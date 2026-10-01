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

"""Real filesystem tests; load only the stdlib provider, never app/.env."""

from __future__ import annotations

import errno
import importlib.util
import multiprocessing
import os
import stat
import sys
import types
from dataclasses import replace
from pathlib import Path

import pytest

# Importing app executes its FastAPI setup. A private test package instead loads
# the exact production modules without touching app or its environment loader.
_PACKAGE = "_eigent_gitless_provider_tests"
_MODULE_ROOT = (
    Path(__file__).resolve().parents[3] / "app" / "workspace_runtime"
)
_package = types.ModuleType(_PACKAGE)
_package.__path__ = [str(_MODULE_ROOT)]
sys.modules[_PACKAGE] = _package


def _load(name):
    spec = importlib.util.spec_from_file_location(
        f"{_PACKAGE}.{name}", _MODULE_ROOT / f"{name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


content = _load("content")
provider = _load("provider")


@pytest.fixture
def setup(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.txt").write_bytes(b"first input\n")
    store = content.ContentStore(tmp_path / "objects")
    runtime = provider.DirectoryWorkspaceProvider(
        store, tmp_path / "workspaces"
    )
    observed = source.stat()
    identity = content.content_digest(
        content.canonical_json([observed.st_dev, observed.st_ino])
    )
    fence = provider.SourceFence("physical-1", identity, 4, None, 2)
    return source, store, runtime, fence


def capture(setup, **kwargs):
    source, _store, runtime, fence = setup
    return runtime.capture_source(
        source, owner="project/run/attempt", read_fence=lambda: fence, **kwargs
    )


def test_snapshot_and_prepare_are_gitless_and_independent(setup, monkeypatch):
    source, store, runtime, _fence = setup
    monkeypatch.setenv("PATH", "")
    (source / "empty").mkdir()
    (source / "tool.sh").write_bytes(b"#!/bin/sh\n")
    (source / "tool.sh").chmod(0o755)
    snapshot = capture(setup)
    first = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    second = runtime.prepare(snapshot, owner=snapshot.owner, generation=2)
    entry = next(
        item
        for item in store.get_manifest(snapshot.revision_id).entries
        if item.path == "a.txt"
    )
    blob = store.root / "objects" / entry.digest[:2] / entry.digest
    inodes = {
        (source / "a.txt").stat().st_ino,
        blob.stat().st_ino,
        (first.local_root / "a.txt").stat().st_ino,
        (second.local_root / "a.txt").stat().st_ino,
    }
    assert len(inodes) == 4
    assert (first.local_root / "empty").is_dir()
    assert (first.local_root / "tool.sh").stat().st_mode & 0o777 == 0o755
    (source / "a.txt").write_bytes(b"external changed\n")
    (first.local_root / "a.txt").write_bytes(b"private edit\n")
    assert (second.local_root / "a.txt").read_bytes() == b"first input\n"
    assert runtime.read(snapshot, "a.txt") == b"first input\n"
    assert not (source / ".git").exists()
    assert not (first.local_root / ".git").exists()


def test_checkpoint_retains_input_and_records_deletions_modes_lineage(setup):
    source, store, runtime, _ = setup
    (source / "gone").mkdir()
    (source / "gone" / "nested.txt").write_bytes(b"deleted later")
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=3)
    (handle.local_root / "a.txt").write_bytes(b"second output\n")
    (handle.local_root / "a.txt").chmod(0o600)
    (handle.local_root / "gone" / "nested.txt").unlink()
    (handle.local_root / "gone").rmdir()
    checked = []
    output = runtime.checkpoint(
        handle,
        assert_owner=lambda value: checked.append(value),
        mutation_receipts=("tool-call-1",),
    )
    manifest = store.get_manifest(output.revision_id)
    assert checked == [handle, handle]
    assert (
        manifest.parent_revision
        == manifest.source_revision
        == snapshot.revision_id
    )
    assert manifest.lineage == (snapshot.revision_id,)
    assert manifest.mutation_receipts == ("tool-call-1",)
    assert {
        entry.path for entry in manifest.entries if entry.kind == "tombstone"
    } == {"gone", "gone/nested.txt"}
    assert (
        next(entry.mode for entry in manifest.entries if entry.path == "a.txt")
        == 0o600
    )
    assert output.changed_paths == ("a.txt", "gone", "gone/nested.txt")
    assert runtime.read(snapshot, "a.txt") == b"first input\n"
    assert runtime.read(output, "a.txt", offset=7, length=6) == b"output"
    with pytest.raises(FileNotFoundError):
        runtime.read(output, "gone/nested.txt")
    (handle.local_root / "a.txt").write_bytes(b"third output\n")
    assert runtime.read(output, "a.txt") == b"second output\n"


def test_checkpoint_represents_directory_to_file_without_losing_tombstone(
    setup,
):
    source, store, runtime, _ = setup
    (source / "node").mkdir()
    (source / "node" / "old.txt").write_bytes(b"old")
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    (handle.local_root / "node" / "old.txt").unlink()
    (handle.local_root / "node").rmdir()
    (handle.local_root / "node").write_bytes(b"replacement")
    result = runtime.checkpoint(handle, assert_owner=lambda _: None)
    entries = {
        entry.path: entry
        for entry in store.get_manifest(result.revision_id).entries
    }
    assert entries["node"].kind == "file"
    assert entries["node/old.txt"].kind == "tombstone"


@pytest.mark.parametrize(
    "state,owner",
    [
        ("writing", "legacy:run:2"),
        ("recovery_required", None),
        ("settled", "apply:req:4"),
    ],
)
def test_live_capture_rejects_unsettled_source_before_reading(
    setup, state, owner
):
    source, _, runtime, fence = setup
    with pytest.raises(provider.SourceWaitingForSettlementError):
        runtime.capture_source(
            source / "does-not-exist",
            owner="owner",
            read_fence=lambda: replace(fence, state=state, owner=owner),
        )


@pytest.mark.parametrize(
    "field,value",
    [
        ("write_epoch", 6),
        ("physical_identity", "replacement"),
        ("settled_revision", "new"),
        ("integration_receipt_cursor", 3),
        ("binding_version", 1),
    ],
)
def test_capture_rejects_changed_fence_including_ABA(setup, field, value):
    source, _, runtime, fence = setup
    before = (source / "a.txt").read_bytes()
    observations = iter([fence, replace(fence, **{field: value})])
    committed = []
    with pytest.raises(provider.SourceChangedError):
        runtime.capture_source(
            source,
            owner="owner",
            read_fence=lambda: next(observations),
            commit_capture=lambda *args: committed.append(args),
        )
    assert (source / "a.txt").read_bytes() == before
    assert committed == []
    assert list(runtime.workspace_root.iterdir()) == []


def test_expected_fence_and_final_commit_rejection_do_not_return_ready(setup):
    source, _, runtime, fence = setup
    with pytest.raises(provider.SourceChangedError):
        capture(setup, expected_fence=replace(fence, write_epoch=3))
    committed = []

    def reject(snapshot, expected):
        assert snapshot.fence == expected == fence
        raise provider.SourceChangedError("journal CAS rejected")

    with pytest.raises(provider.SourceChangedError):
        runtime.capture_source(
            source,
            owner="owner",
            read_fence=lambda: fence,
            commit_capture=reject,
        )
    assert committed == []
    assert list(runtime.workspace_root.iterdir()) == []


def test_source_fence_cannot_authorize_another_directory(setup, tmp_path):
    _, _, runtime, fence = setup
    other = tmp_path / "other"
    other.mkdir()
    (other / "other.txt").write_bytes(b"wrong target")
    with pytest.raises(provider.SourceChangedError, match="physical fence"):
        runtime.capture_source(other, owner="owner", read_fence=lambda: fence)


def test_capture_depth_is_bounded(setup):
    source, _, runtime, _ = setup
    (source / "one" / "two").mkdir(parents=True)
    runtime.limits = provider.CaptureLimits(max_depth=1)
    with pytest.raises(provider.WorkspaceLimitError, match="depth"):
        capture(setup)


def test_capture_rechecks_identity_if_root_replaced_before_scan(
    setup, monkeypatch
):
    source, _, runtime, _ = setup
    original = runtime._scan
    scans = 0

    def replaced_root(root, **kwargs):
        nonlocal scans
        scans += 1
        if scans == 1:
            source.rename(source.with_name("old-source"))
            source.mkdir()
            (source / "a.txt").write_bytes(b"first input\n")
        return original(root, **kwargs)

    monkeypatch.setattr(runtime, "_scan", replaced_root)
    with pytest.raises(provider.SourceChangedError, match="physical fence"):
        capture(setup)


def test_capture_refuses_platform_without_safe_descriptor_walk(
    setup, monkeypatch
):
    monkeypatch.setattr(os, "supports_fd", set())
    with pytest.raises(content.WorkspaceContentError, match="platform"):
        capture(setup)


def test_capture_detects_write_during_copy_and_final_fence_change(
    setup, monkeypatch
):
    source, store, runtime, fence = setup
    original = store.put_blob
    changed = False

    def change_after_read(value):
        nonlocal changed
        result = original(value)
        if not changed:
            (source / "a.txt").write_bytes(b"late write\n")
            changed = True
        return result

    monkeypatch.setattr(store, "put_blob", change_after_read)
    with pytest.raises(provider.SourceChangedError):
        capture(setup)
    monkeypatch.setattr(store, "put_blob", original)
    observations = iter([fence, fence, replace(fence, write_epoch=6)])
    with pytest.raises(provider.SourceChangedError):
        runtime.capture_source(
            source, owner="owner", read_fence=lambda: next(observations)
        )


def test_capture_exclusions_are_explicit_and_git_metadata_is_not_read(setup):
    source, store, runtime, _ = setup
    (source / ".git").mkdir()
    (source / ".git" / "do-not-copy").write_bytes(b"git metadata")
    (source / "cache").mkdir()
    (source / "cache" / "excluded").write_bytes(b"excluded")
    runtime.exclude_path = lambda path, is_dir: path == "cache" and is_dir
    snapshot = capture(setup)
    manifest = store.get_manifest(snapshot.revision_id)
    assert manifest.coverage == (".git", "cache")
    assert [entry.path for entry in manifest.entries] == ["a.txt"]


@pytest.mark.parametrize(
    "path",
    [
        "../escape",
        "/absolute",
        "a/../b",
        "a//b",
        "a/./b",
        "a\\b",
        "C:drive",
        ".git/config",
        ".GIT/config",
        "nested/.GiT/HEAD",
        "a\0b",
    ],
)
def test_paths_are_strictly_relative(setup, path):
    _, _, runtime, _ = setup
    snapshot = capture(setup)
    with pytest.raises(content.InvalidWorkspacePath):
        runtime.read(snapshot, path)


@pytest.mark.parametrize("metadata_name", [".git", ".GIT", ".GiT"])
def test_git_metadata_alias_is_excluded_from_source_and_checkpoint(
    setup,
    metadata_name,
):
    source, store, runtime, _ = setup
    metadata = source / metadata_name
    metadata.mkdir()
    (metadata / "HEAD").write_bytes(b"must not capture")
    snapshot = capture(setup)
    manifest = store.get_manifest(snapshot.revision_id)
    assert metadata_name in manifest.coverage
    assert all(
        not entry.path.startswith(metadata_name) for entry in manifest.entries
    )
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    (handle.local_root / metadata_name).mkdir()
    (handle.local_root / metadata_name / "injected").write_bytes(
        b"must not publish"
    )
    output = runtime.checkpoint(handle, assert_owner=lambda _: None)
    assert output.changed_paths == ()
    assert all(
        not entry.path.startswith(metadata_name)
        for entry in store.get_manifest(output.revision_id).entries
    )
    with pytest.raises(content.InvalidWorkspacePath):
        content.ManifestEntry(
            f"{metadata_name}/injected", "file", store.put_blob(b"x"), 1, 0o644
        )


def test_symlink_and_fifo_cannot_escape_capture_or_checkpoint(setup, tmp_path):
    source, _, runtime, _ = setup
    outside = tmp_path / "outside"
    outside.write_bytes(b"not authorized")
    (source / "escape").symlink_to(outside)
    with pytest.raises(content.InvalidWorkspacePath):
        capture(setup)
    (source / "escape").unlink()
    os.mkfifo(source / "pipe")
    with pytest.raises(content.InvalidWorkspacePath):
        capture(setup)
    (source / "pipe").unlink()
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    (handle.local_root / "escape").symlink_to(outside)
    with pytest.raises(content.InvalidWorkspacePath):
        runtime.checkpoint(handle, assert_owner=lambda _: None)
    assert outside.read_bytes() == b"not authorized"


def _replace_regular_file_with_fifo(root, operation):
    """Run the actual stat/open race in a process the test can always stop."""
    source = root / "source"
    source.mkdir()
    (source / "a.txt").write_bytes(b"ordinary input")
    store = content.ContentStore(root / "objects")
    runtime = provider.DirectoryWorkspaceProvider(store, root / "workspaces")
    observed = source.stat()
    fence = provider.SourceFence(
        "physical-1",
        content.content_digest(
            content.canonical_json([observed.st_dev, observed.st_ino])
        ),
        1,
        None,
    )
    target = source
    if operation == "checkpoint":
        snapshot = runtime.capture_source(
            source, owner="owner", read_fence=lambda: fence
        )
        handle = runtime.prepare(snapshot, owner="owner", generation=1)
        target = handle.local_root
    replaced = False
    committed = []
    original_open = os.open
    original_support = os.supports_dir_fd

    def replace_at_open(path, flags, *args, **kwargs):
        nonlocal replaced
        if path == "a.txt" and "dir_fd" in kwargs and not replaced:
            os.unlink(path, dir_fd=kwargs["dir_fd"])
            os.mkfifo(path, dir_fd=kwargs["dir_fd"])
            replaced = True
        return original_open(path, flags, *args, **kwargs)

    os.open = replace_at_open
    os.supports_dir_fd = original_support | {replace_at_open}
    try:
        with pytest.raises(provider.SourceChangedError) as failure:
            if operation == "capture":
                runtime.capture_source(
                    source,
                    owner="owner",
                    read_fence=lambda: fence,
                    commit_capture=lambda *args: committed.append(args),
                )
            elif operation == "checkpoint":
                runtime.checkpoint(handle, assert_owner=lambda _: None)
            else:
                runtime._scan(source, save_objects=False)
        assert failure.value.code == "source_changed"
        assert replaced
        assert stat.S_ISFIFO((target / "a.txt").lstat().st_mode)
        assert committed == []
    finally:
        os.open = original_open
        os.supports_dir_fd = original_support


@pytest.mark.skipif(
    "fork" not in multiprocessing.get_all_start_methods()
    or not hasattr(os, "O_NONBLOCK")
    or not hasattr(os, "mkfifo"),
    reason="requires POSIX nonblocking FIFO and fork",
)
@pytest.mark.parametrize("operation", ["capture", "checkpoint", "verify"])
def test_regular_file_replaced_by_fifo_fails_without_waiting_for_writer(
    tmp_path, operation
):
    process = multiprocessing.get_context("fork").Process(
        target=_replace_regular_file_with_fifo, args=(tmp_path, operation)
    )
    process.start()
    try:
        process.join(timeout=5)
        assert not process.is_alive(), "capture blocked opening the FIFO"
        assert process.exitcode == 0
    finally:
        if process.is_alive():
            process.kill()
            process.join(timeout=5)
        process.close()


@pytest.mark.parametrize(
    "limits",
    [
        {"max_file_bytes": 2},
        {"max_total_bytes": 2},
        {"max_files": 1},
        {"max_entries": 1},
    ],
)
def test_capture_limits_fail_without_shared_directory_fallback(setup, limits):
    source, _, runtime, _ = setup
    (source / "b.txt").write_bytes(b"another")
    runtime.limits = provider.CaptureLimits(**limits)
    with pytest.raises(provider.WorkspaceLimitError):
        capture(setup)
    assert (source / "a.txt").read_bytes() == b"first input\n"
    assert list(runtime.workspace_root.iterdir()) == []


def test_prepare_rechecks_limits_and_cleans_partial_failure(
    setup, monkeypatch
):
    source, store, runtime, _ = setup
    snapshot = capture(setup)
    runtime.limits = provider.CaptureLimits(max_file_bytes=2)
    with pytest.raises(provider.WorkspaceLimitError):
        runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    runtime.limits = provider.CaptureLimits()
    original = os.fsync

    def disk_full(_descriptor):
        raise OSError(errno.ENOSPC, "injected disk full")

    monkeypatch.setattr(os, "fsync", disk_full)
    with pytest.raises(OSError):
        runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    monkeypatch.setattr(os, "fsync", original)
    assert list(runtime.workspace_root.iterdir()) == []
    assert (source / "a.txt").read_bytes() == b"first input\n"
    assert runtime.read(snapshot, "a.txt") == b"first input\n"


def test_prepare_rechecks_depth_and_owner_after_persisting(setup):
    source, _, runtime, _ = setup
    (source / "one" / "two").mkdir(parents=True)
    snapshot = capture(setup)
    runtime.limits = provider.CaptureLimits(max_depth=1)
    with pytest.raises(provider.WorkspaceLimitError):
        runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    runtime.limits = provider.CaptureLimits()
    checks = 0

    def reject_final_owner(owner, generation):
        nonlocal checks
        checks += 1
        if checks == 3:
            assert any(runtime.workspace_root.glob("workspace_*.json"))
            raise provider.WorkspaceOwnerError(
                "ownership lost after persistence"
            )

    with pytest.raises(provider.WorkspaceOwnerError):
        runtime.prepare(
            snapshot,
            owner=snapshot.owner,
            generation=1,
            assert_owner=reject_final_owner,
        )
    assert list(runtime.workspace_root.iterdir()) == []
    assert (source / "a.txt").read_bytes() == b"first input\n"


def test_capture_disk_failure_cannot_publish_ready(setup, monkeypatch):
    _, _, runtime, _ = setup
    committed = []

    def disk_full(_descriptor):
        raise OSError(errno.ENOSPC, "injected disk full")

    monkeypatch.setattr(os, "fsync", disk_full)
    with pytest.raises(content.WorkspaceContentError, match="persist"):
        capture(setup, commit_capture=lambda *args: committed.append(args))
    assert committed == []
    assert list(runtime.workspace_root.iterdir()) == []


def test_checkpoint_rejects_stale_owner_and_late_writer(setup, monkeypatch):
    _, store, runtime, _ = setup
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    with pytest.raises(provider.WorkspaceOwnerError):
        runtime.checkpoint(
            replace(handle, generation=2), assert_owner=lambda _: None
        )
    checks = 0

    def changed_owner(_handle):
        nonlocal checks
        checks += 1
        if checks > 1:
            raise provider.WorkspaceOwnerError("journal generation changed")

    with pytest.raises(provider.WorkspaceOwnerError):
        runtime.checkpoint(handle, assert_owner=changed_owner)
    original = store.put_blob

    def late_write(value):
        result = original(value)
        (handle.local_root / "a.txt").write_bytes(b"writer not settled")
        return result

    monkeypatch.setattr(store, "put_blob", late_write)
    with pytest.raises(provider.SourceChangedError):
        runtime.checkpoint(handle, assert_owner=lambda _: None)
    assert runtime.read(snapshot, "a.txt") == b"first input\n"


def test_durable_retention_is_delegated_and_release_never_deletes_content(
    setup,
):
    _, store, runtime, _ = setup
    snapshot = capture(setup)
    with pytest.raises(provider.RetentionUnavailableError):
        runtime.retain(snapshot, "artifact-1")

    class Retention:
        def __init__(self):
            self.references = set()

        def retain(self, revision, owner):
            self.references.add((revision, owner))

        def release(self, revision, owner):
            self.references.discard((revision, owner))

    runtime.retention = Retention()
    runtime.retain(snapshot, "artifact-1")
    runtime.retain(snapshot, "run-input")
    runtime.release(snapshot, "run-input")
    assert runtime.retention.references == {
        (snapshot.revision_id, "artifact-1")
    }
    assert store.references(snapshot.revision_id)["objects"]
    assert runtime.read(snapshot, "a.txt") == b"first input\n"


def test_objects_and_manifests_verify_digests_and_reject_alias_paths(setup):
    _, store, runtime, _ = setup
    snapshot = capture(setup)
    manifest = store.get_manifest(snapshot.revision_id)
    entry = manifest.entries[0]
    with pytest.raises(content.ContentIntegrityError, match="ambiguous"):
        content.WorkspaceManifest(
            entries=(entry, replace(entry, path="A.txt"))
        )
    blob = store.root / "objects" / entry.digest[:2] / entry.digest
    blob.chmod(0o644)
    blob.write_bytes(b"corrupt")
    with pytest.raises(content.ContentIntegrityError):
        runtime.read(snapshot, "a.txt")
    with pytest.raises(content.ContentIntegrityError):
        store.read_blob("../escape")


def test_content_store_rejects_symlink_even_with_matching_bytes(
    setup, tmp_path
):
    _, store, _, _ = setup
    digest = store.put_blob(b"valid bytes")
    blob = store.root / "objects" / digest[:2] / digest
    outside = tmp_path / "outside-object"
    blob.rename(outside)
    blob.symlink_to(outside)
    with pytest.raises(content.ContentIntegrityError, match="symlink"):
        store.read_blob(digest)
    with pytest.raises(content.ContentIntegrityError, match="symlink"):
        store.put_blob(b"valid bytes")
