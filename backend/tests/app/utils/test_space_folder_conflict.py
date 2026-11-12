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

"""A Space folder that holds Eigent's own data is refused before a Task runs.

Runtime storage for each Run lives under the home folder and must stay
separate from the folder Tasks write to. These tests pin the shared folder
check to that rule and show that Task start refuses such a folder before
anything is created, instead of failing later while agents are built.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.run_context import RunContext
from app.utils.runtime_storage import runtime_storage
from app.utils.workspace_paths import (
    SPACE_FOLDER_HOLDS_APP_DATA,
    SPACE_FOLDER_IS_HOME,
    run_output_root,
    space_folder_conflict,
)
from app.utils.workspace_resolver import (
    SpaceFolderNotUsableError,
    WorkspaceBinding,
    WorkspaceResolver,
    WorkspaceStore,
)

EMAIL = "u@example.com"
USER_ID = "42"


@pytest.fixture
def home(tmp_path: Path, monkeypatch) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    return home


def _candidates(home: Path) -> dict[str, tuple[Path, str | None]]:
    owner = home / ".eigent" / f"user_{USER_ID}"
    return {
        "home": (home, SPACE_FOLDER_IS_HOME),
        "app data": (home / ".eigent", SPACE_FOLDER_HOLDS_APP_DATA),
        "owner data": (owner, SPACE_FOLDER_HOLDS_APP_DATA),
        "runtime": (owner / "runtime", SPACE_FOLDER_HOLDS_APP_DATA),
        "inside runtime": (
            owner / "runtime" / "project_p1",
            SPACE_FOLDER_HOLDS_APP_DATA,
        ),
        "above home": (home.parent, SPACE_FOLDER_HOLDS_APP_DATA),
        "documents": (home / "Documents", None),
        "blank Space folder": (owner / "space_abc", None),
        "app workspace": (home / ".eigent" / "workspace", None),
        "another account's runtime": (
            home / ".eigent" / "user_7" / "runtime",
            None,
        ),
    }


@pytest.mark.parametrize(
    "label",
    [
        "home",
        "app data",
        "owner data",
        "runtime",
        "inside runtime",
        "above home",
        "documents",
        "blank Space folder",
        "app workspace",
        "another account's runtime",
    ],
)
def test_folder_check_matches_runtime_storage(home: Path, label: str):
    folder, expected = _candidates(home)[label]
    folder.mkdir(parents=True, exist_ok=True)

    assert space_folder_conflict(folder, EMAIL, USER_ID) == expected

    # The check is the gate for runtime storage: a folder it allows never
    # fails the overlap rule later, and a folder it refuses always would.
    context = RunContext(
        space_id="space-1",
        project_id="p1",
        run_id="run-1",
        task_id="run-1",
        email=EMAIL,
        user_id=USER_ID,
        working_directory=folder,
        task_output_root=run_output_root(
            EMAIL, "space-1", "p1", "run-1", USER_ID
        ),
        camel_log_dir=home / "logs",
        binding_source="space_local_brain",
        workdir_mode="direct-write",
        browser_port=9222,
    )
    if expected is None:
        runtime_storage(context)
    else:
        with pytest.raises(ValueError, match="must be separate"):
            runtime_storage(context)


def test_link_to_home_is_judged_by_its_target(home: Path, tmp_path: Path):
    link = tmp_path / "home-link"
    link.symlink_to(home, target_is_directory=True)

    assert space_folder_conflict(link, EMAIL, USER_ID) == SPACE_FOLDER_IS_HOME


def _resolver_bound_to(folder: Path) -> WorkspaceResolver:
    binding = WorkspaceBinding(
        space_id="space-1",
        workspace_root=str(folder),
        source="local",
        created_at="2026-11-11T00:00:00Z",
        updated_at="2026-11-11T00:00:00Z",
    )
    store = WorkspaceStore()
    store.get_binding = lambda *args, **kwargs: binding
    return WorkspaceResolver(store=store)


@pytest.mark.parametrize(
    ("relative", "code"),
    [
        ("", SPACE_FOLDER_IS_HOME),
        (".eigent", SPACE_FOLDER_HOLDS_APP_DATA),
    ],
)
def test_task_start_refuses_a_space_folder_that_holds_app_data(
    home: Path, relative: str, code: str
):
    folder = home / relative
    folder.mkdir(parents=True, exist_ok=True)
    resolver = _resolver_bound_to(folder)

    with pytest.raises(SpaceFolderNotUsableError) as error:
        resolver.freeze_task_directories_for(
            space_id="space-1",
            project_id="p1",
            task_id="run-1",
            email=EMAIL,
            task_lock=SimpleNamespace(),
            user_id=USER_ID,
        )

    assert error.value.code == code
    assert not isinstance(error.value, ValueError)
    # Refused before any Run folder is created.
    assert not run_output_root(
        EMAIL, "space-1", "p1", "run-1", USER_ID
    ).exists()


def test_task_start_keeps_ordinary_space_folders(home: Path):
    folder = home / "Documents"
    folder.mkdir()
    resolver = _resolver_bound_to(folder)

    frozen = resolver.freeze_task_directories_for(
        space_id="space-1",
        project_id="p1",
        task_id="run-1",
        email=EMAIL,
        task_lock=SimpleNamespace(),
        user_id=USER_ID,
    )

    assert frozen.working_directory == folder.resolve()


def test_copy_mode_never_checks_the_space_folder_itself(home: Path):
    """Only the folder Tasks write to matters; a copy works elsewhere."""

    resolver = _resolver_bound_to(home)
    with patch(
        "app.utils.workspace_resolver._copy_space_baseline",
        return_value=None,
    ):
        frozen = resolver.freeze_task_directories_for(
            space_id="space-1",
            project_id="p1",
            task_id="run-1",
            email=EMAIL,
            task_lock=SimpleNamespace(workdir_mode="copy"),
            user_id=USER_ID,
        )

    assert frozen.working_directory != home
