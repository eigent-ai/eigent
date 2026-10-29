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

"""Independent durable catalog; late video never mutates Run artifacts."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .models import RecordingError


class RecordingStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = path
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS recordings (
                    id TEXT PRIMARY KEY, principal TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL, root TEXT NOT NULL,
                    directory TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL,
                    UNIQUE(principal, idempotency_key)
                );
                CREATE TABLE IF NOT EXISTS recording_events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    principal TEXT NOT NULL, recording_id TEXT NOT NULL, body TEXT NOT NULL
                );
            """)
        path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def all(self, principal: str | None = None):
        with self.connect() as db:
            query = (
                "SELECT body FROM recordings WHERE principal=? ORDER BY rowid DESC"
                if principal
                else "SELECT body FROM recordings ORDER BY rowid DESC"
            )
            rows = db.execute(
                query,
                (principal,) if principal else (),
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def get(self, recording_id: str):
        with self.connect() as db:
            row = db.execute(
                "SELECT body FROM recordings WHERE id=?", (recording_id,)
            ).fetchone()
        if row is None:
            raise RecordingError("recording_not_found", 404)
        return json.loads(row[0])

    def save(self, record: dict, *, expected_version: int | None = None):
        from .models import public_record

        record = {**record, "version": (expected_version or 0) + 1}
        body = json.dumps(record, separators=(",", ":"))
        with self.connect() as db:
            if expected_version is None:
                db.execute(
                    "INSERT INTO recordings VALUES (?,?,?,?,?,?,?)",
                    (
                        record["id"],
                        record["principal"],
                        record["idempotency_key"],
                        record["root"],
                        record["directory"],
                        record["version"],
                        body,
                    ),
                )
            else:
                result = db.execute(
                    "UPDATE recordings SET version=?,body=? WHERE id=? AND version=?",
                    (
                        record["version"],
                        body,
                        record["id"],
                        expected_version,
                    ),
                )
                if result.rowcount != 1:
                    raise RecordingError("recording_version_conflict")
            db.execute(
                "INSERT INTO recording_events(principal,recording_id,body) VALUES(?,?,?)",
                (
                    record["principal"],
                    record["id"],
                    json.dumps(public_record(record)),
                ),
            )
        return record

    def events(self, principal: str, after: int):
        with self.connect() as db:
            rows = db.execute(
                "SELECT sequence,body FROM recording_events WHERE principal=? AND sequence>? ORDER BY sequence LIMIT 100",
                (principal, after),
            ).fetchall()
        return [
            {"sequence": row[0], "recording": json.loads(row[1])}
            for row in rows
        ]

    def reserved(self, root: Path, relative: str) -> bool:
        with self.connect() as db:
            directories = db.execute(
                "SELECT directory FROM recordings WHERE root=?",
                (str(root.resolve()),),
            ).fetchall()
        return any(
            relative == row[0] or relative.startswith(row[0] + "/")
            for row in directories
        )
