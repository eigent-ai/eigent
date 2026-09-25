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

"""Real leaf subprocesses and temporary files; never import app or dotenv."""

from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
import types
from dataclasses import FrozenInstanceError, replace
from pathlib import Path

import pytest

_PACKAGE = "_eigent_bound_runtime_tests"
_ROOT = Path(__file__).resolve().parents[3] / "app" / "workspace_runtime"
_package = types.ModuleType(_PACKAGE)
_package.__path__ = [str(_ROOT)]
sys.modules[_PACKAGE] = _package


def _load(name):
    spec = importlib.util.spec_from_file_location(
        f"{_PACKAGE}.{name}", _ROOT / f"{name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


content = _load("content")
provider = _load("provider")
runtime = _load("bound_runtime")
Op = runtime.WorkerOperation


@pytest.fixture
def make_runtime(tmp_path):
    def make(name="one", *, env=None, timeout=1):
        root = (tmp_path / name).resolve()
        root.mkdir()
        handle = provider.WorkspaceHandle(
            f"workspace-{name}", root, f"attempt-{name}", 1, "a" * 64
        )
        binding = runtime.RuntimeBinding(
            f"run-{name}",
            f"attempt-{name}",
            1,
            handle,
            f"env-{name}",
            {} if env is None else env,
        )
        return runtime.BoundRuntime(binding, stop_timeout=timeout)

    return make


async def wait_for_files(*paths):
    for _ in range(400):
        if all(path.exists() for path in paths):
            return
        await asyncio.sleep(0.01)
    raise AssertionError("sealed workers did not reach their file boundary")


def test_binding_copies_environment_and_requires_exact_attempt(make_runtime):
    env = {"VALUE": "frozen"}
    bound = make_runtime(env=env)
    env["VALUE"] = "changed"
    assert bound.binding.env["VALUE"] == "frozen"
    with pytest.raises(TypeError):
        bound.binding.env["VALUE"] = "write"
    with pytest.raises(FrozenInstanceError):
        bound.binding.generation = 3
    with pytest.raises(AttributeError):
        bound.binding = replace(bound.binding, run_id="other")
    with pytest.raises(runtime.RuntimeBindingError):
        replace(bound.binding, generation=2)
    with pytest.raises(runtime.RuntimeBindingError):
        replace(bound.binding, attempt_id="other")
    with pytest.raises(runtime.RuntimeBindingError):
        replace(bound.binding, env={"DYLD_INSERT_LIBRARIES": "attack"})
    asyncio.run(bound.stop())


def test_two_real_workers_overlap_with_private_cwd_and_explicit_env(
    make_runtime, monkeypatch
):
    monkeypatch.setenv("BOUND_SENTINEL", "parent")
    original_cwd = Path.cwd()
    first = make_runtime("one", env={"BOUND_SENTINEL": "one"})
    second = make_runtime("two", env={"BOUND_SENTINEL": "two"})

    async def handler(bound):
        return await bound.execute_worker(
            [
                Op("write", "started", b"started"),
                Op("sleep", seconds=0.5),
                Op("write", "same.txt", environment_key="BOUND_SENTINEL"),
            ],
            mutation_id="write",
        )

    async def scenario():
        jobs = [
            asyncio.create_task(bound.run(handler))
            for bound in (first, second)
        ]
        await wait_for_files(
            first.binding.workspace.local_root / "started",
            second.binding.workspace.local_root / "started",
        )
        assert all(not task.done() for task in jobs)
        await asyncio.gather(*jobs)
        for bound in (first, second):
            proof = await bound.stop()
            receipt = bound.verify_settlement(proof)
            assert receipt["outcome"] == "stopped"
            assert len(receipt["process_instances"]) == 1
            assert receipt["process_instances"][0][1] == 0
            assert "env" not in receipt
            assert bound.path_provenance(("same.txt", "started")) == {
                path: bound.mutation_receipts[0]
                for path in ("same.txt", "started")
            }

    asyncio.run(scenario())
    assert (
        first.binding.workspace.local_root / "same.txt"
    ).read_text() == "one"
    assert (
        second.binding.workspace.local_root / "same.txt"
    ).read_text() == "two"
    assert os.environ["BOUND_SENTINEL"] == "parent"
    assert Path.cwd() == original_cwd


def test_same_workspace_programs_serialize_and_duplicate_dispatch_is_once(
    make_runtime,
):
    bound = make_runtime()

    async def scenario():
        first_program = [
            Op("sleep", seconds=0.1),
            Op("mkdir", "created", mode=0o750),
        ]
        first = asyncio.create_task(
            bound.execute_worker(first_program, mutation_id="first")
        )
        duplicate = asyncio.create_task(
            bound.execute_worker(first_program, mutation_id="first")
        )
        second = asyncio.create_task(
            bound.execute_worker(
                [Op("write", "created/nested.txt", b"second")],
                mutation_id="second",
            )
        )
        results = await asyncio.gather(first, duplicate, second)
        assert results[0] is results[1]
        assert len(bound.mutation_receipts) == 2
        with pytest.raises(runtime.RuntimeBindingError):
            await bound.execute_worker([Op("sleep")], mutation_id="first")
        proof = await bound.stop()
        assert len(proof.process_instances) == 2
        assert (
            bound.binding.workspace.local_root / "created/nested.txt"
        ).read_bytes() == b"second"

    asyncio.run(scenario())


def test_cancel_one_owner_reaps_its_process_and_keeps_other_run(make_runtime):
    first, second = make_runtime("one"), make_runtime("two")

    async def scenario():
        first_job = asyncio.create_task(
            first.execute_worker(
                [
                    Op("write", "started", b"yes"),
                    Op("sleep", seconds=10),
                    Op("write", "late.txt", b"must not happen"),
                ],
                mutation_id="first",
            )
        )
        second_job = asyncio.create_task(
            second.execute_worker(
                [
                    Op("write", "started", b"yes"),
                    Op("sleep", seconds=0.25),
                    Op("write", "done.txt", b"unaffected"),
                ],
                mutation_id="second",
            )
        )
        await wait_for_files(
            first.binding.workspace.local_root / "started",
            second.binding.workspace.local_root / "started",
        )
        proof = await first.stop()
        assert proof.process_instances[0][1] < 0
        first.verify_settlement(proof)
        with pytest.raises(runtime.WorkerExecutionError):
            await first_job
        await second_job
        await second.stop()
        assert not (first.binding.workspace.local_root / "late.txt").exists()
        assert (
            second.binding.workspace.local_root / "done.txt"
        ).read_bytes() == b"unaffected"

    asyncio.run(scenario())


def test_cancelling_subscriber_wait_does_not_orphan_worker(make_runtime):
    bound = make_runtime()

    async def scenario():
        subscriber = asyncio.create_task(
            bound.execute_worker(
                [Op("write", "started", b"yes"), Op("sleep", seconds=10)],
                mutation_id="owned",
            )
        )
        await wait_for_files(bound.binding.workspace.local_root / "started")
        subscriber.cancel()
        with pytest.raises(asyncio.CancelledError):
            await subscriber
        proof = await bound.stop()
        assert proof.process_instances[0][1] < 0
        assert bound.path_provenance(("started",))

    asyncio.run(scenario())


def test_late_dispatch_is_denied_before_a_settlement_is_issued(make_runtime):
    bound = make_runtime()

    async def scenario():
        entered = asyncio.Event()

        async def handler(active):
            entered.set()
            await active.cancelled.wait()
            with pytest.raises(runtime.RuntimeSealed):
                await active.execute_worker(
                    [Op("write", "late.txt", b"late")], mutation_id="late"
                )

        job = asyncio.create_task(bound.run(handler))
        await entered.wait()
        proof = await bound.stop()
        await job
        assert bound.verify_settlement(proof)["process_instances"] == []
        with pytest.raises(runtime.RuntimeSealed):
            await bound.run(handler)
        assert not (bound.binding.workspace.local_root / "late.txt").exists()

    asyncio.run(scenario())


def test_unfinished_handler_cannot_be_settled_by_timeout(make_runtime):
    bound = make_runtime(timeout=0.01)

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()

        async def handler(_active):
            entered.set()
            await release.wait()

        job = asyncio.create_task(bound.run(handler))
        await entered.wait()
        with pytest.raises(runtime.UnsettledWriters):
            await bound.stop()
        assert bound.sealed and not job.done()
        with pytest.raises(runtime.UnsettledWriters):
            bound.path_provenance(())
        release.set()
        await job
        bound.verify_settlement(await bound.stop())

    asyncio.run(scenario())


def test_stop_cancels_only_owned_authorization_lock_waiters(make_runtime):
    first, peer = make_runtime("one"), make_runtime("peer")

    async def scenario():
        lock = asyncio.Lock()
        await lock.acquire()  # A background refresh owns the shared lock.

        async def refresh():
            async with lock:
                return True

        for bound in (first, peer):
            bound._refresh_authorization = refresh
            bound._authorize = lambda *_: True
        waiting = [
            asyncio.create_task(first.refresh_authorization())
            for _ in range(2)
        ]
        other = asyncio.create_task(peer.refresh_authorization())
        await asyncio.sleep(0)
        proof = await first.stop()
        first.verify_settlement(proof)
        assert lock.locked() and not other.done()
        assert all(task.cancelled() for task in first._authorization_tasks)
        assert all(task.done() for task in first._tasks)
        await asyncio.gather(*waiting, return_exceptions=True)
        lock.release()
        await other
        peer.verify_settlement(await peer.stop())

    asyncio.run(scenario())


@pytest.mark.parametrize("read_holds_lock", [False, True])
def test_authorization_cleanup_is_joined_through_repeated_cancel_and_stop(
    make_runtime, read_holds_lock
):
    bound = make_runtime()

    async def scenario():
        entered, cleaning, release = (
            asyncio.Event(),
            asyncio.Event(),
            asyncio.Event(),
        )
        closed = []

        async def refresh():
            try:
                entered.set()
                await asyncio.Event().wait()
            finally:
                cleaning.set()
                await release.wait()
                closed.append(True)

        bound._refresh_authorization = refresh
        bound._authorize = lambda *_: True
        request = asyncio.create_task(
            bound.read_file("never-read.txt")
            if read_holds_lock
            else bound.refresh_authorization()
        )
        await entered.wait()
        stopping = asyncio.create_task(bound.stop())
        await asyncio.wait_for(cleaning.wait(), 1)
        request.cancel()
        stopping.cancel()
        await asyncio.gather(request, stopping, return_exceptions=True)
        again = asyncio.create_task(bound.stop())
        await asyncio.sleep(0)
        assert not again.done() and not closed
        assert all(
            not task.done() and task.cancelling() == 1
            for task in bound._authorization_tasks
        )
        release.set()
        proof = await again
        assert closed == [True]
        assert all(task.done() for task in bound._tasks)
        bound.verify_settlement(proof)

    asyncio.run(scenario())


def test_unknown_descendants_and_forged_or_foreign_proof_fail_closed(
    make_runtime,
):
    first, second = make_runtime("one"), make_runtime("two")

    async def scenario():
        proof = await first.stop()
        with pytest.raises(runtime.UnsettledWriters):
            first.verify_settlement(replace(proof))
        with pytest.raises(runtime.UnsettledWriters):
            second.verify_settlement(proof)
        second.flag_unmanaged_writer()
        with pytest.raises(runtime.UnsettledWriters):
            await second.stop()
        with pytest.raises(runtime.UnsettledWriters):
            await second.stop()

    asyncio.run(scenario())


def test_mutation_provenance_covers_delete_type_and_mode_and_rejects_extra(
    make_runtime,
):
    bound = make_runtime()
    root = bound.binding.workspace.local_root
    (root / "changed-type").write_text("input file")
    (root / "deleted").write_text("delete")
    (root / "mode").write_text("mode")

    async def scenario():
        receipt = await bound.execute_worker(
            [
                Op("delete", "changed-type"),
                Op("mkdir", "changed-type", mode=0o755),
                Op("delete", "deleted"),
                Op("chmod", "mode", mode=0o755),
            ],
            mutation_id="owned",
        )
        assert receipt.attempt_id == bound.binding.attempt_id
        await bound.stop()
        changed = ("changed-type", "deleted", "mode")
        assert bound.path_provenance(changed) == dict.fromkeys(
            changed, receipt.receipt_id
        )
        with pytest.raises(runtime.RuntimeBindingError):
            bound.path_provenance((*changed, "raw-diff-is-not-authorization"))
        with pytest.raises(runtime.RuntimeBindingError):
            bound.path_provenance(("mode", "mode"))
        assert (root / "changed-type").is_dir()
        assert not (root / "deleted").exists()
        assert (root / "mode").stat().st_mode & 0o777 == 0o755

    asyncio.run(scenario())


@pytest.mark.parametrize("kind", ["symlink", "hardlink", "fifo"])
def test_worker_rejects_unsafe_file_before_truncation(
    make_runtime, tmp_path, kind
):
    bound = make_runtime()
    external = tmp_path / "outside"
    external.write_bytes(b"original")
    target = bound.binding.workspace.local_root / "target"
    if kind == "symlink":
        target.symlink_to(external)
    elif kind == "hardlink":
        os.link(external, target)
    else:
        os.mkfifo(target)

    async def scenario():
        with pytest.raises(runtime.WorkerExecutionError):
            await bound.execute_worker(
                [Op("write", "target", b"bad")], mutation_id="unsafe"
            )
        bound.verify_settlement(await bound.stop())

    asyncio.run(scenario())
    assert external.read_bytes() == b"original"


def test_root_replacement_and_unbounded_or_executable_inputs_rejected(
    make_runtime,
):
    bound = make_runtime()
    root = bound.binding.workspace.local_root
    for path in ("../escape", ".GIT/config", "/absolute", "dir//file"):
        with pytest.raises(content.InvalidWorkspacePath):
            Op("write", path, b"bad")
    with pytest.raises(runtime.RuntimeBindingError):
        Op("shell", "bash")
    with pytest.raises(runtime.RuntimeBindingError):
        Op("sleep", seconds=float("inf"))
    renamed = root.with_name("old-root")
    root.rename(renamed)
    root.mkdir()

    async def scenario():
        with pytest.raises(runtime.RuntimeBindingError):
            await bound.execute_worker(
                [Op("write", "new", b"bad")], mutation_id="swapped"
            )
        with pytest.raises(runtime.RuntimeBindingError):
            await bound.stop()
        assert not (root / "new").exists()

    asyncio.run(scenario())


def test_real_provider_checkpoint_has_complete_scoped_receipts(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "file").write_bytes(b"input")
    store = content.ContentStore(tmp_path / "objects")
    directory = provider.DirectoryWorkspaceProvider(
        store, tmp_path / "workspaces"
    )
    observed = source.stat()
    identity = content.content_digest(
        content.canonical_json([observed.st_dev, observed.st_ino])
    )
    snapshot = directory.capture_source(
        source,
        owner="attempt",
        read_fence=lambda: provider.SourceFence("target", identity, 0, None),
    )
    workspace = directory.prepare(snapshot, owner="attempt", generation=1)
    bound = runtime.BoundRuntime(
        runtime.RuntimeBinding("run", "attempt", 1, workspace, "env", {})
    )

    async def scenario():
        await bound.execute_worker(
            [Op("write", "file", b"output")], mutation_id="edit"
        )
        bound.verify_settlement(await bound.stop())

    asyncio.run(scenario())
    checkpoint = directory.checkpoint(
        workspace,
        assert_owner=lambda _handle: None,
        mutation_receipts=bound.mutation_receipts,
    )
    assert checkpoint.changed_paths == ("file",)
    assert bound.path_provenance(checkpoint.changed_paths) == {
        "file": bound.mutation_receipts[0]
    }
    assert (
        store.get_manifest(checkpoint.revision_id).mutation_receipts
        == bound.mutation_receipts
    )
    assert directory.read(snapshot, "file") == b"input"
    assert directory.read(checkpoint, "file") == b"output"


def test_dispatch_rechecks_authority_after_waiting_for_mutation_lock(
    make_runtime,
):
    prototype = make_runtime()
    authority = {"allowed": True}
    checked = []

    def authorize(binding, operations):
        checked.append(
            (binding, tuple(op.path for op in operations if op.path))
        )
        return authority["allowed"]

    bound = runtime.BoundRuntime(prototype.binding, authorize=authorize)

    async def scenario():
        await prototype.stop()
        first = asyncio.create_task(
            bound.execute_worker(
                [Op("write", "started", b"yes"), Op("sleep", seconds=0.15)],
                mutation_id="first",
            )
        )
        await wait_for_files(bound.binding.workspace.local_root / "started")
        queued = asyncio.create_task(
            bound.execute_worker(
                [Op("write", "revoked.txt", b"must not write")],
                mutation_id="queued",
            )
        )
        await asyncio.sleep(0)
        authority["allowed"] = False
        await first
        with pytest.raises(
            runtime.RuntimeBindingError, match="not authorized"
        ):
            await queued
        proof = await bound.stop()
        assert len(proof.process_instances) == 1
        assert len(bound.mutation_receipts) == 1

    asyncio.run(scenario())
    assert checked == [
        (bound.binding, ("started",)),
        (bound.binding, ("revoked.txt",)),
    ]
    assert not (bound.binding.workspace.local_root / "revoked.txt").exists()


def test_authorization_failure_does_not_expose_policy_exception(make_runtime):
    prototype = make_runtime()

    def authorize(_binding, _operations):
        raise ValueError("sensitive credential diagnostic")

    bound = runtime.BoundRuntime(prototype.binding, authorize=authorize)

    async def scenario():
        await prototype.stop()
        with pytest.raises(runtime.RuntimeBindingError) as failed:
            await bound.execute_worker(
                [Op("write", "denied", b"must not write")],
                mutation_id="denied",
            )
        assert str(failed.value) == "worker dispatch authorization unavailable"
        assert failed.value.__suppress_context__
        assert (await bound.stop()).process_instances == ()

    asyncio.run(scenario())
    assert not (bound.binding.workspace.local_root / "denied").exists()
