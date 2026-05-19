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

from app.controller.remote_sub_agent_controller import (
    ValidateRemoteSubAgentRequest,
    validate_remote_sub_agent,
)

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_validate_remote_sub_agent_rejects_missing_fields():
    response = await validate_remote_sub_agent(
        ValidateRemoteSubAgentRequest(
            provider="gemini_agents",
            api_key="",
            base_url="https://example.test/v1beta",
            agent_name="antigravity-preview-05-2026",
        )
    )

    assert response.is_valid is False
    assert "required" in response.message


@pytest.mark.asyncio
async def test_validate_remote_sub_agent_success(monkeypatch):
    seen: dict[str, object] = {}

    async def fake_validate(config, *, options=None):
        seen["config"] = config
        seen["timeout"] = options.timeout_seconds if options else None
        return {
            "id": "interaction-1",
            "environment_id": "env-1",
            "status": "in_progress",
        }

    monkeypatch.setattr(
        "app.controller.remote_sub_agent_controller."
        "validate_remote_sub_agent_provider",
        fake_validate,
    )

    response = await validate_remote_sub_agent(
        ValidateRemoteSubAgentRequest(
            provider="gemini_agents",
            api_key=" test-key ",
            base_url=" https://example.test/v1beta ",
            agent_name=" antigravity-preview-05-2026 ",
            timeout_seconds=12,
        )
    )

    assert response.is_valid is True
    assert response.interaction_id == "interaction-1"
    assert response.environment_id == "env-1"
    assert response.status == "in_progress"
    assert seen["config"] == {
        "enabled": True,
        "provider": "gemini_agents",
        "gemini_agents": {
            "api_key": "test-key",
            "base_url": "https://example.test/v1beta",
            "agent_name": "antigravity-preview-05-2026",
        },
    }
    assert seen["timeout"] == 12


@pytest.mark.asyncio
async def test_validate_remote_sub_agent_failure(monkeypatch):
    async def fake_validate(*_: object, **__: object):
        raise RuntimeError("Gemini Agents API request failed: 401 invalid")

    monkeypatch.setattr(
        "app.controller.remote_sub_agent_controller."
        "validate_remote_sub_agent_provider",
        fake_validate,
    )

    response = await validate_remote_sub_agent(
        ValidateRemoteSubAgentRequest(
            provider="gemini_agents",
            api_key="bad-key",
            base_url="https://example.test/v1beta",
            agent_name="antigravity-preview-05-2026",
        )
    )

    assert response.is_valid is False
    assert "401" in response.message
