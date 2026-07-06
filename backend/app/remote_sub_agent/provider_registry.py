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

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.remote_sub_agent.constants import DEFAULT_REMOTE_SUB_AGENT_PROVIDER
from app.remote_sub_agent.providers.gemini_agents import GeminiAgentsProvider
from app.remote_sub_agent.types import RemoteSubAgentProvider


@dataclass(frozen=True, slots=True)
class ProviderBuildOptions:
    timeout_seconds: float | None = None


@dataclass(frozen=True, slots=True)
class RemoteSubAgentProviderAdapter:
    name: str
    build: Callable[[Any, ProviderBuildOptions], RemoteSubAgentProvider]
    is_configured: Callable[[Any], bool]


def get_configured_provider_name(
    remote_sub_agent_config: Any | None,
) -> str:
    return (
        _config_str(
            remote_sub_agent_config,
            "provider",
            DEFAULT_REMOTE_SUB_AGENT_PROVIDER,
        )
        or DEFAULT_REMOTE_SUB_AGENT_PROVIDER
    )


def get_provider_config(
    remote_sub_agent_config: Any | None,
    provider_name: str | None = None,
) -> Any:
    provider = provider_name or get_configured_provider_name(
        remote_sub_agent_config
    )
    return _config_value(remote_sub_agent_config, provider, {})


def get_provider_max_wall_time_seconds(
    remote_sub_agent_config: Any | None,
    default: int = 600,
) -> int:
    provider_config = get_provider_config(remote_sub_agent_config)
    return _config_int(provider_config, "max_wall_time_seconds", default)


def is_remote_sub_agent_provider_configured(
    remote_sub_agent_config: Any | None,
) -> bool:
    provider_name = get_configured_provider_name(remote_sub_agent_config)
    adapter = _PROVIDER_ADAPTERS.get(provider_name)
    if adapter is None:
        return False
    return adapter.is_configured(get_provider_config(remote_sub_agent_config))


def build_remote_sub_agent_provider(
    remote_sub_agent_config: Any | None,
    *,
    options: ProviderBuildOptions | None = None,
) -> RemoteSubAgentProvider:
    provider_name = get_configured_provider_name(remote_sub_agent_config)
    adapter = _PROVIDER_ADAPTERS.get(provider_name)
    if adapter is None:
        known = ", ".join(sorted(_PROVIDER_ADAPTERS))
        raise ValueError(
            f"Unsupported remote sub agent provider: {provider_name}. "
            f"Known providers: {known}"
        )
    return adapter.build(
        get_provider_config(remote_sub_agent_config, provider_name),
        options or ProviderBuildOptions(),
    )


async def validate_remote_sub_agent_provider(
    remote_sub_agent_config: Any | None,
    *,
    options: ProviderBuildOptions | None = None,
) -> dict[str, Any]:
    provider = build_remote_sub_agent_provider(
        remote_sub_agent_config,
        options=options,
    )
    validate_connection = getattr(provider, "validate_connection", None)
    if not callable(validate_connection):
        raise ValueError(
            f"Remote sub agent provider '{provider.name}' does not support "
            "connection validation."
        )

    result = validate_connection()
    if isinstance(result, Awaitable):
        return await result
    return result


def _build_gemini_provider(
    config: Any,
    options: ProviderBuildOptions,
) -> GeminiAgentsProvider:
    return GeminiAgentsProvider(
        api_key=_config_str(config, "api_key"),
        base_url=_config_str(config, "base_url") or None,
        agent_name=_config_str(config, "agent_name") or None,
        poll_interval_seconds=_config_float(
            config,
            "poll_interval_seconds",
        ),
        timeout=options.timeout_seconds,
    )


def _is_gemini_configured(config: Any) -> bool:
    return bool(
        _config_str(config, "api_key")
        and _config_str(config, "base_url")
        and _config_str(config, "agent_name")
    )


def _config_value(config: Any, key: str, default: Any = None) -> Any:
    if config is None:
        return default
    if isinstance(config, dict):
        return config.get(key, default)
    return getattr(config, key, default)


def _config_str(
    config: Any,
    key: str,
    default: str | None = "",
) -> str:
    value = _config_value(config, key, default)
    if value is None:
        return ""
    return str(value).strip()


def _config_float(config: Any, key: str) -> float | None:
    value = _config_value(config, key)
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _config_int(config: Any, key: str, default: int) -> int:
    value = _config_value(config, key)
    if value in (None, ""):
        return default
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return default


_PROVIDER_ADAPTERS: dict[str, RemoteSubAgentProviderAdapter] = {
    GeminiAgentsProvider.name: RemoteSubAgentProviderAdapter(
        name=GeminiAgentsProvider.name,
        build=_build_gemini_provider,
        is_configured=_is_gemini_configured,
    ),
}
