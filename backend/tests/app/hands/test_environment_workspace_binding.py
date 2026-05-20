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

from app.hands.capabilities import BrainCapabilities
from app.hands.environment_hands import EnvironmentHands


def _hands(
    workspace_root: Path,
    filesystem_scope: str = "full",
) -> EnvironmentHands:
    return EnvironmentHands(
        BrainCapabilities(
            filesystem_scope=filesystem_scope,
            workspace_root=workspace_root,
            deployment_type="local",
        )
    )


@pytest.mark.unit
def test_validate_workspace_binding_rejects_home_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    hands = _hands(home / "workspace")
    monkeypatch.setattr(hands, "_sensitive_prefixes", lambda: [])

    ok, reason = hands.validate_workspace_binding_path(str(home))

    assert ok is False
    assert reason == "home_root_forbidden"


@pytest.mark.unit
def test_validate_workspace_binding_rejects_sensitive_prefix(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    home = tmp_path / "home"
    sensitive = home / ".ssh"
    sensitive.mkdir(parents=True)
    project = sensitive / "project"
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))
    hands = _hands(home / "workspace")
    monkeypatch.setattr(hands, "_sensitive_prefixes", lambda: [sensitive])

    ok, reason = hands.validate_workspace_binding_path(str(project))

    assert ok is False
    assert reason is not None
    assert reason.startswith("sensitive_path:")


@pytest.mark.unit
def test_validate_workspace_binding_rejects_outside_workspace_scope(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    home = tmp_path / "home"
    home.mkdir()
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    monkeypatch.setenv("HOME", str(home))
    hands = _hands(workspace, filesystem_scope="workspace_only")
    monkeypatch.setattr(hands, "_sensitive_prefixes", lambda: [])

    ok, reason = hands.validate_workspace_binding_path(str(outside))

    assert ok is False
    assert reason == "filesystem_capability_denied"


@pytest.mark.unit
def test_validate_workspace_binding_accepts_regular_home_subdir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    home = tmp_path / "home"
    project = home / "project"
    project.mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    hands = _hands(home / "workspace")
    monkeypatch.setattr(hands, "_sensitive_prefixes", lambda: [])

    ok, reason = hands.validate_workspace_binding_path(str(project))

    assert ok is True
    assert reason is None
