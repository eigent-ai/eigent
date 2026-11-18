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
"""Where a plugin may be imported from."""

import os
import platform
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.controller import workspace_config_controller
from app.hands import binding_path_policy as policy
from app.hands.capabilities import BrainCapabilities
from app.hands.environment_hands import EnvironmentHands

pytestmark = pytest.mark.unit


def _hands(tmp_path: Path) -> EnvironmentHands:
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    return EnvironmentHands(
        BrainCapabilities(filesystem_scope="full", workspace_root=workspace)
    )


def _home(tmp_path: Path, monkeypatch) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    return home


def _system_folder() -> Path:
    if platform.system() == "Windows":
        return Path(os.environ.get("SystemRoot") or r"C:\Windows")
    return Path("/etc")


def _request(hands) -> SimpleNamespace:
    return SimpleNamespace(state=SimpleNamespace(hands=hands))


def test_plugin_folder_inside_home_is_allowed(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch)
    source = home / ".claude" / "plugins" / "reviewer"
    source.mkdir(parents=True)

    assert _hands(tmp_path).validate_agent_plugin_source_path(str(source)) == (
        True,
        None,
    )


def test_plugin_folder_outside_home_is_allowed(tmp_path, monkeypatch):
    _home(tmp_path, monkeypatch)
    source = tmp_path / "drive" / "plugins" / "reviewer"
    source.mkdir(parents=True)

    assert _hands(tmp_path).validate_agent_plugin_source_path(str(source)) == (
        True,
        None,
    )


def test_plugin_archive_is_allowed(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch)
    archive = home / "Downloads" / "reviewer.zip"
    archive.parent.mkdir()
    archive.write_bytes(b"PK")

    assert _hands(tmp_path).validate_agent_plugin_source_path(
        str(archive)
    ) == (True, None)


def test_plugin_folder_in_eigent_data_is_allowed(tmp_path, monkeypatch):
    # An import only reads its source, so Eigent's own data folder is not
    # off limits the way it is for a Space's working folder.
    home = _home(tmp_path, monkeypatch)
    source = home / ".eigent" / "plugins" / "reviewer"
    source.mkdir(parents=True)

    assert _hands(tmp_path).validate_agent_plugin_source_path(str(source)) == (
        True,
        None,
    )


def test_system_folder_is_refused(tmp_path, monkeypatch):
    _home(tmp_path, monkeypatch)

    assert _hands(tmp_path).validate_agent_plugin_source_path(
        str(_system_folder())
    ) == (False, policy.SYSTEM_PATH_FORBIDDEN)


def test_credential_folder_is_refused(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch)
    (home / ".ssh").mkdir()

    assert _hands(tmp_path).validate_agent_plugin_source_path(
        str(home / ".ssh")
    ) == (False, policy.SENSITIVE_PATH_FORBIDDEN)


def test_folder_outside_a_workspace_only_scope_is_refused(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    hands = EnvironmentHands(
        BrainCapabilities(
            filesystem_scope="workspace_only", workspace_root=workspace
        )
    )

    assert hands.validate_agent_plugin_source_path(str(outside)) == (
        False,
        "filesystem_capability_denied",
    )


def test_import_route_refuses_a_system_folder(tmp_path, monkeypatch):
    _home(tmp_path, monkeypatch)

    with pytest.raises(HTTPException) as exc_info:
        workspace_config_controller._authorized_agent_plugin_source(
            _request(_hands(tmp_path)), str(_system_folder())
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == {"code": "agent_plugin_source_not_allowed"}


def test_import_route_returns_an_allowed_folder(tmp_path, monkeypatch):
    _home(tmp_path, monkeypatch)
    source = tmp_path / "drive" / "plugins" / "reviewer"
    source.mkdir(parents=True)

    resolved = workspace_config_controller._authorized_agent_plugin_source(
        _request(_hands(tmp_path)), str(source)
    )

    assert resolved == source.resolve()


def test_import_route_keeps_the_scope_check_for_other_hands(tmp_path):
    # Hands without a plugin source check fall back to the filesystem scope.
    source = tmp_path / "reviewer"
    source.mkdir()
    refuses = SimpleNamespace(can_access_filesystem=lambda _path: False)
    allows = SimpleNamespace(can_access_filesystem=lambda _path: True)

    with pytest.raises(HTTPException) as exc_info:
        workspace_config_controller._authorized_agent_plugin_source(
            _request(refuses), str(source)
        )

    assert exc_info.value.status_code == 403
    assert (
        workspace_config_controller._authorized_agent_plugin_source(
            _request(allows), str(source)
        )
        == source.resolve()
    )
