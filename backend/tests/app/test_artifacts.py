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

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import MagicMock

from app import artifacts
from app.run_journal import SQLiteRunJournal


def test_finalize_commits_artifacts_then_manifest_and_is_idempotent(
    monkeypatch, tmp_path
):
    output_root = tmp_path / "output"
    workspace_root = tmp_path / "workspace"
    output_root.mkdir()
    workspace_root.mkdir()
    generated = output_root / "report.csv"
    generated.write_text("a,b\n1,2\n", encoding="utf-8")
    changed = workspace_root / "notes.md"
    changed.write_text("updated", encoding="utf-8")

    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    try:
        run = journal.ensure_run(run_id="run-1", project_id="project-1")
        snapshot = SimpleNamespace(
            task_id="run-1",
            project_id="project-1",
            task_output_root=str(output_root),
            working_directory=str(workspace_root),
            task_start_time=0,
            artifact_manifest=None,
        )
        resolver = MagicMock()
        resolver.store.get_snapshot.return_value = snapshot
        monkeypatch.setattr(
            artifacts, "get_workspace_resolver", lambda: resolver
        )

        from app.service import task as task_service

        monkeypatch.setattr(
            task_service,
            "get_task_lock_if_exists",
            lambda _project_id: SimpleNamespace(
                email="user@example.com", user_id="user-1"
            ),
        )

        first = artifacts.finalize_run_artifacts(journal, run)
        second = artifacts.finalize_run_artifacts(journal, run)
        events = journal.list_events("run-1")

        assert first.event_id == second.event_id
        assert {event.event_type for event in events[:-1]} == {
            "artifact.created",
            "artifact.modified",
        }
        assert events[-1].event_type == "artifact.manifest.finalized"
        assert first.payload["artifact_count"] == 2
        assert first.payload["scan_status"] == "complete"
        assert {
            artifact["uploadPolicy"] for artifact in first.payload["artifacts"]
        } == {"agent_generated", "metadata_only"}
        resolver.store.freeze_artifact_manifest.assert_called_once()
    finally:
        journal.close()


def test_finalize_records_explicit_unavailable_manifest_without_workspace(
    monkeypatch, tmp_path
):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    try:
        run = journal.ensure_run(run_id="run-1", project_id="project-1")
        from app.service import task as task_service

        monkeypatch.setattr(
            task_service, "get_task_lock_if_exists", lambda _project_id: None
        )

        manifest = artifacts.finalize_run_artifacts(journal, run)

        assert manifest.event_type == "artifact.manifest.finalized"
        assert manifest.payload == {
            "artifacts": [],
            "artifact_count": 0,
            "scan_status": "workspace_unavailable",
            "truncated": False,
            "manifest_digest": manifest.payload["manifest_digest"],
        }
    finally:
        journal.close()


def test_concurrent_manifest_finalization_commits_one_authoritative_barrier(
    tmp_path,
):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    barrier = Barrier(2)
    try:
        journal.ensure_run(run_id="run-1", project_id="project-1")

        def finalize(filename: str):
            barrier.wait()
            return artifacts.record_artifact_manifest(
                journal,
                run_id="run-1",
                project_id="project-1",
                artifacts=[
                    {
                        "filename": filename,
                        "path": f"/workspace/{filename}",
                        "relativePath": filename,
                        "changeType": "generated",
                    }
                ],
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(finalize, ("first.txt", "second.txt")))

        events = journal.list_events("run-1")
        manifests = [
            event
            for event in events
            if event.event_type == "artifact.manifest.finalized"
        ]
        assert len(manifests) == 1
        assert len(events) == 2
        assert {result.event_id for result in results} == {
            manifests[0].event_id
        }
    finally:
        journal.close()
