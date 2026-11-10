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

"""Admission transactions against real RunJournal connections in temporary DBs.

Run with dotenv loading disabled and --confcutdir=tests/app/workspace_runtime
to avoid the unrelated server/LLM fixtures in the backend-wide conftest.
"""

from __future__ import annotations

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest

from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.workspace_runtime.admission import (
    AdmissionClaim,
    AdmissionConflict,
    AdmissionError,
    AdmissionFenceLost,
    AdmissionStore,
    InvalidExecutionEnvelope,
)
from app.workspace_runtime.store import WorkspaceStateStore


@pytest.fixture
def journals(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as first, SQLiteRunJournal(path) as second:
        yield first, second


def envelope(project_id="p1", **updates):
    return {
        "space_id": "space-1",
        "project_id": project_id,
        "prompt": "Create the report",
        "model_platform": "openai",
        "model_type": "test-model",
        "session_mode": "single-agent",
        "workspace_policy_version": "isolated-v1",
        "configuration_revision": "config:1",
        "credential_ref": "credential:1",
        "permission_profile_revision": "permissions:1",
        "principal_ref": "principal:1",
        "attachment_ids": ["attachment:1"],
        "model_parameters": {"temperature": 0.2},
        **updates,
    }


def submit(store, request_id="r1", project_id="p1", **kwargs):
    return store.submit(
        request_id=request_id,
        project_id=project_id,
        kind="start",
        envelope=envelope(project_id),
        **kwargs,
    )


def prepare_callback(journal, target, *, bind=True, activate=False):
    workspace = WorkspaceStateStore(journal)

    def prepare(connection, request, claim):
        # This is the real transaction-taking Attempt helper. Run creation is
        # also in this transaction; failure must leave no partial admission.
        connection.execute(
            """INSERT INTO runs
            (run_id,project_id,status,version,active_attempt_id,deadline_at,
             timeout_policy_version,created_at,updated_at)
            VALUES (?,?,'pending',0,NULL,NULL,'v1',1,1)""",
            (request.request_id, request.project_id),
        )
        attempt = journal._create_run_attempt_in_transaction(
            connection,
            request.request_id,
            request_id=request.request_id,
            reason="initial_execution",
            activate=activate,
            admission_claim=(claim.request_id, claim.generation),
            now=1,
        )
        if bind:
            workspace.bind_run_in_transaction(
                connection,
                run_id=request.request_id,
                attempt_id=attempt.attempt_id,
                generation=claim.generation,
                workspace_id=f"workspace:{request.request_id}:{claim.generation}",
                provider="directory",
                snapshot_revision="snapshot:1",
                root_path="/prepared/private/workspace",
                target=target,
                policy_version="isolated-v1",
            )
        return attempt

    return prepare


def test_submit_is_immutable_and_duplicate_preserves_queue_position(journals):
    first, second = journals
    store, other = AdmissionStore(first), AdmissionStore(second)
    payload = envelope()
    original = store.submit(
        request_id="r1",
        project_id="p1",
        kind="start",
        envelope=payload,
        now=1,
    )
    payload["model_parameters"]["temperature"] = 0.8
    payload["attachment_ids"].append("attachment:2")
    submit(store, "r2", now=2)
    retry = submit(other, "r1", now=20)
    assert original == retry
    assert other.get("r1").envelope["model_parameters"] == {"temperature": 0.2}
    assert other.get("r1").envelope["attachment_ids"] == ["attachment:1"]
    assert other.get("r2").queue_seq == 2
    with pytest.raises(AdmissionConflict):
        other.submit(
            request_id="r1",
            project_id="p1",
            kind="start",
            envelope=payload,
        )


@pytest.mark.parametrize(
    "forbidden",
    [
        {"api_key": "do-not-store"},
        {"env": {"TOKEN": "do-not-store"}},
        {"headers": {"Authorization": "do-not-store"}},
        {"installed_mcp": {"env": {"TOKEN": "do-not-store"}}},
        {"env_path": "/outside/.env"},
        {"task_output_root": "/outside"},
        {"model_parameters": {"api_key": "do-not-store"}},
        {"model_parameters": {"temperature": float("nan")}},
        {"attachment_ids": ["/outside/file"]},
        {"attachment_ids": ["C:/outside/file"]},
        {"credential_ref": "/outside/secret"},
    ],
)
def test_envelope_rejects_secrets_and_paths_without_persisting(
    journals, forbidden
):
    first, _ = journals
    store = AdmissionStore(first)
    with pytest.raises(InvalidExecutionEnvelope):
        store.submit(
            request_id="unsafe",
            project_id="p1",
            kind="start",
            envelope=envelope(**forbidden),
        )
    assert store.get("unsafe") is None
    assert (
        first._connection.execute(
            "SELECT COUNT(*) FROM execution_requests"
        ).fetchone()[0]
        == 0
    )


def test_missing_configuration_waits_and_cannot_be_overtaken(journals):
    first, _ = journals
    store = AdmissionStore(first)
    request = store.submit(
        request_id="missing",
        project_id="p1",
        kind="start",
        envelope={"prompt": "Report"},
    )
    submit(store, "r2")
    submit(store, "r3", "p2")
    assert request.wait_reason == "configuration_required"
    assert [r.request_id for r in store.list_dispatch_candidates()] == ["r3"]
    assert store.claim("missing", owner_id="worker-1") is None
    assert store.claim("r2", owner_id="worker-1") is None


def test_fifo_round_robin_and_send_now_keep_one_head_per_project(journals):
    first, _ = journals
    store = AdmissionStore(first)
    submit(store, "r1", now=3)
    submit(
        store, "r2", now=1
    )  # FIFO uses allocation sequence, not wall clock.
    submit(store, "r3", "p2")
    submit(store, "r4", "p3")
    assert [r.request_id for r in store.list_dispatch_candidates()] == [
        "r1",
        "r3",
        "r4",
    ]
    assert [
        r.request_id
        for r in store.list_dispatch_candidates(after_project_id="p2")
    ] == ["r4", "r1", "r3"]
    assert [
        r.request_id
        for r in store.list_dispatch_candidates(after_project_id="p3", limit=1)
    ] == ["r1"]
    store.set_delivery_mode("r2", "send_now")
    assert store.claim("r1", owner_id="worker") is None
    assert store.claim("r2", owner_id="worker") is not None
    assert [r.request_id for r in store.list_dispatch_candidates()] == [
        "r3",
        "r4",
    ]


@pytest.mark.parametrize("latest_priority", ["submit", "update"])
@pytest.mark.parametrize("preparation_result", ["release", "handoff"])
def test_latest_send_now_demotes_preparing_without_revoking_claim(
    journals, tmp_path, latest_priority, preparation_result
):
    first, second = journals
    store, other = AdmissionStore(first), AdmissionStore(second)
    payload = envelope()
    del payload["prompt"]
    for request_id in ("a", "b", "c"):
        first.put_follow_up_request(
            request_id=request_id, project_id="p1", content=request_id
        )

    def add(request_id, delivery_mode="wait"):
        return other.submit(
            request_id=request_id,
            project_id="p1",
            kind="follow_up",
            source_follow_up_request_id=request_id,
            envelope=payload,
            delivery_mode=delivery_mode,
        )

    add("a", "send_now")
    if latest_priority == "update":
        add("b")
    add("c")
    claim = store.claim("a", owner_id="preparer")
    if latest_priority == "submit":
        add("b", "send_now")
    else:
        other.set_delivery_mode("b", "send_now")

    assert other.get("a").status == "preparing"
    assert other.get("a").delivery_mode == "wait"
    assert other.get("b").delivery_mode == "send_now"
    assert other.get_claim("p1") == claim
    assert other.claim("b", owner_id="other-worker") is None
    assert other.list_dispatch_candidates() == ()
    assert dict(
        second._connection.execute(
            "SELECT request_id,delivery_mode FROM follow_up_requests"
        ).fetchall()
    ) == {"a": "wait", "b": "send_now", "c": "wait"}

    if preparation_result == "release":
        store.release(claim, wait_reason="prepare_failed")
        assert [
            request.request_id for request in other.list_dispatch_candidates()
        ] == ["b"]
        assert other.claim("a", owner_id="old-priority") is None
        next_claim = other.claim("b", owner_id="next-worker")
        assert next_claim.generation == claim.generation + 1
    else:
        # Changing priority does not revoke the valid preparation owner.
        target = WorkspaceStateStore(first).register_target(tmp_path)
        admitted = store.handoff(
            claim, prepare_attempt=prepare_callback(first, target)
        )
        assert admitted.status == "admitted"
        assert admitted.delivery_mode == "wait"
        assert other.claim("b", owner_id="other-worker") is None


def test_send_now_and_preparer_release_serialize_across_connections(journals):
    first, second = journals
    store, other = AdmissionStore(first), AdmissionStore(second)
    for request_id in ("a", "b"):
        first.put_follow_up_request(
            request_id=request_id, project_id="p1", content=request_id
        )
        payload = envelope()
        del payload["prompt"]
        store.submit(
            request_id=request_id,
            project_id="p1",
            kind="follow_up",
            source_follow_up_request_id=request_id,
            envelope=payload,
        )
    store.set_delivery_mode("a", "send_now")
    claim = store.claim("a", owner_id="preparer")
    start = threading.Barrier(2)

    def release():
        start.wait(timeout=5)
        return store.release(claim)

    def promote():
        start.wait(timeout=5)
        return other.set_delivery_mode("b", "send_now")

    with ThreadPoolExecutor(max_workers=2) as pool:
        released, promoted = pool.submit(release), pool.submit(promote)
        assert released.result(timeout=5).status == "pending"
        assert promoted.result(timeout=5).delivery_mode == "send_now"
    assert [row.request_id for row in other.list_dispatch_candidates()] == [
        "b"
    ]
    for table in ("execution_requests", "follow_up_requests"):
        assert dict(
            second._connection.execute(
                "SELECT request_id,delivery_mode FROM " + table
            ).fetchall()
        ) == {"a": "wait", "b": "send_now"}


def test_two_connections_race_to_claim_same_project(journals):
    first, second = journals
    stores = AdmissionStore(first), AdmissionStore(second)
    submit(stores[0])
    barrier = threading.Barrier(2)

    def claim(index):
        barrier.wait(timeout=5)
        return stores[index].claim("r1", owner_id=f"process-{index}")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, (0, 1)))
    winners = [value for value in results if value is not None]
    assert len(winners) == 1
    assert (
        first._connection.execute(
            "SELECT COUNT(*) FROM project_admission_claims WHERE state='claimed'"
        ).fetchone()[0]
        == 1
    )
    assert stores[1].get("r1").status == "preparing"


def test_distinct_projects_claim_concurrently(journals):
    first, second = journals
    stores = AdmissionStore(first), AdmissionStore(second)
    submit(stores[0], "r1", "p1")
    submit(stores[0], "r2", "p2")
    barrier = threading.Barrier(2)

    def claim(index):
        barrier.wait(timeout=5)
        return stores[index].claim(f"r{index + 1}", owner_id=f"worker-{index}")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, (0, 1)))
    assert all(isinstance(result, AdmissionClaim) for result in results)


def test_claim_heartbeat_is_not_a_ttl_and_generation_never_resets(journals):
    first, second = journals
    store, other = AdmissionStore(first), AdmissionStore(second)
    submit(store)
    old = store.claim("r1", owner_id="process-1", now=1)
    assert other.claim("r1", owner_id="process-2", now=10**12) is None
    with pytest.raises(AdmissionFenceLost):
        other.release(replace(old, owner_id="process-2"))
    store.release(old, wait_reason="capacity", now=2)
    current = other.claim("r1", owner_id="process-2", now=3)
    assert current.generation == old.generation + 1
    with pytest.raises(AdmissionFenceLost):
        store.heartbeat(old)
    with pytest.raises(AdmissionFenceLost):
        store.release(old)
    other.heartbeat(current, now=4)
    assert (
        first._connection.execute(
            "SELECT heartbeat_at FROM project_admission_claims"
        ).fetchone()[0]
        == 4
    )


def test_cancellation_fences_preparation_and_preserves_next_generation(
    journals,
):
    first, second = journals
    store, other = AdmissionStore(first), AdmissionStore(second)
    submit(store)
    submit(store, "r2")
    old = store.claim("r1", owner_id="worker-1")
    assert other.cancel("r1").status == "cancelled"
    current = other.claim("r2", owner_id="worker-2")
    assert current.generation > old.generation
    called = []
    with pytest.raises(AdmissionFenceLost):
        store.handoff(old, prepare_attempt=lambda *args: called.append(args))
    assert called == []
    assert other.get("r2").status == "preparing"


def test_handoff_atomic_attempt_lease_binding_and_barrier(journals, tmp_path):
    first, second = journals
    store = AdmissionStore(first)
    target = WorkspaceStateStore(first).register_target(tmp_path)
    submit(store)
    claim = store.claim("r1", owner_id="worker")
    admitted = store.handoff(
        claim, prepare_attempt=prepare_callback(first, target)
    )
    assert admitted.status == "admitted"
    assert admitted.admitted_run_id == "r1"
    assert second.get_run("r1").status == "pending"
    assert second.list_run_attempts("r1")[0].status == "pending"
    assert second.get_active_project_run("p1").run_id == "r1"
    assert (
        second._connection.execute(
            "SELECT state FROM run_workspace_finalizations WHERE run_id='r1'"
        ).fetchone()[0]
        == "pending"
    )
    assert (
        second._connection.execute(
            "SELECT state FROM project_admission_claims WHERE project_id='p1'"
        ).fetchone()[0]
        == "handed_off"
    )
    redirected = AdmissionStore(second).cancel("r1")
    assert (redirected.status, redirected.admitted_attempt_id) == (
        "admitted",
        admitted.admitted_attempt_id,
    )
    callbacks = []
    retry = store.handoff(
        claim, prepare_attempt=lambda *args: callbacks.append(args)
    )
    assert retry == admitted
    assert callbacks == []
    with pytest.raises(AdmissionFenceLost):
        store.handoff(
            replace(claim, owner_id="other-process"),
            prepare_attempt=lambda *args: callbacks.append(args),
        )


@pytest.mark.parametrize(
    "failure", ["missing_binding", "activated", "callback_error"]
)
def test_bad_handoff_rolls_back_all_run_side_effects(
    journals, tmp_path, failure
):
    first, second = journals
    store = AdmissionStore(first)
    target = WorkspaceStateStore(first).register_target(tmp_path)
    submit(store)
    claim = store.claim("r1", owner_id="worker")
    base = prepare_callback(
        first,
        target,
        bind=failure != "missing_binding",
        activate=failure == "activated",
    )

    def prepare(connection, request, owner):
        attempt = base(connection, request, owner)
        if failure == "callback_error":
            raise RuntimeError("preparation failed")
        return attempt

    with pytest.raises((AdmissionError, RuntimeError)):
        store.handoff(claim, prepare_attempt=prepare)
    assert second.get_run("r1") is None
    assert second.get_active_project_run("p1") is None
    for table in (
        "run_attempts",
        "run_workspace_bindings",
        "run_workspace_finalizations",
    ):
        assert (
            second._connection.execute(
                f"SELECT COUNT(*) FROM {table}"
            ).fetchone()[0]
            == 0
        )
    assert AdmissionStore(second).get("r1").status == "preparing"


def test_cancel_commits_first_and_handoff_cannot_create_run(
    journals, tmp_path
):
    first, second = journals
    store, other = AdmissionStore(first), AdmissionStore(second)
    target = WorkspaceStateStore(first).register_target(tmp_path)
    submit(store)
    claim = store.claim("r1", owner_id="worker")
    cancelled = threading.Event()

    def cancel():
        result = other.cancel("r1")
        cancelled.set()
        return result

    def handoff():
        assert cancelled.wait(timeout=5)
        with pytest.raises(AdmissionFenceLost):
            store.handoff(
                claim, prepare_attempt=prepare_callback(first, target)
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        cancel_future, handoff_future = (
            pool.submit(cancel),
            pool.submit(handoff),
        )
        assert cancel_future.result(timeout=5).status == "cancelled"
        handoff_future.result(timeout=5)
    assert second.get_run("r1") is None


def test_handoff_holds_sqlite_writer_until_cancel_redirects(
    journals, tmp_path
):
    first, second = journals
    store, other = AdmissionStore(first), AdmissionStore(second)
    target = WorkspaceStateStore(first).register_target(tmp_path)
    submit(store)
    claim = store.claim("r1", owner_id="worker")
    inside_callback, cancel_started = threading.Event(), threading.Event()
    base = prepare_callback(first, target)

    def prepare(connection, request, owner):
        result = base(connection, request, owner)
        inside_callback.set()
        # Deterministic test interleaving only; production callbacks do not wait.
        assert cancel_started.wait(timeout=5)
        return result

    def cancel():
        assert inside_callback.wait(timeout=5)
        cancel_started.set()
        return other.cancel("r1")

    with ThreadPoolExecutor(max_workers=2) as pool:
        handoff_future = pool.submit(
            store.handoff, claim, prepare_attempt=prepare
        )
        cancel_future = pool.submit(cancel)
        admitted = handoff_future.result(timeout=5)
        redirect = cancel_future.result(timeout=5)
    assert redirect.status == "admitted"
    assert redirect.admitted_attempt_id == admitted.admitted_attempt_id
    assert len(second.list_run_attempts("r1")) == 1


def test_follow_up_compatibility_updates_are_in_handoff_and_cancel(
    journals, tmp_path
):
    first, second = journals
    store = AdmissionStore(first)
    target = WorkspaceStateStore(first).register_target(tmp_path)
    for request_id in ("r1", "r2"):
        first.put_follow_up_request(
            request_id=request_id, project_id="p1", content=request_id
        )
        payload = envelope()
        del payload["prompt"]
        store.submit(
            request_id=request_id,
            project_id="p1",
            kind="follow_up",
            source_follow_up_request_id=request_id,
            envelope=payload,
        )
    store.set_delivery_mode("r2", "send_now")
    rows = second.list_follow_up_requests(project_id="p1")
    assert rows[0].request_id == "r2" and rows[0].delivery_mode == "send_now"
    store.cancel("r2")
    assert (
        second._connection.execute(
            "SELECT status FROM follow_up_requests WHERE request_id='r2'"
        ).fetchone()[0]
        == "cancelled"
    )
    claim = store.claim("r1", owner_id="worker")
    admitted = store.handoff(
        claim, prepare_attempt=prepare_callback(first, target)
    )
    assert second._connection.execute(
        "SELECT status,admitted_run_id FROM follow_up_requests WHERE request_id='r1'"
    ).fetchone()[:] == ("admitted", admitted.admitted_run_id)


def test_follow_up_mutation_cannot_change_admitted_intent(journals, tmp_path):
    first, second = journals
    store = AdmissionStore(first)
    target = WorkspaceStateStore(first).register_target(tmp_path)
    first.put_follow_up_request(
        request_id="r1", project_id="p1", content="original"
    )
    payload = envelope()
    del payload["prompt"]
    store.submit(
        request_id="r1",
        project_id="p1",
        kind="follow_up",
        envelope=payload,
        source_follow_up_request_id="r1",
    )
    claim = store.claim("r1", owner_id="worker")
    with second._write_transaction() as connection:
        connection.execute(
            "UPDATE follow_up_requests SET content='changed' WHERE request_id='r1'"
        )
    with pytest.raises(AdmissionConflict):
        store.handoff(claim, prepare_attempt=prepare_callback(first, target))
    assert second.get_run("r1") is None


def test_terminal_fact_does_not_unblock_unsettled_workspace(
    journals, tmp_path
):
    first, second = journals
    store = AdmissionStore(first)
    target = WorkspaceStateStore(first).register_target(tmp_path)
    submit(store)
    submit(store, "r2")
    claim = store.claim("r1", owner_id="worker")
    admitted = store.handoff(
        claim, prepare_attempt=prepare_callback(first, target)
    )
    first.append_event(
        "r1",
        RunEventDraft(
            event_id="terminal",
            event_type="run.failed",
            payload={"reason": "test"},
        ),
    )
    assert AdmissionStore(second).claim("r2", owner_id="worker-2") is None
    with (
        pytest.raises(AdmissionError),
        first._write_transaction() as connection,
    ):
        store.release_settled_in_transaction(
            connection,
            run_id="r1",
            attempt_id=admitted.admitted_attempt_id,
            generation=claim.generation,
        )
    workspace = WorkspaceStateStore(first)
    workspace.record_writer_settlement(
        run_id="r1",
        attempt_id=admitted.admitted_attempt_id,
        generation=claim.generation,
        process_receipt={
            "outcome": "stopped",
            "process_birth_id": "test-process",
        },
    )
    with first._write_transaction() as connection:
        first._append_event_in_transaction(
            connection,
            "r1",
            RunEventDraft(
                event_id="finalizer-terminal",
                event_type="run.failed",
                payload={"attempt_id": admitted.admitted_attempt_id},
            ),
            run_status="failed",
            clear_active_attempt=True,
        )
        workspace.finalize_in_transaction(
            connection,
            run_id="r1",
            attempt_id=admitted.admitted_attempt_id,
            generation=claim.generation,
            checkpoint_revision="revision:1",
            manifest_digest="manifest:1",
            outcome="failed",
            changed_paths={},
        )
        store.release_settled_in_transaction(
            connection,
            run_id="r1",
            attempt_id=admitted.admitted_attempt_id,
            generation=claim.generation,
        )
    with first._write_transaction() as connection:
        # A lost finalizer response can retry the already committed release.
        store.release_settled_in_transaction(
            connection,
            run_id="r1",
            attempt_id=admitted.admitted_attempt_id,
            generation=claim.generation,
        )
    next_claim = AdmissionStore(second).claim("r2", owner_id="worker-2")
    assert next_claim.generation == claim.generation + 1
    with (
        pytest.raises(AdmissionFenceLost),
        first._write_transaction() as connection,
    ):
        store.release_settled_in_transaction(
            connection,
            run_id="r1",
            attempt_id=admitted.admitted_attempt_id,
            generation=claim.generation,
        )


def test_resume_references_existing_run_and_never_creates_a_message(journals):
    first, second = journals
    store = AdmissionStore(first)
    first.ensure_run(run_id="prior", project_id="p1", status="interrupted")
    payload = envelope()
    del payload["prompt"]
    request = store.submit(
        request_id="resume:1",
        project_id="p1",
        kind="resume",
        target_run_id="prior",
        envelope=payload,
    )
    assert request.target_run_id == "prior"
    assert (
        store.claim(request.request_id, owner_id="worker") is None
    )  # No fenced transfer adapter yet.
    assert (
        second._connection.execute(
            "SELECT COUNT(*) FROM follow_up_requests"
        ).fetchone()[0]
        == 0
    )
    other_payload = {**payload, "project_id": "p2"}
    with pytest.raises(AdmissionConflict):
        store.submit(
            request_id="bad",
            project_id="p2",
            kind="resume",
            target_run_id="prior",
            envelope=other_payload,
        )


def test_source_command_reuse_and_wrong_project_are_rejected(journals):
    first, _ = journals
    store = AdmissionStore(first)
    submit(store, source="remote_control", source_command_id="command:1")
    with pytest.raises(AdmissionConflict):
        submit(
            store, "r2", source="remote_control", source_command_id="command:1"
        )
    with pytest.raises(InvalidExecutionEnvelope):
        store.submit(
            request_id="wrong",
            project_id="p2",
            kind="start",
            envelope=envelope("p1"),
        )
    serialized = first._connection.execute(
        "SELECT envelope_json FROM execution_requests"
    ).fetchone()[0]
    assert json.loads(serialized)["credential_ref"] == "credential:1"


def test_composable_submit_requires_own_transaction_and_rolls_back(journals):
    first, second = journals
    store = AdmissionStore(first)
    arguments = {
        "request_id": "r1",
        "project_id": "p1",
        "kind": "start",
        "envelope": envelope(),
    }
    with pytest.raises(AdmissionError):
        store.submit_in_transaction(first._connection, **arguments)
    with (
        pytest.raises(AdmissionError),
        second._write_transaction() as connection,
    ):
        store.submit_in_transaction(connection, **arguments)
    with pytest.raises(RuntimeError), first._write_transaction() as connection:
        store.submit_in_transaction(connection, **arguments)
        raise RuntimeError("outer message transaction rolled back")
    assert AdmissionStore(second).get("r1") is None
