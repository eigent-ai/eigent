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

"""Usage attribution on the model.invocation.* Run events.

These events are synced to Cloud unchanged, so their payloads are a
contract: identifiers, digests, counts and timing only. Prompt and
response text must never appear in them.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from app.run_journal import SCHEMA_VERSION, RunEventDraft, SQLiteRunJournal
from app.run_journal.cloud_projection import cloud_event_payload

DISPATCHED_KEYS = {
    "invocation_id",
    "attempt_id",
    "step_id",
    "agent_id",
    "agent_name",
    "logical_call_id",
    "retry_index",
    "provider",
    "model",
    "transport",
    "request_digest",
    "redaction_version",
}

TERMINAL_KEYS = {
    "invocation_id",
    "attempt_id",
    "step_id",
    "agent_id",
    "agent_name",
    "provider",
    "model",
    "status",
    "request_digest",
    "response_digest",
    "finish_reason",
    "usage",
    "duration_ms",
    "error_code",
}

USAGE_KEYS = {
    "prompt_tokens",
    "completion_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
}

PROMPT_TEXT = "summarise the quarterly numbers for the board"
RESPONSE_TEXT = "Revenue grew eleven percent quarter over quarter"


def _journal(tmp_path: Path) -> SQLiteRunJournal:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    return journal


def _start(
    journal: SQLiteRunJournal,
    invocation_id: str,
    *,
    attempt_id: str | None = None,
    agent_name: str | None = "developer_agent",
    now: float = 10.0,
) -> None:
    journal.start_model_invocation(
        invocation_id=invocation_id,
        run_id="run-1",
        attempt_id=attempt_id,
        agent_id="agent-1",
        agent_name=agent_name,
        logical_call_id=f"logical-{invocation_id}",
        provider="openai",
        model="gpt-test",
        transport="chat_completions",
        thinking_effort=None,
        request={"messages": [{"role": "user", "content": PROMPT_TEXT}]},
        now=now,
    )


def _synced_model_events(
    journal: SQLiteRunJournal,
) -> dict[str, dict[str, Any]]:
    """Return the Cloud payload of each model.invocation.* event by type."""

    return {
        event.event_type: cloud_event_payload(event.event_type, event.payload)
        for event in journal.list_events("run-1")
        if event.event_type.startswith("model.invocation.")
    }


def _assert_no_content(payload: dict[str, Any]) -> None:
    encoded = json.dumps(payload)
    assert PROMPT_TEXT not in encoded
    assert RESPONSE_TEXT not in encoded


def test_completed_call_events_carry_agent_model_and_duration(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    _start(journal, "inv-1", now=10.0)
    journal.finish_model_invocation(
        "inv-1",
        status="completed",
        response={
            "choices": [
                {
                    "message": {"content": RESPONSE_TEXT},
                    "finish_reason": "stop",
                }
            ],
        },
        prompt_tokens=120,
        completion_tokens=30,
        cache_read_tokens=64,
        cache_write_tokens=0,
        finish_reason="stop",
        now=12.5,
    )

    events = _synced_model_events(journal)
    dispatched = events["model.invocation.dispatched"]
    completed = events["model.invocation.completed"]

    assert set(dispatched) == DISPATCHED_KEYS
    assert set(completed) == TERMINAL_KEYS
    assert set(completed["usage"]) == USAGE_KEYS
    assert dispatched["agent_name"] == "developer_agent"
    assert completed["agent_name"] == "developer_agent"
    assert completed["provider"] == "openai"
    assert completed["model"] == "gpt-test"
    assert completed["duration_ms"] == 2500
    # Existing readers keep the nested usage object unchanged.
    assert completed["usage"] == {
        "prompt_tokens": 120,
        "completion_tokens": 30,
        "cache_read_tokens": 64,
        "cache_write_tokens": 0,
    }
    _assert_no_content(dispatched)
    _assert_no_content(completed)
    record = journal.get_model_invocation("inv-1")
    assert record is not None
    assert record.agent_name == "developer_agent"


def test_failed_call_event_has_the_same_key_set(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _start(journal, "inv-1", now=10.0)
    journal.finish_model_invocation(
        "inv-1",
        status="failed",
        error_code="RateLimitError",
        error_message=f"provider rejected: {PROMPT_TEXT}",
        now=10.25,
    )

    failed = _synced_model_events(journal)["model.invocation.failed"]

    assert set(failed) == TERMINAL_KEYS
    assert failed["error_code"] == "RateLimitError"
    assert failed["duration_ms"] == 250
    assert failed["provider"] == "openai"
    assert failed["model"] == "gpt-test"
    # The error message can quote the request, so it stays local.
    _assert_no_content(failed)


def test_run_end_sweep_event_carries_attribution_and_duration(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    attempt = journal.create_run_attempt(
        "run-1", request_id="initial", reason="initial", activate=True
    )
    _start(journal, "inv-1", attempt_id=attempt.attempt_id, now=10.0)

    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="terminal:failed",
            event_type="run.failed",
            payload={"reason": "test_terminal"},
            created_at=20.0,
        ),
    )

    unknown = _synced_model_events(journal)["model.invocation.outcome_unknown"]
    assert set(unknown) == TERMINAL_KEYS
    assert set(unknown["usage"]) == USAGE_KEYS
    assert unknown["agent_name"] == "developer_agent"
    assert unknown["provider"] == "openai"
    assert unknown["model"] == "gpt-test"
    assert unknown["duration_ms"] == 10_000
    _assert_no_content(unknown)


def test_startup_reconciliation_event_has_no_duration(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _start(journal, "inv-1", now=10.0)

    journal.reconcile_startup(now=500.0)

    unknown = _synced_model_events(journal)["model.invocation.outcome_unknown"]
    assert set(unknown) == TERMINAL_KEYS
    assert unknown["agent_name"] == "developer_agent"
    assert unknown["provider"] == "openai"
    assert unknown["model"] == "gpt-test"
    # The call ended at an unknown time before the restart.
    assert unknown["duration_ms"] is None


def test_missing_agent_name_is_null_not_absent(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _start(journal, "inv-1", agent_name="  ", now=10.0)
    journal.finish_model_invocation(
        "inv-1", status="completed", response={}, now=11.0
    )

    events = _synced_model_events(journal)
    assert set(events["model.invocation.dispatched"]) == DISPATCHED_KEYS
    assert set(events["model.invocation.completed"]) == TERMINAL_KEYS
    assert events["model.invocation.dispatched"]["agent_name"] is None
    assert events["model.invocation.completed"]["agent_name"] is None


def test_v43_database_gains_agent_name_and_keeps_open_calls(
    tmp_path: Path,
) -> None:
    path = tmp_path / "journal.sqlite3"
    journal = _journal(tmp_path)
    journal.close()
    with sqlite3.connect(path) as connection:
        connection.execute(
            "ALTER TABLE model_invocations DROP COLUMN agent_name"
        )
        connection.execute(
            "DELETE FROM run_journal_migrations WHERE version = 44"
        )
        connection.execute("PRAGMA user_version = 43")
        # A call that was in flight when the older app wrote this file.
        connection.execute(
            """
            INSERT INTO model_invocations(
                invocation_id, run_id, attempt_id, agent_id,
                logical_call_id, retry_index, status, provider, model,
                transport, request_json, request_digest, redaction_version,
                started_at
            ) VALUES (
                'inv-old', 'run-1', NULL, 'agent-1', 'logical-old', 0,
                'dispatched', 'openai', 'gpt-test', 'chat_completions',
                '{}', ?, 'model-invocation-v1', 10.0
            )
            """,
            ("0" * 64,),
        )

    upgraded = SQLiteRunJournal(path)
    try:
        assert upgraded.schema_version == SCHEMA_VERSION == 44
        old = upgraded.finish_model_invocation(
            "inv-old", status="completed", response={}, now=11.0
        )
        assert old.agent_name is None
        completed = _synced_model_events(upgraded)[
            "model.invocation.completed"
        ]
        assert set(completed) == TERMINAL_KEYS
        assert completed["agent_name"] is None
        assert completed["provider"] == "openai"
        assert completed["duration_ms"] == 1000
    finally:
        upgraded.close()

    # Re-running the migration on a file that already has the column is a
    # no-op rather than a duplicate-column failure.
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA user_version = 43")
    reopened = SQLiteRunJournal(path)
    try:
        assert reopened.schema_version == 44
    finally:
        reopened.close()
