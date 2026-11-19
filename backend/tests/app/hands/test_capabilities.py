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

from app.hands import capabilities
from app.hands.environment_hands import EnvironmentHands


@pytest.mark.unit
def test_has_terminal_shell_accepts_windows_powershell(monkeypatch):
    monkeypatch.setattr(capabilities.os, "name", "nt")

    def fake_which(command: str) -> str | None:
        if command == "powershell.exe":
            return (
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\"
                "powershell.exe"
            )
        return None

    monkeypatch.setattr(capabilities.shutil, "which", fake_which)

    assert capabilities._has_terminal_shell() is True


@pytest.mark.unit
def test_has_terminal_shell_accepts_posix_sh(monkeypatch):
    monkeypatch.setattr(capabilities.os, "name", "posix")

    def fake_which(command: str) -> str | None:
        if command == "sh":
            return "/bin/sh"
        return None

    monkeypatch.setattr(capabilities.shutil, "which", fake_which)

    assert capabilities._has_terminal_shell() is True


@pytest.mark.unit
def test_detect_capabilities_uses_terminal_shell_probe(monkeypatch):
    monkeypatch.setattr(capabilities, "_is_running_in_docker", lambda: False)
    monkeypatch.setattr(capabilities, "_probe_cdp_browser", lambda: False)
    monkeypatch.setattr(capabilities, "_is_electron_runtime", lambda: False)
    monkeypatch.setattr(
        capabilities, "_can_launch_local_cdp_browser", lambda: False
    )
    monkeypatch.setattr(capabilities, "env", lambda _, default=None: default)
    monkeypatch.setattr(capabilities.shutil, "which", lambda _: None)
    monkeypatch.setattr(capabilities, "_has_terminal_shell", lambda: True)

    caps = capabilities.detect_capabilities()
    hands = EnvironmentHands(caps)

    assert caps.has_terminal is True
    assert hands.can_execute_terminal() is True


@pytest.mark.unit
def test_environment_hands_full_scope_allows_path_outside_workspace(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    # Use the filesystem root so this path is outside both the configured
    # workspace and the user's home directory on Windows and POSIX runners.
    outside = Path(tmp_path.anchor) / "eigent-full-scope-test"

    caps = capabilities.BrainCapabilities(
        filesystem_scope="full",
        workspace_root=workspace,
    )
    hands = EnvironmentHands(caps)

    assert hands.can_access_filesystem(str(outside)) is True


@pytest.mark.unit
def test_environment_hands_workspace_only_stays_restricted(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    inside = workspace / "project"
    inside.mkdir()
    outside = Path(tmp_path.anchor) / "eigent-workspace-only-test"

    caps = capabilities.BrainCapabilities(
        filesystem_scope="workspace_only",
        workspace_root=workspace,
    )
    hands = EnvironmentHands(caps)

    assert hands.can_access_filesystem(str(inside)) is True
    assert hands.can_access_filesystem(str(outside)) is False
