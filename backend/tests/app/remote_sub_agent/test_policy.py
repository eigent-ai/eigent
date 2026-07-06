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

from app.remote_sub_agent.policy import (
    RemoteSubAgentPolicy,
    build_configured_policy,
    build_default_policy,
)

pytestmark = pytest.mark.unit


def test_policy_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("EIGENT_REMOTE_SUB_AGENT_ENABLED", raising=False)

    policy = build_default_policy()

    assert policy.enabled is False
    with pytest.raises(PermissionError):
        policy.ensure_enabled()


def test_policy_allows_enabled_provider(monkeypatch):
    monkeypatch.setenv("EIGENT_REMOTE_SUB_AGENT_ENABLED", "true")
    monkeypatch.setenv(
        "EIGENT_REMOTE_SUB_AGENT_ALLOWED_PROVIDERS",
        "gemini_agents,other_provider",
    )

    policy = build_default_policy()

    assert policy.enabled is True
    policy.ensure_provider_allowed("gemini_agents")


def test_configured_policy_does_not_read_env_enablement(monkeypatch):
    monkeypatch.setenv("EIGENT_REMOTE_SUB_AGENT_ENABLED", "true")

    policy = build_configured_policy(None)

    assert policy.enabled is False


def test_configured_policy_uses_user_selected_provider(temp_dir: Path):
    policy = build_configured_policy(
        {
            "enabled": True,
            "provider": "gemini_agents",
            "gemini_agents": {"max_wall_time_seconds": 900},
        },
        temp_dir,
    )

    assert policy.enabled is True
    assert policy.allowed_providers == ("gemini_agents",)
    assert policy.max_wall_time_seconds == 900
    assert policy.working_directory == temp_dir


def test_policy_rejects_disallowed_provider():
    policy = RemoteSubAgentPolicy(
        enabled=True,
        allowed_providers=("gemini_agents",),
    )

    with pytest.raises(PermissionError):
        policy.ensure_provider_allowed("unexpected_provider")


def test_policy_rejects_sensitive_files(temp_dir: Path):
    secret_file = temp_dir / ".env"
    secret_file.write_text("TOKEN=secret")
    policy = RemoteSubAgentPolicy(
        enabled=True,
        working_directory=temp_dir,
    )

    with pytest.raises(PermissionError):
        policy.ensure_file_in_scope(secret_file)


def test_policy_accepts_workspace_file(temp_dir: Path):
    workspace_file = temp_dir / "notes.txt"
    workspace_file.write_text("hello")
    policy = RemoteSubAgentPolicy(
        enabled=True,
        working_directory=temp_dir,
    )

    assert (
        policy.ensure_file_in_scope(workspace_file) == workspace_file.resolve()
    )
