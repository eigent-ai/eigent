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

import inspect

import pytest
from pydantic import ValidationError

from app.model.remote_sub_agent.provider import RemoteSubAgentProviderIn


class TestRemoteSubAgentProviderSchema:
    def test_disabled_provider_requires_credentials(self):
        with pytest.raises(ValidationError):
            RemoteSubAgentProviderIn(
                provider_name="gemini_agents",
                enabled=False,
            )

    def test_disabled_provider_accepts_agent_configuration(self):
        config = RemoteSubAgentProviderIn(
            provider_name="gemini_agents",
            enabled=False,
            api_key="test-key",
            endpoint_url="https://generativelanguage.googleapis.com/v1beta",
            agent_name="antigravity-preview-05-2026",
            config={
                "max_wall_time_seconds": 900,
                "poll_interval_seconds": 5,
            },
        )

        assert config.provider_name == "gemini_agents"
        assert config.enabled is False

    def test_enabled_provider_requires_credentials(self):
        with pytest.raises(ValidationError):
            RemoteSubAgentProviderIn(
                provider_name="gemini_agents",
                enabled=True,
                api_key="",
                endpoint_url="",
                agent_name="",
                model_name="",
            )

    def test_enabled_provider_accepts_agent_configuration(self):
        config = RemoteSubAgentProviderIn(
            provider_name="gemini_agents",
            enabled=True,
            api_key="test-key",
            endpoint_url="https://generativelanguage.googleapis.com/v1beta",
            agent_name="antigravity-preview-05-2026",
            config={
                "max_wall_time_seconds": 900,
                "poll_interval_seconds": 5,
            },
        )

        assert config.enabled is True

    def test_enabled_provider_rejects_model_only_configuration(self):
        with pytest.raises(ValidationError):
            RemoteSubAgentProviderIn(
                provider_name="gemini_agents",
                enabled=True,
                api_key="test-key",
                endpoint_url="https://generativelanguage.googleapis.com/v1beta",
                agent_name="",
                model_name="gemini-3-flash-preview",
            )


class TestRemoteSubAgentProviderAuth:
    def test_provider_endpoints_require_auth(self):
        from app.domains.remote_sub_agent.api import provider_controller

        endpoints = [
            provider_controller.list_remote_sub_agent_providers,
            provider_controller.get_remote_sub_agent_provider,
            provider_controller.create_remote_sub_agent_provider,
            provider_controller.update_remote_sub_agent_provider,
            provider_controller.delete_remote_sub_agent_provider,
        ]

        for endpoint in endpoints:
            assert "auth" in inspect.signature(endpoint).parameters
