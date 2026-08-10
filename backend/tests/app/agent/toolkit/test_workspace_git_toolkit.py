from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from app.agent.toolkit import workspace_git_toolkit as toolkit_module
from app.agent.toolkit.workspace_git_toolkit import WorkspaceGitToolkit
from app.run_journal import SQLiteRunJournal
from app.workspace_git import (
    AdvancedGitService,
    ContentRepositoryService,
    GitBackend,
)


def test_workspace_git_toolkit_exposes_structured_scoped_capability(
    tmp_path: Path,
    monkeypatch,
):
    root = tmp_path / "space"
    root.mkdir()
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        backend = GitBackend(hooks_path=hooks)
        content = ContentRepositoryService(
            journal,
            state_root=tmp_path / "state",
            git_backend=backend,
        )
        repository = content.bootstrap(
            space_id="space-1",
            space_root=root,
            allow_init=True,
            eigent_owned_space=False,
        ).repository
        service = AdvancedGitService(
            journal,
            content=content,
            git_backend=backend,
        )
        monkeypatch.setattr(
            toolkit_module,
            "get_default_advanced_git_service",
            lambda: service,
        )
        monkeypatch.setattr(
            toolkit_module,
            "run_context_for_task",
            lambda _task_id: SimpleNamespace(
                space_id="space-1",
                working_directory=root,
            ),
        )
        toolkit = WorkspaceGitToolkit("project-1", "developer")

        capabilities = json.loads(toolkit.git_capabilities())
        status = json.loads(toolkit.git_status())
        preview = json.loads(
            toolkit.advanced_git_preview(
                ["status", "--short"],
                "preview-1",
            )
        )

        assert capabilities["repository_id"] == repository.repository_id
        assert capabilities["logical_root"] == "."
        assert str(root) not in json.dumps(capabilities)
        assert status["available"] is True
        assert preview["classification"] == "git.read"
        assert preview["requires_user_confirmation"] is False
        rejection = json.loads(
            toolkit.advanced_git_preview(
                ["push", "--force", "origin", "HEAD"],
                "force-1",
            )
        )
        assert rejection["accepted"] is False
        assert rejection["rejection"]["code"] == (
            "advanced_git_policy_rejected"
        )
        assert "preview" in rejection["rejection"]["remediation"].lower()
        assert "HumanInteraction" in capabilities["model_guidance"]
