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

import os
from types import SimpleNamespace

import pytest

os.environ.setdefault(
    "database_url", "sqlite:////private/tmp/eigent_space_folder_ref_test.db"
)

from app.domains.space.service.folder_binding import (
    normalize_folder_root_reference,
    same_folder_reference,
)
from app.domains.space.service.space_service import SpaceService
from app.model.space import SpaceIn, SpaceSourceType


class _ExecResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeSession:
    def __init__(self, rows=None):
        self._rows = rows or []

    def exec(self, _statement):
        return _ExecResult(self._rows)


def test_prepare_folder_space_keeps_unmounted_root_reference():
    root_path = "/Users/alice/projects/not-mounted-inside-server-container"

    root_ref, fingerprint = SpaceService._prepare_space_root(
        SpaceIn(
            name="Repo",
            source_type=SpaceSourceType.FOLDER,
            root_path=root_path,
        ),
        "user_1",
        _FakeSession(),
    )

    assert root_ref == root_path
    assert fingerprint is None


def test_prepare_folder_space_rejects_duplicate_root_reference():
    existing = SimpleNamespace(
        root_path="/Users/alice/projects/repo",
        root_fingerprint=None,
    )

    with pytest.raises(ValueError, match="already bound"):
        SpaceService._prepare_space_root(
            SpaceIn(
                name="Repo",
                source_type=SpaceSourceType.FOLDER,
                root_path="/Users/alice/projects/repo/",
            ),
            "user_1",
            _FakeSession([existing]),
        )


def test_normalize_folder_root_reference_collapses_redundant_segments():
    """./, //, and trailing separators are deduped without touching the fs."""

    assert (
        normalize_folder_root_reference("/Users/alice/./repo")
        == "/Users/alice/repo"
    )
    assert (
        normalize_folder_root_reference("/Users/alice//repo/")
        == "/Users/alice/repo"
    )
    assert same_folder_reference(
        "/Users/alice/./repo/",
        "/Users/alice/repo",
    )


def test_normalize_folder_root_reference_rejects_empty_after_normalization():
    with pytest.raises(ValueError, match="Folder Space requires root_path"):
        normalize_folder_root_reference("./")


def test_relocate_rejects_unverified_change_without_force():
    """Reference-only relocate requires either a client fingerprint or force."""

    space = SimpleNamespace(
        id="space_1",
        user_id="user_1",
        source_type=SpaceSourceType.FOLDER,
        root_path="/Users/alice/projects/repo",
        root_fingerprint=None,
        status="active",
    )

    session_calls: list[tuple[str, str]] = []

    class _RelocateSession(_FakeSession):
        def get(self, _model, _id):
            return space

        def add(self, _obj):
            session_calls.append(("add", "ok"))

        def commit(self):
            session_calls.append(("commit", "ok"))

        def refresh(self, _obj):
            session_calls.append(("refresh", "ok"))

    with pytest.raises(ValueError, match="cannot be verified"):
        SpaceService.relocate_space(
            "space_1",
            "/Users/alice/projects/repo-renamed",
            "user_1",
            _RelocateSession(),
        )
    assert session_calls == []  # rejected before any write
