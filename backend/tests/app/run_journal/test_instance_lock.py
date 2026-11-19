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
"""Only one process owns a RunJournal file at a time."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.run_journal import instance_lock
from app.run_journal.instance_lock import (
    acquire_journal_instance_lock,
    holds_journal_instance_lock,
    instance_lock_path,
    journal_instance_owner_pid,
    release_journal_instance_locks,
)
from app.run_journal.store import SQLiteRunJournal

BACKEND = Path(__file__).resolve().parents[3]

_TRY_FROM_ANOTHER_PROCESS = """
import sys
from pathlib import Path
from app.run_journal.instance_lock import acquire_journal_instance_lock
print(acquire_journal_instance_lock(Path(sys.argv[1])))
"""

_RECONCILE_IF_OWNER = """
import sys
from pathlib import Path
from app.run_journal.instance_lock import acquire_journal_instance_lock
from app.run_journal.store import SQLiteRunJournal
path = Path(sys.argv[1])
if acquire_journal_instance_lock(path):
    journal = SQLiteRunJournal(path)
    print("reconciled", len(journal.reconcile_startup().interrupted_run_ids))
    journal.close()
else:
    print("not owner")
"""


@pytest.fixture(autouse=True)
def release_after_test():
    yield
    release_journal_instance_locks()


def _other_process(script: str, journal_path: Path) -> str:
    env = {**os.environ, "PYTHONPATH": str(BACKEND)}
    result = subprocess.run(
        [sys.executable, "-c", script, str(journal_path)],
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip().splitlines()[-1]


def test_first_process_owns_the_journal(tmp_path):
    journal_path = tmp_path / "run-journal.sqlite3"

    assert acquire_journal_instance_lock(journal_path)

    assert holds_journal_instance_lock(journal_path)
    assert instance_lock_path(journal_path).name == "run-journal.sqlite3.lock"
    assert journal_instance_owner_pid(journal_path) == os.getpid()
    # Asking again in the owning process is not a conflict.
    assert acquire_journal_instance_lock(journal_path)


def test_a_second_process_cannot_own_the_same_journal(tmp_path):
    journal_path = tmp_path / "run-journal.sqlite3"
    assert acquire_journal_instance_lock(journal_path)

    assert _other_process(_TRY_FROM_ANOTHER_PROCESS, journal_path) == "False"

    release_journal_instance_locks()
    assert not holds_journal_instance_lock(journal_path)
    assert _other_process(_TRY_FROM_ANOTHER_PROCESS, journal_path) == "True"


def test_another_journal_is_independent(tmp_path):
    assert acquire_journal_instance_lock(tmp_path / "a.sqlite3")
    assert (
        _other_process(_TRY_FROM_ANOTHER_PROCESS, tmp_path / "b.sqlite3")
        == "True"
    )


def test_a_second_brain_does_not_interrupt_the_owners_running_task(tmp_path):
    """The reason the lock exists: startup reconciliation is not owner-aware."""

    journal_path = tmp_path / "run-journal.sqlite3"
    assert acquire_journal_instance_lock(journal_path)
    with SQLiteRunJournal(journal_path) as journal:
        journal.ensure_run(
            run_id="run-live", project_id="proj-1", status="running"
        )

        assert _other_process(_RECONCILE_IF_OWNER, journal_path) == "not owner"

        assert journal.get_run("run-live").status == "running"


def test_waiting_gives_up_after_the_deadline(tmp_path, monkeypatch):
    journal_path = tmp_path / "run-journal.sqlite3"
    attempts: list[int] = []

    def never(fd: int) -> bool:
        attempts.append(fd)
        return False

    monkeypatch.setattr(instance_lock, "_try_lock", never)
    monkeypatch.setattr(instance_lock.time, "sleep", lambda _seconds: None)

    assert not acquire_journal_instance_lock(journal_path, wait_seconds=0.05)
    assert attempts
    assert not holds_journal_instance_lock(journal_path)
