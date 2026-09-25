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

"""Real sealed workers, SQLite transactions, CAS objects and temporary Git."""

import asyncio
import json
import os
import shutil
import subprocess
import threading
from types import SimpleNamespace

import pytest
import pytest_asyncio

from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.workspace_runtime.admission import AdmissionStore
from app.workspace_runtime.bound_runtime import (
    BoundRuntime,
    RuntimeBinding,
    RuntimeBindingError,
    UnsettledWriters,
    WorkerExecutionError,
    WorkerOperation,
)
from app.workspace_runtime.content import ContentStore
from app.workspace_runtime.finalizer import WorkspaceFinalizer
from app.workspace_runtime.provider import (
    DirectoryWorkspaceProvider,
    SourceFence,
)
from app.workspace_runtime.store import WorkspaceFenceLost, WorkspaceStateStore


def git(root, *arguments):
    return subprocess.run(
        ["git", "-C", str(root), *arguments],
        env={
            "PATH": "/usr/bin:/bin",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "Fixture",
            "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
            "GIT_COMMITTER_NAME": "Fixture",
            "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
        },
        check=True,
        capture_output=True,
        timeout=10,
    ).stdout


@pytest_asyncio.fixture
async def factory(tmp_path):
    worlds = []

    def build(*, use_git=False):
        root = tmp_path / str(len(worlds))
        root.mkdir()
        source = root / "source"
        source.mkdir()
        (source / "base.txt").write_bytes(b"base\n")
        journal = SQLiteRunJournal(root / "journal.sqlite")
        state = WorkspaceStateStore(journal)
        content = ContentStore(root / "objects")
        if use_git:
            from app.workspace_runtime.git_provider import GitWorkspaceProvider

            git(source, "init", "--initial-branch=main")
            git(source, "add", "base.txt")
            git(
                source, "-c", "commit.gpgSign=false", "commit", "-m", "fixture"
            )
            (source / "base.txt").write_bytes(b"unmodified user overlay\n")
            (source / "untracked.txt").write_bytes(b"unmodified user file\n")
            provider = GitWorkspaceProvider(
                content, root / "workspaces", repository_root=source
            )
        else:
            provider = DirectoryWorkspaceProvider(content, root / "workspaces")
        target = state.register_target(source)
        admission = AdmissionStore(journal)
        admission.submit(
            request_id="run",
            project_id="project",
            kind="start",
            envelope={
                "prompt": "make a report",
                "space_id": "space",
                "project_id": "project",
                "model_platform": "synthetic",
                "model_type": "synthetic",
                "session_mode": "single-agent",
                "workspace_policy_version": "isolated-v1",
                "configuration_revision": "config:1",
                "credential_ref": "credential:1",
                "permission_profile_revision": "permission:1",
                "principal_ref": "principal:1",
            },
        )
        claim = admission.claim("run", owner_id="dispatcher")
        attempt_id = "attempt-run"
        fence = SourceFence(
            target.target_id,
            target.physical_identity,
            target.write_epoch,
            target.settled_revision,
            target.receipt_cursor,
            binding_version=target.binding_version,
        )
        snapshot = provider.capture_source(
            source, owner=attempt_id, read_fence=lambda: fence
        )
        workspace = provider.prepare(
            snapshot, owner=attempt_id, generation=claim.generation
        )
        journal.ensure_run(
            run_id="run", project_id="project", status="pending"
        )

        def prepare(connection, request, owner):
            attempt = journal._create_run_attempt_in_transaction(
                connection,
                "run",
                request_id="run",
                reason="test",
                attempt_id=attempt_id,
                activate=False,
                admission_claim=(owner.request_id, owner.generation),
            )
            state.bind_run_in_transaction(
                connection,
                run_id="run",
                attempt_id=attempt.attempt_id,
                generation=owner.generation,
                workspace_id=workspace.workspace_id,
                provider=workspace.provider,
                snapshot_revision=workspace.input_revision,
                root_path=str(workspace.local_root),
                target=target,
                policy_version="isolated-v1",
            )
            return attempt

        request = admission.handoff(claim, prepare_attempt=prepare)
        journal.activate_run_attempt(
            attempt_id,
            expected_run_id="run",
            expected_generation=claim.generation,
        )
        runtime = BoundRuntime(
            RuntimeBinding(
                "run",
                attempt_id,
                claim.generation,
                workspace,
                "environment:test",
                {},
            )
        )
        world = SimpleNamespace(
            journal=journal,
            state=state,
            admission=admission,
            request=request,
            runtime=runtime,
            provider=provider,
            source=source,
            target=target,
            finalizer=WorkspaceFinalizer(journal),
            root=root,
        )
        worlds.append(world)
        return world

    try:
        yield build
    finally:
        for world in worlds:
            try:
                await world.runtime.stop()
            except UnsettledWriters:
                pass
            world.journal.close()


async def write(world, value=b"report bytes"):
    return await world.runtime.execute_worker(
        [WorkerOperation("write", "report.txt", value)], mutation_id="report"
    )


def row(world):
    return world.journal._connection.execute(
        "SELECT * FROM run_workspace_finalizations WHERE run_id='run'"
    ).fetchone()


def assert_held(world):
    assert row(world)["state"] == "needs_attention"
    assert (
        world.journal._connection.execute(
            "SELECT COUNT(*) FROM project_run_execution_leases"
        ).fetchone()[0]
        == 1
    )
    assert world.admission.get_claim("project").state == "handed_off"
    assert world.journal.get_run_artifact_manifest_event("run") is None
    assert (
        world.journal._connection.execute(
            "SELECT COUNT(*) FROM workspace_integration_requests"
        ).fetchone()[0]
        == 0
    )


@pytest.mark.asyncio
async def test_success_commits_artifact_result_terminal_outbox_and_release(
    factory,
):
    world = factory()
    await write(world)
    revision = await world.finalizer.finalize(
        world.request,
        world.runtime,
        world.provider,
        "Report ready",
        "completed",
    )
    assert row(world)["state"] == "settled"
    assert row(world)["checkpoint_revision"] == revision
    assert world.journal.get_run("run").status == "completed"
    assert world.admission.get_claim("project").state == "released"
    assert (
        world.journal._connection.execute(
            "SELECT COUNT(*) FROM project_run_execution_leases"
        ).fetchone()[0]
        == 0
    )
    integration = world.journal._connection.execute(
        "SELECT * FROM workspace_integration_requests"
    ).fetchone()
    assert integration["output_revision"] == revision
    manifest = world.journal.get_run_artifact_manifest_event("run")
    result = world.journal.get_run_final_result_event("run")
    terminal = next(
        e
        for e in world.journal.list_events("run")
        if e.event_type == "run.completed"
    )
    assert manifest.sequence < result.sequence < terminal.sequence
    assert result.payload["message"] == "Report ready"
    assert terminal.payload["artifact_manifest_event_id"] == manifest.event_id
    assert terminal.payload["result_event_id"] == result.event_id
    assert manifest.payload["artifact_count"] == 1
    assert str(world.root) not in json.dumps(manifest.payload)
    # No legacy upload outbox is populated with a mutable local path.
    assert (
        world.journal._connection.execute(
            "SELECT COUNT(*) FROM artifact_upload_outbox"
        ).fetchone()[0]
        == 0
    )


@pytest.mark.asyncio
async def test_finalized_artifact_and_retry_ignore_later_mutable_files(
    factory,
):
    world = factory()
    await write(world)
    revision = await world.finalizer.finalize(
        world.request, world.runtime, world.provider, "done", "completed"
    )
    artifact = world.journal.get_run_artifact_manifest_event("run").payload[
        "artifacts"
    ][0]
    (world.source / "report.txt").write_bytes(b"later target version")
    (world.runtime.binding.workspace.local_root / "report.txt").write_bytes(
        b"later private version"
    )
    assert (
        world.finalizer.read_artifact(
            run_id="run",
            artifact_id=artifact["artifact_id"],
            provider=world.provider,
        )
        == b"report bytes"
    )
    assert (
        world.finalizer.read_artifact(
            run_id="run",
            artifact_id=artifact["artifact_id"],
            provider=world.provider,
            offset=7,
            length=5,
        )
        == b"bytes"
    )
    assert (
        await world.finalizer.finalize(
            world.request,
            world.runtime,
            world.provider,
            "different retry",
            "failed",
        )
        == revision
    )
    assert (
        world.journal.get_run_final_result_event("run").payload["message"]
        == "done"
    )


@pytest.mark.asyncio
async def test_cancel_intent_wins_over_proposed_success(factory):
    world = factory()
    await write(world)
    world.journal.request_cancel("run", request_id="cancel", reason="test")
    await world.finalizer.finalize(
        world.request,
        world.runtime,
        world.provider,
        "must not win",
        "completed",
    )
    assert row(world)["outcome"] == "cancelled"
    assert world.journal.get_run("run").status == "cancelled"
    assert world.journal.get_run_final_result_event("run") is None
    assert (
        world.journal.get_run_artifact_manifest_event("run").payload[
            "artifact_count"
        ]
        == 1
    )
    assert (
        world.journal._connection.execute(
            "SELECT COUNT(*) FROM workspace_integration_requests"
        ).fetchone()[0]
        == 0
    )


@pytest.mark.asyncio
async def test_unowned_writer_and_unprovenanced_change_keep_barriers(factory):
    live = factory()
    live.runtime.flag_unmanaged_writer()
    with pytest.raises(UnsettledWriters):
        await live.finalizer.finalize(
            live.request, live.runtime, live.provider, "", "failed"
        )
    assert_held(live)
    with pytest.raises(WorkspaceFenceLost):
        live.finalizer.mark_needs_attention(
            run_id="run", attempt_id="attempt-run", generation=2
        )
    changed = factory()
    (changed.runtime.binding.workspace.local_root / "unowned.txt").write_bytes(
        b"unknown writer"
    )
    with pytest.raises(RuntimeBindingError, match="unowned mutation"):
        await changed.finalizer.finalize(
            changed.request, changed.runtime, changed.provider, "", "completed"
        )
    assert_held(changed)


@pytest.mark.asyncio
async def test_commit_failure_rolls_back_terminal_and_outbox_then_retry(
    factory, monkeypatch
):
    world = factory()
    await write(world)
    original = world.finalizer.state.finalize_in_transaction

    def fail_after_updates(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("injected before commit")

    monkeypatch.setattr(
        world.finalizer.state, "finalize_in_transaction", fail_after_updates
    )
    with pytest.raises(RuntimeError, match="before commit"):
        await world.finalizer.finalize(
            world.request, world.runtime, world.provider, "done", "completed"
        )
    assert_held(world)
    assert world.journal.get_run("run").status == "running"
    assert world.journal.get_run_final_result_event("run") is None
    monkeypatch.setattr(
        world.finalizer.state, "finalize_in_transaction", original
    )
    await world.finalizer.finalize(
        world.request, world.runtime, world.provider, "done", "completed"
    )
    assert world.journal.get_run("run").status == "completed"
    assert (
        world.journal._connection.execute(
            "SELECT COUNT(*) FROM workspace_integration_requests"
        ).fetchone()[0]
        == 1
    )


@pytest.mark.asyncio
async def test_cancel_committed_after_capture_is_rechecked_in_final_transaction(
    factory, monkeypatch
):
    world = factory()
    await write(world)
    captured, release = threading.Event(), threading.Event()
    original = world.finalizer._artifact_payload

    def pause(*args):
        result = original(*args)
        captured.set()
        assert release.wait(timeout=3)
        return result

    monkeypatch.setattr(world.finalizer, "_artifact_payload", pause)
    finishing = asyncio.create_task(
        world.finalizer.finalize(
            world.request, world.runtime, world.provider, "done", "completed"
        )
    )
    try:
        assert await asyncio.to_thread(captured.wait, 2)
        with SQLiteRunJournal(world.journal.path) as sibling:
            sibling.request_cancel(
                "run", request_id="cancel", reason="late cancel"
            )
    finally:
        release.set()
    await finishing
    assert row(world)["outcome"] == "cancelled"
    assert world.journal.get_run_final_result_event("run") is None


@pytest.mark.asyncio
async def test_existing_terminal_and_early_manifest_do_not_skip_settlement(
    factory,
):
    world = factory()
    await write(world, b"late captured bytes")
    world.journal.append_event(
        "run",
        RunEventDraft(
            event_id="early-manifest",
            event_type="artifact.manifest.finalized",
            payload={"artifact_count": 0, "artifacts": []},
        ),
    )
    world.journal.request_cancel("run", request_id="cancel", reason="test")
    world.journal.complete_cancel("run", request_id="cancel")
    old_terminal = next(
        e
        for e in world.journal.list_events("run")
        if e.event_type == "run.cancelled"
    )
    await world.finalizer.finalize(
        world.request, world.runtime, world.provider, "ignored", "completed"
    )
    terminals = [
        e
        for e in world.journal.list_events("run")
        if e.event_type == "run.cancelled"
    ]
    assert terminals == [old_terminal]
    assert row(world)["state"] == "settled"
    manifest = world.journal.get_run_artifact_manifest_event("run")
    assert manifest.event_id != "early-manifest"
    assert (
        world.finalizer.read_artifact(
            run_id="run",
            artifact_id=manifest.payload["artifacts"][0]["artifact_id"],
            provider=world.provider,
        )
        == b"late captured bytes"
    )


@pytest.mark.asyncio
@pytest.mark.skipif(
    shutil.which("git") is None, reason="requires synthetic Git repository"
)
async def test_git_checkpoint_records_only_receipt_backed_managed_paths(
    factory,
):
    world = factory(use_git=True)
    await write(world)
    revision = await world.finalizer.finalize(
        world.request, world.runtime, world.provider, "done", "completed"
    )
    manifest = world.journal.get_run_artifact_manifest_event("run")
    commit = manifest.payload["git_checkpoint"]["commit"]
    assert git(world.source, "show", f"{commit}:report.txt") == b"report bytes"
    assert git(world.source, "show", f"{commit}:base.txt") == b"base\n"
    assert (
        world.provider.read(revision, "base.txt")
        == b"unmodified user overlay\n"
    )
    assert (
        world.source / "base.txt"
    ).read_bytes() == b"unmodified user overlay\n"
    assert not (world.source / "report.txt").exists()


@pytest.mark.asyncio
async def test_terminated_worker_prefix_is_recovery_output_not_success(
    factory,
):
    world = factory()
    execution = asyncio.create_task(
        world.runtime.execute_worker(
            [
                WorkerOperation("write", "report.txt", b"partial"),
                WorkerOperation("sleep", seconds=10),
            ],
            mutation_id="partial",
        )
    )
    path = world.runtime.binding.workspace.local_root / "report.txt"
    for _ in range(100):
        if path.exists():
            break
        await asyncio.sleep(0.01)
    assert path.exists()
    await world.finalizer.finalize(
        world.request,
        world.runtime,
        world.provider,
        "not complete",
        "completed",
    )
    with pytest.raises(WorkerExecutionError):
        await execution
    assert row(world)["outcome"] == "failed"
    assert world.journal.get_run_final_result_event("run") is None
    assert (
        world.journal.get_run_artifact_manifest_event("run").payload[
            "artifact_count"
        ]
        == 1
    )


@pytest.mark.asyncio
async def test_prior_terminal_and_manifest_are_not_a_writer_stop_proof(
    factory,
):
    world = factory()
    world.journal.append_event(
        "run",
        RunEventDraft(
            event_id="early-manifest",
            event_type="artifact.manifest.finalized",
            payload={"artifact_count": 0, "artifacts": []},
        ),
    )
    world.journal.request_cancel("run", request_id="cancel", reason="test")
    world.journal.complete_cancel("run", request_id="cancel")
    world.runtime.flag_unmanaged_writer()
    with pytest.raises(UnsettledWriters):
        await world.finalizer.finalize(
            world.request, world.runtime, world.provider, "", "cancelled"
        )
    assert row(world)["state"] == "needs_attention"
    assert row(world)["manifest_digest"] is None
    assert (
        world.journal.get_run_artifact_manifest_event("run").event_id
        == "early-manifest"
    )
    assert (
        world.journal._connection.execute(
            "SELECT COUNT(*) FROM project_run_execution_leases"
        ).fetchone()[0]
        == 1
    )
    assert world.admission.get_claim("project").state == "handed_off"


@pytest.mark.asyncio
async def test_cancel_can_finish_an_interrupted_but_unsettled_run(factory):
    world = factory()
    await write(world)
    with world.journal._write_transaction() as connection:
        world.journal._append_event_in_transaction(
            connection,
            "run",
            RunEventDraft(
                event_id="interrupted",
                event_type="runtime.interrupted",
                payload={"reason": "restart"},
            ),
            run_status="interrupted",
            clear_active_attempt=True,
        )
    world.journal.request_cancel("run", request_id="cancel", reason="test")
    await world.finalizer.finalize(
        world.request, world.runtime, world.provider, "", "interrupted"
    )
    assert world.journal.get_run("run").status == "cancelled"
    assert row(world)["outcome"] == "cancelled"
    assert row(world)["state"] == "settled"
    assert world.admission.get_claim("project").state == "released"
    assert any(
        event.event_id == "interrupted"
        for event in world.journal.list_events("run")
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", [None, "delete", "chmod"])
async def test_empty_output_and_non_byte_mutations_keep_exact_change_scope(
    factory, operation
):
    world = factory()
    if operation is not None:
        await world.runtime.execute_worker(
            [WorkerOperation(operation, "base.txt", mode=0o600)],
            mutation_id="metadata-change",
        )
    revision = await world.finalizer.finalize(
        world.request, world.runtime, world.provider, "done", "completed"
    )
    assert row(world)["state"] == "settled"
    paths = world.journal._connection.execute(
        "SELECT relative_path FROM workspace_integration_paths"
    ).fetchall()
    assert [item[0] for item in paths] == (
        [] if operation is None else ["base.txt"]
    )
    output = world.provider.store.get_manifest(revision)
    entry = next(item for item in output.entries if item.path == "base.txt")
    if operation == "delete":
        assert entry.kind == "tombstone"
    elif operation == "chmod":
        assert entry.mode == 0o600
    artifact_count = world.journal.get_run_artifact_manifest_event(
        "run"
    ).payload["artifact_count"]
    assert artifact_count == (1 if operation == "chmod" else 0)
