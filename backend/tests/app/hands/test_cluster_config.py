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

from pathlib import Path

import pytest

from app.hands.cluster_config import (
    HandsClusterConfigError,
    load_hands_cluster_config,
)


@pytest.mark.unit
def test_load_cluster_config_with_routes_and_env_token(tmp_path: Path):
    config = tmp_path / "hands_clusters.toml"
    config.write_text(
        """
[defaults]
timeout_seconds = 12
verify_tls = true
acquire_path = "/acquire"
release_path = "/release"
health_path = "/health"

[routes]
browser = "browser_pool"
terminal = "terminal_pool"
default = "gateway"

[clusters.gateway]
base_url = "http://hands-gateway.local"

[clusters.browser_pool]
base_url = "http://browser-cluster.local"
auth_token_env = "BROWSER_CLUSTER_TOKEN"

[clusters.terminal_pool]
api = "http://terminal-cluster.local"
verify_tls = false
""".strip(),
        encoding="utf-8",
    )
    routing = load_hands_cluster_config(
        str(config),
        read_env=lambda name: "token_browser"
        if name == "BROWSER_CLUSTER_TOKEN"
        else None,
    )

    assert set(routing.route_to_cluster.keys()) == {
        "browser",
        "terminal",
        "default",
    }
    assert (
        routing.route_to_cluster["browser"].base_url
        == "http://browser-cluster.local"
    )
    assert routing.route_to_cluster["browser"].auth_token == "token_browser"
    assert routing.route_to_cluster["terminal"].verify_tls is False
    assert routing.route_to_cluster["default"].timeout_seconds == 12


@pytest.mark.unit
def test_load_cluster_config_without_routes_single_cluster_defaults_to_default(
    tmp_path: Path,
):
    config = tmp_path / "hands_clusters.toml"
    config.write_text(
        """
[clusters.default]
base_url = "http://hands-gateway.local"
""".strip(),
        encoding="utf-8",
    )
    routing = load_hands_cluster_config(str(config))
    assert set(routing.route_to_cluster.keys()) == {"default"}
    assert (
        routing.route_to_cluster["default"].base_url
        == "http://hands-gateway.local"
    )


@pytest.mark.unit
def test_load_cluster_config_normalizes_fallback_route(tmp_path: Path):
    config = tmp_path / "hands_clusters.toml"
    config.write_text(
        """
[routes]
fallback = "gateway"

[clusters.gateway]
base_url = "http://hands-gateway.local"
""".strip(),
        encoding="utf-8",
    )
    routing = load_hands_cluster_config(str(config))
    assert set(routing.route_to_cluster.keys()) == {"default"}


@pytest.mark.unit
def test_load_cluster_config_invalid_route_target_raises(tmp_path: Path):
    config = tmp_path / "hands_clusters.toml"
    config.write_text(
        """
[routes]
browser = "missing_cluster"

[clusters.gateway]
base_url = "http://hands-gateway.local"
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(HandsClusterConfigError):
        load_hands_cluster_config(str(config))


@pytest.mark.unit
def test_load_cluster_config_missing_file_raises():
    with pytest.raises(HandsClusterConfigError):
        load_hands_cluster_config("/tmp/non-existent-hands-cluster.toml")
