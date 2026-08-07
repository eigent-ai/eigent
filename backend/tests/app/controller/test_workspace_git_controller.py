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
from app.workspace_git import ContentRepositoryService, GitBackend


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
