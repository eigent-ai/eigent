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

"""
Hands = Brain capabilities, driven by deployment env, not by Channel.

- Brain on local/cloud VM -> full capabilities (extensible: smart home, router, car, etc.)
- Brain in sandbox/Docker -> limited capabilities
- Channel only affects message display format
- MCP is available in all deployment modes
"""

import logging

from app.component.environment import env
from app.hands import (
    FullHands,
    HandsClusterConfigError,
    HandsClusterRoutingConfig,
    HttpHandsCluster,
    IHands,
    IHandsCluster,
    RemoteHands,
    RoutedHandsCluster,
    SandboxHands,
    load_hands_cluster_config,
)
from app.hands.capabilities import detect_capabilities
from app.hands.environment_hands import EnvironmentHands

logger = logging.getLogger("hands.resolver")

# Global EnvironmentHands singleton, initialized at startup
_environment_hands: IHands | None = None


def _is_truthy(raw: str | None) -> bool:
    if raw is None:
        return False
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _new_http_cluster(
    cluster_api: str,
    timeout_seconds: float,
    verify_tls: bool,
    auth_token: str | None,
    acquire_path: str,
    release_path: str,
    health_path: str,
) -> HttpHandsCluster:
    logger.info(
        "Configured HttpHandsCluster",
        extra={
            "cluster_api": cluster_api,
            "acquire_path": acquire_path,
            "release_path": release_path,
            "health_path": health_path,
            "verify_tls": verify_tls,
            "has_auth_token": bool(auth_token),
            "timeout_seconds": timeout_seconds,
        },
    )
    return HttpHandsCluster(
        base_url=cluster_api,
        timeout_seconds=timeout_seconds,
        verify_tls=verify_tls,
        auth_token=auth_token,
        acquire_path=acquire_path,
        release_path=release_path,
        health_path=health_path,
    )


def _build_remote_cluster() -> IHandsCluster | None:
    config_file = env("EIGENT_HANDS_CLUSTER_CONFIG_FILE", "").strip()
    if not config_file:
        return None

    try:
        routing = load_hands_cluster_config(config_file)
    except HandsClusterConfigError as exc:
        logger.warning(
            "Failed to load hands cluster config file %r: %s",
            config_file,
            exc,
        )
        return None

    logger.info(
        "Loaded hands cluster config file",
        extra={
            "config_file": routing.source_path,
            "routes": sorted(routing.route_to_cluster.keys()),
        },
    )
    return _build_cluster_from_routing(routing)


def _build_cluster_from_routing(
    routing: HandsClusterRoutingConfig,
) -> IHandsCluster:
    clusters_by_name: dict[str, IHandsCluster] = {}
    route_clients: dict[str, IHandsCluster] = {}

    for route_key, endpoint in routing.route_to_cluster.items():
        client = clusters_by_name.get(endpoint.name)
        if client is None:
            client = _new_http_cluster(
                endpoint.base_url,
                timeout_seconds=endpoint.timeout_seconds,
                verify_tls=endpoint.verify_tls,
                auth_token=endpoint.auth_token,
                acquire_path=endpoint.acquire_path,
                release_path=endpoint.release_path,
                health_path=endpoint.health_path,
            )
            clusters_by_name[endpoint.name] = client
        route_clients[route_key] = client

    if len(route_clients) == 1 and "default" in route_clients:
        return route_clients["default"]
    return RoutedHandsCluster(clusters=route_clients)


def _create_remote_hands(workspace_root: str) -> RemoteHands:
    cluster = _build_remote_cluster()
    if cluster is None:
        logger.warning(
            "RemoteHands enabled but EIGENT_HANDS_CLUSTER_CONFIG_FILE is missing/invalid; "
            "browser resource acquisition will fallback to localhost endpoint"
        )
    return RemoteHands(cluster=cluster, workspace_root=workspace_root)


def init_environment_hands(config: dict | None = None) -> IHands:
    """Initialize global EnvironmentHands (capability set) at Brain startup"""
    global _environment_hands
    mode = env("EIGENT_HANDS_MODE", "").strip().lower()
    remote_enabled = _is_truthy(env("EIGENT_HANDS_REMOTE", "false"))

    if mode == "remote" or remote_enabled:
        workspace_root = env("EIGENT_WORKSPACE", "~/.eigent/workspace")
        logger.info(
            "Initializing RemoteHands from env switch",
            extra={"mode": mode, "remote_enabled": remote_enabled},
        )
        _environment_hands = _create_remote_hands(workspace_root)
        return _environment_hands

    caps = detect_capabilities(config)
    _environment_hands = EnvironmentHands(caps)
    return _environment_hands


def get_environment_hands() -> IHands:
    """Return global EnvironmentHands, shared by all Channels. Auto-detect if not initialized."""
    global _environment_hands
    if _environment_hands is None:
        init_environment_hands()
    return _environment_hands


def _reset_environment_hands_for_testing() -> None:
    """Testing only: reset global Hands so it can be re-initialized with new env."""
    global _environment_hands
    _environment_hands = None


def get_hands_for_channel(
    _channel: str,
    hands_override: str | None = None,
    workspace_root: str | None = None,
) -> IHands:
    """
    Return Hands (Brain capability) instance. Capabilities driven by deployment env; Channel not involved.

    - _channel: Kept for API compatibility; not used (Hands are env-driven per ADR-0006)
    - hands_override: For debugging; force full/sandbox/remote
    - workspace_root: Override workspace root (optional)
    """
    root = workspace_root or env("EIGENT_WORKSPACE", "~/.eigent/workspace")

    if hands_override:
        if hands_override in ("full", "sandbox", "remote"):
            if hands_override == "remote":
                return _create_remote_hands(root)
            cls = {"full": FullHands, "sandbox": SandboxHands}[hands_override]
            return cls(workspace_root=root)
        logger.warning(
            "Ignoring invalid X-Hands-Override: %r, expected full, sandbox or remote",
            hands_override,
        )

    return get_environment_hands()
