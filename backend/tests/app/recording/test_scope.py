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

import json
from types import SimpleNamespace

import pytest

from app.recording.models import RecordingError
from app.recording.scope import _managed_scope
from app.run_journal import SQLiteRunJournal


def test_managed_scope_uses_admitted_registration_and_canonical_binding(
    tmp_path,
):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    root = tmp_path / "space"
    root.mkdir()
    binding = SimpleNamespace(workspace_root=str(root), updated_at="version")
    document = {
        "configuration": {
            "project_id": "session",
            "space_id": "space",
            "principal_ref": "account:7",
        },
        "binding": {
            "source": {"account_owner_id": "7", "space_id": "space"},
            "workspace_binding": {"updated_at": "version"},
            "source_root": str(root),
        },
    }
    # Minimal admitted fixture respects the production table's Run/Attempt FKs.
    journal.ensure_run(run_id="run", project_id="session")
    attempt = journal.create_run_attempt(
        "run", request_id="start", reason="initial", activate=True
    )
    with journal._write_transaction() as db:
        # Scope resolver reads only the admitted request's immutable references.
        # Its storage contract is exercised with an actual SQLite journal.
        db.execute(
            "INSERT INTO managed_execution_configurations VALUES(?,?,?,?,?)",
            ("config", "session", "account:7", json.dumps(document), 1),
        )
        db.execute(
            "INSERT INTO execution_requests(request_id,project_id,kind,envelope_json,envelope_digest,intent_digest,source,queue_seq,delivery_mode,status,created_at,updated_at) VALUES('request','session','start',?,'digest','intent','local',1,'wait','pending',1,1)",
            (
                json.dumps(
                    {
                        "configuration_revision": "config",
                        "principal_ref": "account:7",
                    }
                ),
            ),
        )
        # A real admitted attempt is created through the journal helper below.
    with journal._write_transaction() as db:
        db.execute(
            "UPDATE execution_requests SET status='admitted',admitted_run_id='run',admitted_attempt_id=?",
            (attempt.attempt_id,),
        )
    run = journal.get_run("run")
    resolver = SimpleNamespace(
        store=SimpleNamespace(
            get_canonical_binding=lambda user, space: binding
        )
    )
    scope = _managed_scope(journal, resolver, run, "brain_user:7")
    assert scope.root == root
    assert scope.user_id == "7"
    assert scope.attempt_id == attempt.attempt_id
    with pytest.raises(RecordingError, match="recording_forbidden"):
        _managed_scope(journal, resolver, run, "brain_user:8")
    binding.updated_at = "rebound"
    with pytest.raises(RecordingError, match="workspace_rebound"):
        _managed_scope(journal, resolver, run, "brain_user:7")
    journal.close()
