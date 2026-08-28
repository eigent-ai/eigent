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

from __future__ import annotations

import inspect
import sqlite3
from dataclasses import replace
from unittest.mock import patch

import pytest

import app.run_journal.store as store_module
from app.run_journal.models import RunEventDraft
from app.run_journal.store import (
    SCHEMA_VERSION,
    IdempotencyConflictError,
    RunJournalError,
    SQLiteRunJournal,
)
from app.run_runtime.step_coordinator import step_event_draft
from app.workload import (
    CAPTURE_POLICY_REQUIRED,
    DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
    RETENTION_POLICY_EVIDENCE_REQUIRED,
    WORKLOAD_PROFILE_SCHEMA_VERSION,
    validate_workload_profile,
    workload_profile_digest,
)


def test_attempt_binds_default_production_workload_and_emits_digest(
    tmp_path,
) -> None:
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
        )

        assert attempt.workload_profile == DEFAULT_PRODUCTION_WORKLOAD_PROFILE
        assert attempt.workload_profile_digest == workload_profile_digest(
            DEFAULT_PRODUCTION_WORKLOAD_PROFILE
        )
        event = journal.list_events("run-1")[-1]
        assert event.event_type == "run.attempt_created"
        assert event.payload["workload_profile"]["workload_kind"] == (
            "production"
        )
        assert event.payload["workload_profile_digest"] == (
            attempt.workload_profile_digest
        )


def test_attempt_admission_freezes_required_capture_environment(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EIGENT_MODEL_CAPTURE_REQUIRED", "true")
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
        )

        assert attempt.workload_profile.capture_policy_ref == (
            CAPTURE_POLICY_REQUIRED
        )
        event = journal.list_events("run-1")[-1]
        assert event.payload["workload_profile"]["capture_policy_ref"] == (
            CAPTURE_POLICY_REQUIRED
        )


def test_attempt_workload_is_part_of_idempotent_execution_identity(
    tmp_path,
) -> None:
    strict = replace(
        DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
        workload_kind="test",
        profile_version="test-v1",
        capture_policy_ref=CAPTURE_POLICY_REQUIRED,
        retention_policy_ref=RETENTION_POLICY_EVIDENCE_REQUIRED,
    )
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        first = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            workload_profile=strict,
        )
        replay = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            workload_profile=strict,
        )

        assert replay == first
        with pytest.raises(
            IdempotencyConflictError, match="different workload profile"
        ):
            journal.create_run_attempt(
                "run-1",
                request_id="initial",
                reason="initial_execution",
            )


def test_unknown_capture_policy_cannot_silently_degrade_to_best_effort() -> (
    None
):
    profile = replace(
        DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
        capture_policy_ref="capture.unknown.v1",
    )

    with pytest.raises(ValueError, match="unsupported capture policy"):
        validate_workload_profile(profile)


def test_workload_profile_rejects_only_versions_outside_supported_window() -> (
    None
):
    assert WORKLOAD_PROFILE_SCHEMA_VERSION == 1
    assert (
        validate_workload_profile(DEFAULT_PRODUCTION_WORKLOAD_PROFILE)
        == DEFAULT_PRODUCTION_WORKLOAD_PROFILE
    )
    for unsupported in (0, WORKLOAD_PROFILE_SCHEMA_VERSION + 1):
        with pytest.raises(ValueError, match="unsupported WorkloadProfile"):
            validate_workload_profile(
                replace(
                    DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
                    schema_version=unsupported,
                )
            )


def test_legacy_evidence_workload_profile_remains_readable() -> None:
    legacy = replace(
        DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
        workload_kind="test",
        profile_version="test-v1",
    )

    assert validate_workload_profile(legacy) == legacy


def test_capture_gap_is_idempotent_and_durable(tmp_path) -> None:
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
        )
        first = journal.record_attempt_evidence_gap(
            gap_id="gap-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            dimension="model_decisions",
            reason_code="capture_failed",
            source="model_capture",
            detail_code="RuntimeError",
            now=2,
        )
        replay = journal.record_attempt_evidence_gap(
            gap_id="gap-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            dimension="model_decisions",
            reason_code="capture_failed",
            source="model_capture",
            detail_code="RuntimeError",
            now=3,
        )

        assert replay == first
        assert journal.list_attempt_evidence_gaps(attempt.attempt_id) == (
            first,
        )
        events = [
            event
            for event in journal.list_events("run-1")
            if event.event_type == "attempt.evidence_gap_recorded"
        ]
        assert len(events) == 1
        assert events[0].payload["reason_code"] == ("capture_failed")


def test_capture_gap_can_bind_to_authored_step(tmp_path) -> None:
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
        )
        journal.append_event(
            "run-1",
            step_event_draft(
                run_id="run-1",
                attempt_id=attempt.attempt_id,
                step_id="step-1",
                plan_item_id="plan-item-1",
                title="Inspect evidence",
                summary=None,
                ordinal=0,
                agent_id="agent-1",
                event="created",
                status="pending",
            ),
        )

        gap = journal.record_attempt_evidence_gap(
            gap_id="gap-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            step_id="step-1",
            dimension="model_decisions",
            reason_code="capture_failed",
            source="model_capture",
        )

        assert gap.step_id == "step-1"
        assert journal.list_events("run-1")[-1].payload["step_id"] == (
            "step-1"
        )


def test_capture_gap_rejects_step_from_another_attempt(tmp_path) -> None:
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        first_attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
        )
        journal.append_event(
            "run-1",
            step_event_draft(
                run_id="run-1",
                attempt_id=first_attempt.attempt_id,
                step_id="step-1",
                plan_item_id="plan-item-1",
                title="Inspect evidence",
                summary=None,
                ordinal=0,
                agent_id="agent-1",
                event="created",
                status="pending",
            ),
        )
        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="run-1:first-attempt-interrupted",
                event_type="run.interrupted",
                payload={"reason_code": "test_retry"},
            ),
        )
        second_attempt = journal.create_run_attempt(
            "run-1",
            request_id="retry",
            reason="manual_retry",
        )

        with pytest.raises(
            IdempotencyConflictError,
            match="Step does not belong to the Run",
        ):
            journal.record_attempt_evidence_gap(
                gap_id="gap-1",
                run_id="run-1",
                attempt_id=second_attempt.attempt_id,
                step_id="step-1",
                dimension="model_decisions",
                reason_code="capture_failed",
                source="model_capture",
            )


def test_capture_gap_and_event_roll_back_as_one_transaction(tmp_path) -> None:
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
        )

        with (
            patch.object(
                journal,
                "_append_event_in_transaction",
                side_effect=RuntimeError("event write failed"),
            ),
            pytest.raises(RuntimeError, match="event write failed"),
        ):
            journal.record_attempt_evidence_gap(
                gap_id="gap-1",
                run_id="run-1",
                attempt_id=attempt.attempt_id,
                dimension="model_decisions",
                reason_code="capture_failed",
                source="model_capture",
            )

        assert journal.list_attempt_evidence_gaps(attempt.attempt_id) == ()


def test_v33_database_backfills_default_workload_without_losing_attempt(
    tmp_path,
) -> None:
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as current:
        current.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        attempt = current.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
        )

    with sqlite3.connect(path) as connection:
        connection.execute("DROP TABLE attempt_evidence_gaps")
        connection.execute("DROP INDEX model_invocations_step_idx")
        connection.execute("ALTER TABLE model_invocations DROP COLUMN step_id")
        connection.execute("DROP INDEX run_attempts_workload_kind_idx")
        connection.execute(
            "ALTER TABLE run_attempts DROP COLUMN workload_profile_digest"
        )
        connection.execute(
            "ALTER TABLE run_attempts DROP COLUMN workload_profile_json"
        )
        connection.execute(
            "ALTER TABLE run_attempts DROP COLUMN workload_kind"
        )
        connection.execute(
            "DELETE FROM run_journal_migrations WHERE version = 34"
        )
        connection.execute("PRAGMA user_version = 33")

    with SQLiteRunJournal(path) as upgraded:
        restored = upgraded.get_run_attempt(attempt.attempt_id)
        assert upgraded.schema_version == SCHEMA_VERSION
        assert restored is not None
        assert restored.workload_profile == DEFAULT_PRODUCTION_WORKLOAD_PROFILE
        assert restored.workload_profile_digest == workload_profile_digest(
            DEFAULT_PRODUCTION_WORKLOAD_PROFILE
        )
        assert upgraded.list_attempt_evidence_gaps(attempt.attempt_id) == ()


def test_v34_migration_defaults_are_frozen_historical_literals() -> None:
    from app.run_journal.store import _MIGRATION_V34

    source = inspect.getsource(store_module)
    assert '_MIGRATION_V34 = """' in source
    assert '_MIGRATION_V34 = f"""' not in source
    assert (
        "4786bb51388abddfbbe18decc88ada3e3e896b4aa9967970c2b99865d4999302"
        in _MIGRATION_V34
    )
    assert (
        '"retention_policy_ref":"retention.product-default.v1"'
        in _MIGRATION_V34
    )


def test_attempt_read_rejects_redundant_workload_kind_mismatch(
    tmp_path,
) -> None:
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
        )

    with sqlite3.connect(path) as connection:
        connection.execute(
            "UPDATE run_attempts SET workload_kind = 'test' "
            "WHERE attempt_id = ?",
            (attempt.attempt_id,),
        )

    with SQLiteRunJournal(path) as journal:
        with pytest.raises(RunJournalError, match="kind mismatch"):
            journal.get_run_attempt(attempt.attempt_id)
