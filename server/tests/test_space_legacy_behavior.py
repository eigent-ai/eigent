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

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.domains.remote_control.service.remote_control_service import RemoteControlService
from app.domains.space.service.space_service import SpaceService
from app.model.space.space import SpaceSourceType


class _ExecResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _ListSpacesSession:
    def __init__(self, rows=None, project_space_ids=None):
        self._rows = rows or []
        self._project_space_ids = project_space_ids or []
        self._exec_count = 0

    def exec(self, _statement):
        self._exec_count += 1
        if self._exec_count > 1:
            return _ExecResult(self._project_space_ids)
        return _ExecResult(self._rows)


def _space(
    space_id: str,
    source_type: str,
    *,
    user_id: str = "user_new",
    name: str = "Untitled Space",
):
    return SimpleNamespace(
        id=space_id,
        user_id=user_id,
        name=name,
        description=None,
        source_type=source_type,
        root_path=None,
        root_fingerprint=None,
        status="active",
        schema_version=1,
        metadata_json={"legacy": True} if source_type == SpaceSourceType.LEGACY else None,
        created_at=None,
        updated_at=None,
    )


def test_list_spaces_does_not_create_legacy_for_empty_user(monkeypatch):
    def fail_ensure(*_args, **_kwargs):
        raise AssertionError("list_spaces must not create Legacy Space")

    monkeypatch.setattr(SpaceService, "ensure_legacy_space", fail_ensure)

    assert SpaceService.list_spaces("user_new", _ListSpacesSession()) == []


def test_list_spaces_hides_empty_legacy_space():
    spaces = [
        _space("legacy_user_new", SpaceSourceType.LEGACY, name="Legacy Space"),
        _space("space_new", SpaceSourceType.BLANK),
    ]

    result = SpaceService.list_spaces("user_new", _ListSpacesSession(spaces))

    assert [space.id for space in result] == ["space_new"]


def test_list_spaces_keeps_legacy_space_with_active_projects():
    legacy_space = _space(
        "legacy_user_old",
        SpaceSourceType.LEGACY,
        user_id="user_old",
        name="Legacy Space",
    )

    result = SpaceService.list_spaces(
        "user_old",
        _ListSpacesSession([legacy_space], project_space_ids=["legacy_user_old"]),
    )

    assert [space.id for space in result] == ["legacy_user_old"]


def test_remote_control_rejects_legacy_space():
    with pytest.raises(HTTPException) as exc:
        RemoteControlService._ensure_remote_control_supported_space(
            SimpleNamespace(source_type=SpaceSourceType.LEGACY)
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "REMOTE_CONTROL_LEGACY_SPACE_UNSUPPORTED"
