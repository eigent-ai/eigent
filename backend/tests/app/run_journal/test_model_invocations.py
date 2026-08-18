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

import sqlite3
from pathlib import Path

import pytest

from app.run_journal.store import (
    IdempotencyConflictError,
    InvalidRunTransitionError,
    SQLiteRunJournal,
)


def _journal(tmp_path: Path) -> SQLiteRunJournal:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    return journal


def test_model_invocation_is_structured_redacted_and_event_linked(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)

    started = journal.start_model_invocation(
        invocation_id="inv-1",
        run_id="run-1",
        attempt_id=None,
        agent_id="agent-1",
        logical_call_id="logical-1",
        provider="openai",
        model="gpt-test",
        transport="responses",
        thinking_effort="high",
        request={
            "messages": [
                {
                    "role": "user",
                    "content": "Authorization: Bearer secret-token-value",
                }
            ],
            "model_config_dict": {"api_key": "sk-" + "a" * 40},
        },
        now=10.0,
    )

    assert started.status == "dispatched"
    assert started.retry_index == 0
    assert "secret-token-value" not in str(started.request)
    assert "sk-" + "a" * 40 not in str(started.request)
    assert started.request["model_config_dict"]["api_key"] == "[REDACTED]"

    journal.mark_model_invocation_first_token("inv-1", now=11.0)
    # The first-token marker is level-triggered and cannot create token-delta
    # rows when called repeatedly.
    journal.mark_model_invocation_first_token("inv-1", now=12.0)
    completed = journal.finish_model_invocation(
        "inv-1",
        status="completed",
        response={
            "choices": [{"finish_reason": "stop"}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2},
        },
        prompt_tokens=4,
        completion_tokens=2,
        finish_reason="stop",
        now=13.0,
    )

    assert completed.status == "completed"
    assert completed.first_token_at == 11.0
    assert completed.prompt_tokens == 4
    assert completed.completion_tokens == 2
    assert completed.response_digest is not None
    assert [
        event.event_type
        for event in journal.list_model_invocation_events("inv-1")
    ] == ["dispatched", "first_token", "completed"]
    assert [event.event_type for event in journal.list_events("run-1")] == [
        "model.invocation.dispatched",
        "model.invocation.completed",
    ]


def test_model_invocation_retry_index_is_allocated_under_writer_lock(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    values = []
    for invocation_id in ("inv-1", "inv-2"):
        values.append(
            journal.start_model_invocation(
                invocation_id=invocation_id,
                run_id="run-1",
                attempt_id=None,
                agent_id="agent-1",
                logical_call_id="logical-1",
                provider="openai",
                model="gpt-test",
                transport="chat_completions",
                thinking_effort=None,
                request={"messages": [{"role": "user", "content": "hi"}]},
            ).retry_index
        )

    assert values == [0, 1]


def test_model_invocation_attempt_mismatch_rolls_back_all_rows(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    journal.ensure_run(
        run_id="run-2", project_id="project-2", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-2", request_id="request-2", reason="initial"
    )

    with pytest.raises(IdempotencyConflictError):
        journal.start_model_invocation(
            invocation_id="inv-bad",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            agent_id="agent-1",
            logical_call_id="logical-bad",
            provider="openai",
            model="gpt-test",
            transport="chat_completions",
            thinking_effort=None,
            request={"messages": []},
        )

    assert journal.get_model_invocation("inv-bad") is None
    assert journal.list_events("run-1") == []


def test_model_invocation_terminal_write_is_idempotent(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    journal.start_model_invocation(
        invocation_id="inv-1",
        run_id="run-1",
        attempt_id=None,
        agent_id="agent-1",
        logical_call_id="logical-1",
        provider="openai",
        model="gpt-test",
        transport="chat_completions",
        thinking_effort=None,
        request={"messages": []},
    )
    first = journal.finish_model_invocation(
        "inv-1", status="failed", error_code="400", error_message="bad"
    )
    replay = journal.finish_model_invocation(
        "inv-1", status="failed", error_code="400", error_message="bad"
    )

    assert replay == first
    assert len(journal.list_model_invocation_events("inv-1")) == 2
    assert len(journal.list_events("run-1")) == 2
    with pytest.raises(InvalidRunTransitionError):
        journal.finish_model_invocation(
            "inv-1",
            status="failed",
            error_code="400",
            error_message="different terminal payload",
        )


def test_startup_reconciliation_closes_dispatched_model_call(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    journal.start_model_invocation(
        invocation_id="inv-crashed",
        run_id="run-1",
        attempt_id=None,
        agent_id="agent-1",
        logical_call_id="logical-crashed",
        provider="openai",
        model="gpt-test",
        transport="responses",
        thinking_effort="medium",
        request={"messages": []},
        now=10.0,
    )

    result = journal.reconcile_startup(now=20.0)

    record = journal.get_model_invocation("inv-crashed")
    assert record is not None
    assert record.status == "outcome_unknown"
    assert record.error_code == "brain_restart_after_dispatch"
    assert result.outcome_unknown_model_invocation_ids == ("inv-crashed",)
    assert [
        event.event_type
        for event in journal.list_model_invocation_events("inv-crashed")
    ] == ["dispatched", "outcome_unknown"]


def test_v29_database_adds_model_trajectory_tables(tmp_path: Path) -> None:
    path = tmp_path / "journal.sqlite3"
    journal = SQLiteRunJournal(path)
    journal.ensure_run(run_id="run-before-upgrade", project_id="project-1")
    journal.close()
    with sqlite3.connect(path) as connection:
        connection.execute("DROP TABLE model_invocation_events")
        connection.execute("DROP TABLE model_invocations")
        connection.execute(
            "DELETE FROM run_journal_migrations WHERE version = 30"
        )
        connection.execute("PRAGMA user_version = 29")

    upgraded = SQLiteRunJournal(path)
    try:
        assert upgraded.schema_version == 30
        assert upgraded.get_run("run-before-upgrade") is not None
        tables = {
            row[0]
            for row in upgraded._connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        assert {"model_invocations", "model_invocation_events"} <= tables
    finally:
        upgraded.close()
