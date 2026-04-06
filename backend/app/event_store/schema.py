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
"""Canonical event envelope and SQLite DDL for the local event log."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any

SCHEMA_VERSION = 1


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(slots=True)
class EventEnvelope:
    """Canonical event shape shared across local SQLite, sync payloads,
    and server Postgres."""

    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    run_id: str = ""
    project_id: str = ""
    task_id: str | None = None
    seq: int = 0
    event_type: str = ""
    occurred_at: str = field(default_factory=_utc_now_iso)
    source: str = "camel"
    agent_id: str | None = None
    agent_name: str | None = None
    schema_version: int = SCHEMA_VERSION
    payload: dict[str, Any] = field(default_factory=dict)
    synced_at: str | None = None
    sync_attempts: int = 0

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        if isinstance(data["payload"], str):
            try:
                data["payload"] = json.loads(data["payload"])
            except json.JSONDecodeError:
                data["payload"] = data["payload"]
        return data

    def to_compat_dict(self) -> dict[str, Any]:
        """Return a dict compatible with CAMEL's TranscriptStore.read_all()
        format (workforce_id, timestamp keys)."""
        payload = self.payload
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                pass
        return {
            "event_type": self.event_type,
            "workforce_id": self.run_id,
            "timestamp": self.occurred_at,
            "task_id": self.task_id,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "source": self.source,
            "payload": payload,
        }


# ---------------------------------------------------------------------------
# SQLite DDL
# ---------------------------------------------------------------------------

CREATE_EVENT_LOG_TABLE = """\
CREATE TABLE IF NOT EXISTS event_log (
    event_id       TEXT    PRIMARY KEY,
    run_id         TEXT    NOT NULL,
    project_id     TEXT    NOT NULL,
    task_id        TEXT,
    seq            INTEGER NOT NULL,
    event_type     TEXT    NOT NULL,
    occurred_at    TEXT    NOT NULL,
    source         TEXT    NOT NULL DEFAULT 'camel',
    agent_id       TEXT,
    agent_name     TEXT,
    schema_version INTEGER NOT NULL DEFAULT 1,
    payload        TEXT    NOT NULL DEFAULT '{}',
    synced_at      TEXT,
    sync_attempts  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (run_id, seq)
);
"""

CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_event_log_run_id ON event_log(run_id);",
    "CREATE INDEX IF NOT EXISTS idx_event_log_project_id ON event_log(project_id);",
    "CREATE INDEX IF NOT EXISTS idx_event_log_task_id ON event_log(task_id);",
    (
        "CREATE INDEX IF NOT EXISTS idx_event_log_unsynced "
        "ON event_log(synced_at) WHERE synced_at IS NULL;"
    ),
]
