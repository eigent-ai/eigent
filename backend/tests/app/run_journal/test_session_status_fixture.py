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

"""Shared navigation fixture authored and reopened through SQLiteRunJournal."""

import json
from dataclasses import asdict
from pathlib import Path

from app.run_journal import RunEventDraft, SQLiteRunJournal


def test_session_status_fixture_survives_journal_restart(tmp_path):
    fixtures = []
    for status in ["completed", "failed", "cancelled", "interrupted"]:
        path = tmp_path / f"{status}.sqlite3"
        project_id = f"project-{status}"
        run_id = f"run-{status}"
        with SQLiteRunJournal(path) as journal:
            journal.ensure_run(
                run_id=run_id,
                project_id=project_id,
                status="pending",
                now=1700000000,
            )
            journal.create_run_attempt(
                run_id,
                request_id="initial",
                reason="initial_execution",
                activate=True,
                attempt_id=f"attempt-{status}",
                now=1700000001,
            )
            if status != "interrupted":
                journal.append_event(
                    run_id,
                    RunEventDraft(
                        event_id=f"outcome-{status}",
                        event_type=f"run.{status}",
                        payload={},
                        created_at=1700000002,
                    ),
                )
        with SQLiteRunJournal(path) as journal:
            if status == "interrupted":
                journal.reconcile_startup(now=1700000002)
            run = journal.get_run(run_id)
            assert run.status == status
            events = [
                {**asdict(e), "project_id": project_id, "origin": run.origin}
                for e in journal.list_events(run_id)
            ]
            fixtures.append({"summary": asdict(run), "events": events})
        with SQLiteRunJournal(path) as journal:
            assert journal.get_run(run_id).status == status
    fixture = (
        Path(__file__).resolve().parents[4]
        / "test/fixtures/session-status/journal-outcomes.json"
    )
    assert fixtures == json.loads(fixture.read_text())
