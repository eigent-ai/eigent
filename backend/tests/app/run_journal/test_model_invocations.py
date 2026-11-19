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
from dataclasses import replace
from pathlib import Path

import pytest

from app.run_journal.models import RunEventDraft
from app.run_journal.store import (
    _MODEL_INVOCATION_DOCUMENT_MAX_BYTES,
    SCHEMA_VERSION,
    IdempotencyConflictError,
    InvalidRunTransitionError,
    SQLiteRunJournal,
)
from app.workload import (
    CAPTURE_POLICY_REQUIRED,
    DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
    PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS,
    RETENTION_POLICY_EVIDENCE_REQUIRED,
    RETENTION_POLICY_PRODUCT_DEFAULT,
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


def test_model_invocation_documents_respect_sqlite_byte_budget(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    oversized = '"\\🙂' * _MODEL_INVOCATION_DOCUMENT_MAX_BYTES

    started = journal.start_model_invocation(
        invocation_id="inv-budget",
        run_id="run-1",
        attempt_id=None,
        agent_id="agent-1",
        logical_call_id="logical-budget",
        provider="openai",
        model="gpt-test",
        transport="responses",
        thinking_effort=None,
        request={"messages": [{"role": "user", "content": oversized}]},
    )
    completed = journal.finish_model_invocation(
        "inv-budget",
        status="completed",
        response={"output": oversized},
    )

    assert started.request["_eigent_capture"]["truncated"] is True
    assert started.request["_eigent_capture"]["original_bytes"] > (
        _MODEL_INVOCATION_DOCUMENT_MAX_BYTES
    )
    assert len(started.request["_eigent_capture"]["original_sha256"]) == 64
    assert completed.response is not None
    assert completed.response["_eigent_capture"]["truncated"] is True
    sizes = journal._connection.execute(
        """
        SELECT length(CAST(request_json AS BLOB)),
               length(CAST(response_json AS BLOB))
        FROM model_invocations WHERE invocation_id = ?
        """,
        ("inv-budget",),
    ).fetchone()
    assert sizes is not None
    assert sizes[0] <= _MODEL_INVOCATION_DOCUMENT_MAX_BYTES
    assert sizes[1] <= _MODEL_INVOCATION_DOCUMENT_MAX_BYTES


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


@pytest.mark.parametrize(
    ("terminal_event_type", "expected_status"),
    [
        ("run.interrupted", "interrupted"),
        ("run.failed", "failed"),
    ],
)
def test_generic_terminal_transition_closes_dispatched_model_call(
    tmp_path: Path,
    terminal_event_type: str,
    expected_status: str,
) -> None:
    journal = _journal(tmp_path)
    attempt = journal.create_run_attempt(
        "run-1", request_id="initial", reason="initial", activate=True
    )
    journal.start_model_invocation(
        invocation_id="inv-terminal",
        run_id="run-1",
        attempt_id=attempt.attempt_id,
        agent_id="agent-1",
        logical_call_id="logical-terminal",
        provider="openai",
        model="gpt-test",
        transport="responses",
        thinking_effort=None,
        request={"messages": []},
        now=10,
    )

    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id=f"terminal:{expected_status}",
            event_type=terminal_event_type,
            payload={"reason": "test_terminal"},
            created_at=20,
        ),
    )

    invocation = journal.get_model_invocation("inv-terminal")
    assert invocation is not None
    assert invocation.status == "outcome_unknown"
    assert invocation.error_code == (
        "run_terminal_before_model_capture_completed"
    )
    assert journal.get_run("run-1").status == expected_status
    assert (
        journal.list_attempt_evidence_gaps(attempt.attempt_id)[0].reason_code
        == "outcome_unknown"
    )


def test_completed_cancel_closes_dispatched_model_call(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    attempt = journal.create_run_attempt(
        "run-1", request_id="initial", reason="initial", activate=True
    )
    journal.start_model_invocation(
        invocation_id="inv-cancel",
        run_id="run-1",
        attempt_id=attempt.attempt_id,
        agent_id="agent-1",
        logical_call_id="logical-cancel",
        provider="openai",
        model="gpt-test",
        transport="responses",
        thinking_effort=None,
        request={"messages": []},
        now=10,
    )

    journal.request_cancel(
        "run-1", request_id="cancel-1", reason="user", now=19
    )
    journal.complete_cancel("run-1", request_id="cancel-1", now=20)

    invocation = journal.get_model_invocation("inv-cancel")
    assert invocation is not None
    assert invocation.status == "outcome_unknown"
    assert journal.get_run("run-1").status == "cancelled"
    assert (
        journal.list_attempt_evidence_gaps(attempt.attempt_id)[0].reason_code
        == "outcome_unknown"
    )


def test_retention_candidates_follow_immutable_attempt_policy(
    tmp_path: Path,
) -> None:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    product_attempt = journal.create_run_attempt(
        "run-1", request_id="product", reason="initial"
    )
    journal.start_model_invocation(
        invocation_id="inv-product",
        run_id="run-1",
        attempt_id=product_attempt.attempt_id,
        agent_id="agent-1",
        logical_call_id="logical-product",
        provider="openai",
        model="gpt-test",
        transport="responses",
        thinking_effort=None,
        request={"messages": [{"role": "user", "content": "retain me"}]},
        now=1,
    )
    journal.finish_model_invocation(
        "inv-product",
        status="completed",
        response={"output": "done"},
        now=2,
    )

    journal.ensure_run(
        run_id="run-2", project_id="project-2", status="pending"
    )
    evidence_profile = replace(
        DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
        workload_kind="test",
        profile_version="test-v1",
        capture_policy_ref=CAPTURE_POLICY_REQUIRED,
        retention_policy_ref=RETENTION_POLICY_EVIDENCE_REQUIRED,
    )
    evidence_attempt = journal.create_run_attempt(
        "run-2",
        request_id="evidence",
        reason="test",
        workload_profile=evidence_profile,
    )
    journal.start_model_invocation(
        invocation_id="inv-evidence",
        run_id="run-2",
        attempt_id=evidence_attempt.attempt_id,
        agent_id="agent-2",
        logical_call_id="logical-evidence",
        provider="openai",
        model="gpt-test",
        transport="responses",
        thinking_effort=None,
        request={"messages": []},
        now=1,
    )
    journal.finish_model_invocation(
        "inv-evidence", status="completed", response={"output": "done"}, now=2
    )

    journal.ensure_run(
        run_id="run-3", project_id="project-3", status="pending"
    )
    strict_production_profile = replace(
        DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
        profile_version="strict-production-v1",
        capture_policy_ref=CAPTURE_POLICY_REQUIRED,
        retention_policy_ref=RETENTION_POLICY_EVIDENCE_REQUIRED,
    )
    strict_production_attempt = journal.create_run_attempt(
        "run-3",
        request_id="strict-production",
        reason="evidence",
        workload_profile=strict_production_profile,
    )
    journal.start_model_invocation(
        invocation_id="inv-strict-production",
        run_id="run-3",
        attempt_id=strict_production_attempt.attempt_id,
        agent_id="agent-3",
        logical_call_id="logical-strict-production",
        provider="openai",
        model="gpt-test",
        transport="responses",
        thinking_effort=None,
        request={"messages": []},
        now=1,
    )
    journal.finish_model_invocation(
        "inv-strict-production",
        status="completed",
        response={"output": "done"},
        now=2,
    )

    candidates = journal.list_model_invocation_retention_candidates(
        now=PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS + 3
    )

    assert candidates == ("inv-product",)
    # Candidate planning is read-only until destructive expiry is explicitly
    # authorized by the product lifecycle policy.
    retained = journal.get_model_invocation("inv-product")
    assert retained is not None
    assert retained.request["messages"][0]["content"] == "retain me"
    assert retained.response == {"output": "done"}


def test_model_document_retention_preserves_audit_and_records_gap_once(
    tmp_path: Path,
) -> None:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-retention", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-retention", request_id="product", reason="initial"
    )
    journal.start_model_invocation(
        invocation_id="inv-retention",
        run_id="run-retention",
        attempt_id=attempt.attempt_id,
        agent_id="agent-1",
        logical_call_id="logical-retention",
        provider="openai",
        model="gpt-test",
        transport="responses",
        thinking_effort="high",
        request={"messages": [{"role": "user", "content": "large body"}]},
        redaction_version="redaction-v1",
        now=1,
    )
    original = journal.finish_model_invocation(
        "inv-retention",
        status="completed",
        response={"output": "large response"},
        prompt_tokens=17,
        completion_tokens=9,
        cache_read_tokens=3,
        cache_write_tokens=2,
        finish_reason="stop",
        now=2,
    )
    run_before_retention = journal.get_run("run-retention")
    events_before_retention = journal.list_events("run-retention")

    result = journal.expire_model_invocation_documents(
        now=PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS + 3
    )

    assert result.expired_invocation_ids == ("inv-retention",)
    assert result.skipped_invocation_ids == ()
    assert result.remaining_candidate_count == 0
    retained = journal.get_model_invocation("inv-retention")
    assert retained is not None
    expected_tombstone = {
        "_eigent_retention": {
            "expired": True,
            "policy_ref": RETENTION_POLICY_PRODUCT_DEFAULT,
            "version": 1,
        }
    }
    assert retained.request == expected_tombstone
    assert retained.response == expected_tombstone
    assert retained.request_digest == original.request_digest
    assert retained.response_digest == original.response_digest
    assert retained.prompt_tokens == 17
    assert retained.completion_tokens == 9
    assert retained.cache_read_tokens == 3
    assert retained.cache_write_tokens == 2
    assert retained.finish_reason == "stop"
    assert retained.status == "completed"
    assert retained.started_at == 1
    assert retained.completed_at == 2
    assert retained.redaction_version == "redaction-v1+retention-v1"

    gaps = journal.list_attempt_evidence_gaps(attempt.attempt_id)
    assert len(gaps) == 1
    assert gaps[0].reason_code == "retention_expired"
    assert gaps[0].dimension == "model_decisions"
    # Retention is local lifecycle maintenance, not a late Run event. It must
    # not advance the completed/pending Run timeline, history cursor or Cloud
    # outbox merely because a document reached its retention age.
    assert journal.list_events("run-retention") == events_before_retention
    assert journal.get_run("run-retention") == run_before_retention

    repeated = journal.expire_model_invocation_documents(
        now=PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS + 4
    )
    assert repeated.expired_invocation_ids == ()
    assert repeated.skipped_invocation_ids == ()
    assert repeated.remaining_candidate_count == 0
    assert (
        journal.list_model_invocation_retention_candidates(
            now=PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS + 4
        )
        == ()
    )
    assert len(journal.list_attempt_evidence_gaps(attempt.attempt_id)) == 1


def test_model_document_retention_skips_poison_candidate_and_continues(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-retention", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-retention", request_id="product", reason="initial"
    )
    for index, invocation_id in enumerate(("inv-00-poison", "inv-01-good")):
        journal.start_model_invocation(
            invocation_id=invocation_id,
            run_id="run-retention",
            attempt_id=attempt.attempt_id,
            agent_id="agent-1",
            logical_call_id=f"logical-{index}",
            provider="openai",
            model="gpt-test",
            transport="responses",
            thinking_effort=None,
            request={"messages": [{"content": invocation_id}]},
            now=1 + index,
        )
        journal.finish_model_invocation(
            invocation_id,
            status="completed",
            response={"output": invocation_id},
            now=2 + index,
        )

    expire_one = journal._expire_model_invocation_document_in_transaction

    def injected_failure(connection, *, invocation, timestamp):
        if invocation["invocation_id"] == "inv-00-poison":
            raise RuntimeError("injected retention poison")
        return expire_one(
            connection,
            invocation=invocation,
            timestamp=timestamp,
        )

    monkeypatch.setattr(
        journal,
        "_expire_model_invocation_document_in_transaction",
        injected_failure,
    )

    with caplog.at_level("ERROR", logger="run_journal"):
        result = journal.expire_model_invocation_documents(
            now=PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS + 4
        )

    assert result.expired_invocation_ids == ("inv-01-good",)
    assert result.skipped_invocation_ids == ("inv-00-poison",)
    assert result.remaining_candidate_count == 1
    poison = journal.get_model_invocation("inv-00-poison")
    expired = journal.get_model_invocation("inv-01-good")
    assert poison is not None
    assert expired is not None
    assert poison.request["messages"][0]["content"] == "inv-00-poison"
    assert expired.request["_eigent_retention"]["expired"] is True
    assert "Skipping model-document retention candidate" in caplog.text


def test_model_document_retention_is_bounded_and_runs_after_recovery(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-retention", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-retention", request_id="product", reason="initial"
    )
    journal.start_model_invocation(
        invocation_id="inv-retention",
        run_id="run-retention",
        attempt_id=attempt.attempt_id,
        agent_id="agent-1",
        logical_call_id="logical-retention",
        provider="openai",
        model="gpt-test",
        transport="responses",
        thinking_effort=None,
        request={"messages": []},
        now=1,
    )
    journal.finish_model_invocation(
        "inv-retention",
        status="completed",
        response={"output": "done"},
        now=2,
    )

    with pytest.raises(ValueError, match="between 1 and 100"):
        journal.expire_model_invocation_documents(limit=101)

    with caplog.at_level("INFO", logger="run_journal"):
        journal.reconcile_startup(
            now=PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS + 3
        )

    retained = journal.get_model_invocation("inv-retention")
    assert retained is not None
    assert retained.request["_eigent_retention"]["expired"] is True
    assert "expired=1 skipped=0 remaining=0" in caplog.text


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
        assert upgraded.schema_version == SCHEMA_VERSION
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
