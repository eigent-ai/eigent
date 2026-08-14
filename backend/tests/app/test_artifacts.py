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


def test_finalize_rescans_non_terminal_run_and_reuses_terminal_manifest(
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
            user_id="user-1",
        )
        resolver = MagicMock()
        resolver.store.find_snapshot.return_value = (
            "user_user-1",
            snapshot,
        )
        monkeypatch.setattr(
            artifacts, "get_workspace_resolver", lambda: resolver
        )

        first = artifacts.finalize_run_artifacts(journal, run)
        resumed = output_root / "resumed.txt"
        resumed.write_text(
            "created after the first manifest", encoding="utf-8"
        )
        second = artifacts.finalize_run_artifacts(journal, run)
        journal.append_event(
            "run-1",
            artifacts.RunEventDraft(
                event_id="run-1-completed",
                event_type="run.completed",
                payload={"artifact_manifest_event_id": second.event_id},
            ),
        )
        third = artifacts.finalize_run_artifacts(journal, run)
        events = journal.list_events("run-1")

        assert first.event_id != second.event_id
        assert second.event_id == third.event_id
        assert first.payload["artifact_count"] == 2
        assert second.payload["artifact_count"] == 3
        assert {event.event_type for event in events} >= {
            "artifact.created",
            "artifact.modified",
            "artifact.manifest.finalized",
            "run.completed",
        }
        assert second.payload["scan_status"] == "complete"
        assert {
            artifact["uploadPolicy"]
            for artifact in second.payload["artifacts"]
        } == {"agent_generated", "metadata_only"}
        assert resolver.store.freeze_artifact_manifest.call_count == 2
    finally:
        journal.close()


def test_finalize_records_explicit_unavailable_manifest_without_workspace(
    monkeypatch, tmp_path
):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    try:
        run = journal.ensure_run(run_id="run-1", project_id="project-1")
        resolver = MagicMock()
        resolver.store.find_snapshot.return_value = None
        monkeypatch.setattr(
            artifacts, "get_workspace_resolver", lambda: resolver
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
        journal.append_event(
            "run-1",
            artifacts.RunEventDraft(
                event_id="run-1-completed",
                event_type="run.completed",
                payload={},
            ),
        )

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
        assert len(events) == 3
        assert {result.event_id for result in results} == {
            manifests[0].event_id
        }
    finally:
        journal.close()


def test_success_terminal_pins_latest_manifest_observed_inside_transaction(
    tmp_path,
):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    try:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        stale = artifacts.record_artifact_manifest(
            journal,
            run_id="run-1",
            project_id="project-1",
            artifacts=[
                {
                    "filename": "first.txt",
                    "path": "/workspace/first.txt",
                    "relativePath": "first.txt",
                    "changeType": "generated",
                }
            ],
        )
        latest = artifacts.record_artifact_manifest(
            journal,
            run_id="run-1",
            project_id="project-1",
            artifacts=[
                {
                    "filename": "second.txt",
                    "path": "/workspace/second.txt",
                    "relativePath": "second.txt",
                    "changeType": "generated",
                }
            ],
        )

        _, terminal = journal.complete_successful_run(
            "run-1",
            assistant_final=artifacts.RunEventDraft(
                event_id="assistant-final:run-1",
                event_type="assistant.final",
                payload={"message": "done"},
            ),
            terminal=artifacts.RunEventDraft(
                event_id="run-1-completed",
                event_type="run.completed",
                payload={"reason": "completed"},
            ),
            artifact_manifest=stale,
            expected_project_id="project-1",
        )

        assert stale.event_id != latest.event_id
        assert (
            terminal.payload["artifact_manifest_event_id"] == latest.event_id
        )
        assert terminal.payload["artifact_count"] == 1
    finally:
        journal.close()


def test_discovery_marks_exact_result_cap_as_partial(tmp_path):
    output_root = tmp_path / "output"
    output_root.mkdir()
    for name in ("a.txt", "b.txt"):
        (output_root / name).write_text(name, encoding="utf-8")
    snapshot = SimpleNamespace(
        task_output_root=str(output_root),
        working_directory=str(output_root),
        task_start_time=0,
    )

    result = artifacts.discover_task_changed_files(snapshot, max_entries=1)

    assert len(result.artifacts) == 1
    assert result.scan_status == "partial"
    assert result.truncated is True
