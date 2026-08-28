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

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.controller import workspace_controller
from app.run_journal import SQLiteRunJournal
from app.workspace_config import canonical_digest
from app.workspace_git import ContentRepositoryService, GitBackend


@dataclass
class _Binding:
    space_id: str
    workspace_root: str
    source: str = "space"
    created_at: str = "2026-08-24T00:00:00Z"
    updated_at: str = "2026-08-24T00:00:00Z"
    root_fingerprint: dict | None = None
    version: int = 1


class _BindingStore:
    def __init__(self) -> None:
        self.bindings: dict[tuple[str, str, str | None], _Binding] = {}

    @staticmethod
    def _key(
        email: str, space_id: str, user_id
    ) -> tuple[str, str, str | None]:
        return email, space_id, None if user_id is None else str(user_id)

    def get_binding(self, email, space_id, user_id=None):
        return self.bindings.get(self._key(email, space_id, user_id))

    def list_bindings(self, email, user_id=None):
        owner = None if user_id is None else str(user_id)
        return [
            binding
            for (
                binding_email,
                _,
                binding_owner,
            ), binding in self.bindings.items()
            if binding_email == email and binding_owner == owner
        ]

    def delete_binding(self, email, space_id, user_id=None):
        self.bindings.pop(self._key(email, space_id, user_id), None)


class _Resolver:
    def __init__(self) -> None:
        self.store = _BindingStore()

    def ensure_space_binding(
        self,
        email: str,
        space_id: str,
        workspace_root: str,
        *,
        user_id=None,
    ) -> _Binding:
        key = self.store._key(email, space_id, user_id)
        binding = self.store.bindings.get(key)
        if binding is None:
            binding = _Binding(
                space_id=space_id, workspace_root=workspace_root
            )
            self.store.bindings[key] = binding
        return binding


class _LocalHands:
    @staticmethod
    def get_capability_manifest():
        return {"deployment": "local"}

    @staticmethod
    def validate_workspace_binding_path(_path: str):
        return True, None


@pytest.fixture
def workspace_dependencies(tmp_path, monkeypatch):
    hooks = tmp_path / "empty-hooks"
    hooks.mkdir()
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    service = ContentRepositoryService(
        journal,
        state_root=tmp_path / "state",
        git_backend=GitBackend(hooks_path=hooks),
    )
    resolver = _Resolver()
    monkeypatch.setattr(
        workspace_controller,
        "_content_repository_service",
        lambda: service,
    )
    monkeypatch.setattr(
        workspace_controller,
        "get_workspace_resolver",
        lambda: resolver,
    )
    try:
        yield service, resolver
    finally:
        journal.close()


def _request():
    return SimpleNamespace(state=SimpleNamespace(hands=_LocalHands()))


def _git(root, *args: str) -> str:
    return subprocess.run(
        ("git", "-C", str(root), *args),
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


@pytest.mark.asyncio
async def test_scratch_space_initializes_version_history_by_default(
    tmp_path,
    monkeypatch,
    workspace_dependencies,
):
    service, _ = workspace_dependencies
    root = tmp_path / "scratch-space"
    monkeypatch.setattr(
        workspace_controller,
        "_scratch_space_root",
        lambda *_args, **_kwargs: root,
    )

    response = await workspace_controller.workspace_scratch(
        workspace_controller.WorkspaceScratchRequest(
            space_id="space-1",
            email="owner@example.com",
            user_id="user-1",
        ),
        _request(),
    )

    assert response["version_history"] == {
        "enabled": True,
        "repository_id": response["version_history"]["repository_id"],
        "initialized": True,
        "ownership": "eigent_owned",
        "state": "ready",
    }
    assert (root / ".git").is_dir()
    assert service.git.probe(root).branch == "main"
    head = service.git.current_head(root)
    assert head is not None
    assert service.git.commit_parent(root, head) is None
    assert service.git.show_commit_paths(root, head) == ()

    replay = await workspace_controller.workspace_scratch(
        workspace_controller.WorkspaceScratchRequest(
            space_id="space-1",
            email="owner@example.com",
            user_id="user-1",
        ),
        _request(),
    )
    assert replay["version_history"]["initialized"] is False
    assert replay["version_history"]["ownership"] == "eigent_owned"


@pytest.mark.asyncio
async def test_existing_scratch_binding_heals_unborn_eigent_repository(
    tmp_path,
    workspace_dependencies,
):
    service, resolver = workspace_dependencies
    root = tmp_path / "legacy-scratch-space"
    root.mkdir()
    (root / "existing-output.txt").write_text(
        "keep this untracked\n", encoding="utf-8"
    )
    service.git.init_repository(root)
    repository_id = (
        "repo_"
        + canonical_digest({"space_id": "space-legacy", "role": "content"})[
            :32
        ]
    )
    service.journal.put_git_repository(
        repository_id=repository_id,
        space_id="space-legacy",
        repository_role="content",
        root_path=str(root.resolve()),
        root_path_digest=canonical_digest(str(root.resolve())),
        ownership="eigent_owned",
        state="ready",
        version_coverage="managed_files_only",
    )
    resolver.ensure_space_binding(
        "owner@example.com",
        "space-legacy",
        str(root.resolve()),
        user_id="user-1",
    )

    response = await workspace_controller.workspace_scratch(
        workspace_controller.WorkspaceScratchRequest(
            space_id="space-legacy",
            email="owner@example.com",
            user_id="user-1",
        ),
        _request(),
    )

    assert response["version_history"] == {
        "enabled": True,
        "repository_id": repository_id,
        "initialized": False,
        "ownership": "eigent_owned",
        "state": "ready",
    }
    head = service.git.current_head(root)
    assert head is not None
    assert service.git.show_commit_paths(root, head) == ()
    assert _git(root, "status", "--porcelain") == "?? existing-output.txt"


@pytest.mark.asyncio
async def test_folder_space_initializes_git_without_staging_existing_files(
    tmp_path,
    workspace_dependencies,
):
    _, _resolver = workspace_dependencies
    root = tmp_path / "plain-folder"
    root.mkdir()
    existing_file = root / "private.txt"
    existing_file.write_text("leave me untracked\n", encoding="utf-8")

    response = await workspace_controller.workspace_bind(
        workspace_controller.WorkspaceBindRequest(
            space_id="space-user-folder",
            email="owner@example.com",
            user_id="user-1",
            path=str(root),
        ),
        _request(),
    )

    assert response["version_history"]["enabled"] is True
    assert response["version_history"]["initialized"] is True
    assert response["version_history"]["ownership"] == "adopted"
    assert _git(root, "symbolic-ref", "--short", "HEAD") == "main"
    head = _git(root, "rev-parse", "--verify", "HEAD")
    assert _git(root, "diff-tree", "--name-only", "-r", "--root", head) == ""
    assert _git(root, "status", "--porcelain") == "?? private.txt"


@pytest.mark.asyncio
async def test_folder_space_reuses_repository_at_selected_root(
    tmp_path,
    workspace_dependencies,
):
    service, _ = workspace_dependencies
    root = tmp_path / "existing-repository"
    root.mkdir()
    service.git.init_repository(root, initial_branch="trunk")
    _git(root, "remote", "add", "origin", "https://example.invalid/repo")
    config_before = (root / ".git" / "config").read_bytes()

    response = await workspace_controller.workspace_bind(
        workspace_controller.WorkspaceBindRequest(
            space_id="space-2",
            email="owner@example.com",
            user_id="user-1",
            path=str(root),
        ),
        _request(),
    )

    assert response["version_history"]["enabled"] is True
    assert response["version_history"]["initialized"] is False
    assert response["version_history"]["ownership"] == "adopted"
    assert service.git.probe(root).branch == "trunk"
    assert service.git.current_head(root) is None
    assert (root / ".git" / "config").read_bytes() == config_before


@pytest.mark.asyncio
async def test_folder_binding_rolls_back_when_selected_path_is_nested_repo(
    tmp_path,
    workspace_dependencies,
):
    service, resolver = workspace_dependencies
    parent = tmp_path / "parent-repository"
    child = parent / "child"
    child.mkdir(parents=True)
    service.git.init_repository(parent)

    with pytest.raises(HTTPException) as raised:
        await workspace_controller.workspace_bind(
            workspace_controller.WorkspaceBindRequest(
                space_id="space-3",
                email="owner@example.com",
                user_id="user-1",
                path=str(child),
            ),
            _request(),
        )

    assert getattr(raised.value, "status_code", None) == 409
    assert raised.value.detail["code"] == "nested_repository_requires_binding"
    assert (
        resolver.store.get_binding("owner@example.com", "space-3", "user-1")
        is None
    )
    assert not (child / ".git").exists()
