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

"""R16: revalidate Git discovery dependencies without Git on the event loop."""

import asyncio
import threading
from pathlib import Path

import pytest

from app.workspace_runtime.service import AdmissionError
from tests.app.workspace_runtime import (
    test_git_provider as gp,
    test_registration as reg,
)

deployment = reg.deployment
INVALID = (
    "head_missing",
    "head_empty",
    "head_invalid",
    "head_directory",
    "head_unreadable",
    "head_relative_link",
    "head_absolute_link",
    "objects_missing",
    "objects_unsearchable",
    "refs_missing",
    "refs_unsearchable",
    "config_invalid",
    "config_format",
    "config_extension",
    "worktree_config_invalid",
    "include_invalid",
    "missing_include_created",
)
VALID = ("commit", "branch", "unborn", "detached", "legacy_head")


def prepare_change(root, change):
    directory = Path(
        gp.git(root, "rev-parse", "--absolute-git-dir").decode().strip()
    )
    common = Path(
        gp.git(root, "rev-parse", "--path-format=absolute", "--git-common-dir")
        .decode()
        .strip()
    )
    head = directory / "HEAD"
    target = None
    if change in {"head_relative_link", "head_absolute_link"}:
        # This ordinary file exists before the complete worker check. Git
        # rejects HEAD links to it even though its content resembles an OID.
        target = directory / "synthetic-head-file"
        target.write_text("1" * 40 + "\n")
    elif change.startswith("worktree_config"):
        gp.git(root, "config", "extensions.worktreeConfig", "true")
        target = directory / "config.worktree"
        target.write_text("# synthetic worktree config\n")
    elif change in {"include_invalid", "missing_include_created"}:
        parent = common / "include directory"
        parent.mkdir()
        included = parent / "parent config"
        target = parent / "leaf config"
        included.write_text('[include]\npath = "leaf config"\n')
        gp.git(root, "config", "include.path", str(included))
        if change == "include_invalid":
            target.write_text("# synthetic initially valid leaf\n")

    def mutate():
        if change == "head_missing":
            head.unlink()
        elif change in {"head_empty", "head_invalid"}:
            head.write_bytes(b"" if change == "head_empty" else b"not a ref\n")
        elif change == "head_directory":
            head.unlink()
            head.mkdir()
        elif change == "head_unreadable":
            head.chmod(0)
        elif change in {"head_relative_link", "head_absolute_link"}:
            head.unlink()
            head.symlink_to(
                target.name if change == "head_relative_link" else target
            )
        elif change.endswith("_missing"):
            name = change.removesuffix("_missing")
            (common / name).rename(common / (name + ".previous"))
        elif change.endswith("_unsearchable"):
            (common / change.removesuffix("_unsearchable")).chmod(0)
        elif change == "config_invalid":
            (common / "config").write_text("[malformed\n")
        elif change == "config_format":
            with (common / "config").open("a") as stream:
                stream.write("\n[core]\nrepositoryformatversion = 99\n")
        elif change == "config_extension":
            with (common / "config").open("a") as stream:
                stream.write(
                    "\n[core]\nrepositoryformatversion = 1\n"
                    "[extensions]\nsyntheticUnknown = true\n"
                )
        elif target is not None:
            target.write_text("[malformed\n")
        elif change == "commit":
            (root / "new.txt").write_text("synthetic ordinary file\n")
            gp.git(root, "add", "--", "new.txt")
            gp.git(root, "commit", "-m", "ordinary update")
            gp.git(root, "update-ref", "refs/test/ordinary", "HEAD")
        elif change == "branch":
            gp.git(root, "checkout", "-b", "next-branch")
        elif change == "unborn":
            gp.git(root, "symbolic-ref", "HEAD", "refs/heads/new-unborn")
        elif change == "detached":
            gp.git(root, "checkout", "--detach", "HEAD")
        elif change == "legacy_head":
            head.unlink()
            head.symlink_to("refs/heads/main")
        else:
            raise AssertionError(change)

    def cleanup():
        if change == "head_unreadable":
            head.chmod(0o644)
        elif change.endswith("_unsearchable"):
            (common / change.removesuffix("_unsearchable")).chmod(0o755)

    return mutate, cleanup


@pytest.mark.parametrize("linked", [False, True])
@pytest.mark.parametrize("change", INVALID + VALID)
def test_repository_discovery_state_tracks_validity(tmp_path, linked, change):
    source, store, runtime, _ = gp.build(tmp_path)
    if linked:
        root = tmp_path / "linked"
        gp.git(source, "worktree", "add", str(root), "-b", "linked-branch")
        runtime = gp.provider.GitWorkspaceProvider(
            store, tmp_path / "linked-private", repository_root=root
        )
    else:
        root = source
    mutate, cleanup = prepare_change(root, change)
    before = runtime.capture_authorization_state()
    assert runtime._repository_identity() == runtime.repository_identity
    try:
        mutate()
        if change in VALID:
            assert runtime.authorization_state_current(before)
            assert (
                runtime._repository_identity() == runtime.repository_identity
            )
        else:
            with pytest.raises(gp.backend.GitBackendError):
                runtime._repository_identity()
            try:
                current = runtime.authorization_state_current(before)
            except (OSError, gp.directory.SourceChangedError):
                current = False
            assert current is False
    finally:
        cleanup()


def test_conditional_include_selection_is_fenced_across_branch_switch(
    tmp_path,
):
    source, _, runtime, _ = gp.build(tmp_path)
    common = source / ".git"
    included = common / "branch-config"
    included.write_text("[malformed\n")
    gp.git(source, "config", "includeIf.onbranch:next.path", str(included))
    before = runtime.capture_authorization_state()
    assert runtime._repository_identity() == runtime.repository_identity
    # The file was already malformed but inactive at the complete worker check.
    # A different HEAD branch makes it a newly selected configuration source.
    (common / "HEAD").write_text("ref: refs/heads/next\n")
    assert runtime.authorization_state_current(before) is False
    with pytest.raises(gp.backend.GitBackendError):
        runtime._repository_identity()


def test_include_edit_during_discovery_cannot_hide_new_dependency(
    tmp_path, monkeypatch
):
    source, _, runtime, _ = gp.build(tmp_path)
    included = source / ".git" / "included"
    included.write_text("# initially no child\n")
    gp.git(source, "config", "include.path", str(included))
    child = source / ".git" / "child"
    child.write_text("# synthetic child\n")
    original = runtime._authorization_includes
    calls = 0

    def edited_after_discovery():
        nonlocal calls
        result = original()
        calls += 1
        if calls == 1:
            included.write_text('[include]\npath = "child"\n')
        return result

    monkeypatch.setattr(
        runtime, "_authorization_includes", edited_after_discovery
    )
    with pytest.raises(gp.directory.SourceChangedError):
        runtime.capture_authorization_state()
    assert calls == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["api", "local"])
@pytest.mark.parametrize("change", INVALID + VALID)
async def test_completed_worker_revalidates_git_dependencies(
    deployment, monkeypatch, path, change
):
    d = deployment
    d.project("a", git=True)
    root = Path(d.projects["a"]["space_root"])
    gp.git(root, "commit", "--allow-empty", "-m", "synthetic base")
    mutate, cleanup = prepare_change(root, change)
    envelope = await d.register("a")
    entry = d.registration.registered[envelope["configuration_revision"]]
    request_id = "git-continuation-" + change
    request = None
    if path == "local":
        await d.submit("a", request_id, envelope)
        request = d.service.admission.get(request_id)
    loop = asyncio.get_running_loop()
    entered, release = asyncio.Event(), threading.Event()
    target = d.service.policies if path == "api" else d.service
    method = "require" if path == "api" else "_policy"
    original = getattr(target, method)
    git_run = entry.provider.git._run

    def worker_git(*args, **kwargs):
        assert threading.current_thread() is not threading.main_thread()
        return git_run(*args, **kwargs)

    def complete(*args, **kwargs):
        result = original(*args, **kwargs)
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(8), "test did not release completed worker"
        return result

    monkeypatch.setattr(entry.provider.git, "_run", worker_git)
    monkeypatch.setattr(target, method, complete)
    pending = asyncio.create_task(
        d.client.post(
            "/projects/a/executions",
            json={
                "request_id": request_id,
                "kind": "start",
                "envelope": {**envelope, "prompt": "synthetic request"},
            },
        )
        if path == "api"
        else d.service._policy_local_async(request)
    )
    try:
        await asyncio.wait_for(entered.wait(), 3)
        mutate()
        release.set()
        if path == "local" and change in INVALID:
            with pytest.raises(AdmissionError):
                await asyncio.wait_for(pending, 3)
        else:
            result = await asyncio.wait_for(pending, 3)
            if path == "local":
                assert result is entry.policy
            elif change in INVALID:
                assert result.status_code in (403, 503), result.text
                assert d.service.admission.get(request_id) is None
            else:
                assert result.status_code == 202, result.text
                assert d.service.admission.get(request_id).status == "pending"
    finally:
        release.set()
        await asyncio.gather(pending, return_exceptions=True)
        cleanup()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    [
        "head_missing",
        "refs_missing",
        "include_invalid",
        "head_relative_link",
        "head_absolute_link",
        "legacy_head",
    ],
)
async def test_admission_transaction_rechecks_git_dependencies(
    deployment, monkeypatch, change
):
    d = deployment
    d.project("a", git=True)
    root = Path(d.projects["a"]["space_root"])
    mutate, cleanup = prepare_change(root, change)
    envelope = await d.register("a")
    original = d.service.policies.require_authorization_async

    async def after_continuation(*args, **kwargs):
        receipt = await original(*args, **kwargs)
        mutate()
        return receipt

    monkeypatch.setattr(
        d.service.policies, "require_authorization_async", after_continuation
    )
    try:
        result = await d.client.post(
            "/projects/a/executions",
            json={
                "request_id": "git-commit-boundary",
                "kind": "start",
                "envelope": {**envelope, "prompt": "synthetic request"},
            },
        )
        stored = d.service.admission.get("git-commit-boundary")
        if change in VALID:
            assert result.status_code == 202, result.text
            assert stored.status == "pending"
        else:
            assert result.status_code in (403, 503), result.text
            assert stored is None
    finally:
        cleanup()
