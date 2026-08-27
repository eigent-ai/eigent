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

"""Lazy process-owned RunJournal runtime.

Importing this module never creates files. The first canonical event opens the
SQLite database, and Brain shutdown closes the shared connection explicitly.
"""

from __future__ import annotations

import threading
from pathlib import Path

from app.component.environment import env
from app.run_journal.paths import default_run_journal_path
from app.run_journal.recorder import EventRecorder
from app.run_journal.store import SQLiteRunJournal

_runtime_lock = threading.Lock()
_default_journal: SQLiteRunJournal | None = None
_default_recorder: EventRecorder | None = None


def _notify_cloud_sync() -> None:
    from app.run_sync.runtime import notify_default_cloud_sync_worker

    notify_default_cloud_sync_worker()


def configured_run_journal_path() -> Path:
    configured = str(env("EIGENT_RUN_JOURNAL_PATH", "")).strip()
    if configured:
        return Path(configured).expanduser()
    return default_run_journal_path()


def get_default_run_journal() -> SQLiteRunJournal:
    global _default_journal
    with _runtime_lock:
        if _default_journal is None:
            _default_journal = SQLiteRunJournal(configured_run_journal_path())
        return _default_journal


def get_default_event_recorder() -> EventRecorder:
    global _default_journal, _default_recorder
    with _runtime_lock:
        if _default_recorder is None:
            # Construct directly while holding the runtime lock; calling
            # get_default_run_journal() here would try to acquire it twice.
            if _default_journal is None:
                _default_journal = SQLiteRunJournal(
                    configured_run_journal_path()
                )
            _default_recorder = EventRecorder(
                _default_journal,
                on_commit=_notify_cloud_sync,
            )
        return _default_recorder


def close_default_run_journal() -> None:
    global _default_journal, _default_recorder
    with _runtime_lock:
        journal = _default_journal
        _default_journal = None
        _default_recorder = None
    if journal is not None:
        journal.close()
