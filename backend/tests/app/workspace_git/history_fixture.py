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

"""Real Git/SQLite/API fixture shared by Python and frontend regressions.

Run from backend with its Python environment to emit the API payloads as JSON.
Only the local account binding and service construction are substituted.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import local_control
from app.controller import workspace_git_controller
from app.run_journal import SQLiteRunJournal
from app.workspace_config import canonical_digest
from app.workspace_git import (
    ContentRepositoryService,
    GitBackend,
    WorkspaceGitCoordinator,
)


def task_ref(run_id: str, suffix: str = "completed") -> str:
    return (
        "refs/eigent/tasks/"
        + canonical_digest({"run_id": run_id})[:32]
        + f"/{suffix}"
    )


def build_history_fixture(tmp_path: Path) -> dict:
    root = tmp_path / "space"
    root.mkdir()
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    git = GitBackend(hooks_path=hooks)
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        content = ContentRepositoryService(
            journal, state_root=tmp_path / "state", git_backend=git
        )
        repository = content.bootstrap(
            space_id="space-1",
            space_root=root,
            allow_init=True,
            eigent_owned_space=True,
        ).repository

        def admit(run_id, project_id, repo=repository):
            journal.ensure_run(run_id=run_id, project_id=project_id)
            return journal.admit_git_run_workspace(
                run_id=run_id,
                project_id=project_id,
                repository_id=repo.repository_id,
                user_head=git.current_head(Path(repo.root_path)),
                user_ref="refs/heads/main",
            )

        def commit(subject, timestamp):
            # Fixed dates exercise ordering independently of ref enumeration.
            tree = git.empty_tree_oid(root)
            return subprocess.run(
                ["git", "-C", str(root), "commit-tree", tree, "-m", subject],
                env={
                    **git._environment(
                        identity=("Fixture", "fixture@example.com")
                    ),
                    "GIT_AUTHOR_DATE": f"{timestamp} +0000",
                    "GIT_COMMITTER_DATE": f"{timestamp} +0000",
                },
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()

        app = FastAPI()
        app.include_router(workspace_git_controller.router, prefix="/api/v1")
        resolver = SimpleNamespace(
            store=SimpleNamespace(
                get_binding=lambda *_args: SimpleNamespace(
                    workspace_root=str(root)
                )
            )
        )
        with (
            patch.object(
                workspace_git_controller, "_service", lambda: content
            ),
            patch.object(
                workspace_git_controller,
                "get_workspace_resolver",
                lambda: resolver,
            ),
            patch.dict(
                os.environ,
                {
                    "EIGENT_RUNTIME": "electron",
                    "EIGENT_LOCAL_CONTROL_CAPABILITY": "history-fixture",
                },
            ),
            patch.object(
                local_control,
                "_process_local_control_capability",
                local_control._CAPABILITY_UNSET,
            ),
            TestClient(app, client=("127.0.0.1", 50000)) as client,
        ):

            def history(limit=50):
                response = client.get(
                    "/api/v1/spaces/space-1/git/history",
                    params={"email": "fixture@example.com", "limit": limit},
                    headers={
                        local_control.LOCAL_CONTROL_CAPABILITY_HEADER: "history-fixture"
                    },
                )
                assert response.status_code == 200, response.text
                return response.json()

            technical_only = history()
            oids = {}
            refs = []
            # Two Tasks in one Session, another Task in a second Session.
            for run_id, project_id, timestamp, suffix in (
                ("task-a", "session-a", 1700000030, "completed"),
                ("task-b", "session-a", 1700000010, "completed"),
                ("task-c", "session-b", 1700000020, "recovery-cancelled"),
            ):
                _, run = admit(run_id, project_id)
                oid = commit(f"Checkpoint {run_id}", timestamp)
                oids[run_id] = oid
                ref = task_ref(run_id, suffix)
                refs.append(ref)
                git.update_eigent_ref(root, ref, oid)
                journal.complete_direct_git_run(
                    run_id=run_id,
                    expected_base_commit=run.workspace_base_commit,
                    terminal_commit=oid,
                )
            # Another retained boundary for the same Task must not add a Task.
            recovery_ref = task_ref("task-a", "recovery-failed")
            refs.append(recovery_ref)
            git.update_eigent_ref(
                root,
                recovery_ref,
                commit("Earlier task-a checkpoint", 1700000000),
            )
            direct = history()

            other_root = tmp_path / "other-space"
            other_root.mkdir()
            other_repo = content.bootstrap(
                space_id="other-space",
                space_root=other_root,
                allow_init=True,
                eigent_owned_space=True,
            ).repository
            admit("foreign-task", "foreign-session", other_repo)
            technical_refs = [
                task_ref("orphan-task"),
                task_ref("foreign-task"),
                task_ref("task-a", "unknown"),
                task_ref("task-a", "recovery-cancelled/extra"),
                "refs/eigent/tasks/not-a-digest/completed",
            ]
            for ref in technical_refs:
                git.update_eigent_ref(root, ref, oids["task-a"])
            # A Task without changes finalizes at its base: no saved version.
            _, unchanged = admit("unchanged-task", "session-c")
            journal.complete_direct_git_run(
                run_id="unchanged-task",
                expected_base_commit=unchanged.workspace_base_commit,
                terminal_commit=unchanged.workspace_base_commit,
            )
            unchanged_ref = task_ref("unchanged-task")
            technical_refs.append(unchanged_ref)
            git.update_eigent_ref(
                root, unchanged_ref, unchanged.workspace_base_commit
            )
            # A validly named ref to a non-commit is also technical-only.
            non_commit_ref = task_ref("task-b", "recovery-cancelled")
            technical_refs.append(non_commit_ref)
            git.update_eigent_ref(
                root, non_commit_ref, git.empty_tree_oid(root)
            )
            with_orphans = history()
            limited = history(limit=1)

            # Exercise real managed materialization alongside direct checkpoints.
            project, _ = admit("managed-task", "session-a")
            coordinator = WorkspaceGitCoordinator(
                journal, state_root=tmp_path / "state", git_backend=git
            )
            managed = coordinator.ensure_run_materialized(
                run_id="managed-task",
                operation_request_id="managed-materialization",
                expected_repo_state_digest=git.repo_state_token(root).digest,
                expected_project_version=project.version,
                expected_project_head=project.integration_head,
            )
            legacy_refs = [
                "refs/eigent/archive/runs/legacy-task/integration",
                "refs/eigent/archive/runs/legacy-task/agents/agent-1",
                "refs/heads/eigent/agent/legacy-active/agent-1",
                "refs/heads/eigent/run/legacy-active",
                "refs/heads/eigent/project/legacy-session",
            ]
            for ref in legacy_refs:
                git.update_eigent_ref(root, ref, oids["task-b"])
            mixed = history()
            return {
                "technical_only": technical_only,
                "direct": direct,
                "with_orphans": with_orphans,
                "limited": limited,
                "mixed": mixed,
                "direct_refs": refs,
                "technical_refs": technical_refs,
                "legacy_refs": legacy_refs,
                "managed_ref": managed.run.run_ref,
                "managed_project_ref": managed.project.integration_ref,
                "oids": oids,
            }


if __name__ == "__main__":
    with TemporaryDirectory(prefix="eigent-history-") as directory:
        print(json.dumps(build_history_fixture(Path(directory))))
