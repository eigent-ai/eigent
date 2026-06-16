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

from __future__ import annotations

import tomllib
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class HandsClusterConfigError(ValueError):
    """Raised when cluster config file is invalid."""


@dataclass(frozen=True, slots=True)
class ClusterEndpointConfig:
    name: str
    base_url: str
    timeout_seconds: float
    verify_tls: bool
    acquire_path: str
    release_path: str
    health_path: str
    auth_token: str | None


@dataclass(frozen=True, slots=True)
class HandsClusterRoutingConfig:
    source_path: str
    route_to_cluster: dict[str, ClusterEndpointConfig]


def load_hands_cluster_config(
    config_file: str,
    read_env: Callable[[str], str | None] | None = None,
) -> HandsClusterRoutingConfig:
    env_reader = read_env or _default_read_env
    source_path = _resolve_config_path(config_file)
    data = _read_toml(source_path)

    defaults = _read_defaults(data.get("defaults"))
    clusters = _read_clusters(data.get("clusters"), defaults, env_reader)
    routes = _read_routes(data.get("routes"), clusters)

    return HandsClusterRoutingConfig(
        source_path=str(source_path),
        route_to_cluster=routes,
    )


def _default_read_env(name: str) -> str | None:
    from app.component.environment import env

    return env(name)


def _resolve_config_path(config_file: str) -> Path:
    raw = (config_file or "").strip()
    if not raw:
        raise HandsClusterConfigError("config file path is empty")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    if not path.exists():
        raise HandsClusterConfigError(
            f"cluster config file does not exist: {path}"
        )
    if not path.is_file():
        raise HandsClusterConfigError(
            f"cluster config path is not a file: {path}"
        )
    return path


def _read_toml(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as handle:
            parsed = tomllib.load(handle)
    except tomllib.TOMLDecodeError as exc:
        raise HandsClusterConfigError(
            f"invalid TOML in cluster config: {path}: {exc}"
        ) from exc
    except OSError as exc:
        raise HandsClusterConfigError(
            f"unable to read cluster config file: {path}: {exc}"
        ) from exc
    if not isinstance(parsed, dict):
        raise HandsClusterConfigError(
            f"cluster config root must be an object: {path}"
        )
    return parsed


def _read_defaults(raw: Any) -> dict[str, Any]:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise HandsClusterConfigError("[defaults] must be a TOML table/object")
    return {
        "timeout_seconds": _as_float(
            raw.get("timeout_seconds"), "defaults.timeout_seconds", 10.0
        ),
        "verify_tls": _as_bool(
            raw.get("verify_tls"), "defaults.verify_tls", True
        ),
        "acquire_path": _as_path_segment(
            raw.get("acquire_path"), "defaults.acquire_path", "/acquire"
        ),
        "release_path": _as_path_segment(
            raw.get("release_path"), "defaults.release_path", "/release"
        ),
        "health_path": _as_path_segment(
            raw.get("health_path"), "defaults.health_path", "/health"
        ),
        "auth_token": _as_optional_str(raw.get("auth_token")),
        "auth_token_env": _as_optional_str(raw.get("auth_token_env")),
    }


def _read_clusters(
    raw: Any,
    defaults: dict[str, Any],
    read_env: Callable[[str], str | None],
) -> dict[str, ClusterEndpointConfig]:
    if not isinstance(raw, dict) or not raw:
        raise HandsClusterConfigError(
            "[clusters] must be a non-empty TOML table/object"
        )

    clusters: dict[str, ClusterEndpointConfig] = {}
    for raw_name, item in raw.items():
        if not isinstance(raw_name, str) or not raw_name.strip():
            raise HandsClusterConfigError(
                "cluster name must be a non-empty string"
            )
        name = raw_name.strip().lower()
        if not isinstance(item, dict):
            raise HandsClusterConfigError(
                f"[clusters.{raw_name}] must be a TOML table/object"
            )

        base_url = _as_optional_str(item.get("base_url")) or _as_optional_str(
            item.get("api")
        )
        if not base_url:
            raise HandsClusterConfigError(
                f"[clusters.{raw_name}] requires base_url (or api)"
            )

        timeout_seconds = _as_float(
            item.get("timeout_seconds"),
            f"clusters.{raw_name}.timeout_seconds",
            defaults["timeout_seconds"],
        )
        verify_tls = _as_bool(
            item.get("verify_tls"),
            f"clusters.{raw_name}.verify_tls",
            defaults["verify_tls"],
        )
        acquire_path = _as_path_segment(
            item.get("acquire_path"),
            f"clusters.{raw_name}.acquire_path",
            defaults["acquire_path"],
        )
        release_path = _as_path_segment(
            item.get("release_path"),
            f"clusters.{raw_name}.release_path",
            defaults["release_path"],
        )
        health_path = _as_path_segment(
            item.get("health_path"),
            f"clusters.{raw_name}.health_path",
            defaults["health_path"],
        )
        auth_token = _resolve_auth_token(
            item=item,
            defaults=defaults,
            read_env=read_env,
        )

        clusters[name] = ClusterEndpointConfig(
            name=name,
            base_url=base_url.strip(),
            timeout_seconds=timeout_seconds,
            verify_tls=verify_tls,
            acquire_path=acquire_path,
            release_path=release_path,
            health_path=health_path,
            auth_token=auth_token,
        )
    return clusters


def _read_routes(
    raw: Any,
    clusters: dict[str, ClusterEndpointConfig],
) -> dict[str, ClusterEndpointConfig]:
    if raw is None:
        if len(clusters) == 1:
            only = next(iter(clusters.values()))
            return {"default": only}
        return dict(clusters)

    if not isinstance(raw, dict):
        raise HandsClusterConfigError("[routes] must be a TOML table/object")

    route_to_cluster: dict[str, ClusterEndpointConfig] = {}
    for raw_route, raw_cluster in raw.items():
        if not isinstance(raw_route, str) or not raw_route.strip():
            raise HandsClusterConfigError(
                "route key must be a non-empty string"
            )
        if not isinstance(raw_cluster, str) or not raw_cluster.strip():
            raise HandsClusterConfigError(
                f"route '{raw_route}' target must be a non-empty string"
            )

        route_key = _normalize_route_key(raw_route)
        cluster_name = raw_cluster.strip().lower()
        cluster = clusters.get(cluster_name)
        if cluster is None:
            raise HandsClusterConfigError(
                f"route '{raw_route}' references unknown cluster '{raw_cluster}'"
            )
        route_to_cluster[route_key] = cluster

    if not route_to_cluster:
        raise HandsClusterConfigError("[routes] must not be empty")
    return route_to_cluster


def _resolve_auth_token(
    item: dict[str, Any],
    defaults: dict[str, Any],
    read_env: Callable[[str], str | None],
) -> str | None:
    direct = _as_optional_str(item.get("auth_token"))
    if direct:
        return direct

    env_name = _as_optional_str(item.get("auth_token_env"))
    if env_name:
        return _as_optional_str(read_env(env_name))

    default_direct = _as_optional_str(defaults.get("auth_token"))
    if default_direct:
        return default_direct

    default_env_name = _as_optional_str(defaults.get("auth_token_env"))
    if default_env_name:
        return _as_optional_str(read_env(default_env_name))

    return None


def _normalize_route_key(raw: str) -> str:
    key = raw.strip().lower()
    if key in ("*", "fallback"):
        return "default"
    return key


def _as_optional_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        return s if s else None
    return str(value).strip() or None


def _as_float(value: Any, field: str, default: float) -> float:
    if value is None:
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise HandsClusterConfigError(
            f"{field} must be a number, got {value!r}"
        ) from exc
    if parsed <= 0:
        raise HandsClusterConfigError(f"{field} must be > 0, got {parsed!r}")
    return parsed


def _as_bool(value: Any, field: str, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("1", "true", "yes", "on"):
            return True
        if lowered in ("0", "false", "no", "off"):
            return False
    raise HandsClusterConfigError(f"{field} must be a boolean, got {value!r}")


def _as_path_segment(value: Any, field: str, default: str) -> str:
    if value is None:
        return default
    if not isinstance(value, str):
        raise HandsClusterConfigError(f"{field} must be a string path")
    s = value.strip()
    if not s:
        raise HandsClusterConfigError(f"{field} must not be empty")
    return s if s.startswith("/") else f"/{s}"
