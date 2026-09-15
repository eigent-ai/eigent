"""Fallback manifest selection and partial-result boundaries."""

import os
from pathlib import Path

import pytest

from app import artifacts
from app.utils.file_utils import list_files
from app.utils.workspace_resolver import TaskSnapshot
from app.workspace_git import GitBackend
from app.workspace_git.backend import GitBackendError


def _snapshot(tmp_path):
    root = tmp_path / "workspace"
    output = tmp_path / "task-output"
    root.mkdir()
    output.mkdir()
    GitBackend().init_repository(root)
    return root, TaskSnapshot(
        task_id="fixture-run",
        project_id="fixture-project",
        space_id="fixture-space",
        user_id=None,
        working_directory=str(root),
        task_output_root=str(output),
        task_start_time=0,
        binding_source="space_local_brain",
        created_at="2026-01-01T00:00:00Z",
        workdir_mode="direct-write",
    )


@pytest.mark.parametrize("final_first", [True, False])
@pytest.mark.parametrize(
    "final_names",
    [("movie.mp4",), ("scene.blend",), ("movie.mp4", "scene.blend")],
)
@pytest.mark.parametrize("frame_count", [498, 499, 500, 720])
def test_native_walk_retains_deliverables_at_manifest_boundary(
    tmp_path, final_first, final_names, frame_count
):
    root, snapshot = _snapshot(tmp_path)
    for name in ("renders", "exports"):
        (root / name).mkdir()
    # Fill directories according to the observed filesystem order; os.walk
    # remains real, including its mutable directory pruning and Git boundary.
    order = [name for name in next(os.walk(root))[1] if name != ".git"]
    finals = root / order[0 if final_first else 1]
    frames = root / order[1 if final_first else 0]
    for index in range(frame_count):
        (frames / f"frame-{index:04}.png").write_bytes(b"fixture")
    for name in final_names:
        (finals / name).write_bytes(b"fixture")
    assert [name for name in next(os.walk(root))[1] if name != ".git"] == order

    result = artifacts.discover_task_changed_files(snapshot)

    found = {item["relativePath"] for item in result.artifacts}
    assert {f"{finals.name}/{name}" for name in final_names} <= found
    total = frame_count + len(final_names)
    assert len(result.artifacts) == min(total, 500)
    assert result.truncated is (total > 500)
    assert result.scan_status == ("partial" if total > 500 else "complete")
    assert {item["uploadPolicy"] for item in result.artifacts} == {
        "metadata_only"
    }
    assert {item["changeType"] for item in result.artifacts} == {"changed"}
    assert len(list(frames.iterdir())) == frame_count


@pytest.mark.parametrize("failure", ["timeout", "classification_error"])
def test_native_scan_keeps_verified_final_when_later_classification_fails(
    tmp_path, monkeypatch, failure
):
    root, snapshot = _snapshot(tmp_path)
    (root / "final.mp4").write_bytes(b"fixture")
    tail = root / "tail"
    tail.mkdir()
    (tail / "unverified.blend").write_bytes(b"fixture")
    clock = [0.0]
    monkeypatch.setattr(artifacts.time, "perf_counter", lambda: clock[0])
    original = GitBackend.ignored_paths
    verified = set()

    def classify(git, repository, paths):
        if "tail/unverified.blend" in paths:
            if failure == "timeout":
                clock[0] = artifacts.MAX_ARTIFACT_SCAN_SECONDS + 1
            raise GitBackendError("classification unavailable")
        ignored = original(git, repository, paths)
        verified.update(set(paths) - ignored)
        return ignored

    monkeypatch.setattr(GitBackend, "ignored_paths", classify)

    result = artifacts.discover_task_changed_files(snapshot)

    assert "final.mp4" in verified
    assert [item["relativePath"] for item in result.artifacts] == ["final.mp4"]
    assert result.truncated and result.scan_status == "partial"
    assert result.artifacts[0]["uploadPolicy"] == "metadata_only"


@pytest.mark.parametrize(
    "mutation",
    [None, "outside_link", "inside_link", "removed", "outside_window"],
)
def test_expired_scan_keeps_only_verified_files_still_in_scope(
    tmp_path, monkeypatch, mutation
):
    root, snapshot = _snapshot(tmp_path)
    final = root / "final.mp4"
    final.write_bytes(b"fixture")
    clock = [0.0]
    monkeypatch.setattr(artifacts.time, "perf_counter", lambda: clock[0])
    verified = []

    def scan(directory, **kwargs):
        values = list_files(directory, **kwargs)
        if Path(directory) == root:
            assert str(final) in values
            verified.extend(values)
            unverified = root / "unverified.blend"
            unverified.write_bytes(b"not classified")
            if mutation == "outside_window":
                os.utime(final, (0, 0))
            elif mutation is not None:
                final.unlink()
                if mutation == "outside_link":
                    outside = tmp_path / "outside.mp4"
                    outside.write_bytes(b"outside scope")
                    final.symlink_to(outside)
                elif mutation == "inside_link":
                    final.symlink_to(unverified)
            # Exercise partial handoff after the real scanner has returned.
            clock[0] = artifacts.MAX_ARTIFACT_SCAN_SECONDS + 1
            kwargs["stats"]["scan_limited"] = 1
            return [*values, str(unverified)]
        return values

    result = artifacts.discover_task_changed_files(
        snapshot, modification_windows=((1, None),), list_files_fn=scan
    )

    assert str(final) in verified
    assert [item["relativePath"] for item in result.artifacts] == (
        ["final.mp4"] if mutation is None else []
    )
    assert result.truncated and result.scan_status == "partial"


def test_entry_budget_retains_verified_final(tmp_path, monkeypatch):
    root, snapshot = _snapshot(tmp_path)
    (root / "final.mp4").write_bytes(b"fixture")
    (root / "tail").mkdir()
    (root / "tail" / "unvisited.blend").write_bytes(b"fixture")
    # The empty output root and the pruned .git directory also count.
    monkeypatch.setattr(artifacts, "MAX_ARTIFACT_SCAN_ENTRIES", 6)

    result = artifacts.discover_task_changed_files(snapshot)

    assert [item["relativePath"] for item in result.artifacts] == ["final.mp4"]
    assert result.truncated and result.scan_status == "partial"


def test_timeout_in_later_batch_keeps_completed_batch(tmp_path, monkeypatch):
    root, snapshot = _snapshot(tmp_path)
    for index in range(501):
        (root / f"output-{index:04}.mp4").write_bytes(b"fixture")
    order = next(os.walk(root))[2]
    clock = [0.0]
    monkeypatch.setattr(artifacts.time, "perf_counter", lambda: clock[0])
    original = GitBackend.ignored_paths
    verified = set()

    def classify(git, repository, paths):
        if order[-1] in paths:
            clock[0] = artifacts.MAX_ARTIFACT_SCAN_SECONDS + 1
            raise GitBackendError("classification timed out")
        ignored = original(git, repository, paths)
        verified.update(set(paths) - ignored)
        return ignored

    monkeypatch.setattr(GitBackend, "ignored_paths", classify)

    result = artifacts.discover_task_changed_files(snapshot)

    assert verified == set(order[:500])
    assert {item["relativePath"] for item in result.artifacts} == verified
    assert result.truncated and result.scan_status == "partial"
