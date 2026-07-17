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

import pytest

from app.remote_sub_agent.provider_registry import (
    build_remote_sub_agent_provider,
    get_configured_provider_name,
    get_provider_max_wall_time_seconds,
    is_remote_sub_agent_provider_configured,
)
from app.remote_sub_agent.providers.gemini_agents import GeminiAgentsProvider

pytestmark = pytest.mark.unit


def _config() -> dict:
    return {
        "enabled": True,
        "provider": "gemini_agents",
        "gemini_agents": {
            "api_key": "test-key",
            "base_url": "https://example.test/v1beta",
            "agent_name": "antigravity-preview-05-2026",
            "max_wall_time_seconds": 900,
            "poll_interval_seconds": 7,
        },
    }


def test_registry_reads_selected_provider():
    assert get_configured_provider_name(_config()) == "gemini_agents"


def test_registry_checks_provider_specific_required_fields():
    assert is_remote_sub_agent_provider_configured(_config()) is True

    incomplete = _config()
    incomplete["gemini_agents"] = {
        **incomplete["gemini_agents"],
        "api_key": "",
    }

    assert is_remote_sub_agent_provider_configured(incomplete) is False


def test_registry_builds_gemini_provider_from_provider_config():
    provider = build_remote_sub_agent_provider(_config())

    assert isinstance(provider, GeminiAgentsProvider)
    assert provider.name == "gemini_agents"
    assert provider.api_key == "test-key"
    assert provider.base_url == "https://example.test/v1beta"
    assert provider.agent_name == "antigravity-preview-05-2026"
    assert provider.poll_interval_seconds == 7


def test_registry_rejects_unknown_provider():
    with pytest.raises(ValueError, match="Unsupported remote sub agent"):
        build_remote_sub_agent_provider(
            {
                "enabled": True,
                "provider": "other_provider",
                "other_provider": {},
            }
        )


def test_registry_reads_max_wall_time_from_selected_provider_config():
    assert get_provider_max_wall_time_seconds(_config()) == 900
