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

"""WorkspaceResolver direct-write default regression tests.

Locks in the contract for folder-backed Spaces after the copy → direct-write
default switch (see docs/core/space-folder-output-copy-bug-analysis.md):
- if task_lock has no workdir_mode, freeze defaults to direct-write so the
  agent's working_directory == the selected folder (no Project workdir copy)
- explicit workdir_mode='copy' on task_lock still triggers the copy path so
  existing rows in the server DB keep working
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.utils.workspace_resolver import (
    WorkspaceBinding,
    WorkspaceResolver,
    WorkspaceStore,
)


@pytest.fixture
def bound_resolver(tmp_path: Path):
    """A resolver whose binding store returns a folder pointing at tmp_path.

    tmp_path stands in for the user's selected local folder.
    """

    source_root = tmp_path / "selected_folder"
    source_root.mkdir()
    (source_root / "existing_file.txt").write_text("source content")

    binding = WorkspaceBinding(
        space_id="space_folder",
        workspace_root=str(source_root),
        source="local",
        created_at="2026-05-28T00:00:00Z",
        updated_at="2026-05-28T00:00:00Z",
    )

    store = WorkspaceStore()
    with (
        patch.object(store, "get_binding", return_value=binding),
        patch.object(store, "save_snapshot"),
    ):
        resolver = WorkspaceResolver(store=store)
        yield resolver, source_root


def test_freeze_defaults_to_direct_write_when_task_lock_has_no_workdir_mode(
    bound_resolver,
):
    """The key regression: no explicit workdir_mode + folder binding must
    resolve working_directory to the selected folder, NOT to a Project
    workdir copy under ~/.eigent/.../workdir."""

    resolver, source_root = bound_resolver
    task_lock = SimpleNamespace()  # NB: no .workdir_mode attribute at all

    with patch(
        "app.utils.workspace_resolver._copy_space_baseline"
    ) as copy_baseline:
        frozen = resolver.freeze_task_directories_for(
            space_id="space_folder",
            project_id="proj_x",
            task_id="task_x",
            email="u@example.com",
            task_lock=task_lock,
            user_id="42",
        )

    assert frozen.working_directory == source_root
    assert frozen.workdir_mode == "direct-write"
    assert frozen.base_snapshot_id is None
    copy_baseline.assert_not_called()


def test_freeze_honors_explicit_copy_workdir_mode_from_task_lock(
    bound_resolver,
):
    """Back-compat: a Project row in the server DB with workdir_mode='copy'
    (created before the direct-write default flip) must still produce a copy.
    Otherwise existing Projects would silently start writing to the user's
    folder."""

    resolver, source_root = bound_resolver
    task_lock = SimpleNamespace(workdir_mode="copy")

    with patch(
        "app.utils.workspace_resolver._copy_space_baseline",
        return_value="snapshot_abc",
    ) as copy_baseline:
        frozen = resolver.freeze_task_directories_for(
            space_id="space_folder",
            project_id="proj_x",
            task_id="task_x",
            email="u@example.com",
            task_lock=task_lock,
            user_id="42",
        )

    assert frozen.working_directory != source_root
    assert frozen.workdir_mode == "copy"
    assert frozen.base_snapshot_id == "snapshot_abc"
    copy_baseline.assert_called_once()
    # The copy target must be the project workdir, not the selected folder.
    copy_src, copy_dst = copy_baseline.call_args.args
    assert copy_src == source_root
    assert ".eigent" in str(copy_dst) or "/projects/" in str(copy_dst)
