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

"""Real journal and local filesystem integration tests, without an app boot."""

from __future__ import annotations

import json
import os
import select
import stat
import threading
from dataclasses import replace
from pathlib import Path

import pytest

from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.workspace_runtime.content import (
    ContentStore,
    ManifestEntry,
    WorkspaceManifest,
)
from app.workspace_runtime.execution import publication_execution
from app.workspace_runtime.integration import WorkspaceIntegrationCoordinator
from app.workspace_runtime.provider import DirectoryWorkspaceProvider
from app.workspace_runtime.store import (
    WorkspaceBusy,
    WorkspaceFenceLost,
    WorkspaceStateStore,
)


class Crash(BaseException):
    pass


@pytest.fixture
def world(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        root = tmp_path / "space"
        root.mkdir()
        state = WorkspaceStateStore(journal)
        target = state.register_target(root)
        content = ContentStore(tmp_path / "content")
        provider = DirectoryWorkspaceProvider(
            content, tmp_path / "private", retention=state
        )
        engine = WorkspaceIntegrationCoordinator(
            state,
            provider,
            authorize=lambda request: True,
            worker_id="worker-1",
        )
        yield journal, state, target, root, content, provider, engine


def revision(content, files, *, parent=None):
    entries = {}
    for path, value in files.items():
        for directory in Path(path).parents:
            if str(directory) != ".":
                entries[str(directory)] = ManifestEntry(
                    str(directory), "directory", mode=0o755
                )
        data = value.encode() if isinstance(value, str) else value
        entries[path] = ManifestEntry(
            path, "file", content.put_blob(data), len(data), 0o644
        )
    return content.put_manifest(
        WorkspaceManifest(
            tuple(entries.values()),
            parent_revision=parent,
            source_revision=parent,
        )
    )


def write(root, files):
    for path, value in files.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(value.encode() if isinstance(value, str) else value)
        target.chmod(0o644)


def enqueue(
    world,
    run_id,
    inputs,
    outputs,
    *,
    project="p1",
    groups=None,
    directory_modes=None,
):
    journal, state, target, root, content, provider, engine = world
    input_revision = revision(content, inputs)
    output_revision = revision(content, outputs, parent=input_revision)
    if directory_modes:
        manifest = content.get_manifest(output_revision)
        output_revision = content.put_manifest(
            replace(
                manifest,
                entries=tuple(
                    replace(entry, mode=directory_modes[entry.path])
                    if entry.path in directory_modes
                    else entry
                    for entry in manifest.entries
                ),
            )
        )
    journal.ensure_run(run_id=run_id, project_id=project, status="pending")
    attempt = journal.create_run_attempt(
        run_id, request_id=f"start-{run_id}", reason="test", activate=False
    )
    with journal._write_transaction() as connection:
        state.bind_run_in_transaction(
            connection,
            run_id=run_id,
            attempt_id=attempt.attempt_id,
            generation=1,
            workspace_id=f"workspace-{run_id}",
            provider="directory",
            snapshot_revision=input_revision,
            root_path=str(root.parent / run_id),
            target=state.target(target.target_id),
            policy_version="isolated-v1",
        )
    state.record_writer_settlement(
        run_id=run_id,
        attempt_id=attempt.attempt_id,
        generation=1,
        process_receipt={"outcome": "stopped", "processes": []},
    )
    if groups is None:
        groups = {
            path: path
            for path in inputs.keys() | outputs.keys()
            if inputs.get(path) != outputs.get(path)
        }
    with journal._write_transaction() as connection:
        journal._append_event_in_transaction(
            connection,
            run_id,
            RunEventDraft(
                event_type="run.completed",
                payload={},
                event_id=f"completed-{run_id}",
            ),
            run_status="completed",
        )
        request_id = state.finalize_in_transaction(
            connection,
            run_id=run_id,
            attempt_id=attempt.attempt_id,
            generation=1,
            checkpoint_revision=output_revision,
            manifest_digest=output_revision,
            outcome="completed",
            changed_paths=groups,
        )
    assert request_id is not None
    return request_id


def paths(journal, request_id):
    return {
        row["relative_path"]: dict(row)
        for row in journal._connection.execute(
            "SELECT * FROM workspace_integration_paths WHERE request_id=?",
            (request_id,),
        )
    }


def test_same_file_auto_merge_preserves_git_metadata_and_receipts(world):
    journal, state, target, root, content, provider, engine = world
    write(
        root,
        {
            "x.txt": "one\ntwo\nthree\n",
            ".git/HEAD": "ref: refs/heads/main\n",
            ".git/index": b"INDEX\x00",
        },
    )
    request_a = enqueue(
        world,
        "a",
        {"x.txt": "one\ntwo\nthree\n"},
        {"x.txt": "ONE\ntwo\nthree\n"},
        project="pa",
    )
    request_b = enqueue(
        world,
        "b",
        {"x.txt": "one\ntwo\nthree\n"},
        {"x.txt": "one\ntwo\nTHREE\n"},
        project="pb",
    )
    assert engine.process(request_a).status == "integrated"
    result = engine.process(request_b)
    assert result.status == "integrated"
    assert (root / "x.txt").read_text() == "ONE\ntwo\nTHREE\n"
    assert (root / ".git/HEAD").read_text() == "ref: refs/heads/main\n"
    assert (root / ".git/index").read_bytes() == b"INDEX\x00"
    assert provider.read(result.revision, "x.txt") == b"ONE\ntwo\nTHREE\n"
    receipt = paths(journal, request_b)["x.txt"]
    assert (
        receipt["receipt_cursor"]
        == state.target(target.target_id).receipt_cursor
    )
    assert (
        state.revision_at(target.target_id, receipt["receipt_cursor"])
        == result.revision
    )
    epoch = state.target(target.target_id).write_epoch
    write(root, {"x.txt": "external-later\n"})
    assert engine.process(request_b).status == "integrated"
    assert (root / "x.txt").read_text() == "external-later\n"
    assert state.target(target.target_id).write_epoch == epoch


def test_identical_changes_are_equivalent(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "new"})
    request = enqueue(world, "a", {"x": "old"}, {"x": "new"})
    before = (root / "x").stat()
    assert engine.process(request).status == "integrated"
    assert paths(journal, request)["x"]["status"] == "equivalent"
    assert (root / "x").stat().st_ino == before.st_ino


def test_conflict_group_preserves_versions_and_other_paths_publish(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"old": "target", "z": "base"})
    request = enqueue(
        world,
        "a",
        {"old": "base", "z": "base"},
        {"new": "source", "z": "updated"},
        groups={"old": "rename", "new": "rename", "z": "independent"},
    )
    result = engine.process(request)
    assert result.status == "partially_integrated"
    assert (root / "old").read_text() == "target"
    assert not (root / "new").exists()
    assert (root / "z").read_text() == "updated"
    facts = paths(journal, request)
    assert facts["old"]["status"] == "conflict"
    assert facts["new"]["status"] == "waiting"
    assert facts["z"]["status"] == "integrated"
    evidence = json.loads(facts["old"]["evidence_json"])
    assert content.read_blob(evidence["base"]["digest"]) == b"base"
    assert content.read_blob(evidence["pre"]["digest"]) == b"target"
    assert evidence["source"] is None
    assert state.target(target.target_id).available


def test_same_session_predecessor_blocks_only_related_path(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "target", "y": "base"})
    first = enqueue(world, "a", {"x": "base"}, {"x": "source"})
    assert engine.process(first).status == "conflict"
    second = enqueue(
        world,
        "b",
        {"x": "source", "y": "base"},
        {"x": "source-2", "y": "updated"},
    )
    assert engine.process(second).status == "partially_integrated"
    assert paths(journal, second)["x"]["status"] == "waiting"
    assert (root / "y").read_text() == "updated"
    with journal._write_transaction() as connection:
        connection.execute(
            "UPDATE workspace_integration_paths SET status='discarded' WHERE request_id=?",
            (first,),
        )
        # A future explicit resolver can wake this dependency immediately.
        connection.execute(
            "UPDATE workspace_integration_requests SET retry_after_at=0 "
            "WHERE request_id=?",
            (second,),
        )
    engine.process(second)
    assert paths(journal, second)["x"]["status"] == "needs_rebase"
    assert (root / "x").read_text() == "target"


def test_different_session_has_no_path_predecessor(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "a\nb\n"})
    blocked = enqueue(world, "a", {"x": "base"}, {"x": "other"}, project="pa")
    assert engine.process(blocked).status == "conflict"
    independent = enqueue(
        world, "b", {"x": "a\nb\n"}, {"x": "A\nb\n"}, project="pb"
    )
    assert paths(journal, independent)["x"]["predecessor_change_id"] is None
    assert engine.process(independent).status == "integrated"


def test_next_run_delta_never_republishes_old_session_output(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old", "y": "old"})
    first = enqueue(
        world, "a", {"x": "old", "y": "old"}, {"x": "session", "y": "old"}
    )
    assert engine.process(first).status == "integrated"
    write(root, {"x": "later-other-session"})
    second = enqueue(
        world, "b", {"x": "session", "y": "old"}, {"x": "session", "y": "new"}
    )
    assert engine.process(second).status == "integrated"
    assert (root / "x").read_text() == "later-other-session"
    assert set(paths(journal, second)) == {"y"}


def test_two_engines_cannot_claim_or_publish_same_request(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old"})
    request = enqueue(world, "a", {"x": "old"}, {"x": "new"})
    with SQLiteRunJournal(journal.path) as other_journal:
        other = WorkspaceIntegrationCoordinator(
            WorkspaceStateStore(other_journal),
            provider,
            authorize=lambda request: True,
            worker_id="worker-2",
        )
        candidate = engine.prepare(request)
        assert other.process(request).status == "preparing"
        with pytest.raises(WorkspaceFenceLost):
            other.publish(candidate)
        assert engine.publish(candidate).status == "integrated"


def test_stale_generation_cannot_publish(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old"})
    request = enqueue(world, "a", {"x": "old"}, {"x": "new"})
    candidate = engine.prepare(request)
    with pytest.raises(WorkspaceFenceLost):
        engine.publish(
            replace(
                candidate, worker_generation=candidate.worker_generation + 1
            )
        )
    assert (root / "x").read_text() == "old"
    assert state.target(target.target_id).available


def test_bounded_recompute_revalidates_then_durably_waits(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old"})
    request = enqueue(world, "a", {"x": "old"}, {"x": "new"})
    calls = []

    def changing_validator(candidate):
        calls.append(candidate.candidate_digest)
        write(root, {"x": "external-" + str(len(calls))})
        return True

    engine.validator = changing_validator
    result = engine.process(request)
    assert result.status == "waiting_target_stable"
    assert result.wait_reason == "target_changed"
    assert len(calls) == 2
    assert calls[0] != calls[1]
    assert (root / "x").read_text() == "external-2"
    assert state.target(target.target_id).available


@pytest.mark.parametrize(
    "authorization", [None, lambda request: False, lambda request: None]
)
def test_missing_or_denied_authorization_never_writes(world, authorization):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old"})
    request = enqueue(world, "a", {"x": "old"}, {"x": "new"})
    engine.authorize = authorization
    assert engine.process(request).wait_reason == "authorization_required"
    assert (root / "x").read_text() == "old"
    assert state.target(target.target_id).available


def test_validation_rejection_never_publishes(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old"})
    request = enqueue(world, "a", {"x": "old"}, {"x": "new"})
    engine.validator = lambda candidate: False
    assert engine.process(request).wait_reason == "validation_failed"
    assert (root / "x").read_text() == "old"


def test_partial_crash_rolls_forward_exact_pre_postimages(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old-x", "y": "old-y"})
    request = enqueue(
        world,
        "a",
        {"x": "old-x", "y": "old-y"},
        {"x": "new-x", "y": "new-y"},
        groups={"x": "pair", "y": "pair"},
    )
    original = engine._write_entry
    writes = []

    def crash(owner, item):
        original(owner, item)
        writes.append(item["path"])
        raise Crash()

    engine._write_entry = crash
    with pytest.raises(Crash):
        engine.process(request)
    assert writes == ["x"]
    operation = engine.result(request).operation_id
    assert state.target(target.target_id).state == "writing"
    with pytest.raises(WorkspaceBusy):
        state.capture_fence(target.target_id)
    other = WorkspaceIntegrationCoordinator(
        state,
        provider,
        authorize=lambda request: True,
        worker_id="other-worker",
    )
    with pytest.raises(WorkspaceBusy):
        other.reconcile(operation)
    engine._write_entry = original
    assert engine.reconcile(operation).status == "integrated"
    assert (root / "x").read_text() == "new-x"
    assert (root / "y").read_text() == "new-y"
    assert state.target(target.target_id).available
    assert all(
        row["receipt_cursor"] is not None
        for row in paths(journal, request).values()
    )
    assert engine.reconcile(operation).status == "integrated"


def test_recovery_third_version_is_preserved_and_blocks_roll_forward(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old-x", "y": "old-y"})
    request = enqueue(
        world, "a", {"x": "old-x", "y": "old-y"}, {"x": "new-x", "y": "new-y"}
    )
    original = engine._write_entry

    def crash(owner, item):
        original(owner, item)
        raise Crash()

    engine._write_entry = crash
    with pytest.raises(Crash):
        engine.process(request)
    operation = engine.result(request).operation_id
    write(root, {"x": "third-external"})
    engine._write_entry = original
    assert engine.reconcile(operation).status == "needs_attention"
    assert (root / "x").read_text() == "third-external"
    assert (root / "y").read_text() == "old-y"
    assert state.target(target.target_id).state == "recovery_required"
    assert all(
        row["receipt_cursor"] is None
        for row in paths(journal, request).values()
    )
    evidence = json.loads(paths(journal, request)["x"]["evidence_json"])
    retained = evidence["observed_revision"]
    assert state.references(retained) == (f"recovery:{operation}",)
    write(root, {"x": "external-again"})
    assert provider.read(retained, "observed") == b"third-external"


@pytest.mark.parametrize("failed_stage", ["observe", "manifest"])
def test_recovery_evidence_failure_is_safe_and_does_not_release_owner(
    world, monkeypatch, caplog, failed_stage
):
    journal, state, target, root, content, provider, engine = world
    failed_path = "private-path-one.txt"
    retained_path = "private-path-two.txt"
    unknown_path = "unknown-private-file.txt"
    initial = {failed_path: "old-one", retained_path: "old-two"}
    write(root, initial)
    request = enqueue(
        world,
        "a",
        initial,
        {failed_path: "new-one", retained_path: "new-two"},
    )
    original_write = engine._write_entry

    def crash(owner, item):
        original_write(owner, item)
        raise Crash()

    monkeypatch.setattr(engine, "_write_entry", crash)
    with pytest.raises(Crash):
        engine.process(request)
    monkeypatch.setattr(engine, "_write_entry", original_write)
    operation = engine.result(request).operation_id
    owner = state.target(target.target_id)
    assert owner.owner_id == operation
    assert owner.state == "writing"
    live = {
        failed_path: "secret-third-version-one",
        retained_path: "secret-third-version-two",
        unknown_path: "secret-unknown-file-contents",
    }
    write(root, live)
    secret_error = (
        f"private-exception-details {root / failed_path}: {live[failed_path]}"
    )
    if failed_stage == "observe":
        original_observe = engine._observe

        def fail_observe(current_owner, path):
            if path == failed_path:
                raise RuntimeError(secret_error)
            return original_observe(current_owner, path)

        monkeypatch.setattr(engine, "_observe", fail_observe)
    else:
        original_manifest = content.put_manifest

        def fail_manifest(manifest):
            fence = manifest.source_fence or {}
            if (
                fence.get("purpose") == "recovery_evidence"
                and fence.get("path") == failed_path
            ):
                raise RuntimeError(secret_error)
            return original_manifest(manifest)

        monkeypatch.setattr(content, "put_manifest", fail_manifest)
    logger_name = "app.workspace_runtime.integration"
    with caplog.at_level("WARNING", logger=logger_name):
        assert engine.reconcile(operation).status == "needs_attention"
    assert state.target(target.target_id) == replace(
        owner, state="recovery_required"
    )
    with pytest.raises(WorkspaceBusy):
        state.capture_fence(target.target_id)
    assert {path.name: path.read_text() for path in root.iterdir()} == live
    recorded_paths = paths(journal, request)
    assert all(
        row["receipt_cursor"] is None for row in recorded_paths.values()
    )
    failed_evidence = json.loads(
        recorded_paths[failed_path]["evidence_json"] or "{}"
    )
    assert "observed_revision" not in failed_evidence
    retained = json.loads(recorded_paths[retained_path]["evidence_json"])[
        "observed_revision"
    ]
    assert state.references(retained) == (f"recovery:{operation}",)
    assert provider.read(retained, "observed") == live[retained_path].encode()
    revisions = journal._connection.execute(
        "SELECT revision FROM workspace_revision_references WHERE owner=?",
        (f"recovery:{operation}",),
    ).fetchall()
    assert {provider.read(row[0], "observed") for row in revisions} == {
        live[retained_path].encode(),
        live[unknown_path].encode(),
    }
    records = [
        record for record in caplog.records if record.name == logger_name
    ]
    assert len(records) == 1
    record = records[0]
    assert record.levelname == "WARNING"
    assert record.getMessage() == (
        "Workspace recovery evidence capture failed: "
        f"operation_id={operation} stage={failed_stage}"
    )
    assert record.args == (operation, failed_stage)
    assert record.exc_info is None
    assert record.stack_info is None
    assert all(
        secret not in caplog.text
        for secret in (
            str(root),
            *live,
            *live.values(),
            "private-exception-details",
            "RuntimeError",
        )
    )


def test_delete_add_nested_and_binary_conflict(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"remove": "old", "binary": b"\x00target"})
    request = enqueue(
        world,
        "a",
        {"remove": "old", "binary": b"\x00base"},
        {"new/nested": "created", "binary": b"\x00source"},
    )
    result = engine.process(request)
    assert result.status == "partially_integrated"
    assert not (root / "remove").exists()
    assert (root / "new/nested").read_text() == "created"
    assert (root / "binary").read_bytes() == b"\x00target"
    assert paths(journal, request)["binary"]["status"] == "conflict"


def test_target_changes_after_owner_abort_prepared_and_recompute(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "a\nb\n"})
    request = enqueue(world, "a", {"x": "a\nb\n"}, {"x": "A\nb\n"})
    verify = engine._verify_target
    changed = []

    def change_after_handoff(root_path, revision_id):
        if state.target(target.target_id).owner_id and not changed:
            write(root, {"x": "a\nB\n"})
            changed.append(True)
        verify(root_path, revision_id)

    engine._verify_target = change_after_handoff
    result = engine.process(request)
    assert result.status == "integrated"
    assert (root / "x").read_text() == "A\nB\n"
    operations = journal._connection.execute(
        "SELECT operation_id,status FROM workspace_publication_operations "
        "WHERE request_id=? ORDER BY rowid",
        (request,),
    ).fetchall()
    assert [row["status"] for row in operations] == ["aborted", "completed"]
    assert engine.reconcile(operations[0]["operation_id"]) == result
    assert state.target(target.target_id).available


def test_changed_resolution_requires_successor_rebase(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "target"})
    first = enqueue(world, "a", {"x": "base"}, {"x": "source"})
    assert engine.process(first).status == "conflict"
    second = enqueue(world, "b", {"x": "source"}, {"x": "next"})
    resolution = revision(content, {"x": "accepted-different"})
    with journal._write_transaction() as connection:
        connection.execute(
            "UPDATE workspace_integration_paths SET status='resolved',"
            "resolution_revision=? WHERE request_id=?",
            (resolution, first),
        )
    assert engine.process(second).status == "waiting"
    assert paths(journal, second)["x"]["status"] == "needs_rebase"
    assert (root / "x").read_text() == "target"


def test_path_state_change_invalidates_validated_candidate(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old"})
    request = enqueue(world, "a", {"x": "old"}, {"x": "new"})
    candidate = engine.prepare(request)
    with journal._write_transaction() as connection:
        connection.execute(
            "UPDATE workspace_integration_paths SET status='discarded' "
            "WHERE request_id=?",
            (request,),
        )
    with pytest.raises(WorkspaceFenceLost):
        engine.publish(candidate)
    assert (root / "x").read_text() == "old"


def test_parent_conflict_does_not_block_independent_path(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"parent": "external-file", "y": "old"})
    request = enqueue(
        world,
        "a",
        {"y": "old"},
        {"parent/x": "new", "y": "new"},
    )
    assert engine.process(request).status == "partially_integrated"
    assert (root / "parent").read_text() == "external-file"
    assert (root / "y").read_text() == "new"
    assert paths(journal, request)["parent/x"]["status"] == "conflict"


def test_directory_deletion_requires_complete_explicit_group(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"d/x": "old"})
    request = enqueue(
        world,
        "a",
        {"d/x": "old"},
        {},
        groups={"d": "g", "d/x": "g"},
    )
    assert engine.process(request).status == "integrated"
    assert not (root / "d").exists()


def test_two_engines_recompute_against_other_successful_publication(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "a\nb\n"})
    first = enqueue(
        world,
        "a",
        {"x": "a\nb\n"},
        {"x": "A\nb\n"},
        project="pa",
    )
    second = enqueue(
        world,
        "b",
        {"x": "a\nb\n"},
        {"x": "a\nB\n"},
        project="pb",
    )
    with SQLiteRunJournal(journal.path) as other_journal:
        other = WorkspaceIntegrationCoordinator(
            WorkspaceStateStore(other_journal),
            provider,
            authorize=lambda request: True,
            worker_id="worker-2",
        )
        calls = []

        def publish_other(candidate):
            if not calls:
                assert other.process(second).status == "integrated"
            calls.append(candidate)
            return True

        engine.validator = publish_other
        assert engine.process(first).status == "integrated"
    assert len(calls) == 2
    assert (root / "x").read_text() == "A\nB\n"


def test_new_directory_mode_is_not_changed_by_process_umask(world):
    journal, state, target, root, content, provider, engine = world
    request = enqueue(world, "a", {}, {"new/x": "created"})
    previous = os.umask(0o077)
    try:
        result = engine.process(request)
    finally:
        os.umask(previous)
    assert result.status == "integrated"
    assert stat.S_IMODE((root / "new").stat().st_mode) == 0o755


def test_directory_with_uncovered_descendant_is_conflict_before_write(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"d/a": "old", "d/.git/HEAD": "private-ref", "z": "old"})
    request = enqueue(
        world,
        "a",
        {"d/a": "old", "z": "old"},
        {"z": "new"},
        groups={"d": "deletion", "d/a": "deletion", "z": "z"},
    )
    assert engine.process(request).status == "partially_integrated"
    assert (root / "d/a").read_text() == "old"
    assert (root / "d/.git/HEAD").read_text() == "private-ref"
    assert (root / "z").read_text() == "new"
    assert paths(journal, request)["d"]["status"] == "conflict"
    assert paths(journal, request)["d/a"]["status"] == "waiting"
    assert state.target(target.target_id).available


@pytest.mark.parametrize("external_path", ["unchanged", "new-external"])
def test_recovery_checks_complete_tree_before_more_writes(
    world, external_path
):
    journal, state, target, root, content, provider, engine = world
    initial = {"x": "old-x", "y": "old-y", "unchanged": "old"}
    write(root, initial)
    request = enqueue(
        world,
        "a",
        initial,
        {"x": "new-x", "y": "new-y", "unchanged": "old"},
    )
    original = engine._write_entry

    def crash(owner, item):
        original(owner, item)
        raise Crash()

    engine._write_entry = crash
    with pytest.raises(Crash):
        engine.process(request)
    operation = engine.result(request).operation_id
    write(root, {external_path: "third-external"})
    engine._write_entry = original
    assert engine.reconcile(operation).status == "needs_attention"
    assert (root / "y").read_text() == "old-y"
    assert (root / external_path).read_text() == "third-external"
    retained = journal._connection.execute(
        "SELECT revision FROM workspace_revision_references WHERE owner=?",
        (f"recovery:{operation}",),
    ).fetchall()
    assert retained
    assert any(
        provider.read(row[0], "observed") == b"third-external"
        for row in retained
    )
    assert state.target(target.target_id).state == "recovery_required"


def test_retry_backoff_survives_new_connection_and_worker(world, monkeypatch):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old"})
    request = enqueue(world, "a", {"x": "old"}, {"x": "new"})
    now = [1000.0]
    monkeypatch.setattr(
        "app.workspace_runtime.integration.time.time", lambda: now[0]
    )
    changes = []

    def changing_validator(candidate):
        changes.append(True)
        write(root, {"x": "external-" + str(len(changes))})
        return True

    engine.validator = changing_validator
    assert engine.process(request).status == "waiting_target_stable"
    before = journal._connection.execute(
        "SELECT attempts,retry_after_at FROM workspace_integration_requests "
        "WHERE request_id=?",
        (request,),
    ).fetchone()
    assert before["attempts"] == 2
    assert before["retry_after_at"] == 1004.0
    with SQLiteRunJournal(journal.path) as reopened:
        fresh = WorkspaceIntegrationCoordinator(
            WorkspaceStateStore(reopened),
            provider,
            authorize=lambda request: True,
            worker_id="replacement",
        )
        assert fresh.process(request).status == "waiting_target_stable"
        attempts = reopened._connection.execute(
            "SELECT attempts FROM workspace_integration_requests "
            "WHERE request_id=?",
            (request,),
        ).fetchone()[0]
        assert attempts == 2
        now[0] = before["retry_after_at"]
        write(root, {"x": "old"})
        assert fresh.process(request).status == "integrated"
        after = reopened._connection.execute(
            "SELECT attempts,retry_after_at FROM workspace_integration_requests "
            "WHERE request_id=?",
            (request,),
        ).fetchone()
        assert tuple(after) == (3, 0)


def test_conflict_scan_waits_for_durable_backoff(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "target"})
    request = enqueue(world, "a", {"x": "base"}, {"x": "source"})
    assert engine.process(request).status == "conflict"
    assert engine.process(request).status == "conflict"
    row = journal._connection.execute(
        "SELECT attempts,retry_after_at FROM workspace_integration_requests "
        "WHERE request_id=?",
        (request,),
    ).fetchone()
    assert row["attempts"] == 1
    assert row["retry_after_at"] > 0


@pytest.mark.parametrize(
    "instance", ["same", "same_connection", "new_connection"]
)
def test_duplicate_recovery_serializes_all_io_before_successor(
    world, instance
):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old"})
    first = enqueue(world, "a", {"x": "old"}, {"x": "new"}, project="a")
    successor = enqueue(world, "b", {"x": "new"}, {"x": "old"}, project="b")
    original = engine._write_entry
    engine._write_entry = lambda owner, item: (_ for _ in ()).throw(Crash())
    with pytest.raises(Crash):
        engine.process(first)
    operation = engine.result(first).operation_id
    entered, release, waiting, done = (threading.Event() for _ in range(4))
    results, errors, writes = [], [], []
    extra_journal = (
        SQLiteRunJournal(journal.path)
        if instance == "new_connection"
        else None
    )
    other = (
        engine
        if instance == "same"
        else WorkspaceIntegrationCoordinator(
            WorkspaceStateStore(extra_journal) if extra_journal else state,
            provider,
            authorize=lambda request: True,
            worker_id=engine.worker_id,
        )
    )

    def paused(owner, item):
        writes.append(item["path"])
        entered.set()
        assert release.wait(5)
        original(owner, item)

    def invoke(coordinator, waiting_call=False):
        try:
            if waiting_call:
                waiting.set()
            results.append(coordinator.reconcile(operation))
        except BaseException as exc:
            errors.append(exc)
        finally:
            if waiting_call:
                done.set()

    engine._write_entry = paused
    slow = threading.Thread(target=invoke, args=(engine,))
    fast = threading.Thread(target=invoke, args=(other, True))
    slow.start()
    try:
        assert entered.wait(5)
        fast.start()
        assert waiting.wait(5)
        assert not done.wait(0.1)
        assert not state.target(target.target_id).available
    finally:
        release.set()
        slow.join(5)
        fast.join(5)
        if extra_journal:
            extra_journal.close()
    assert not slow.is_alive() and not fast.is_alive()
    assert errors == []
    assert len(results) == 2 and all(r.status == "integrated" for r in results)
    assert writes == ["x"]
    engine._write_entry = original
    assert engine.process(successor).status == "integrated"
    assert engine.reconcile(operation).status == "integrated"
    assert (root / "x").read_text() == "old"
    assert (
        provider.read(state.target(target.target_id).settled_revision, "x")
        == b"old"
    )


def test_publish_rejects_recursive_recovery_without_deadlock(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old"})
    request = enqueue(world, "a", {"x": "old"}, {"x": "new"})
    original = engine._write_entry

    def recursive(owner, item):
        with pytest.raises(WorkspaceBusy, match="reentered"):
            engine.reconcile(owner.owner_id)
        original(owner, item)

    engine._write_entry = recursive
    assert engine.process(request).status == "integrated"


@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX execution lock")
def test_execution_lock_is_shared_after_fork(world):
    journal, state, target, root, content, provider, engine = world
    read_fd, write_fd = os.pipe()
    child = None
    try:
        with publication_execution(journal.path, "operation"):
            child = os.fork()
            if child == 0:
                os.close(read_fd)
                os.write(write_fd, b"waiting")
                with publication_execution(journal.path, "operation"):
                    os.write(write_fd, b"acquired")
                os._exit(0)
            os.close(write_fd)
            write_fd = None
            assert select.select([read_fd], [], [], 5)[0]
            assert os.read(read_fd, 7) == b"waiting"
            assert not select.select([read_fd], [], [], 0.1)[0]
        assert select.select([read_fd], [], [], 5)[0]
        assert os.read(read_fd, 8) == b"acquired"
        _, status = os.waitpid(child, 0)
        child = None
        assert os.waitstatus_to_exitcode(status) == 0
    finally:
        os.close(read_fd)
        if write_fd is not None:
            os.close(write_fd)
        if child:
            os.kill(child, 9)
            os.waitpid(child, 0)


def test_delete_group_recovery_accepts_missing_parent_after_all_deletes(world):
    journal, state, target, root, content, provider, engine = world
    write(root, {"d/x": "old"})
    request = enqueue(
        world, "a", {"d/x": "old"}, {}, groups={"d": "g", "d/x": "g"}
    )
    original = engine._write_entry

    def crash_after_directory(owner, item):
        original(owner, item)
        if item["path"] == "d":
            raise Crash()

    engine._write_entry = crash_after_directory
    with pytest.raises(Crash):
        engine.process(request)
    assert not (root / "d").exists()
    engine._write_entry = original
    assert (
        engine.reconcile(engine.result(request).operation_id).status
        == "integrated"
    )
    assert state.target(target.target_id).available


@pytest.mark.parametrize("mode", [0o500, 0o555, 0o600, 0o000])
def test_unsupported_new_directory_mode_rejects_before_any_target_write(
    world, mode
):
    journal, state, target, root, content, provider, engine = world
    write(root, {"a": "old"})
    request = enqueue(
        world,
        "a",
        {"a": "old"},
        {"a": "new", "d/x": "created"},
        directory_modes={"d": mode},
    )
    result = engine.process(request)
    assert result.wait_reason == "unsupported_directory_permissions"
    assert (root / "a").read_text() == "old"
    assert not (root / "d").exists()
    assert state.target(target.target_id).available
    assert (
        journal._connection.execute(
            "SELECT COUNT(*) FROM workspace_publication_operations"
        ).fetchone()[0]
        == 0
    )


def hard_exit_during_temporary(world, request, phase):
    journal, state, target, root, content, provider, engine = world
    child = os.fork()
    if child == 0:
        with SQLiteRunJournal(journal.path) as child_journal:
            child_state = WorkspaceStateStore(child_journal)
            child_content = ContentStore(content.root)
            child_provider = DirectoryWorkspaceProvider(
                child_content,
                provider.workspace_root,
                retention=child_state,
            )
            child_engine = WorkspaceIntegrationCoordinator(
                child_state,
                child_provider,
                authorize=lambda request: True,
                worker_id=engine.worker_id,
            )
            replace_file, sync_file = os.replace, os.fsync
            read_blob = child_content.read_blob

            def exit_before_replace(source, destination, **kwargs):
                if str(source).startswith(".eigent-publish-"):
                    os._exit(77)
                return replace_file(source, destination, **kwargs)

            def exit_after_partial(revision_id):
                value = read_blob(revision_id)
                row = child_journal._connection.execute(
                    "SELECT * FROM workspace_publication_temporaries "
                    "WHERE state='created' LIMIT 1"
                ).fetchone()
                if (
                    row
                    and json.loads(row["expected_json"])["digest"]
                    == revision_id
                ):
                    with (root / row["temporary_path"]).open("wb") as writer:
                        writer.write(value[: max(1, len(value) // 2)])
                        writer.flush()
                        sync_file(writer.fileno())
                    os._exit(78)
                return value

            def exit_before_identity(descriptor):
                sync_file(descriptor)
                row = child_journal._connection.execute(
                    "SELECT 1 FROM workspace_publication_temporaries "
                    "WHERE state='reserved' LIMIT 1"
                ).fetchone()
                if row:
                    os._exit(79)

            if phase == "ready":
                os.replace = exit_before_replace
            elif phase == "created":
                child_content.read_blob = exit_after_partial
            else:
                os.fsync = exit_before_identity
            child_engine.process(request)
        os._exit(90)
    _, status = os.waitpid(child, 0)
    assert (
        os.waitstatus_to_exitcode(status)
        == {
            "ready": 77,
            "created": 78,
            "reserved": 79,
        }[phase]
    )
    receipt = journal._connection.execute(
        "SELECT * FROM workspace_publication_temporaries "
        "WHERE state!='retired' ORDER BY rowid DESC LIMIT 1"
    ).fetchone()
    assert receipt["state"] == phase
    return dict(receipt)


@pytest.mark.skipif(not hasattr(os, "fork"), reason="real POSIX hard exit")
@pytest.mark.parametrize("phase", ["ready", "created"])
def test_hard_exit_temporary_recovers_only_journaled_owned_file(world, phase):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old", ".eigent-publish-user": "user-data"})
    request = enqueue(world, "a", {"x": "old"}, {"x": "new-content"})
    receipt = hard_exit_during_temporary(world, request, phase)
    temporary = root / receipt["temporary_path"]
    assert temporary.exists() and (root / "x").read_text() == "old"
    assert engine.reconcile(receipt["operation_id"]).status == "integrated"
    assert (root / "x").read_text() == "new-content"
    assert (root / ".eigent-publish-user").read_text() == "user-data"
    assert not temporary.exists()
    assert state.target(target.target_id).available
    assert (
        journal._connection.execute(
            "SELECT COUNT(*) FROM workspace_publication_temporaries "
            "WHERE state!='retired'"
        ).fetchone()[0]
        == 0
    )


@pytest.mark.skipif(not hasattr(os, "fork"), reason="real POSIX hard exit")
@pytest.mark.parametrize("phase", ["ready", "created", "reserved"])
def test_unverified_temporary_is_preserved_and_requires_attention(
    world, phase
):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old"})
    request = enqueue(world, "a", {"x": "old"}, {"x": "new-content"})
    receipt = hard_exit_during_temporary(world, request, phase)
    temporary = root / receipt["temporary_path"]
    if phase == "ready":
        # Same bytes at a replacement inode are not our recorded file.
        replacement = root / "replacement"
        replacement.write_bytes(temporary.read_bytes())
        os.replace(replacement, temporary)
    elif phase == "created":
        # Even our inode is not safe to remove after unrecognized content.
        temporary.write_bytes(b"external-content")
    before = temporary.read_bytes()
    assert (
        engine.reconcile(receipt["operation_id"]).status == "needs_attention"
    )
    assert temporary.read_bytes() == before
    if phase == "reserved":
        assert (
            engine.result(request).wait_reason
            == "temporary_ownership_unverified"
        )
    assert (root / "x").read_text() == "old"
    assert state.target(target.target_id).state == "recovery_required"


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="POSIX FIFO race")
def test_target_observation_regular_to_fifo_is_nonblocking(world, monkeypatch):
    journal, state, target, root, content, provider, engine = world
    write(root, {"x": "old"})
    opened, finished = threading.Event(), threading.Event()
    real_open = os.open
    errors = []

    def swap_to_fifo(name, flags, *args, **kwargs):
        if name == "x" and not opened.is_set():
            (root / "x").unlink()
            os.mkfifo(root / "x")
            opened.set()
        return real_open(name, flags, *args, **kwargs)

    def observe():
        try:
            engine._observe(target, "x")
        except Exception as exc:
            errors.append(exc)
        finally:
            finished.set()

    monkeypatch.setattr(os, "open", swap_to_fifo)
    thread = threading.Thread(target=observe)
    thread.start()
    assert opened.wait(5)
    bounded = finished.wait(1)
    if not bounded:
        # The old implementation would hang; always release the fixture.
        writer = real_open(root / "x", os.O_WRONLY | os.O_NONBLOCK)
        os.close(writer)
    thread.join(5)
    assert bounded and not thread.is_alive()
    assert len(errors) == 1
    assert "target changed before read" in str(errors[0])


def test_readonly_existing_parent_rejects_entire_batch_before_writes(world):
    journal, state, target, root, content, provider, engine = world
    files = {"a": "old", "z/x": "old"}
    write(root, files)
    request = enqueue(world, "a", files, {"a": "new", "z/x": "new"})
    (root / "z").chmod(0o500)
    try:
        result = engine.process(request)
        assert result.wait_reason == "unsupported_directory_permissions"
        assert (root / "a").read_text() == "old"
        assert (root / "z/x").read_text() == "old"
        assert state.target(target.target_id).available
    finally:
        (root / "z").chmod(0o755)


@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX fork fd registry")
def test_fork_waits_until_lock_descriptor_is_registered(world, monkeypatch):
    journal, state, target, root, content, provider, engine = world
    opened, register, holding, release = (threading.Event() for _ in range(4))
    fork_started, fork_finished = threading.Event(), threading.Event()
    original = os.open
    errors = []

    def pause_open(name, flags, *args, **kwargs):
        descriptor = original(name, flags, *args, **kwargs)
        if str(name).endswith(".lock"):
            opened.set()
            assert register.wait(5)
        return descriptor

    def owner():
        try:
            with publication_execution(journal.path, "fork-gap"):
                holding.set()
                assert release.wait(5)
        except BaseException as exc:
            errors.append(exc)

    def forker():
        try:
            fork_started.set()
            child = os.fork()
            if child == 0:
                os._exit(0)
            _, status = os.waitpid(child, 0)
            assert os.waitstatus_to_exitcode(status) == 0
        except BaseException as exc:
            errors.append(exc)
        finally:
            fork_finished.set()

    monkeypatch.setattr(os, "open", pause_open)
    thread = threading.Thread(target=owner)
    fork_thread = threading.Thread(target=forker)
    thread.start()
    try:
        assert opened.wait(5)
        fork_thread.start()
        assert fork_started.wait(5)
        assert not fork_finished.wait(0.1)
        register.set()
        assert holding.wait(5)
        assert fork_finished.wait(5)
    finally:
        register.set()
        release.set()
        thread.join(5)
        fork_thread.join(5)
    assert not thread.is_alive() and not fork_thread.is_alive()
    assert errors == []
