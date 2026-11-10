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

"""Exclusive execution of one journaled publication on supported POSIX hosts.

These lock files are stable coordination identities and must never be unlinked
while the journal is in use. The SQLite owner still controls different
operations; this guard closes duplicate execution of the *same* owner.
"""

from __future__ import annotations

import os
import stat
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .store import WorkspaceBusy, WorkspaceStateError, digest

try:
    import fcntl
except ImportError:  # Unsupported hosts fail before publication I/O.
    fcntl = None


_registry_lock = threading.Lock()
_registry: dict[tuple[str, str], threading.Lock] = {}
_held = threading.local()
_descriptors: set[int] = set()


def _before_fork() -> None:
    # Creation/registration and removal/close are indivisible to fork. A child
    # must not inherit an unregistered fd that can keep a dead writer's lock.
    _registry_lock.acquire()


def _after_fork_parent() -> None:
    _registry_lock.release()


def _after_fork() -> None:
    global _registry_lock, _registry, _held, _descriptors
    # Closing a child's inherited fd does not unlock the parent's description.
    for descriptor in _descriptors:
        os.close(descriptor)
    _registry_lock = threading.Lock()
    _registry = {}
    _held = threading.local()
    _descriptors = set()


if hasattr(os, "register_at_fork"):
    os.register_at_fork(
        before=_before_fork,
        after_in_parent=_after_fork_parent,
        after_in_child=_after_fork,
    )


@contextmanager
def publication_execution(
    journal_path: Path,
    operation_id: str,
) -> Iterator[None]:
    """Serialize threads, coordinator instances, connections and processes.

    Callers must reread durable operation state after entering. Same-thread
    reentry is refused instead of deadlocking. No journal transaction is held
    while waiting. Process death releases the OS lock, not the durable owner.
    """
    if fcntl is None:
        raise WorkspaceStateError("publication execution locking unsupported")
    journal_path = Path(journal_path).resolve(strict=True)
    journal_stat = journal_path.stat()
    journal_identity = (journal_stat.st_dev, journal_stat.st_ino)
    key = (str(journal_path), digest([journal_identity, operation_id]))
    held = getattr(_held, "keys", set())
    if key in held:
        raise WorkspaceBusy("publication execution cannot be reentered")
    with _registry_lock:
        mutex = _registry.setdefault(key, threading.Lock())
    with mutex:
        held.add(key)
        _held.keys = held
        descriptor = None
        locked = False
        try:
            directory = journal_path.with_name(
                "." + journal_path.name + ".workspace-locks"
            )
            directory.mkdir(mode=0o700, exist_ok=True)
            parent = os.open(
                directory,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
            )
            name = key[1] + ".lock"
            try:
                with _registry_lock:
                    descriptor = os.open(
                        name,
                        os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
                        0o600,
                        dir_fd=parent,
                    )
                    _descriptors.add(descriptor)
                observed = os.fstat(descriptor)
                if (
                    not stat.S_ISREG(observed.st_mode)
                    or observed.st_nlink != 1
                ):
                    raise WorkspaceStateError("invalid publication lock file")
                fcntl.flock(descriptor, fcntl.LOCK_EX)
                locked = True
                current = os.stat(name, dir_fd=parent, follow_symlinks=False)
                if (current.st_dev, current.st_ino) != (
                    observed.st_dev,
                    observed.st_ino,
                ):
                    raise WorkspaceStateError(
                        "publication lock identity changed"
                    )
                current_journal = journal_path.stat()
                if (
                    current_journal.st_dev,
                    current_journal.st_ino,
                ) != journal_identity:
                    raise WorkspaceStateError(
                        "publication journal identity changed"
                    )
            finally:
                os.close(parent)
            yield
        finally:
            if descriptor is not None:
                if locked:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                with _registry_lock:
                    _descriptors.discard(descriptor)
                    os.close(descriptor)
            held.remove(key)
