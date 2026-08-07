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
