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

import subprocess

from app.artifacts import (
    _artifact_path_filter,
    _artifact_upload_policy,
    _ArtifactRoot,
)
from app.recording import runtime
from app.recording.models import RecordingScope
from app.recording.service import RecordingService
from app.recording.store import RecordingStore
from app.workspace_git.path_policy import WorkspacePathPolicy


def test_scratch_capture_is_excluded_before_bytes_exist_and_never_uploaded(
    tmp_path, monkeypatch
):
    root = tmp_path / "scratch"
    root.mkdir()
    scope = RecordingScope(
        "local", "owner", "space", "project", "task", "run", None, root, "v1"
    )
    catalog = tmp_path / "recordings.sqlite3"
    monkeypatch.setattr(runtime, "catalog_path", lambda: catalog)
    service = RecordingService(
        RecordingStore(catalog),
        scope_resolver=lambda *args: scope,
        binding_check=lambda row: True,
    )
    spool = tmp_path / "spool"
    spool.mkdir()
    service.register("desktop", str(spool))
    grant = service.authorize("run", "local")["grant_id"]
    record = service.start("run", "local", grant, "one")
    reserved = record["directory"] + "/clip_001.mp4"
    assert WorkspacePathPolicy(root).is_operational(reserved)
    path = root / reserved
    path.parent.mkdir(parents=True)
    path.write_bytes(b"private captured pixels")
    ordinary = root / "recordings" / "user-film.mp4"
    ordinary.write_bytes(b"ordinary video")
    artifact_root = _ArtifactRoot(
        path=root, scan_all=False, upload_policy="agent_generated"
    )
    assert _artifact_upload_policy(artifact_root, reserved) == "metadata_only"
    assert (
        _artifact_upload_policy(artifact_root, "recordings/user-film.mp4")
        == "agent_generated"
    )
    included = _artifact_path_filter(root)((str(path), str(ordinary)))
    assert str(path) not in included
    assert str(ordinary) in included


def test_tracked_capture_content_keeps_checkpoint_contract(
    tmp_path, monkeypatch
):
    # Path policy marks operational paths; Git's tracked-content override must
    # still win, just as it does for tracked files in node_modules and .venv.
    from app.workspace_git.backend import GitBackend

    root = tmp_path / "repo"
    root.mkdir()
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    catalog = tmp_path / "catalog.sqlite3"
    monkeypatch.setattr(runtime, "catalog_path", lambda: catalog)
    scope = RecordingScope(
        "local", "owner", "space", "project", "task", "run", None, root, "v1"
    )
    service = RecordingService(
        RecordingStore(catalog),
        scope_resolver=lambda *args: scope,
        binding_check=lambda row: True,
    )
    spool = tmp_path / "spool"
    spool.mkdir()
    service.register("desktop", str(spool))
    grant = service.authorize("run", "local")["grant_id"]
    row = service.start("run", "local", grant, "capture")
    ordinary = root / row["directory"] / "clip_001.mp4"
    ordinary.parent.mkdir(parents=True)
    ordinary.write_bytes(b"tracked")
    subprocess.run(
        ["git", "-C", str(root), "add", ordinary.relative_to(root).as_posix()],
        check=True,
    )
    assert WorkspacePathPolicy(root).is_operational(
        ordinary.relative_to(root).as_posix()
    )
    assert GitBackend().is_tracked(root, ordinary)
    assert str(ordinary) in _artifact_path_filter(root)((str(ordinary),))


def test_managed_snapshot_port_excludes_only_reserved_media(
    tmp_path, monkeypatch
):
    from app.recording.policy import managed_capture_exclusion
    from app.workspace_runtime.content import ContentStore
    from app.workspace_runtime.provider import DirectoryWorkspaceProvider

    root = tmp_path / "space"
    root.mkdir()
    catalog = tmp_path / "catalog.sqlite3"
    monkeypatch.setattr(runtime, "catalog_path", lambda: catalog)
    scope = RecordingScope(
        "local", "owner", "space", "project", "task", "run", None, root, "v1"
    )
    service = RecordingService(
        RecordingStore(catalog),
        scope_resolver=lambda *args: scope,
        binding_check=lambda row: True,
    )
    spool = tmp_path / "spool"
    spool.mkdir()
    service.register("desktop", str(spool))
    grant = service.authorize("run", "local")["grant_id"]
    row = service.start("run", "local", grant, "recording")
    private = root / row["directory"] / "clip_001.mp4"
    private.parent.mkdir(parents=True)
    private.write_bytes(b"private pixels")
    ordinary = root / "recordings" / "manual.mp4"
    ordinary.write_bytes(b"ordinary content")
    provider = DirectoryWorkspaceProvider(
        ContentStore(tmp_path / "objects"),
        tmp_path / "workspaces",
        exclude_path=managed_capture_exclusion(root),
    )
    entries, _, coverage = provider._scan(root, save_objects=False)
    paths = {entry.path for entry in entries}
    assert private.relative_to(root).as_posix() not in paths
    assert "recordings/manual.mp4" in paths
    assert row["directory"] in coverage


def test_scratch_recording_during_mutation_window_is_not_in_manifest_or_uploads(
    tmp_path, monkeypatch
):
    import os
    from types import SimpleNamespace

    from app import artifacts
    from app.run_journal import SQLiteRunJournal

    eigent_root = tmp_path / "eigent"
    root = eigent_root / "user_42" / "space_alpha"
    root.mkdir(parents=True)
    catalog = tmp_path / "catalog.sqlite3"
    monkeypatch.setattr(runtime, "catalog_path", lambda: catalog)
    monkeypatch.setattr(artifacts, "get_eigent_root", lambda: eigent_root)
    scope = RecordingScope(
        "local",
        "user_42",
        "space_alpha",
        "session",
        "task",
        "run",
        None,
        root,
        "v1",
        user_id="42",
    )
    service = RecordingService(
        RecordingStore(catalog),
        scope_resolver=lambda *args: scope,
        binding_check=lambda row: True,
    )
    spool = tmp_path / "spool"
    spool.mkdir()
    service.register("desktop", str(spool))
    grant = service.authorize("run", "local")["grant_id"]
    row = service.start("run", "local", grant, "capture")
    clip = root / row["directory"] / "clip_001.mp4"
    clip.parent.mkdir(parents=True)
    clip.write_bytes(b"private capture")
    ordinary = root / "recordings" / "manual.mp4"
    ordinary.write_bytes(b"user video")
    for path in (clip, ordinary):
        os.utime(path, (30, 30))
    output = tmp_path / "task-output"
    output.mkdir()
    snapshot = SimpleNamespace(
        task_id="run",
        project_id="session",
        space_id="space_alpha",
        user_id="42",
        task_output_root=str(output),
        working_directory=str(root),
        task_start_time=20,
        artifact_manifest=None,
    )
    policy = artifacts._working_root_upload_policy(
        snapshot, email="owner@example.test", user_id="42"
    )
    assert policy == "agent_generated"
    result = artifacts.discover_task_changed_files(
        snapshot,
        modification_windows=((20, 40),),
        working_root_upload_policy=policy,
    )
    assert row["directory"] + "/clip_001.mp4" not in {
        item["relativePath"] for item in result.artifacts
    }
    assert "recordings/manual.mp4" in {
        item["relativePath"] for item in result.artifacts
    }
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(run_id="run", project_id="session")
    artifacts.record_artifact_manifest(
        journal, run_id="run", project_id="session", artifacts=result.artifacts
    )
    from app.run_journal.models import RunEventDraft

    journal.append_event(
        "run", RunEventDraft(event_type="run.completed", payload={})
    )
    uploads = journal.claim_ready_artifact_uploads(now=float("inf"))
    assert [item.filename for item in uploads] == ["manual.mp4"]
    journal.close()
