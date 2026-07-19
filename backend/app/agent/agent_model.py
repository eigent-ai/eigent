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
from collections.abc import Callable
from copy import deepcopy
from typing import Any

from camel.messages import BaseMessage
from camel.models import ModelFactory
from camel.toolkits import FunctionTool, RegisteredAgentToolkit
from camel.types import ModelPlatformType

from app.agent.listen_chat_agent import ListenChatAgent, logger
from app.model.chat import AgentModelConfig, Chat
from app.model.model_platform import (
    patch_azure_cloud_config,
    patch_bedrock_cloud_config,
)
from app.model.subscription_runtime import (
    apply_subscription_runtime,
    is_subscription_auth,
)
from app.service.task import ActionCreateAgentData, Agents, get_task_lock
from app.utils.event_loop_utils import _schedule_async_task

# OpenAI chat-completions streaming only returns token usage when
# `stream_options.include_usage` is requested. Without it the request-level
# usage callback (on_request_usage) fires with 0 tokens, and because the
# step-level deactivate is zeroed once request-level reporting is active,
# streaming steps end up uncounted. These platforms use native (non-OpenAI)
# SDKs that reject `stream_options` and surface streaming usage on their own,
# so they are excluded from the injection below.
_NATIVE_STREAM_USAGE_PLATFORMS = {
    "anthropic",
    "aws-bedrock",
    "aws-bedrock-converse",
    "cohere",
    "mistral",
    "reka",
    "watsonx",
}


def _ensure_additional_props_false_for_groq(
    tools: list[FunctionTool | Callable] | None,
    model_platform: str,
) -> list[FunctionTool | Callable] | None:
    """Ensure additionalProperties: false on all object schemas for Groq.

    Groq's API requires strict JSON schemas with 'additionalProperties: false'
    on every object type, including nested objects in anyOf/oneOf arrays.
    CAMEL's sanitize_and_enforce_required() already does this, but we apply
    it here as a safety net when tools are passed to the agent.

    Args:
        tools: List of FunctionTool or callable tools
        model_platform: The model platform string (e.g., "groq")

    Returns:
        Modified tools list with additionalProperties: false enforced, or None if input was None
    """
    if not tools:
        return tools

    if model_platform.lower() != "groq":
        return tools

    def _ensure_additional_props_false(obj: Any) -> Any:
        """Recursively ensure additionalProperties: false on all object schemas."""
        if isinstance(obj, dict):
            new_obj = {}
            for k, v in obj.items():
                if k == "type" and v == "object" and "additionalProperties" not in obj:
                    new_obj[k] = v
                    new_obj["additionalProperties"] = False
                elif k in ("properties", "$defs") and isinstance(v, dict):
                    new_obj[k] = {pk: _ensure_additional_props_false(pv) for pk, pv in v.items()}
                elif k in ("items", "allOf", "oneOf", "anyOf") and isinstance(v, (dict, list)):
                    if isinstance(v, dict):
                        new_obj[k] = _ensure_additional_props_false(v)
                    else:
                        new_obj[k] = [_ensure_additional_props_false(item) for item in v]
                else:
                    new_obj[k] = _ensure_additional_props_false(v)
            return new_obj
        elif isinstance(obj, list):
            return [_ensure_additional_props_false(item) for item in obj]
        return obj

    modified_tools = []
    for tool in tools:
        if isinstance(tool, FunctionTool):
            schema = tool.get_openai_tool_schema()
            if isinstance(schema, dict) and "function" in schema:
                func_schema = schema["function"]
                new_func_schema = deepcopy(func_schema)

                if "parameters" in new_func_schema:
                    new_func_schema["parameters"] = _ensure_additional_props_false(
                        new_func_schema["parameters"]
                    )

                new_schema = {"type": "function", "function": new_func_schema}
                new_tool = FunctionTool(tool.func, openai_tool_schema=new_schema)
                modified_tools.append(new_tool)
                continue
        modified_tools.append(tool)

    return modified_tools


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
            custom_value = getattr(custom_model_config, attr, None)
            effective_config[attr] = (
                custom_value
                if custom_value is not None
                else getattr(options, attr)
            )
        extra_params = (
            custom_model_config.extra_params
            if custom_model_config.extra_params is not None
            else options.extra_params or {}
        )
        explicit_model_config = (
            custom_model_config.model_config_dict
            if custom_model_config.model_config_dict is not None
            else options.model_config_dict or {}
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
        explicit_model_config = options.model_config_dict or {}

    has_explicit_custom_api_key = (
        custom_model_config is not None
        and custom_model_config.has_custom_config()
        and custom_model_config.api_key is not None
    )
    use_subscription_runtime = (
        is_subscription_auth(options) and not has_explicit_custom_api_key
    )

    base_effective_config = dict(effective_config)
    base_extra_params = dict(extra_params or {})
    base_model_config = dict(explicit_model_config or {})

    def build_model(force_refresh: bool = False):
        effective_config = dict(base_effective_config)
        extra_params = dict(base_extra_params)
        explicit_model_config = dict(base_model_config)

        if use_subscription_runtime:
            effective_config, extra_params = apply_subscription_runtime(
                options,
                effective_config,
                extra_params,
                force_refresh=force_refresh,
            )

        effective_api_url = effective_config.get("api_url")
        is_effective_cloud = isinstance(effective_api_url, str) and any(
            marker in effective_api_url
            for marker in ("eigent-proxy", "proxy.eigent.ai")
        )

        # Cloud mode: inject default Bedrock region and adjust URL for proxy.
        if (
            effective_config.get("model_platform") == "aws-bedrock-converse"
            and is_effective_cloud
        ):
            (
                effective_config["api_url"],
                extra_params,
            ) = patch_bedrock_cloud_config(
                effective_config["api_url"], extra_params
            )
        # Cloud mode: default api_version for Azure-backed models so AzureOpenAI
        # construction does not blow up when the frontend omits extra_params.
        if (
            effective_config.get("model_platform") == "azure"
            and is_effective_cloud
        ):
            extra_params = patch_azure_cloud_config(extra_params)
        init_param_keys = {
            "api_version",
            "azure_ad_token",
            "azure_ad_token_provider",
            "max_retries",
            "timeout",
            "client",
            "async_client",
            "azure_deployment_name",
            "region_name",
            "aws_access_key_id",
            "aws_secret_access_key",
            "aws_session_token",
            "default_headers",
            "api_mode",
        }

        init_params = {}
        model_config: dict[str, Any] = {}

        # A nested model_config_dict may arrive inside legacy extra_params
        # while stored providers migrate to the explicit top-level field.
        # Treat it as less specific than the explicit request field.
        nested_model_config = extra_params.pop("model_config_dict", None)

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

        if isinstance(nested_model_config, dict):
            model_config.update(nested_model_config)

        # The explicit model config is the canonical API and wins over legacy
        # flat values from extra_params.
        model_config.update(explicit_model_config)

        # Auto-inject prompt caching based on model platform
        try:
            model_platform_enum = ModelPlatformType(
                effective_config["model_platform"].lower()
            )
            if model_platform_enum in {
                ModelPlatformType.ANTHROPIC,
                ModelPlatformType.AWS_BEDROCK_CONVERSE,
            }:
                model_config.setdefault("cache_control", "5m")
            elif model_platform_enum == ModelPlatformType.OPENAI:
                model_config.setdefault(
                    "prompt_cache_key", str(options.project_id)
                )
        except (ValueError, AttributeError):
            logging.error(
                f"Invalid model platform: "
                f"{effective_config['model_platform']}",
                exc_info=True,
            )

        # Runtime-owned values are applied after user configuration.
        if is_effective_cloud:
            model_config["user"] = str(options.project_id)
        if use_subscription_runtime:
            model_config["stream"] = True
            model_config["store"] = False
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

        if effective_config["model_platform"].lower() == "anthropic":
            if model_config.get("max_tokens") is None:
                model_config["max_tokens"] = 128000

        # Ensure streaming steps still report token usage. OpenAI-family
        # providers omit usage from streamed responses unless include_usage
        # is set, which would otherwise make request-level accounting count 0.
        # `stream_options: false` in extra_params opts out entirely, for
        # endpoints that reject the parameter (e.g. older vLLM/Azure).
        if model_config.get("stream_options") is False:
            model_config.pop("stream_options")
        elif model_config.get("stream") and (
            effective_config["model_platform"].lower()
            not in _NATIVE_STREAM_USAGE_PLATFORMS
        ):
            stream_options = model_config.setdefault("stream_options", {})
            if isinstance(stream_options, dict):
                stream_options.setdefault("include_usage", True)

        return ModelFactory.create(
            model_platform=effective_config["model_platform"],
            model_type=effective_config["model_type"],
            api_key=effective_config["api_key"],
            url=effective_config["api_url"],
            model_config_dict=model_config or None,
            timeout=600,  # 10 minutes
            **init_params,
        )

    model = build_model()

    # Ensure additionalProperties: false for Groq compatibility
    # (Groq requires strict JSON schemas on all object types)
    effective_platform = effective_config.get("model_platform", "")
    tools_for_agent = _ensure_additional_props_false_for_groq(
        tools, effective_platform
    )

    return ListenChatAgent(
        options.project_id,
        agent_name,
        system_message,
        model=model,
        tools=tools_for_agent,
        agent_id=agent_id,
        prune_tool_calls_from_memory=prune_tool_calls_from_memory,
        toolkits_to_register_agent=toolkits_to_register_agent,
        enable_snapshot_clean=enable_snapshot_clean,
        model_reload_callback=(
            (lambda: build_model(force_refresh=True))
            if use_subscription_runtime
            else None
        ),
        stream_accumulate=False,
    )
