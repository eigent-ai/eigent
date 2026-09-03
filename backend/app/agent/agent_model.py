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
from typing import Any

from camel.messages import BaseMessage
from camel.models import ModelFactory
from camel.toolkits import FunctionTool, RegisteredAgentToolkit
from camel.types import ModelPlatformType

from app.agent.listen_chat_agent import ListenChatAgent, logger
from app.model.chat import AgentModelConfig, Chat
from app.model.model_platform import (
    azure_reasoning_tools_require_responses_api,
    is_eigent_cloud_model_endpoint,
    patch_azure_cloud_config,
    patch_bedrock_cloud_config,
    resolve_cloud_model_runtime_platform,
)
from app.model.subscription_runtime import (
    apply_subscription_runtime,
    is_subscription_auth,
)
from app.run_journal.model_capture import instrument_model_backend
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


def _responses_instructions(system_message: str | BaseMessage) -> str:
    """Return the trusted agent prompt for the Responses instructions field."""
    if isinstance(system_message, str):
        return system_message

    content = getattr(system_message, "content", "")
    return content if isinstance(content, str) else ""


def _configure_responses_instructions(model_backend: Any) -> None:
    """Keep system/developer text only in Responses `instructions`.

    CAMEL converts the agent system message into an input item. Eigent also
    supplies that trusted text through `instructions` so it is present on every
    chained response. Remove the duplicate input item to avoid sending and
    billing the same prompt twice.
    """
    if getattr(model_backend, "_eigent_instructions_configured", False):
        return

    prepare = getattr(
        model_backend, "_prepare_responses_input_and_chain", None
    )
    if not callable(prepare):
        return

    def prepare_without_instruction_messages(messages, chain_enabled=True):
        state = prepare(messages, chain_enabled=chain_enabled)
        input_messages = state.get("input_messages")
        if not isinstance(input_messages, list):
            return state

        filtered = [
            item
            for item in input_messages
            if not (
                isinstance(item, dict)
                and item.get("role") in {"system", "developer"}
            )
        ]
        if len(filtered) == len(input_messages):
            return state

        return {**state, "input_messages": filtered}

    model_backend._prepare_responses_input_and_chain = (  # noqa: SLF001
        prepare_without_instruction_messages
    )
    model_backend._eigent_instructions_configured = True  # noqa: SLF001


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
        is_effective_cloud = is_eigent_cloud_model_endpoint(effective_api_url)

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
        if not (
            custom_model_config and custom_model_config.has_custom_config()
        ):
            effort_parameter = getattr(
                task_lock,
                "provider_effort_parameter_name",
                None,
            )
            effort_value = getattr(
                task_lock,
                "provider_effort_parameter_value",
                None,
            )
            if (
                isinstance(effort_parameter, str)
                and effort_parameter
                and isinstance(effort_value, str)
                and effort_value != "provider_default"
            ):
                model_config[effort_parameter] = effort_value

        # Eigent Cloud transports are declared by the server-owned model
        # catalog. This lets future models select Responses without a Desktop
        # release. User-managed Azure GPT-5.6 endpoints retain the model-family
        # fallback because they do not have server capability metadata.
        has_function_tools = bool(
            tools or tool_names or toolkits_to_register_agent
        )
        uses_responses_transport = init_params.get("api_mode") == "responses"
        should_use_azure_responses_fallback = (
            not is_effective_cloud
            and has_function_tools
            and model_config.get("reasoning_effort")
            not in {None, "", "provider_default"}
            and azure_reasoning_tools_require_responses_api(
                model_platform=str(effective_config["model_platform"]),
                model_type=str(effective_config["model_type"]),
            )
        )
        if should_use_azure_responses_fallback:
            init_params["api_mode"] = "responses"
            uses_responses_transport = True

        if uses_responses_transport and model_config.get(
            "reasoning_effort"
        ) not in {None, "", "provider_default"}:
            reasoning_effort = model_config.pop("reasoning_effort")
            model_config["reasoning"] = {"effort": reasoning_effort}
            logger.info(
                "Using Responses API reasoning for model %s",
                effective_config["model_type"],
            )

        if uses_responses_transport:
            # Responses does not carry a prior response's `instructions`
            # forward when `previous_response_id` is used. Send the trusted
            # agent prompt on every call so the proxy Prompt Guard can validate
            # continuation/tool turns without weakening its fail-closed rule.
            instructions = _responses_instructions(system_message)
            if instructions:
                model_config["instructions"] = instructions

        runtime_model_platform = resolve_cloud_model_runtime_platform(
            model_platform=str(effective_config["model_platform"]),
            api_url=effective_api_url,
            api_mode=init_params.get("api_mode"),
        )
        if runtime_model_platform != effective_config["model_platform"]:
            # These options belong to AzureOpenAI's constructor.  Passing
            # them to AsyncOpenAI would fail before the request is sent.
            for azure_only_param in (
                "api_version",
                "azure_ad_token",
                "azure_ad_token_provider",
                "azure_deployment_name",
            ):
                init_params.pop(azure_only_param, None)
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
        if uses_responses_transport:
            # stream_options belongs to Chat Completions. Azure Responses
            # rejects it, including when a caller supplied it explicitly.
            model_config.pop("stream_options", None)
        elif model_config.get("stream_options") is False:
            model_config.pop("stream_options")
        elif model_config.get("stream") and (
            effective_config["model_platform"].lower()
            not in _NATIVE_STREAM_USAGE_PLATFORMS
        ):
            stream_options = model_config.setdefault("stream_options", {})
            if isinstance(stream_options, dict):
                stream_options.setdefault("include_usage", True)

        model_backend = ModelFactory.create(
            model_platform=runtime_model_platform,
            model_type=effective_config["model_type"],
            api_key=effective_config["api_key"],
            url=effective_config["api_url"],
            model_config_dict=model_config or None,
            timeout=600,  # 10 minutes
            **init_params,
        )
        if uses_responses_transport and model_config.get("instructions"):
            _configure_responses_instructions(model_backend)
        return instrument_model_backend(
            model_backend,
            agent_id=agent_id,
            provider=str(effective_config["model_platform"]),
            model_name=str(effective_config["model_type"]),
        )

    model = build_model()

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
        model_reload_callback=(
            (lambda: build_model(force_refresh=True))
            if use_subscription_runtime
            else None
        ),
        stream_accumulate=False,
    )
