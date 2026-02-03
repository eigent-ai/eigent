# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import logging
import uuid
from typing import Any, Callable

from camel.messages import BaseMessage
from camel.models import ModelFactory
from camel.toolkits import FunctionTool, RegisteredAgentToolkit
from camel.types import ModelPlatformType

from app.utils.event_loop_utils import _schedule_async_task
from app.agent.listen_chat_agent import ListenChatAgent, logger
from app.model.chat import AgentModelConfig, Chat
from app.service.task import ActionCreateAgentData, Agents, get_task_lock


def agent_model(
    agent_name: str,
    system_message: str | BaseMessage,
    options: Chat,
    tools: list[FunctionTool | Callable] | None = None,
    prune_tool_calls_from_memory: bool = False,
    tool_names: list[str] | None = None,
    toolkits_to_register_agent: list[RegisteredAgentToolkit] | None = None,
    enable_snapshot_clean: bool = False,
    custom_model_config: AgentModelConfig | None = None,
):
    task_lock = get_task_lock(options.project_id)
    agent_id = str(uuid.uuid4())
    logger.info(
        f"Creating agent: {agent_name} with id: {agent_id} "
        f"for project: {options.project_id}"
    )
    # Use thread-safe scheduling to support parallel agent creation
    _schedule_async_task(
        task_lock.put_queue(
            ActionCreateAgentData(
                data={
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "tools": tool_names or [],
                }
            )
        )
    )

    # Determine model configuration - use custom config if provided,
    # otherwise use task defaults
    config_attrs = ["model_platform", "model_type", "api_key", "api_url"]
    effective_config = {}

    if custom_model_config and custom_model_config.has_custom_config():
        for attr in config_attrs:
            effective_config[attr] = getattr(custom_model_config, attr,
                                             None) or getattr(options, attr)
        extra_params = (
            custom_model_config.extra_params or options.extra_params or {}
        )
        logger.info(
            f"Agent {agent_name} using custom model config: "
            f"platform={effective_config['model_platform']}, "
            f"type={effective_config['model_type']}"
        )
    else:
        for attr in config_attrs:
            effective_config[attr] = getattr(options, attr)
        extra_params = options.extra_params or {}
    init_param_keys = {
        "api_version",
        "azure_ad_token",
        "azure_ad_token_provider",
        "max_retries",
        "timeout",
        "client",
        "async_client",
        "azure_deployment_name",
    }

    init_params = {}
    model_config: dict[str, Any] = {}

    if options.is_cloud():
        model_config["user"] = str(options.project_id)

    excluded_keys = {"model_platform", "model_type", "api_key", "url"}

    # Distribute extra_params between init_params and model_config
    for k, v in extra_params.items():
        if k in excluded_keys:
            continue
        # Skip empty values
        if v is None or (isinstance(v, str) and not v.strip()):
            continue

        if k in init_param_keys:
            init_params[k] = v
        else:
            model_config[k] = v

    if agent_name == Agents.task_agent:
        model_config["stream"] = True
    if agent_name == Agents.browser_agent:
        try:
            model_platform_enum = ModelPlatformType(
                effective_config["model_platform"].lower()
            )
            if model_platform_enum in {
                ModelPlatformType.OPENAI,
                ModelPlatformType.AZURE,
                ModelPlatformType.OPENAI_COMPATIBLE_MODEL,
                ModelPlatformType.LITELLM,
                ModelPlatformType.OPENROUTER,
            }:
                model_config["parallel_tool_calls"] = False
        except (ValueError, AttributeError):
            logging.error(
                f"Invalid model platform for browser agent: "
                f"{effective_config['model_platform']}",
                exc_info=True,
            )
            model_platform_enum = None

    model = ModelFactory.create(
        model_platform=effective_config["model_platform"],
        model_type=effective_config["model_type"],
        api_key=effective_config["api_key"],
        url=effective_config["api_url"],
        model_config_dict=model_config or None,
        timeout=600,  # 10 minutes
        **init_params,
    )

    return ListenChatAgent(
        options.project_id,
        agent_name,
        system_message,
        model=model,
        tools=tools,
        agent_id=agent_id,
        prune_tool_calls_from_memory=prune_tool_calls_from_memory,
        toolkits_to_register_agent=toolkits_to_register_agent,
        enable_snapshot_clean=enable_snapshot_clean,
        stream_accumulate=False,
    )
