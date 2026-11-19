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

"""Real temporary CAS/SQLite/Git preparation retirement; no app or accounts."""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import replace

import pytest

from app.run_journal import SQLiteRunJournal
from app.workspace_git.backend import GitBackendError
from app.workspace_runtime.admission import AdmissionStore
from app.workspace_runtime.content import ContentStore
from app.workspace_runtime.git_provider import GitWorkspaceProvider
from app.workspace_runtime.preparation import PreparationResources
from app.workspace_runtime.provider import (
    DirectoryWorkspaceProvider,
    SourceFence,
)
from app.workspace_runtime.store import (
    WorkspaceStateError,
    WorkspaceStateStore,
)


def git(root, *args):
    return subprocess.run(
        [
            "/usr/bin/git",
            "-c",
            "core.hooksPath=/dev/null",
            "-C",
            str(root),
            *args,
        ],
        check=True,
        capture_output=True,
        text=True,
        env={
            "PATH": "/usr/bin:/bin",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_AUTHOR_NAME": "fixture",
            "GIT_AUTHOR_EMAIL": "fixture@invalid",
            "GIT_COMMITTER_NAME": "fixture",
            "GIT_COMMITTER_EMAIL": "fixture@invalid",
        },
    ).stdout.strip()


class World:
    def __init__(self, root, *, use_git=False, dirty=False):
        self.source = root / "source"
        self.source.mkdir()
        (self.source / "a.txt").write_text("a\n")
        (self.source / "nested").mkdir()
        (self.source / "nested/b.txt").write_text("b\n")
        if use_git:
            git(self.source, "init", "--initial-branch=main")
            git(self.source, "add", ".")
            git(self.source, "commit", "-m", "fixture")
            if dirty:
                (self.source / "overlay.txt").write_text("private input\n")
        self.journal = SQLiteRunJournal(root / "journal.sqlite")
        self.state = WorkspaceStateStore(self.journal)
        self.admission = AdmissionStore(self.journal)
        self.store = ContentStore(root / "cas")
        provider = (
            GitWorkspaceProvider if use_git else DirectoryWorkspaceProvider
        )
        self.provider = provider(
            self.store,
            root / "workspaces",
            retention=self.state,
            **({"repository_root": self.source} if use_git else {}),
        )
        self.target = self.state.register_target(self.source)
        fence = SourceFence(
            self.target.target_id,
            self.target.physical_identity,
            self.target.write_epoch,
            self.target.settled_revision,
            binding_version=self.target.binding_version,
        )
        self.admission.submit(
            request_id="request",
            project_id="project",
            kind="start",
            envelope={
                "space_id": "space",
                "project_id": "project",
                "prompt": "fixture",
                "model_platform": "fixture",
                "model_type": "fixture",
                "session_mode": "single-agent",
                "workspace_policy_version": "v1",
                "configuration_revision": "config:1",
                "credential_ref": "credential:1",
                "permission_profile_revision": "permission:1",
                "principal_ref": "principal:1",
            },
        )
        self.claim = self.admission.claim("request", owner_id="dispatcher")
        self.resources = PreparationResources(
            attempt_id="attempt",
            request_id="request",
            generation=self.claim.generation,
            state=self.state,
            provider=self.provider,
        )
        self.snapshot = self.provider.capture_source(
            self.source,
            owner="attempt",
            read_fence=lambda: fence,
        )
        self.state.retain(
            self.snapshot.revision_id, self.resources.reference_owner
        )

    def prepare(self):
        def assert_owner(owner, generation):
            assert (owner, generation) == ("attempt", self.claim.generation)
            with self.journal._lock:
                self.admission.require_claim_in_transaction(
                    self.journal._connection, self.claim
                )

        return self.resources.prepare(self.snapshot, assert_owner=assert_owner)

    def retire(self):
        self.admission.release(
            self.claim, wait_reason="preparation_cleanup_required"
        )

    def references(self):
        with self.journal._lock:
            return [
                tuple(row)
                for row in self.journal._connection.execute(
                    "SELECT revision,owner FROM workspace_revision_references ORDER BY owner,revision"
                )
            ]

    def handoff(self):
        handle = self.resources.workspace

        def prepare(connection, request, claim):
            connection.execute(
                """INSERT INTO runs (run_id,project_id,status,version,active_attempt_id,
                deadline_at,timeout_policy_version,created_at,updated_at)
                VALUES ('request','project','pending',0,NULL,NULL,'v1',1,1)"""
            )
            attempt = self.journal._create_run_attempt_in_transaction(
                connection,
                "request",
                request_id=request.request_id,
                reason="initial_execution",
                attempt_id="attempt",
                admission_claim=(claim.request_id, claim.generation),
                now=1,
            )
            self.state.bind_run_in_transaction(
                connection,
                run_id="request",
                attempt_id=attempt.attempt_id,
                generation=claim.generation,
                workspace_id=handle.workspace_id,
                provider=handle.provider,
                snapshot_revision=handle.input_revision,
                root_path=str(handle.local_root),
                target=self.target,
                policy_version="v1",
            )
            return attempt

        return self.admission.handoff(self.claim, prepare_attempt=prepare)


@pytest.fixture
def world(tmp_path):
    result = World(tmp_path)
    yield result
    result.journal.close()


def test_capture_or_compose_failure_releases_only_own_preparation_refs(world):
    world.state.retain(world.snapshot.revision_id, "another-owner")
    world.state.retain("composed-input", world.resources.reference_owner)
    world.retire()
    assert world.resources.abort()
    assert world.references() == [
        (world.snapshot.revision_id, "another-owner")
    ]
    assert world.store.get_manifest(world.snapshot.revision_id)


def test_directory_retirement_requires_released_claim_and_is_idempotent(world):
    handle = world.prepare()
    assert not world.resources.abort()
    assert handle.local_root.exists()
    world.retire()
    assert world.resources.abort()
    assert world.resources.abort()
    assert not handle.local_root.exists()
    assert not world.provider._marker(handle).exists()
    assert world.references() == []
    assert (world.source / "a.txt").read_text() == "a\n"


def test_cancelled_claim_can_cleanup_and_new_generation_is_not_affected(world):
    handle = world.prepare()
    world.retire()
    later = world.admission.claim("request", owner_id="later-dispatcher")
    assert later.generation > world.claim.generation
    world.state.retain(world.snapshot.revision_id, "preparation:later-attempt")
    assert world.resources.abort()
    assert not handle.local_root.exists()
    with world.journal._lock:
        world.admission.require_claim_in_transaction(
            world.journal._connection, later
        )
    assert world.references() == [
        (world.snapshot.revision_id, "preparation:later-attempt")
    ]


@pytest.mark.parametrize(
    "change",
    [
        "modified",
        "extra",
        "excluded",
        "symlink",
        "hardlink",
        "replace",
        "marker",
        "generation",
        "owner",
    ],
)
def test_changed_unknown_or_mismatched_directory_is_preserved(
    world, tmp_path, change
):
    handle = world.prepare()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "valuable").write_text("preserve")
    if change == "modified":
        (handle.local_root / "a.txt").write_text("changed")
    elif change == "extra":
        (handle.local_root / "new.txt").write_text("unknown")
    elif change == "excluded":
        (handle.local_root / ".git").mkdir()
    elif change == "symlink":
        (handle.local_root / "new-link").symlink_to(
            outside, target_is_directory=True
        )
    elif change == "hardlink":
        os.link(handle.local_root / "a.txt", outside / "alias")
    elif change == "replace":
        old = handle.local_root.with_name("old-private")
        handle.local_root.rename(old)
        shutil.copytree(old, handle.local_root)
    elif change == "marker":
        world.provider._marker(handle).write_text("unknown-owner")
    elif change == "generation":
        world.resources.workspace = replace(handle, generation=2)
    elif change == "owner":
        world.resources.workspace = replace(handle, owner="someone-else")
    world.retire()
    assert not world.resources.abort()
    assert handle.local_root.exists()
    assert (handle.local_root / "nested/b.txt").read_text() == "b\n"
    assert (outside / "valuable").read_text() == "preserve"
    assert world.references()


def test_partial_prepare_without_returned_handle_is_never_guessed(
    world, monkeypatch
):
    evidence = world.provider.workspace_root / "partial-evidence"

    def fail(*args, **kwargs):
        evidence.mkdir()
        (evidence / "bytes").write_text("preserve")
        raise OSError("fixture preparation interrupted")

    monkeypatch.setattr(world.provider, "prepare", fail)
    with pytest.raises(OSError):
        world.prepare()
    world.retire()
    assert not world.resources.abort()
    assert (evidence / "bytes").read_text() == "preserve"
    assert world.references()


def test_reconstructed_helper_cannot_release_an_old_preparation(world):
    handle = world.prepare()
    world.retire()
    with pytest.raises(WorkspaceStateError, match="explicit recovery"):
        PreparationResources(
            attempt_id="attempt",
            request_id="request",
            generation=world.claim.generation,
            state=world.state,
            provider=world.provider,
        )
    assert handle.local_root.exists()
    assert world.references()


def test_handoff_preserves_run_input_and_refuses_cleanup_of_admitted_owner(
    world,
):
    handle = world.prepare()
    world.state.retain("source-lineage", world.resources.reference_owner)
    world.handoff()
    assert not world.resources.abort()
    world.resources.handoff_completed()
    world.resources.handoff_completed()
    assert world.references() == [
        (world.snapshot.revision_id, "run:request:input")
    ]
    assert not world.resources.abort()
    assert handle.local_root.exists()


def test_handoff_ref_release_requires_exact_binding_and_run_retention(world):
    world.prepare()
    with pytest.raises(WorkspaceStateError):
        world.resources.handoff_completed()
    world.handoff()
    world.state.release(world.snapshot.revision_id, "run:request:input")
    with pytest.raises(WorkspaceStateError):
        world.resources.handoff_completed()
    assert world.references() == [
        (world.snapshot.revision_id, world.resources.reference_owner)
    ]


@pytest.mark.parametrize("dirty", [False, True])
def test_git_cleanup_uses_ordinary_removal_and_preserves_dirty_overlay(
    tmp_path, dirty
):
    world = World(tmp_path, use_git=True, dirty=dirty)
    try:
        before = {
            name: (world.source / ".git" / name).read_bytes()
            for name in ("HEAD", "index", "refs/heads/main")
        }
        handle = world.prepare()
        world.retire()
        assert world.resources.abort() is (not dirty)
        assert handle.local_root.exists() is dirty
        assert bool(world.references()) is dirty
        assert (
            world.provider.git.ref_oid(world.source, handle.git_ref)
            is not None
        ) is dirty
        assert {
            name: (world.source / ".git" / name).read_bytes()
            for name in before
        } == before
        assert world.store.get_manifest(handle.input_revision)
        if dirty:
            assert (
                handle.local_root / "overlay.txt"
            ).read_text() == "private input\n"
        else:
            assert all(
                item.path != handle.local_root
                for item in world.provider.git.list_worktrees(world.source)
            )
    finally:
        world.journal.close()


def test_git_cleanup_never_executes_repository_filters(tmp_path):
    world = World(tmp_path, use_git=True)
    try:
        marker = tmp_path / "filter-executed"
        git(
            world.source,
            "config",
            "filter.fixture.clean",
            "touch " + str(marker),
        )
        handle = world.prepare()
        world.retire()
        assert not world.resources.abort()
        assert not marker.exists()
        assert handle.local_root.exists()
        assert world.references()
    finally:
        world.journal.close()


def test_git_partial_registration_is_retained_without_force_removal(
    tmp_path, monkeypatch
):
    world = World(tmp_path, use_git=True)
    try:
        original = world.provider.git.plumbing

        def fail(root, args, **kwargs):
            if args[0] == "read-tree":
                raise GitBackendError("injected private index failure")
            return original(root, args, **kwargs)

        monkeypatch.setattr(world.provider.git, "plumbing", fail)
        with pytest.raises(GitBackendError):
            world.prepare()
        world.retire()
        assert not world.resources.abort()
        assert world.references()
        registered = [
            item
            for item in world.provider.git.list_worktrees(world.source)
            if item.path != world.source
        ]
        assert len(registered) == 1
        assert (registered[0].path / "a.txt").read_text() == "a\n"
        assert world.provider.git.ref_oid(world.source, registered[0].ref_name)
    finally:
        world.journal.close()
