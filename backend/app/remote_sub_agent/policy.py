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

from dataclasses import dataclass
from fnmatch import fnmatch
from pathlib import Path
from typing import Any

from app.component.environment import env
from app.remote_sub_agent.constants import DEFAULT_REMOTE_SUB_AGENT_PROVIDER
from app.remote_sub_agent.provider_registry import (
    get_configured_provider_name,
    get_provider_max_wall_time_seconds,
)

_TRUTHY = {"1", "true", "yes", "y", "on"}
_DEFAULT_MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024


def _parse_bool(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in _TRUTHY


def _parse_int(value: object, default: int) -> int:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return default


def _parse_providers(raw: str | None) -> tuple[str, ...]:
    if not raw:
        return (DEFAULT_REMOTE_SUB_AGENT_PROVIDER,)
    providers = tuple(item.strip() for item in raw.split(",") if item.strip())
    return providers or (DEFAULT_REMOTE_SUB_AGENT_PROVIDER,)


def _config_value(config: Any, key: str, default: Any = None) -> Any:
    if config is None:
        return default
    if isinstance(config, dict):
        return config.get(key, default)
    return getattr(config, key, default)


@dataclass(frozen=True, slots=True)
class RemoteSubAgentPolicy:
    enabled: bool = False
    allowed_providers: tuple[str, ...] = (DEFAULT_REMOTE_SUB_AGENT_PROVIDER,)
    allow_snapshot_download: bool = False
    max_wall_time_seconds: int = 600
    max_snapshot_bytes: int = _DEFAULT_MAX_SNAPSHOT_BYTES
    working_directory: Path | None = None
    deny_path_globs: tuple[str, ...] = (
        ".env",
        ".env.*",
        "**/.env",
        "**/.env.*",
        ".ssh/**",
        "**/.ssh/**",
        "**/*_rsa",
        "**/*_dsa",
        "**/*_ecdsa",
        "**/*_ed25519",
        "**/id_rsa",
        "**/id_dsa",
        "**/id_ecdsa",
        "**/id_ed25519",
        "**/*token*",
        "**/*secret*",
        "**/*credential*",
    )

    def ensure_enabled(self) -> None:
        if not self.enabled:
            raise PermissionError(
                "RemoteSubAgent is disabled. Enable and configure it in "
                "Agents > Models > Sub Agents."
            )

    def ensure_provider_allowed(self, provider: str) -> None:
        if provider not in self.allowed_providers:
            allowed = ", ".join(self.allowed_providers)
            raise PermissionError(
                f"RemoteSubAgent provider '{provider}' is not allowed. "
                f"Allowed providers: {allowed}"
            )

    def ensure_file_in_scope(self, path: str | Path) -> Path:
        if self.working_directory is None:
            raise PermissionError(
                "RemoteSubAgent file access requires a working directory."
            )

        resolved = Path(path).expanduser().resolve()
        root = self.working_directory.expanduser().resolve()

        try:
            relative = resolved.relative_to(root)
        except ValueError:
            raise PermissionError(
                f"RemoteSubAgent file access is outside scope: {resolved}"
            )

        relative_posix = relative.as_posix()
        if self._matches_denylist(relative_posix, resolved.name):
            raise PermissionError(
                f"RemoteSubAgent file access denied by policy: {relative}"
            )

        return resolved

    def _matches_denylist(self, relative_posix: str, name: str) -> bool:
        return any(
            fnmatch(relative_posix, pattern) or fnmatch(name, pattern)
            for pattern in self.deny_path_globs
        )


def build_default_policy(
    working_directory: str | Path | None = None,
) -> RemoteSubAgentPolicy:
    snapshot_mb = _parse_int(
        env("EIGENT_REMOTE_SUB_AGENT_MAX_SNAPSHOT_MB"),
        _DEFAULT_MAX_SNAPSHOT_BYTES // (1024 * 1024),
    )
    return RemoteSubAgentPolicy(
        enabled=_parse_bool(env("EIGENT_REMOTE_SUB_AGENT_ENABLED"), False),
        allowed_providers=_parse_providers(
            env("EIGENT_REMOTE_SUB_AGENT_ALLOWED_PROVIDERS")
        ),
        allow_snapshot_download=_parse_bool(
            env("EIGENT_REMOTE_SUB_AGENT_ALLOW_SNAPSHOT_DOWNLOAD"),
            False,
        ),
        max_wall_time_seconds=_parse_int(
            env("EIGENT_REMOTE_SUB_AGENT_MAX_WALL_TIME_SECONDS"),
            600,
        ),
        max_snapshot_bytes=snapshot_mb * 1024 * 1024,
        working_directory=(
            Path(working_directory) if working_directory is not None else None
        ),
    )


def build_configured_policy(
    remote_sub_agent_config: Any | None = None,
    working_directory: str | Path | None = None,
) -> RemoteSubAgentPolicy:
    enabled = _parse_bool(_config_value(remote_sub_agent_config, "enabled"))
    provider = get_configured_provider_name(remote_sub_agent_config)
    max_wall_time_seconds = get_provider_max_wall_time_seconds(
        remote_sub_agent_config,
        default=600,
    )

    return RemoteSubAgentPolicy(
        enabled=enabled,
        allowed_providers=(provider,),
        allow_snapshot_download=False,
        max_wall_time_seconds=max_wall_time_seconds,
        max_snapshot_bytes=_DEFAULT_MAX_SNAPSHOT_BYTES,
        working_directory=(
            Path(working_directory) if working_directory is not None else None
        ),
    )
