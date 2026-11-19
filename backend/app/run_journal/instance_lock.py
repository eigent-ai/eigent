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
"""One Brain process owns a RunJournal file at a time.

Startup reconciliation settles what a stopped Brain left behind: it moves
every Run that is still pending, running or waiting to interrupted. It cannot
tell a stopped Brain from a live one, so a second Brain opening the same
journal would interrupt the first one's running Tasks.

The owner holds an OS file lock on ``<journal>.lock`` for its lifetime. The OS
releases the lock when the process exits, however it exits, so a crash never
leaves a stale lock behind.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path

logger = logging.getLogger("run_journal.instance_lock")

# The lock covers one byte far past the content, so other processes can still
# read the owner's pid from the start of the file on Windows, where byte-range
# locks are mandatory.
_LOCK_OFFSET = 1 << 30

_guard = threading.Lock()
_held: dict[str, int] = {}


def instance_lock_path(journal_path: Path) -> Path:
    return journal_path.with_name(journal_path.name + ".lock")


def _key(journal_path: Path) -> str:
    return os.path.normcase(str(instance_lock_path(journal_path).resolve()))


def _try_lock(fd: int) -> bool:
    if os.name == "nt":
        import msvcrt

        os.lseek(fd, _LOCK_OFFSET, os.SEEK_SET)
        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True

    import fcntl

    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return False
    return True


def _write_owner(fd: int) -> None:
    try:
        os.lseek(fd, 0, os.SEEK_SET)
        os.write(fd, f"{os.getpid()}\n".ljust(16).encode("ascii"))
    except OSError:
        # The pid is only there for error messages.
        logger.debug("Could not record the journal owner pid", exc_info=True)


def acquire_journal_instance_lock(
    journal_path: Path, *, wait_seconds: float = 0.0
) -> bool:
    """Take ownership of the journal for this process.

    Returns False when another live process owns it. Acquiring again in the
    owning process returns True. ``wait_seconds`` covers a restart, where the
    previous owner is still exiting.
    """

    key = _key(journal_path)
    deadline = time.monotonic() + max(wait_seconds, 0.0)
    with _guard:
        if key in _held:
            return True
        lock_path = instance_lock_path(journal_path)
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        while True:
            if _try_lock(fd):
                _write_owner(fd)
                _held[key] = fd
                return True
            if time.monotonic() >= deadline:
                os.close(fd)
                return False
            time.sleep(0.2)


def holds_journal_instance_lock(journal_path: Path) -> bool:
    with _guard:
        return _key(journal_path) in _held


def journal_instance_owner_pid(journal_path: Path) -> int | None:
    """The pid the current owner recorded, for messages only."""

    try:
        with open(instance_lock_path(journal_path), "rb") as handle:
            text = handle.read(16).decode("ascii", "ignore").strip()
    except OSError:
        return None
    return int(text) if text.isdigit() else None


def release_journal_instance_locks() -> None:
    """Give up every journal this process owns. Closing the file unlocks it."""

    with _guard:
        held = list(_held.values())
        _held.clear()
    for fd in held:
        try:
            os.close(fd)
        except OSError:
            pass


__all__ = [
    "acquire_journal_instance_lock",
    "holds_journal_instance_lock",
    "instance_lock_path",
    "journal_instance_owner_pid",
    "release_journal_instance_locks",
]
