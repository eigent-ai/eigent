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

"""Actual temporary Git repositories; no app bootstrap, .env or account DB."""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
import types
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path

import pytest

_APP_ROOT = Path(__file__).resolve().parents[3] / "app"
_PACKAGE = "_eigent_git_runtime_tests"
_package = types.ModuleType(_PACKAGE)
_package.__path__ = [str(_APP_ROOT / "workspace_runtime")]
sys.modules[_PACKAGE] = _package


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


content = _load(
    f"{_PACKAGE}.content", _APP_ROOT / "workspace_runtime/content.py"
)
directory = _load(
    f"{_PACKAGE}.provider", _APP_ROOT / "workspace_runtime/provider.py"
)
# GitBackend imports only path_policy but its public package eagerly boots the
# whole app. Temporarily provide package shells while loading those real files.
_names = (
    "app",
    "app.workspace_git",
    "app.workspace_git.path_policy",
    "app.workspace_git.backend",
)
_previous = {name: sys.modules.get(name) for name in _names}
try:
    for _name in _names[:2]:
        _shell = types.ModuleType(_name)
        _shell.__path__ = []
        sys.modules[_name] = _shell
    _load(
        "app.workspace_git.path_policy",
        _APP_ROOT / "workspace_git/path_policy.py",
    )
    backend = _load(
        "app.workspace_git.backend", _APP_ROOT / "workspace_git/backend.py"
    )
    provider = _load(
        f"{_PACKAGE}.git_provider",
        _APP_ROOT / "workspace_runtime/git_provider.py",
    )
finally:
    for _name, _module in _previous.items():
        if _module is None:
            sys.modules.pop(_name, None)
        else:
            sys.modules[_name] = _module

_GIT = shutil.which("git")
pytestmark = pytest.mark.skipif(_GIT is None, reason="Git provider needs Git")


def git(root, *args):
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("GIT_")
    }
    environment.update(
        GIT_CONFIG_GLOBAL=os.devnull,
        GIT_CONFIG_NOSYSTEM="1",
        GIT_TERMINAL_PROMPT="0",
        GIT_OPTIONAL_LOCKS="0",
        GIT_AUTHOR_NAME="Fixture",
        GIT_AUTHOR_EMAIL="fixture@example.invalid",
        GIT_COMMITTER_NAME="Fixture",
        GIT_COMMITTER_EMAIL="fixture@example.invalid",
    )
    return subprocess.run(
        [
            _GIT,
            "-c",
            f"core.hooksPath={os.devnull}",
            "-c",
            "commit.gpgSign=false",
            "-C",
            str(root),
            *args,
        ],
        env=environment,
        check=True,
        capture_output=True,
        timeout=10,
    ).stdout


def build(tmp_path, *, initial_commit=True):
    source = tmp_path / "source"
    source.mkdir()
    git(source, "init", "--initial-branch=main")
    (source / "a.txt").write_bytes(b"base\n")
    if initial_commit:
        git(source, "add", "--", "a.txt")
        git(source, "commit", "-m", "fixture")
    store = content.ContentStore(tmp_path / "objects")
    runtime = provider.GitWorkspaceProvider(
        store,
        tmp_path / "workspaces",
        repository_root=source,
        git=backend.GitBackend(_GIT),
    )
    observed = source.stat()
    identity = content.content_digest(
        content.canonical_json([observed.st_dev, observed.st_ino])
    )
    fence = directory.SourceFence("physical-1", identity, 2, None)
    return source, store, runtime, fence


def test_authorization_locator_tracks_linked_worktree_and_common_directory(
    tmp_path,
):
    source, store, _, _ = build(tmp_path)
    linked = tmp_path / "linked"
    git(source, "worktree", "add", "--detach", str(linked))
    runtime = provider.GitWorkspaceProvider(
        store, tmp_path / "private-linked", repository_root=linked
    )
    before = runtime.authorization_locator_state()
    # Ordinary Git writes are not changes of the authority's repository.
    git(source, "update-ref", "refs/test/authority", "HEAD")
    assert runtime.authorization_locator_state() == before
    common = source / ".git"
    common.rename(source / ".old-git")
    common.mkdir()
    # Even if the gitfile and commondir text stay unchanged, target directory
    # identity must not reuse the earlier full Git result.
    with pytest.raises((OSError, directory.SourceChangedError)):
        runtime.authorization_locator_state()


def test_authorization_locator_rejects_gitfile_retarget(tmp_path):
    source, store, _, _ = build(tmp_path)
    linked = tmp_path / "linked"
    git(source, "worktree", "add", "--detach", str(linked))
    runtime = provider.GitWorkspaceProvider(
        store, tmp_path / "private-linked", repository_root=linked
    )
    before = runtime.authorization_locator_state()
    (linked / ".git").write_text("gitdir: " + str(source / ".git") + "\n")
    assert runtime.authorization_locator_state() != before


@pytest.mark.parametrize("locator", ["gitdir", "commondir"])
def test_authorization_locator_preserves_literal_path_whitespace(
    tmp_path, locator
):
    source, store, _, _ = build(tmp_path)
    linked = tmp_path / "linked"
    git(source, "worktree", "add", "--detach", str(linked))
    marker = linked / ".git"
    directory = Path(marker.read_text()[8:].rstrip("\r\n"))
    if locator == "gitdir":
        moved = directory.with_name(directory.name + " ")
        directory.rename(moved)
        marker.write_text("gitdir: " + str(moved) + "\n")
    else:
        (directory / " common").symlink_to(
            source / ".git", target_is_directory=True
        )
        (directory / "commondir").write_text(" common\n")
    runtime = provider.GitWorkspaceProvider(
        store, tmp_path / "private-linked", repository_root=linked
    )
    assert runtime._repository_identity() == runtime.repository_identity
    assert (
        runtime.authorization_locator_state()
        == runtime.authorization_locator_state()
    )


@pytest.fixture
def setup(tmp_path):
    return build(tmp_path)


def capture(setup):
    source, _, runtime, fence = setup
    return runtime.capture_source(
        source, owner="project/run/attempt", read_fence=lambda: fence
    )


def checkpoint(runtime, handle, *changed_paths):
    return runtime.checkpoint(
        handle,
        assert_owner=lambda _: None,
        mutation_receipts=("authorized-tool-call",),
        path_provenance={
            path: "authorized-tool-call" for path in changed_paths
        },
    )


def object_exists(source, oid):
    try:
        git(source, "cat-file", "-e", oid)
    except subprocess.CalledProcessError:
        return False
    return True


def primary_state(source):
    metadata = source / ".git"
    return {
        "head": (metadata / "HEAD").read_bytes(),
        "index": (metadata / "index").read_bytes()
        if (metadata / "index").exists()
        else None,
        "main": (metadata / "refs/heads/main").read_bytes()
        if (metadata / "refs/heads/main").exists()
        else None,
        "files": {
            path.relative_to(source).as_posix(): path.read_bytes()
            for path in source.rglob("*")
            if path.is_file() and ".git" not in path.relative_to(source).parts
        },
    }


def test_dirty_staged_untracked_input_stays_in_cas_beside_managed_commit(
    setup,
):
    source, _, runtime, _ = setup
    (source / "a.txt").write_bytes(b"staged sentinel\n")
    git(source, "add", "--", "a.txt")
    (source / "a.txt").write_bytes(b"dirty sentinel\n")
    (source / "binary.dat").write_bytes(b"\xff\x00\x80binary")
    (source / ".gitignore").write_bytes(b"ignored.txt\n")
    (source / "ignored.txt").write_bytes(b"must be complete input")
    (source / "empty").mkdir()
    before = primary_state(source)
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    assert primary_state(source) == before
    assert git(source, "show", f"{handle.input_commit}:a.txt") == b"base\n"
    assert (
        git(source, "ls-tree", handle.input_commit, "--", "binary.dat") == b""
    )
    assert (
        git(source, "ls-tree", handle.input_commit, "--", "ignored.txt") == b""
    )
    assert runtime.read(snapshot, "a.txt") == b"dirty sentinel\n"
    assert runtime.read(snapshot, "binary.dat") == b"\xff\x00\x80binary"
    assert runtime.read(snapshot, "ignored.txt") == b"must be complete input"
    assert (
        git(handle.local_root, "rev-parse", "HEAD").strip().decode()
        == handle.input_commit
    )
    assert (handle.local_root / "empty").is_dir()
    assert (handle.local_root / "a.txt").read_bytes() == b"dirty sentinel\n"
    assert handle.git_ref.startswith("refs/heads/eigent/runtime/")
    assert git(
        source,
        "for-each-ref",
        "--format=%(refname)",
        "refs/eigent/runtime/sources/",
    )


def test_two_parallel_worktrees_do_not_share_same_named_files_or_artifacts(
    setup,
):
    source, _, runtime, _ = setup
    snapshot = capture(setup)
    before = primary_state(source)
    with ThreadPoolExecutor(max_workers=2) as pool:
        handles = list(
            pool.map(
                lambda generation: runtime.prepare(
                    snapshot, owner=snapshot.owner, generation=generation
                ),
                (1, 2),
            )
        )
    first, second = handles
    assert first.git_ref != second.git_ref
    assert first.local_root != second.local_root
    assert (first.local_root / "a.txt").stat().st_ino != (
        second.local_root / "a.txt"
    ).stat().st_ino
    (first.local_root / "a.txt").write_bytes(b"first run output\n")
    output = checkpoint(runtime, first, "a.txt")
    (second.local_root / "a.txt").write_bytes(b"second run output\n")
    later = checkpoint(runtime, second, "a.txt")
    (first.local_root / "a.txt").write_bytes(b"first run later edit\n")
    assert runtime.read(output, "a.txt") == b"first run output\n"
    assert runtime.read(later, "a.txt") == b"second run output\n"
    assert (
        git(source, "show", f"{output.git_commit}:a.txt")
        == b"first run output\n"
    )
    assert (
        git(source, "rev-parse", f"{output.git_commit}^").strip().decode()
        == first.input_commit
    )
    assert primary_state(source) == before


def test_fixed_snapshot_does_not_recapture_later_source(setup):
    source, _, runtime, _ = setup
    snapshot = capture(setup)
    (source / "a.txt").write_bytes(b"later source\n")
    (source / "after.txt").write_bytes(b"later only")
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    assert (handle.local_root / "a.txt").read_bytes() == b"base\n"
    assert not (handle.local_root / "after.txt").exists()
    assert (source / "a.txt").read_bytes() == b"later source\n"


def test_hooks_filters_and_merge_drivers_do_not_execute(
    setup, tmp_path, monkeypatch
):
    source, _, runtime, _ = setup
    sentinel = tmp_path / "executed"
    script = tmp_path / "external-hook"
    script.write_text(f"#!/bin/sh\nprintf invoked >> '{sentinel}'\ncat\n")
    script.chmod(0o755)
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    for name in (
        "post-checkout",
        "pre-commit",
        "post-commit",
        "reference-transaction",
    ):
        (hooks / name).symlink_to(script)
    git(source, "config", "core.hooksPath", str(hooks))
    git(source, "config", "filter.sentinel.clean", str(script))
    git(source, "config", "filter.sentinel.smudge", str(script))
    git(source, "config", "filter.sentinel.required", "true")
    git(source, "config", "merge.sentinel.driver", str(script))
    (source / ".gitattributes").write_bytes(
        b"*.txt filter=sentinel merge=sentinel text eol=crlf\n"
    )
    (source / "a.txt").write_bytes(b"raw\nbytes\n")
    hostile_config = tmp_path / "hostile-global"
    hostile_config.write_text(f"[core]\n hooksPath = {hooks}\n")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(hostile_config))
    monkeypatch.setenv("GIT_CONFIG_COUNT", "1")
    monkeypatch.setenv("GIT_CONFIG_KEY_0", "core.hooksPath")
    monkeypatch.setenv("GIT_CONFIG_VALUE_0", str(hooks))
    monkeypatch.setenv("GIT_NAMESPACE", "hostile")
    before = primary_state(source)
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    assert (handle.local_root / "a.txt").read_bytes() == b"raw\nbytes\n"
    (handle.local_root / "a.txt").write_bytes(b"output\nbytes\n")
    output = checkpoint(runtime, handle, "a.txt")
    assert runtime.read(output, "a.txt") == b"output\nbytes\n"
    assert not sentinel.exists()
    assert primary_state(source) == before


def test_unborn_repository_remains_unborn_and_does_not_gain_index(tmp_path):
    setup = build(tmp_path, initial_commit=False)
    source, _, runtime, _ = setup
    before = primary_state(source)
    input_oid = (
        git(source, "hash-object", "--no-filters", "--", "a.txt")
        .decode()
        .strip()
    )
    assert not object_exists(source, input_oid)
    snapshot = capture(setup)
    assert snapshot.source_commit is None
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    assert primary_state(source) == before
    assert (handle.local_root / "a.txt").read_bytes() == b"base\n"
    assert (
        git(handle.local_root, "rev-parse", "HEAD").strip().decode()
        == handle.input_commit
    )
    assert not object_exists(source, input_oid)
    unchanged = runtime.checkpoint(handle, assert_owner=lambda _: None)
    assert unchanged.git_commit == handle.input_commit
    assert not object_exists(source, input_oid)
    assert runtime.read(unchanged, "a.txt") == b"base\n"


def test_binary_path_names_modes_and_tombstone_are_retained(setup):
    source, store, runtime, _ = setup
    path = "工具\twith\nnewline.sh"
    (source / path).write_bytes(b"#!/bin/sh\necho safe\n")
    (source / path).chmod(0o751)
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    assert (handle.local_root / path).read_bytes() == (
        source / path
    ).read_bytes()
    assert (handle.local_root / path).stat().st_mode & 0o777 == 0o751
    assert git(source, "ls-tree", handle.input_commit, "--", path) == b""
    (handle.local_root / "a.txt").unlink()
    (handle.local_root / path).chmod(0o700)
    output = checkpoint(runtime, handle, "a.txt", path)
    assert b"100755 blob" in git(
        source, "ls-tree", output.git_commit, "--", path
    )
    assert (
        next(
            entry.kind
            for entry in store.get_manifest(output.revision_id).entries
            if entry.path == "a.txt"
        )
        == "tombstone"
    )
    assert git(source, "ls-tree", output.git_commit, "--", "a.txt") == b""


def test_stale_owner_and_capture_commit_rejection_return_no_ready_handle(
    setup,
):
    source, _, runtime, fence = setup

    def reject(*args):
        raise directory.WorkspaceOwnerError("stale")

    with pytest.raises(directory.WorkspaceOwnerError):
        runtime.capture_source(
            source,
            owner="owner",
            read_fence=lambda: fence,
            commit_capture=reject,
        )
    snapshot = capture(setup)
    with pytest.raises(directory.WorkspaceOwnerError):
        runtime.prepare(
            snapshot, owner=snapshot.owner, generation=1, assert_owner=reject
        )
    assert list(runtime.workspace_root.iterdir()) == []
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    with pytest.raises(directory.WorkspaceOwnerError):
        runtime.checkpoint(
            replace(handle, generation=2), assert_owner=lambda _: None
        )


def test_partial_git_preparation_retains_evidence_without_ready_or_primary_change(
    setup,
    monkeypatch,
):
    source, _, runtime, _ = setup
    snapshot = capture(setup)
    before = primary_state(source)
    original = runtime.git.plumbing

    def fail_private_index(root, args, **kwargs):
        if args[0] == "read-tree":
            raise OSError("injected private index failure")
        return original(root, args, **kwargs)

    monkeypatch.setattr(runtime.git, "plumbing", fail_private_index)
    with pytest.raises(OSError, match="index failure"):
        runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    assert not list(runtime.workspace_root.glob("workspace_*.json"))
    registered = [
        item
        for item in runtime.git.list_worktrees(source)
        if item.path != source
    ]
    assert len(registered) == 1
    assert (registered[0].path / "a.txt").read_bytes() == b"base\n"
    assert primary_state(source) == before


def test_checkpoint_rejects_git_pointer_rebound_to_primary(setup):
    source, _, runtime, _ = setup
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    (handle.local_root / ".git").write_text(f"gitdir: {source / '.git'}\n")
    with pytest.raises(directory.WorkspaceOwnerError):
        runtime.checkpoint(handle, assert_owner=lambda _: None)


@pytest.mark.parametrize(
    "path", [".GIT/injected", ".GiT/hooks/pre-commit", "nested/.GIT/HEAD"]
)
def test_git_metadata_alias_cannot_enter_a_manifest_or_artifact(setup, path):
    source, store, runtime, _ = setup
    before = primary_state(source)
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    with pytest.raises(content.InvalidWorkspacePath):
        content.ManifestEntry(
            path, "file", store.put_blob(b"injected"), 8, 0o644
        )
    with pytest.raises(content.InvalidWorkspacePath):
        runtime.read(snapshot, path)
    output = runtime.checkpoint(handle, assert_owner=lambda _: None)
    assert output.changed_paths == ()
    assert primary_state(source) == before
    assert not (source / ".git/injected").exists()


def test_overlay_objects_are_absent_until_only_authorized_paths_change(
    setup,
    monkeypatch,
):
    source, _, runtime, _ = setup
    (source / "read-only-tracked.txt").write_bytes(b"managed baseline\n")
    git(source, "add", "--", "read-only-tracked.txt")
    git(source, "commit", "-m", "fixture tracked read-only path")
    overlays = {
        "a.txt": b"dirty tracked input, not staged\n",
        "selected.txt": b"untracked selected input\n",
        "read-only.txt": b"untracked read only input\n",
        "binary.dat": b"\x00\xffread-only binary input",
        "read-only-tracked.txt": b"dirty tracked read only input\n",
    }
    for path, value in overlays.items():
        (source / path).write_bytes(value)
    oids = {
        path: git(source, "hash-object", "--no-filters", "--", path)
        .decode()
        .strip()
        for path in overlays
    }
    assert all(not object_exists(source, oid) for oid in oids.values())
    before = primary_state(source)
    written = []
    raw_blob = runtime.git.raw_blob

    def write_blob(root, temporary_root, value):
        written.append(value)
        return raw_blob(root, temporary_root, value)

    monkeypatch.setattr(runtime.git, "raw_blob", write_blob)
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    assert written == []
    assert all(not object_exists(source, oid) for oid in oids.values())
    for path, value in overlays.items():
        assert runtime.read(snapshot, path) == value
        assert (handle.local_root / path).read_bytes() == value
    unchanged = runtime.checkpoint(handle, assert_owner=lambda _: None)
    assert unchanged.git_commit == handle.input_commit
    assert unchanged.overlay_preimage_commit is None
    assert unchanged.path_provenance == ()
    assert written == []
    assert all(not object_exists(source, oid) for oid in oids.values())

    # Restoring dirty content to Git HEAD is still a real I-to-O Agent change.
    (handle.local_root / "a.txt").write_bytes(b"base\n")
    (handle.local_root / "selected.txt").write_bytes(
        b"authorized Agent output\n"
    )
    output = checkpoint(runtime, handle, "a.txt", "selected.txt")
    assert output.path_provenance == (
        ("a.txt", "authorized-tool-call"),
        ("selected.txt", "authorized-tool-call"),
    )
    assert object_exists(source, oids["a.txt"])
    assert object_exists(source, oids["selected.txt"])
    assert not object_exists(source, oids["read-only.txt"])
    assert not object_exists(source, oids["binary.dat"])
    assert not object_exists(source, oids["read-only-tracked.txt"])
    assert not any(
        value in written
        for value in (
            overlays["read-only.txt"],
            overlays["binary.dat"],
            overlays["read-only-tracked.txt"],
        )
    )
    preimage = output.overlay_preimage_commit
    assert (
        git(source, "rev-parse", f"{preimage}^").strip().decode()
        == handle.input_commit
    )
    assert (
        git(source, "rev-parse", f"{output.git_commit}^").strip().decode()
        == preimage
    )
    for path in ("a.txt", "selected.txt"):
        assert git(source, "show", f"{preimage}:{path}") == overlays[path]
    preimage_message = git(source, "show", "-s", "--format=%B", preimage)
    delta_message = git(source, "show", "-s", "--format=%B", output.git_commit)
    assert b"Eigent-Actor: user" in preimage_message
    assert b"Eigent-Trigger: overlay_preimage" in preimage_message
    assert b"Eigent-Actor: agent" in delta_message
    assert b"authorized-tool-call" in preimage_message
    assert git(source, "show", f"{output.git_commit}:a.txt") == b"base\n"
    assert (
        git(source, "show", f"{output.git_commit}:selected.txt")
        == b"authorized Agent output\n"
    )
    assert (
        git(source, "ls-tree", output.git_commit, "--", "read-only.txt") == b""
    )
    assert runtime.read(output, "read-only.txt") == overlays["read-only.txt"]
    assert (
        git(source, "show", f"{output.git_commit}:read-only-tracked.txt")
        == b"managed baseline\n"
    )
    assert (
        runtime.read(output, "read-only-tracked.txt")
        == overlays["read-only-tracked.txt"]
    )
    assert runtime.read(snapshot, "a.txt") == overlays["a.txt"]
    assert primary_state(source) == before


@pytest.mark.parametrize(
    "provenance,receipts",
    [
        (None, ()),
        ({}, ("receipt",)),
        ({"a.txt": "unrecorded"}, ("receipt",)),
        ({"a.txt": "receipt", "unmodified.txt": "receipt"}, ("receipt",)),
    ],
)
def test_checkpoint_requires_exact_path_provenance_before_git_import(
    setup,
    monkeypatch,
    provenance,
    receipts,
):
    source, _, runtime, _ = setup
    (source / "a.txt").write_bytes(b"user preimage requiring provenance")
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    (handle.local_root / "a.txt").write_bytes(
        b"changed without verified path receipt"
    )
    before = primary_state(source)

    def unexpected_write(*args):
        pytest.fail("unproven path reached Git object import")

    monkeypatch.setattr(runtime.git, "raw_blob", unexpected_write)
    with pytest.raises(provider.GitMutationProvenanceError):
        runtime.checkpoint(
            handle,
            assert_owner=lambda _: None,
            mutation_receipts=receipts,
            path_provenance=provenance,
        )
    assert primary_state(source) == before


def test_overlay_deletion_type_and_mode_changes_preserve_only_affected_preimages(
    setup,
):
    source, _, runtime, _ = setup
    (source / "delete.txt").write_bytes(b"user preimage before Agent deletion")
    (source / "mode.txt").write_bytes(b"user preimage before Agent chmod")
    (source / "mode.txt").chmod(0o600)
    (source / "untouched.txt").write_bytes(b"not part of this mutation")
    untouched = (
        git(source, "hash-object", "--no-filters", "--", "untouched.txt")
        .decode()
        .strip()
    )
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    (handle.local_root / "delete.txt").unlink()
    (handle.local_root / "mode.txt").chmod(0o755)
    (handle.local_root / "a.txt").unlink()
    (handle.local_root / "a.txt").mkdir()
    (handle.local_root / "a.txt/child").write_bytes(b"Agent type replacement")
    output = checkpoint(
        runtime, handle, "delete.txt", "mode.txt", "a.txt", "a.txt/child"
    )
    assert output.changed_paths == (
        "a.txt",
        "a.txt/child",
        "delete.txt",
        "mode.txt",
    )
    assert (
        git(source, "show", f"{output.overlay_preimage_commit}:delete.txt")
        == b"user preimage before Agent deletion"
    )
    assert git(source, "ls-tree", output.git_commit, "--", "delete.txt") == b""
    assert b"100755 blob" in git(
        source, "ls-tree", output.git_commit, "--", "mode.txt"
    )
    assert (
        git(source, "show", f"{output.git_commit}:a.txt/child")
        == b"Agent type replacement"
    )
    assert not object_exists(source, untouched)
    assert (
        runtime.read(output, "untouched.txt") == b"not part of this mutation"
    )


@pytest.mark.parametrize("replacement", ["delete", "file"])
@pytest.mark.parametrize("excluded", ["bundle/keep.txt", "bundle/nested"])
def test_subtree_removal_rejects_excluded_managed_descendants(
    setup, monkeypatch, replacement, excluded
):
    source, store, runtime, _ = setup
    managed_path = (
        "bundle/keep.txt"
        if excluded.endswith("keep.txt")
        else "bundle/nested/keep.txt"
    )
    (source / managed_path).parent.mkdir(parents=True)
    (source / managed_path).write_bytes(b"excluded managed descendant\n")
    git(source, "add", "--", managed_path)
    git(source, "commit", "-m", "fixture excluded managed descendant")
    runtime.exclude_path = lambda path, is_dir: path == excluded
    snapshot = capture(setup)
    assert excluded in store.get_manifest(snapshot.revision_id).coverage
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    assert list((handle.local_root / "bundle").iterdir()) == []
    (handle.local_root / "bundle").rmdir()
    if replacement == "file":
        (handle.local_root / "bundle").write_bytes(b"Agent replacement\n")
    before = primary_state(source)
    refs_before = git(source, "for-each-ref")

    def unexpected_write(*args):
        pytest.fail("unproven subtree removal reached Git object import")

    monkeypatch.setattr(runtime.git, "raw_blob", unexpected_write)
    with pytest.raises(provider.GitMutationProvenanceError):
        checkpoint(runtime, handle, "bundle")
    assert git(source, "for-each-ref") == refs_before
    assert primary_state(source) == before


def test_subtree_symlink_replacement_still_fails_closed(setup):
    source, _, runtime, _ = setup
    (source / "bundle").mkdir()
    (source / "bundle/keep.txt").write_bytes(b"excluded managed descendant\n")
    git(source, "add", "--", "bundle/keep.txt")
    git(source, "commit", "-m", "fixture symlink replacement baseline")
    runtime.exclude_path = lambda path, is_dir: path == "bundle/keep.txt"
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    (handle.local_root / "bundle").rmdir()
    (handle.local_root / "bundle").symlink_to("a.txt")
    before = primary_state(source)
    refs_before = git(source, "for-each-ref")
    with pytest.raises(content.InvalidWorkspacePath, match="symlink"):
        checkpoint(runtime, handle, "bundle")
    assert git(source, "for-each-ref") == refs_before
    assert primary_state(source) == before


@pytest.mark.parametrize("user_overlay", ["file", "deleted"])
@pytest.mark.parametrize("agent_output", ["file", "directory"])
def test_overlay_preimage_cannot_remove_uncaptured_managed_subtree(
    setup, monkeypatch, user_overlay, agent_output
):
    source, store, runtime, _ = setup
    (source / "bundle/nested").mkdir(parents=True)
    (source / "bundle/nested/keep.txt").write_bytes(
        b"managed descendant absent from captured user overlay\n"
    )
    git(source, "add", "--", "bundle/nested/keep.txt")
    git(source, "commit", "-m", "fixture managed subtree before user overlay")
    shutil.rmtree(source / "bundle")
    if user_overlay == "file":
        (source / "bundle").write_bytes(b"user replaced managed directory\n")
    snapshot = capture(setup)
    assert not any(
        entry.path.startswith("bundle/")
        for entry in store.get_manifest(snapshot.revision_id).entries
    )
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    if user_overlay == "file":
        (handle.local_root / "bundle").unlink()
    changed_paths = ["bundle"]
    if agent_output == "file":
        (handle.local_root / "bundle").write_bytes(b"Agent replacement\n")
    else:
        (handle.local_root / "bundle").mkdir()
        (handle.local_root / "bundle/new.txt").write_bytes(b"Agent child\n")
        changed_paths.append("bundle/new.txt")
    before = primary_state(source)
    refs_before = git(source, "for-each-ref")

    def unexpected_write(*args):
        pytest.fail("unproven overlay preimage reached Git object import")

    monkeypatch.setattr(runtime.git, "raw_blob", unexpected_write)
    with pytest.raises(provider.GitMutationProvenanceError):
        checkpoint(runtime, handle, *changed_paths)
    assert git(source, "for-each-ref") == refs_before
    assert primary_state(source) == before


@pytest.mark.parametrize("replacement", ["delete", "file"])
def test_complete_subtree_removal_preserves_exact_descendant_receipts(
    setup, replacement
):
    source, _, runtime, _ = setup
    (source / "bundle/nested").mkdir(parents=True)
    (source / "bundle/nested/keep.txt").write_bytes(b"nested managed file\n")
    (source / "bundle/sibling.txt").write_bytes(b"managed sibling\n")
    git(source, "add", "--", "bundle")
    git(source, "commit", "-m", "fixture fully captured managed subtree")
    before = primary_state(source)
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    shutil.rmtree(handle.local_root / "bundle")
    if replacement == "file":
        (handle.local_root / "bundle").write_bytes(b"Agent replacement\n")
    paths = (
        "bundle",
        "bundle/nested",
        "bundle/nested/keep.txt",
        "bundle/sibling.txt",
    )
    provenance = {path: f"mutation:{path}" for path in paths}
    output = runtime.checkpoint(
        handle,
        assert_owner=lambda _: None,
        mutation_receipts=tuple(provenance.values()),
        path_provenance=provenance,
    )
    assert output.changed_paths == paths
    assert output.path_provenance == tuple(sorted(provenance.items()))
    assert output.overlay_preimage_commit is None
    delta = git(
        source,
        "diff-tree",
        "--no-commit-id",
        "--name-status",
        "-r",
        handle.input_commit,
        output.git_commit,
    ).decode()
    assert set(delta.splitlines()) == {
        "D\tbundle/nested/keep.txt",
        "D\tbundle/sibling.txt",
        *(["A\tbundle"] if replacement == "file" else []),
    }
    assert primary_state(source) == before


def test_captured_subtree_removal_requires_each_descendant_receipt(setup):
    source, _, runtime, _ = setup
    (source / "bundle").mkdir()
    (source / "bundle/keep.txt").write_bytes(b"captured managed descendant\n")
    git(source, "add", "--", "bundle")
    git(source, "commit", "-m", "fixture captured descendant without receipt")
    snapshot = capture(setup)
    handle = runtime.prepare(snapshot, owner=snapshot.owner, generation=1)
    shutil.rmtree(handle.local_root / "bundle")
    before = primary_state(source)
    refs_before = git(source, "for-each-ref")
    with pytest.raises(provider.GitMutationProvenanceError):
        checkpoint(runtime, handle, "bundle")
    assert git(source, "for-each-ref") == refs_before
    assert primary_state(source) == before
