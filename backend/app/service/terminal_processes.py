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

"""Bounded observations of managed terminals; execution stays with the owner.

Opaque IDs distinguish repeated commands and toolkit instances. No client supplied
PID, command or URL is ever used to stop a process. Records survive view switches;
when the backend restarts, callers must treat missing records as unavailable.
"""

from __future__ import annotations

import re
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urlsplit

OUTPUT_LIMIT = 131_072
HISTORY_LIMIT = 100
_URL = re.compile(r"https?://[^\s<>\x1b]+")
_WILDCARD_HOST = "0.0.0.0"  # nosec B104 -- parsed URL, never a bind address


def preview_url(output: str) -> str | None:
    for candidate in _URL.findall(output):
        candidate = candidate.rstrip(".,;)'\"]}")
        try:
            parsed = urlsplit(candidate)
            # Only explicit local listening addresses identify a managed server.
            if (
                parsed.hostname
                in {"localhost", "127.0.0.1", "[::1]", "::1", _WILDCARD_HOST}
                and parsed.port
            ):
                if parsed.hostname == _WILDCARD_HOST:
                    candidate = candidate.replace(
                        _WILDCARD_HOST, "127.0.0.1", 1
                    )
                return candidate
        except ValueError:
            pass
    return None


@dataclass
class ProcessRecord:
    id: str
    project_id: str
    run_id: str
    tool_call_id: str
    session_id: str
    agent_name: str
    label: str
    observe: Callable[[], tuple[bool, int | None, bool]] | None
    terminate: Callable[[], str] | None
    created_at: float = field(default_factory=time.time)
    output: str = ""
    offset: int = 0
    version: int = 0
    url: str | None = None
    stopping: bool = False
    stop_error: str | None = None
    running: bool = True
    exit_code: int | None = None
    stopped: bool = False
    available: bool = True
    stop_lock: threading.Lock = field(default_factory=threading.Lock)


class TerminalProcessRegistry:
    def __init__(self):
        self._lock = threading.RLock()
        self._records: dict[str, ProcessRecord] = {}

    def register(
        self,
        *,
        project_id,
        run_id,
        session_id,
        agent_name,
        label,
        tool_call_id="",
        observe,
        terminate,
    ) -> str:
        record = ProcessRecord(
            uuid.uuid4().hex,
            project_id,
            run_id,
            tool_call_id,
            session_id,
            agent_name,
            label[:240],
            observe,
            terminate,
        )
        with self._lock:
            self._records[record.id] = record
            candidates = [
                existing
                for existing in self._records.values()
                if existing.project_id == project_id
            ]
        # Never hold the registry lock while calling an owner: its output reader
        # may hold a session lock while publishing a chunk into this registry.
        completed = [r for r in candidates if not self._refresh(r)]
        with self._lock:
            for old in completed[:-HISTORY_LIMIT]:
                self._records.pop(old.id, None)
        return record.id

    def _refresh(self, record: ProcessRecord) -> bool:
        observe = record.observe
        if observe is None:
            return record.running
        try:
            running, exit_code, stopped = observe()
        except Exception:
            # A missing Docker exec/container or torn-down owner must not make
            # unrelated registrations and list requests fail.
            with self._lock:
                record.available = False
                record.running = False
                record.observe = None
                record.terminate = None
            return False
        with self._lock:
            record.available = True
            record.running = running
            record.exit_code = exit_code
            record.stopped = stopped
            if not running:
                # Completed rows keep their bounded output without retaining
                # the toolkit and all of its Session data through callbacks.
                record.observe = None
                record.terminate = None
        return running

    def append(self, process_id: str, text: str):
        with self._lock:
            record = self._records.get(process_id)
            if not record or not text:
                return
            combined = record.output + text
            removed = max(0, len(combined) - OUTPUT_LIMIT)
            record.output = combined[removed:]
            record.offset += removed
            record.url = preview_url(combined[-8192:]) or record.url
            record.version += 1

    def refresh(self, process_id: str):
        with self._lock:
            record = self._records.get(process_id)
        if record is not None:
            self._refresh(record)

    def _snapshot(self, record, known_version=None):
        self._refresh(record)
        running = record.running
        exit_code = record.exit_code
        stopped = record.stopped
        status = (
            "unavailable"
            if not record.available
            else "stopping"
            if running and record.stopping
            else (
                "running"
                if running
                else "stopped"
                if stopped
                else "failed"
                if exit_code not in (None, 0)
                else "completed"
            )
        )
        with self._lock:
            result = {
                key: getattr(record, key)
                for key in (
                    "id",
                    "project_id",
                    "run_id",
                    "tool_call_id",
                    "session_id",
                    "agent_name",
                    "label",
                    "created_at",
                    "offset",
                    "version",
                    "url",
                    "stop_error",
                )
            }
            result.update(
                status=status,
                exit_code=exit_code,
                can_stop=running and record.available,
            )
            if known_version != record.version:
                result["output"] = record.output
            return result

    def list(self, project_id: str, versions: dict[str, int] | None = None):
        with self._lock:
            records = [
                r for r in self._records.values() if r.project_id == project_id
            ]
        return [self._snapshot(r, (versions or {}).get(r.id)) for r in records]

    def stop(self, project_id: str, process_id: str):
        with self._lock:
            record = self._records.get(process_id)
            if record is None or record.project_id != project_id:
                raise KeyError(process_id)
        # Per-target serialization permits other terminals to stop concurrently.
        with record.stop_lock:
            if not self._refresh(record):
                return self._snapshot(record)
            record.stopping, record.stop_error = True, None
            try:
                terminate = record.terminate
                if terminate is None:
                    raise RuntimeError("Process owner unavailable")
                result = terminate()
                if self._refresh(record):
                    raise RuntimeError(result or "Process did not stop")
            except Exception:
                # Do not expose exception/command text that may contain secrets.
                record.stop_error = "Could not stop this process. Try again."
            finally:
                record.stopping = False
            return self._snapshot(record)


terminal_processes = TerminalProcessRegistry()
