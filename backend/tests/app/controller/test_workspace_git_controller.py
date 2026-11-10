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

from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.local_control import LOCAL_CONTROL_CAPABILITY_HEADER
from app.controller import workspace_git_controller
from app.router import register_routers
from app.run_journal import SQLiteRunJournal
from app.workspace_git import (
    ContentRepositoryService,
    GitBackend,
    WorkspaceGitCoordinator,
)


@dataclass
class _Binding:
    workspace_root: str


class _BindingStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def get_binding(self, _email, _space_id, _user_id):
        return _Binding(workspace_root=str(self.root))


class _Resolver:
    def __init__(self, root: Path) -> None:
        self.store = _BindingStore(root)


@pytest.fixture
def git_api(tmp_path, monkeypatch):
    space = tmp_path / "space"
    space.mkdir()
    hooks = tmp_path / "empty-hooks"
    hooks.mkdir()
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    service = ContentRepositoryService(
        journal,
        state_root=tmp_path / "state",
        git_backend=GitBackend(hooks_path=hooks),
    )
    resolver = _Resolver(space)
    monkeypatch.setattr(workspace_git_controller, "_service", lambda: service)
    monkeypatch.setattr(
        workspace_git_controller,
        "get_workspace_resolver",
        lambda: resolver,
    )
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "test-secret")
    app = FastAPI()
    register_routers(app, prefix="/api/v1")
    client = TestClient(app, client=("127.0.0.1", 50000))
    try:
        yield client, service, resolver, space
    finally:
        client.close()
        journal.close()


def _headers() -> dict[str, str]:
    return {LOCAL_CONTROL_CAPABILITY_HEADER: "test-secret"}


def _status(client: TestClient) -> dict:
    response = client.get(
        "/api/v1/spaces/space-1/git/status",
        params={"email": "user@example.com"},
        headers=_headers(),
    )
    assert response.status_code == 200
    return response.json()


def test_workspace_git_api_requires_local_renderer_capability(git_api):
    client, _, _, _ = git_api

    response = client.get(
        "/api/v1/spaces/space-1/git/status",
        params={"email": "user@example.com"},
    )

    assert response.status_code == 401


def test_workspace_git_checkpoint_and_restore_candidate_flow(git_api):
    client, _, _, space = git_api
    report = space / "report.md"
    report.write_text("first version\n", encoding="utf-8")

    inspection = _status(client)
    assert inspection["enabled"] is False
    assert inspection["consent_required"] is True
    assert str(space) not in str(inspection)

    response = client.post(
        "/api/v1/spaces/space-1/git/bootstrap",
        headers=_headers(),
        json={
            "email": "user@example.com",
            "allow_init": False,
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "git_init_consent_required"

    response = client.post(
        "/api/v1/spaces/space-1/git/bootstrap",
        headers=_headers(),
        json={
            "email": "user@example.com",
            "allow_init": True,
        },
    )
    assert response.status_code == 200
    assert response.json()["initialized"] is True
    assert str(space) not in response.text

    status = _status(client)
    state_digest = status["diagnostics"]["repo_state"]["digest"]
    response = client.post(
        "/api/v1/spaces/space-1/git/checkpoints",
        headers=_headers(),
        json={
            "email": "user@example.com",
            "operation_request_id": "save-1",
            "expected_repo_state_digest": state_digest,
            "paths": ["report.md"],
            "path_sources": {"report.md": "agent_created"},
            "target_role": "user",
            "target_id": "space-1",
            "actor_id": "user-1",
            "trigger": "user_save",
            "message": "Save progress",
        },
    )
    assert response.status_code == 201
    checkpoint_id = response.json()["checkpoint_id"]
    assert response.json()["paths"] == ["report.md"]

    response = client.get(
        "/api/v1/spaces/space-1/git/checkpoints",
        params={"email": "user@example.com"},
        headers=_headers(),
    )
    assert response.status_code == 200
    assert response.json()["checkpoints"][0]["checkpoint_id"] == checkpoint_id
    assert str(space) not in response.text

    report.write_text("second version\n", encoding="utf-8")
    response = client.get(
        "/api/v1/spaces/space-1/git/diff",
        params={
            "email": "user@example.com",
            "paths": "report.md",
        },
        headers=_headers(),
    )
    assert response.status_code == 200
    assert "+second version" in response.json()["diff"]

    status = _status(client)
    response = client.post(
        "/api/v1/spaces/space-1/git/restore",
        headers=_headers(),
        json={
            "email": "user@example.com",
            "checkpoint_id": checkpoint_id,
            "operation_request_id": "restore-1",
            "expected_repo_state_digest": status["diagnostics"]["repo_state"][
                "digest"
            ],
        },
    )
    assert response.status_code == 201
    assert response.json()["checkpoint_id"] == checkpoint_id
    assert response.json()["candidate_ref"].startswith("refs/eigent/recovery/")
    assert response.json()["applied_to_user_worktree"] is False
    assert report.read_text(encoding="utf-8") == "second version\n"


def test_save_point_commits_only_pending_managed_paths(git_api):
    client, _, _, space = git_api
    managed = space / "managed.md"
    unrelated = space / "private.txt"
    managed.write_text("v1\n", encoding="utf-8")
    unrelated.write_text("do not add\n", encoding="utf-8")
    response = client.post(
        "/api/v1/spaces/space-1/git/bootstrap",
        headers=_headers(),
        json={"email": "user@example.com", "allow_init": True},
    )
    assert response.status_code == 200
    status = _status(client)
    response = client.post(
        "/api/v1/spaces/space-1/git/checkpoints",
        headers=_headers(),
        json={
            "email": "user@example.com",
            "operation_request_id": "seed-managed",
            "expected_repo_state_digest": status["diagnostics"]["repo_state"][
                "digest"
            ],
            "paths": ["managed.md"],
            "path_sources": {"managed.md": "agent_created"},
            "target_role": "user",
            "target_id": "space-1",
            "actor_id": "agent-1",
            "trigger": "filesystem.write",
            "message": "Register managed file",
        },
    )
    assert response.status_code == 201

    managed.write_text("v2\n", encoding="utf-8")
    unrelated.write_text("still private\n", encoding="utf-8")
    status = _status(client)
    assert status["pending_managed_paths"] == ["managed.md"]
    assert status["pending_managed_paths_truncated"] is False
    response = client.post(
        "/api/v1/spaces/space-1/git/save-point",
        headers=_headers(),
        json={
            "email": "user@example.com",
            "operation_request_id": "user-save-1",
            "expected_repo_state_digest": status["diagnostics"]["repo_state"][
                "digest"
            ],
            "actor_id": "user-1",
            "message": "Save progress",
        },
    )

    assert response.status_code == 201
    assert response.json()["paths"] == ["managed.md"]
    assert _status(client)["pending_managed_paths"] == []
    assert unrelated.read_text(encoding="utf-8") == "still private\n"
    assert (
        client.get(
            "/api/v1/spaces/space-1/git/diff",
            params={
                "email": "user@example.com",
                "paths": "private.txt",
            },
            headers=_headers(),
        ).json()["diff"]
        == ""
    )


def test_workspace_git_status_fails_closed_after_space_rebind(git_api):
    client, _, resolver, _ = git_api
    response = client.post(
        "/api/v1/spaces/space-1/git/bootstrap",
        headers=_headers(),
        json={
            "email": "user@example.com",
            "allow_init": True,
        },
    )
    assert response.status_code == 200
    rebound = resolver.store.root.parent / "rebound"
    rebound.mkdir()
    resolver.store.root = rebound

    response = client.get(
        "/api/v1/spaces/space-1/git/status",
        params={"email": "user@example.com"},
        headers=_headers(),
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == (
        "git_repository_binding_mismatch"
    )


def test_advanced_git_api_previews_confirms_and_lists_history(git_api):
    client, _, _, _ = git_api
    response = client.post(
        "/api/v1/spaces/space-1/git/bootstrap",
        headers=_headers(),
        json={"email": "user@example.com", "allow_init": True},
    )
    assert response.status_code == 200
    status = _status(client)
    request = {
        "email": "user@example.com",
        "operation_request_id": "advanced-api-1",
        "argv": ["commit", "--allow-empty", "-m", "API checkpoint"],
    }
    preview = client.post(
        "/api/v1/spaces/space-1/git/operations:preview",
        headers=_headers(),
        json=request,
    )
    assert preview.status_code == 200
    assert preview.json()["classification"] == "git.local_write"
    assert preview.json()["requires_confirmation"] is True

    rejected = client.post(
        "/api/v1/spaces/space-1/git/operations",
        headers=_headers(),
        json={
            **request,
            "expected_repo_state_digest": status["diagnostics"]["repo_state"][
                "digest"
            ],
            "actor_id": "user-1",
        },
    )
    assert rejected.status_code == 409
    assert (
        rejected.json()["detail"]["code"] == "advanced_git_approval_required"
    )

    executed = client.post(
        "/api/v1/spaces/space-1/git/operations",
        headers=_headers(),
        json={
            **request,
            "expected_repo_state_digest": status["diagnostics"]["repo_state"][
                "digest"
            ],
            "confirmed_action_digest": preview.json()["action_digest"],
            "actor_id": "user-1",
        },
    )
    assert executed.status_code == 200
    assert executed.json()["returncode"] == 0

    history = client.get(
        "/api/v1/spaces/space-1/git/history",
        headers=_headers(),
        params={"email": "user@example.com"},
    )
    assert history.status_code == 200
    assert history.json()["commits"][0]["subject"] == "API checkpoint"
    assert history.json()["backup"]["configured"] is False

    force = client.post(
        "/api/v1/spaces/space-1/git/operations:preview",
        headers=_headers(),
        json={
            "email": "user@example.com",
            "operation_request_id": "force-1",
            "argv": ["push", "--force", "origin", "HEAD"],
        },
    )
    assert force.status_code == 422
    assert force.json()["detail"]["code"] == "advanced_git_command_rejected"


def test_workspace_git_rejects_escaping_checkpoint_path(git_api):
    client, _, _, _ = git_api

    response = client.post(
        "/api/v1/spaces/space-1/git/checkpoints",
        headers=_headers(),
        json={
            "email": "user@example.com",
            "operation_request_id": "save-escape",
            "expected_repo_state_digest": "0" * 64,
            "paths": ["../secret.txt"],
            "path_sources": {"../secret.txt": "user_selected"},
            "target_role": "user",
            "target_id": "space-1",
            "actor_id": "user-1",
            "trigger": "user_save",
            "message": "Invalid save",
        },
    )

    assert response.status_code == 422


def test_project_git_changes_returns_lazy_authoritative_diff(
    git_api,
    monkeypatch,
):
    client, service, _, space = git_api
    response = client.post(
        "/api/v1/spaces/space-1/git/bootstrap",
        headers=_headers(),
        json={"email": "user@example.com", "allow_init": True},
    )
    assert response.status_code == 200
    seed = space / "seed.txt"
    seed.write_text("seed\n", encoding="utf-8")
    service.git.commit_paths(space, (seed,), message="seed")
    service.journal.ensure_run(
        run_id="run-review",
        project_id="project-review",
        status="pending",
    )
    coordinator = WorkspaceGitCoordinator(
        service.journal,
        state_root=service.state_root,
        git_backend=service.git,
    )
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-review",
        run_id="run-review",
    )
    assert admission is not None
    workspace = coordinator.ensure_run_materialized(
        run_id="run-review",
        operation_request_id="materialize-review",
        expected_repo_state_digest=service.git.repo_state_token(space).digest,
        expected_project_version=admission.project.version,
        expected_project_head=admission.project.integration_head,
    )
    run_seed = workspace.run_worktree / "seed.txt"
    run_seed.write_text("updated\n", encoding="utf-8")
    note = workspace.run_worktree / "note.md"
    note.write_text("new note\n", encoding="utf-8")
    # Image previews have a larger budget than text diffs. This mirrors the
    # real regression: a valid 2.45 MB PNG was rejected by the 2 MB text cap.
    image_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * (2_456_112 - 8)
    binary = workspace.run_worktree / "image.png"
    binary.write_bytes(image_bytes)
    run_head = service.git.commit_paths(
        workspace.run_worktree,
        (run_seed, note, binary),
        message="review changes",
    )
    response = client.get(
        "/api/v1/runs/run-review/git/changes",
        params={"space_id": "space-1", "email": "user@example.com"},
        headers=_headers(),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Run changes are not finalized yet"

    promoted = coordinator.promote_run(
        run_id="run-review",
        operation_request_id="promote-review",
        expected_run_state_digest=service.git.repo_state_token(
            workspace.run_worktree
        ).digest,
        expected_project_version=workspace.project.version,
        expected_project_head=str(workspace.project.integration_head),
        expected_run_head=run_head,
    )
    assert promoted.project.integration_head == run_head

    response = client.get(
        "/api/v1/projects/project-review/git/changes",
        params={"space_id": "space-1", "email": "user@example.com"},
        headers=_headers(),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["base_commit"] == admission.run.workspace_base_commit
    assert payload["target_commit"] == run_head
    assert payload["totals"] == {"added": 2, "removed": 1}
    assert payload["truncated"] is False
    files = {item["path"]: item for item in payload["files"]}
    assert files["seed.txt"]["status"] == "modified"
    assert files["note.md"]["status"] == "added"
    assert files["image.png"]["binary"] is True
    assert str(space) not in response.text
    run_response = client.get(
        "/api/v1/runs/run-review/git/changes",
        params={"space_id": "space-1", "email": "user@example.com"},
        headers=_headers(),
    )
    assert run_response.status_code == 200
    run_payload = run_response.json()
    assert run_payload["run_id"] == "run-review"
    assert run_payload["project_id"] == "project-review"
    assert run_payload["base_commit"] == admission.run.workspace_base_commit
    assert run_payload["target_commit"] == run_head
    assert run_payload["files"] == payload["files"]
    assert run_payload["totals"] == payload["totals"]
    assert str(space) not in run_response.text

    response = client.get(
        "/api/v1/projects/project-review/git/changes/content",
        params={
            "space_id": "space-1",
            "email": "user@example.com",
            "path": "seed.txt",
            "base_commit": payload["base_commit"],
            "target_commit": payload["target_commit"],
        },
        headers=_headers(),
    )
    assert response.status_code == 200
    assert response.json()["before"]["content"] == "seed\n"
    assert response.json()["after"]["content"] == "updated\n"
    assert str(space) not in response.text

    run_response = client.get(
        "/api/v1/runs/run-review/git/changes/content",
        params={
            "space_id": "space-1",
            "email": "user@example.com",
            "path": "seed.txt",
            "base_commit": run_payload["base_commit"],
            "target_commit": run_payload["target_commit"],
        },
        headers=_headers(),
    )
    assert run_response.status_code == 200
    assert run_response.json()["run_id"] == "run-review"
    assert run_response.json()["project_id"] == "project-review"
    assert run_response.json()["before"]["content"] == "seed\n"
    assert run_response.json()["after"]["content"] == "updated\n"
    assert str(space) not in run_response.text

    image_response = client.get(
        "/api/v1/projects/project-review/git/changes/blob",
        params={
            "space_id": "space-1",
            "email": "user@example.com",
            "path": "image.png",
            "side": "after",
            "base_commit": payload["base_commit"],
            "target_commit": payload["target_commit"],
        },
        headers=_headers(),
    )
    assert image_response.status_code == 200
    assert image_response.headers["content-type"] == "image/png"
    assert image_response.headers["cache-control"] == "private, no-store"
    assert image_response.content == image_bytes
    assert str(space) not in image_response.text

    with monkeypatch.context() as patch:
        patch.setattr(
            workspace_git_controller,
            "_PROJECT_IMAGE_PREVIEW_MAX_BYTES",
            len(image_bytes) - 1,
        )
        oversized_image_response = client.get(
            "/api/v1/projects/project-review/git/changes/blob",
            params={
                "space_id": "space-1",
                "email": "user@example.com",
                "path": "image.png",
                "side": "after",
                "base_commit": payload["base_commit"],
                "target_commit": payload["target_commit"],
            },
            headers=_headers(),
        )
    assert oversized_image_response.status_code == 413
    assert oversized_image_response.json()["detail"] == (
        "Image preview is too large"
    )

    missing_before = client.get(
        "/api/v1/projects/project-review/git/changes/blob",
        params={
            "space_id": "space-1",
            "email": "user@example.com",
            "path": "image.png",
            "side": "before",
            "base_commit": payload["base_commit"],
            "target_commit": payload["target_commit"],
        },
        headers=_headers(),
    )
    assert missing_before.status_code == 404

    run_image_response = client.get(
        "/api/v1/runs/run-review/git/changes/blob",
        params={
            "space_id": "space-1",
            "email": "user@example.com",
            "path": "image.png",
            "side": "after",
            "base_commit": run_payload["base_commit"],
            "target_commit": run_payload["target_commit"],
        },
        headers=_headers(),
    )
    assert run_image_response.status_code == 200
    assert run_image_response.content == image_bytes

    response = client.get(
        "/api/v1/projects/project-review/git/changes/content",
        params={
            "space_id": "space-1",
            "email": "user@example.com",
            "path": "not-changed.txt",
            "base_commit": payload["base_commit"],
            "target_commit": payload["target_commit"],
        },
        headers=_headers(),
    )
    assert response.status_code == 404


def test_run_git_changes_reports_unmaterialized_run_without_404(git_api):
    client, service, _, _ = git_api
    service.journal.ensure_run(
        run_id="run-not-materialized",
        project_id="project-not-materialized",
    )

    response = client.get(
        "/api/v1/runs/run-not-materialized/git/changes",
        params={"space_id": "space-1", "email": "user@example.com"},
        headers=_headers(),
    )

    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "reason": "run_git_not_materialized",
        "run_id": "run-not-materialized",
        "project_id": "project-not-materialized",
    }

    missing = client.get(
        "/api/v1/runs/run-does-not-exist/git/changes",
        params={"space_id": "space-1", "email": "user@example.com"},
        headers=_headers(),
    )
    assert missing.status_code == 404


def test_run_workspace_api_stays_lazy_until_explicit_materialization(git_api):
    client, service, _, space = git_api
    response = client.post(
        "/api/v1/spaces/space-1/git/bootstrap",
        headers=_headers(),
        json={"email": "user@example.com", "allow_init": True},
    )
    assert response.status_code == 200
    seed = space / "seed.txt"
    seed.write_text("seed\n", encoding="utf-8")
    service.git.commit_paths(space, (seed,), message="seed")
    service.journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    coordinator = WorkspaceGitCoordinator(
        service.journal,
        state_root=service.state_root,
        git_backend=service.git,
    )
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )
    assert admission is not None

    response = client.get(
        "/api/v1/runs/run-1/git/snapshot",
        params={"space_id": "space-1", "email": "user@example.com"},
        headers=_headers(),
    )
    assert response.status_code == 200
    assert response.json()["materialized"] is False

    response = client.get(
        "/api/v1/runs/run-1/git/snapshot/files",
        params={
            "space_id": "space-1",
            "email": "user@example.com",
            "path": "seed.txt",
            "max_bytes": 4,
        },
        headers=_headers(),
    )
    assert response.status_code == 206
    assert response.content == b"seed"
    assert response.headers["content-range"] == "bytes 0-3/5"
    assert response.headers["x-eigent-snapshot-source"] == "project_blob"
    assert str(space) not in response.text

    response = client.get(
        "/api/v1/runs/run-1/git/snapshot",
        params={"space_id": "space-1", "email": "user@example.com"},
        headers=_headers(),
    )
    assert response.status_code == 200
    assert response.json()["materialized"] is True
    assert response.json()["snapshot"]["generation"] == 0

    response = client.get(
        "/api/v1/runs/run-1/git/workspace",
        params={"space_id": "space-1", "email": "user@example.com"},
        headers=_headers(),
    )
    assert response.status_code == 200
    assert response.json()["materialized"] is False
    assert response.json()["run"]["materialization_state"] == (
        "unmaterialized"
    )

    response = client.post(
        "/api/v1/runs/run-1/git/workspace:materialize",
        headers=_headers(),
        json={
            "space_id": "space-1",
            "email": "user@example.com",
            "operation_request_id": "materialize-run-1",
            "expected_repo_state_digest": service.git.repo_state_token(
                space
            ).digest,
            "expected_project_version": admission.project.version,
            "expected_project_head": admission.project.integration_head,
        },
    )
    assert response.status_code == 200
    assert response.json()["materialized"] is True
    assert response.json()["freshness"] == "current"
    assert response.json()["run"]["materialization_state"] == "materialized"
    assert str(service.state_root) not in response.text
    assert str(space) not in response.text

    run = service.journal.get_run_git_materialization("run-1")
    project = service.journal.get_project_git_state("project-1")
    assert run is not None and run.worktree_path
    assert project is not None and project.integration_head
    save_payload = {
        "space_id": "space-1",
        "email": "user@example.com",
        "operation_request_id": "save-run-note-1",
        "editor_session_id": "editor-1",
        "relative_path": "notes/progress.md",
        "content": "saved from Run workspace",
        "expected_content_digest": None,
        "actor_id": "user-1",
    }
    response = client.post(
        "/api/v1/runs/run-1/git/workspace/files:save",
        headers=_headers(),
        json=save_payload,
    )
    assert response.status_code == 201
    saved_checkpoint = response.json()["checkpoint_id"]
    replay = client.post(
        "/api/v1/runs/run-1/git/workspace/files:save",
        headers=_headers(),
        json=save_payload,
    )
    assert replay.status_code == 201
    assert replay.json()["checkpoint_id"] == saved_checkpoint
    assert (
        Path(run.worktree_path) / "notes/progress.md"
    ).read_text() == "saved from Run workspace"
    run_seed = Path(run.worktree_path) / "seed.txt"
    run_seed.write_text("agent edit\n", encoding="utf-8")
    response = client.post(
        "/api/v1/spaces/space-1/git/checkpoints",
        headers=_headers(),
        json={
            "email": "user@example.com",
            "operation_request_id": "checkpoint-run-1",
            "expected_repo_state_digest": service.git.repo_state_token(
                Path(run.worktree_path)
            ).digest,
            "paths": ["seed.txt"],
            "path_sources": {"seed.txt": "agent_modified"},
            "target_role": "run",
            "target_id": "run-1",
            "actor_id": "agent-1",
            "trigger": "run_terminal",
            "message": "Checkpoint Run output",
            "workspace_source": "run",
            "run_id": "run-1",
        },
    )
    assert response.status_code == 201
    run_head = response.json()["commit_oid"]

    response = client.post(
        "/api/v1/runs/run-1/git/workspace:promote",
        headers=_headers(),
        json={
            "space_id": "space-1",
            "email": "user@example.com",
            "operation_request_id": "promote-run-1",
            "expected_run_state_digest": service.git.repo_state_token(
                Path(run.worktree_path)
            ).digest,
            "expected_project_version": project.version,
            "expected_project_head": project.integration_head,
            "expected_run_head": run_head,
        },
    )
    assert response.status_code == 200
    assert response.json()["pending_apply"] is True
    assert response.json()["freshness"] == "stale"
    assert response.json()["run"]["materialization_state"] == "promoted"
    assert seed.read_text(encoding="utf-8") == "seed\n"
    promoted_payload = response.json()

    response = client.post(
        "/api/v1/projects/project-1/git/workspace:refresh",
        headers=_headers(),
        json={
            "space_id": "space-1",
            "email": "user@example.com",
            "operation_request_id": "refresh-project-1",
            "expected_projection_state_digest": promoted_payload[
                "projection_state_digest"
            ],
            "expected_project_version": promoted_payload["version"],
            "expected_integration_head": promoted_payload["integration_head"],
            "expected_projected_head": promoted_payload["projected_head"],
        },
    )
    assert response.status_code == 200
    assert response.json()["freshness"] == "current"
    projected = service.journal.get_project_git_state("project-1")
    assert projected is not None and projected.worktree_path
    assert (Path(projected.worktree_path) / "seed.txt").read_text() == (
        "agent edit\n"
    )
    assert seed.read_text(encoding="utf-8") == "seed\n"

    response = client.get(
        "/api/v1/projects/project-1/git/workspace",
        params={"space_id": "space-1", "email": "user@example.com"},
        headers=_headers(),
    )
    assert response.status_code == 200
    assert response.json()["integration_head"] == run_head
    assert response.json()["run"] is None
