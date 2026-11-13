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
"""Git commands that read every worktree never run while one is being added.

`git worktree add` writes a new worktree's metadata in several steps. A second
Git process that lists worktrees in between reads a half-written file and
exits with an error, which is what happened when two Sessions started in the
same Git-backed Space at the same moment.
"""

import shutil
import subprocess
import threading
from pathlib import Path

import pytest

from app.workspace_git import GitBackend, backend as backend_module

pytestmark = pytest.mark.unit


def _repository(path: Path) -> tuple[GitBackend, str]:
    backend = GitBackend()
    path.mkdir()
    backend.init_repository(path)
    anchor = backend.create_anchor_commit(path, message="Start")
    return backend, anchor


class _SlowWorktreeAdd:
    """Hold `git worktree add` at the point its metadata is half-written."""

    def __init__(self, monkeypatch, repository: Path, elsewhere: Path):
        self.half_written = threading.Event()
        self.finish = threading.Event()
        self.started_during_add = threading.Event()
        self._adding = False
        real_popen = subprocess.Popen

        # Every Git process starts here: `subprocess.run` calls `Popen` too.
        def popen(command, *args, **kwargs):
            arguments = tuple(str(value) for value in command)
            if (
                "worktree" in arguments
                and "add" in arguments
                and str(repository) in arguments
            ):
                # What another Git process sees mid-add: the new worktree's
                # folder and `gitdir` exist, and `commondir` is still empty.
                metadata = repository / ".git" / "worktrees" / "half-written"
                metadata.mkdir(parents=True)
                (metadata / "gitdir").write_text(
                    f"{elsewhere / '.git'}\n", encoding="utf-8"
                )
                (metadata / "commondir").write_bytes(b"")
                self._adding = True
                self.half_written.set()
                self.finish.wait(10)
                self._adding = False
                shutil.rmtree(metadata)
            elif self._adding:
                self.started_during_add.set()
            return real_popen(command, *args, **kwargs)

        monkeypatch.setattr(backend_module.subprocess, "Popen", popen)


def _in_thread(function):
    outcome: dict[str, object] = {}

    def target():
        try:
            outcome["value"] = function()
        except BaseException as error:  # noqa: BLE001 - reported by the test
            outcome["error"] = error

    thread = threading.Thread(target=target)
    thread.start()
    return thread, outcome


@pytest.mark.parametrize(
    "read",
    [
        "list",
        "list_from_linked_worktree",
        "search_every_branch",
        "history_of_every_branch",
        "branch_list",
    ],
)
def test_reading_every_worktree_waits_for_a_worktree_being_added(
    tmp_path: Path, monkeypatch, read: str
):
    repository = tmp_path / "repository"
    backend, anchor = _repository(repository)
    existing = tmp_path / "existing"
    backend.ensure_worktree(
        repository,
        worktree_path=existing,
        ref_name="refs/heads/eigent/existing",
        commit_oid=anchor,
    )
    slow = _SlowWorktreeAdd(monkeypatch, repository, tmp_path / "elsewhere")

    adding, added = _in_thread(
        lambda: backend.ensure_worktree(
            repository,
            worktree_path=tmp_path / "second",
            ref_name="refs/heads/eigent/second",
            commit_oid=anchor,
        )
    )
    assert slow.half_written.wait(10)
    readers = {
        "list": lambda: backend.list_worktrees(repository),
        "list_from_linked_worktree": lambda: backend.list_worktrees(existing),
        # `git log --all` walks every worktree's HEAD.
        "search_every_branch": lambda: backend.find_commit_by_operation(
            repository, "operation-1"
        ),
        # The same walk and a branch list, as the Git view runs them.
        "history_of_every_branch": lambda: backend.run_advanced_argv(
            repository, ("log", "--max-count=5", "--format=%H", "--all")
        ),
        "branch_list": lambda: backend.run_advanced_argv(
            repository, ("branch",)
        ),
    }
    reading, result = _in_thread(readers[read])
    # Git must not be asked to read every worktree while one is half-written.
    read_too_early = slow.started_during_add.wait(0.5)
    slow.finish.set()
    adding.join(10)
    reading.join(10)

    assert not read_too_early
    assert "error" not in added, added.get("error")
    assert "error" not in result, result.get("error")
    value = result["value"]
    if read in {"list", "list_from_linked_worktree"}:
        assert {item.path for item in value} >= {
            existing.resolve(),
            (tmp_path / "second").resolve(),
        }
    elif read == "search_every_branch":
        assert value is None
    else:
        assert value.returncode == 0, value.stderr


@pytest.mark.parametrize(
    "unaffected", ["another_repository", "command_that_reads_one_worktree"]
)
def test_other_git_commands_are_not_held_up(
    tmp_path: Path, monkeypatch, unaffected: str
):
    repository = tmp_path / "repository"
    backend, anchor = _repository(repository)
    other = tmp_path / "other"
    other_backend, _ = _repository(other)
    slow = _SlowWorktreeAdd(monkeypatch, repository, tmp_path / "elsewhere")

    adding, added = _in_thread(
        lambda: backend.ensure_worktree(
            repository,
            worktree_path=tmp_path / "second",
            ref_name="refs/heads/eigent/second",
            commit_oid=anchor,
        )
    )
    assert slow.half_written.wait(10)
    commands = {
        "another_repository": lambda: other_backend.list_worktrees(other),
        "command_that_reads_one_worktree": lambda: backend.ref_oid(
            repository, "refs/heads/eigent/second"
        ),
    }
    running, result = _in_thread(commands[unaffected])
    # It has to finish while the first repository's add is still held.
    running.join(5)
    finished_during_add = not running.is_alive()
    slow.finish.set()
    adding.join(10)
    running.join(10)

    assert finished_during_add
    assert "error" not in added, added.get("error")
    assert "error" not in result, result.get("error")
    if unaffected == "another_repository":
        assert [item.path for item in result["value"]] == [other.resolve()]
    else:
        assert result["value"] == anchor
