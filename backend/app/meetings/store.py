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
"""SQLite store for meetings, separate from the Run journal (plan §5.2)."""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import threading
import time
import uuid
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from app.meetings.note import DEFAULT_NOTE_TEMPLATE

MEETING_STATUSES = ("recording", "ready", "interrupted", "failed")
MEETING_SOURCES = ("microphone", "import")
_MEETING_ID = re.compile(r"^meeting_[0-9a-f]{32}$")
_SCHEMA_VERSION = 1


class MeetingNotFoundError(KeyError):
    """No meeting has this id."""


@dataclass(frozen=True)
class TypedNote:
    """A line the person typed, at its position in the meeting."""

    at_ms: int
    text: str


@dataclass(frozen=True)
class MeetingSpaceLink:
    meeting_id: str
    space_id: str
    relative_path: str
    digest: str
    written_at: float


@dataclass(frozen=True)
class Meeting:
    id: str
    title: str
    status: str
    source: str
    started_at: float
    ended_at: float | None
    duration_ms: int
    recording_file: str | None
    recording_bytes: int
    note_markdown: str
    note_edited: bool
    created_at: float
    updated_at: float
    typed_notes: tuple[TypedNote, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["typed_notes"] = [asdict(note) for note in self.typed_notes]
        data["recording_kept"] = self.recording_file is not None
        return data


def is_meeting_id(value: str) -> bool:
    return bool(_MEETING_ID.match(value))


def _like_pattern(query: str) -> str:
    escaped = (
        query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    )
    return f"%{escaped}%"


class MeetingStore:
    """Meetings, their notes and Space links under ``root``.

    ``root`` holds ``meetings.sqlite`` and one ``recordings/<meeting id>``
    folder per meeting. Nothing here is synced.
    """

    def __init__(self, root: Path) -> None:
        self.root = root.expanduser()
        self.root.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / "meetings.sqlite"
        self._lock = threading.RLock()
        self._migrate()
        self._recover_interrupted()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            connection = sqlite3.connect(self.db_path)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            try:
                with connection:
                    yield connection
            finally:
                connection.close()

    def _migrate(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS meetings (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    source TEXT NOT NULL,
                    started_at REAL NOT NULL,
                    ended_at REAL,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    recording_file TEXT,
                    recording_bytes INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS meeting_notes (
                    meeting_id TEXT PRIMARY KEY
                        REFERENCES meetings(id) ON DELETE CASCADE,
                    typed_notes TEXT NOT NULL DEFAULT '[]',
                    note_markdown TEXT NOT NULL,
                    note_edited INTEGER NOT NULL DEFAULT 0,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS meeting_space_links (
                    meeting_id TEXT NOT NULL
                        REFERENCES meetings(id) ON DELETE CASCADE,
                    space_id TEXT NOT NULL,
                    relative_path TEXT NOT NULL,
                    digest TEXT NOT NULL,
                    written_at REAL NOT NULL,
                    PRIMARY KEY (meeting_id, space_id)
                );
                CREATE INDEX IF NOT EXISTS meetings_started_at
                    ON meetings(started_at DESC);
                """
            )
            db.execute(f"PRAGMA user_version = {_SCHEMA_VERSION}")

    def _recover_interrupted(self) -> None:
        # Nothing can still be recording when the store opens: whoever was
        # recording lost its connection. Keep what was saved (plan §5.2).
        now = time.time()
        with self._connect() as db:
            db.execute(
                "UPDATE meetings SET status = 'interrupted', updated_at = ?"
                " WHERE status = 'recording'",
                (now,),
            )

    # Meetings ------------------------------------------------------------

    def _row_to_meeting(self, row: sqlite3.Row) -> Meeting:
        typed = tuple(
            TypedNote(at_ms=int(item["at_ms"]), text=str(item["text"]))
            for item in json.loads(row["typed_notes"] or "[]")
        )
        return Meeting(
            id=row["id"],
            title=row["title"],
            status=row["status"],
            source=row["source"],
            started_at=row["started_at"],
            ended_at=row["ended_at"],
            duration_ms=row["duration_ms"],
            recording_file=row["recording_file"],
            recording_bytes=row["recording_bytes"],
            note_markdown=row["note_markdown"],
            note_edited=bool(row["note_edited"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            typed_notes=typed,
        )

    _SELECT = (
        "SELECT m.*, n.typed_notes, n.note_markdown, n.note_edited"
        " FROM meetings m JOIN meeting_notes n ON n.meeting_id = m.id"
    )

    def create(
        self,
        *,
        title: str,
        source: str = "microphone",
        status: str = "recording",
        started_at: float | None = None,
    ) -> Meeting:
        if source not in MEETING_SOURCES:
            raise ValueError(f"Unknown meeting source: {source}")
        if status not in MEETING_STATUSES:
            raise ValueError(f"Unknown meeting status: {status}")
        now = time.time()
        meeting_id = f"meeting_{uuid.uuid4().hex}"
        with self._connect() as db:
            db.execute(
                "INSERT INTO meetings (id, title, status, source, started_at,"
                " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    meeting_id,
                    title,
                    status,
                    source,
                    started_at if started_at is not None else now,
                    now,
                    now,
                ),
            )
            db.execute(
                "INSERT INTO meeting_notes (meeting_id, note_markdown,"
                " updated_at) VALUES (?, ?, ?)",
                (meeting_id, DEFAULT_NOTE_TEMPLATE, now),
            )
        return self.get(meeting_id)

    def get(self, meeting_id: str) -> Meeting:
        if not is_meeting_id(meeting_id):
            raise MeetingNotFoundError(meeting_id)
        with self._connect() as db:
            row = db.execute(
                f"{self._SELECT} WHERE m.id = ?",  # nosec B608
                (meeting_id,),
            ).fetchone()
        if row is None:
            raise MeetingNotFoundError(meeting_id)
        return self._row_to_meeting(row)

    def list_meetings(self, query: str | None = None) -> list[Meeting]:
        """Newest first. ``query`` matches titles and notes."""

        sql = self._SELECT
        params: tuple[Any, ...] = ()
        if query and query.strip():
            pattern = _like_pattern(query.strip())
            sql += (
                " WHERE m.title LIKE ? ESCAPE '\\'"
                " OR n.note_markdown LIKE ? ESCAPE '\\'"
                " OR n.typed_notes LIKE ? ESCAPE '\\'"
            )
            params = (pattern, pattern, pattern)
        sql += " ORDER BY m.started_at DESC"
        with self._connect() as db:
            rows = db.execute(sql, params).fetchall()
        return [self._row_to_meeting(row) for row in rows]

    def update(
        self,
        meeting_id: str,
        *,
        title: str | None = None,
        status: str | None = None,
        duration_ms: int | None = None,
        ended_at: float | None = None,
        typed_notes: Sequence[TypedNote] | None = None,
        note_markdown: str | None = None,
    ) -> Meeting:
        self.get(meeting_id)
        if status is not None and status not in MEETING_STATUSES:
            raise ValueError(f"Unknown meeting status: {status}")
        now = time.time()
        meeting_fields: dict[str, Any] = {}
        if title is not None:
            meeting_fields["title"] = title
        if status is not None:
            meeting_fields["status"] = status
        if duration_ms is not None:
            meeting_fields["duration_ms"] = max(0, int(duration_ms))
        if ended_at is not None:
            meeting_fields["ended_at"] = ended_at
        note_fields: dict[str, Any] = {}
        if typed_notes is not None:
            note_fields["typed_notes"] = json.dumps(
                [asdict(note) for note in typed_notes], ensure_ascii=False
            )
        if note_markdown is not None:
            note_fields["note_markdown"] = note_markdown
            note_fields["note_edited"] = 1
        with self._connect() as db:
            meeting_fields["updated_at"] = now
            assignments = ", ".join(f"{key} = ?" for key in meeting_fields)
            db.execute(
                f"UPDATE meetings SET {assignments} WHERE id = ?",  # nosec B608
                (*meeting_fields.values(), meeting_id),
            )
            if note_fields:
                note_fields["updated_at"] = now
                assignments = ", ".join(f"{key} = ?" for key in note_fields)
                db.execute(
                    f"UPDATE meeting_notes SET {assignments}"  # nosec B608
                    " WHERE meeting_id = ?",
                    (*note_fields.values(), meeting_id),
                )
        return self.get(meeting_id)

    def delete(self, meeting_id: str) -> None:
        """Remove the meeting, its recording and links.

        Copies already added to Spaces are Space files and stay.
        """

        self.get(meeting_id)
        with self._connect() as db:
            db.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))
        folder = self.recording_dir(meeting_id)
        if folder.exists():
            shutil.rmtree(folder)

    # Recordings ----------------------------------------------------------

    def recording_dir(self, meeting_id: str) -> Path:
        if not is_meeting_id(meeting_id):
            raise MeetingNotFoundError(meeting_id)
        return self.root / "recordings" / meeting_id

    def recording_path(self, meeting: Meeting) -> Path | None:
        if meeting.recording_file is None:
            return None
        path = self.recording_dir(meeting.id) / meeting.recording_file
        return path if path.is_file() else None

    def attach_recording(
        self, meeting_id: str, *, file_name: str, size: int
    ) -> Meeting:
        """Record that ``file_name`` in the meeting's folder is its audio."""

        meeting = self.get(meeting_id)
        if Path(file_name).name != file_name:
            raise ValueError("Recording file name must not contain a path")
        previous = meeting.recording_file
        with self._connect() as db:
            db.execute(
                "UPDATE meetings SET recording_file = ?, recording_bytes = ?,"
                " updated_at = ? WHERE id = ?",
                (file_name, int(size), time.time(), meeting_id),
            )
        if previous and previous != file_name:
            (self.recording_dir(meeting_id) / previous).unlink(missing_ok=True)
        return self.get(meeting_id)

    # Space links ---------------------------------------------------------

    def links(self, meeting_id: str) -> list[MeetingSpaceLink]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM meeting_space_links WHERE meeting_id = ?"
                " ORDER BY written_at",
                (meeting_id,),
            ).fetchall()
        return [MeetingSpaceLink(**dict(row)) for row in rows]

    def links_for(
        self, meeting_ids: Sequence[str]
    ) -> dict[str, list[MeetingSpaceLink]]:
        result: dict[str, list[MeetingSpaceLink]] = {
            meeting_id: [] for meeting_id in meeting_ids
        }
        if not meeting_ids:
            return result
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM meeting_space_links ORDER BY written_at"
            ).fetchall()
        for row in rows:
            if row["meeting_id"] in result:
                result[row["meeting_id"]].append(MeetingSpaceLink(**dict(row)))
        return result

    def get_link(
        self, meeting_id: str, space_id: str
    ) -> MeetingSpaceLink | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM meeting_space_links"
                " WHERE meeting_id = ? AND space_id = ?",
                (meeting_id, space_id),
            ).fetchone()
        return MeetingSpaceLink(**dict(row)) if row else None

    def save_link(
        self,
        meeting_id: str,
        space_id: str,
        *,
        relative_path: str,
        digest: str,
    ) -> MeetingSpaceLink:
        self.get(meeting_id)
        with self._connect() as db:
            db.execute(
                "INSERT INTO meeting_space_links (meeting_id, space_id,"
                " relative_path, digest, written_at) VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT(meeting_id, space_id) DO UPDATE SET"
                " relative_path = excluded.relative_path,"
                " digest = excluded.digest,"
                " written_at = excluded.written_at",
                (meeting_id, space_id, relative_path, digest, time.time()),
            )
        link = self.get_link(meeting_id, space_id)
        assert link is not None
        return link

    def delete_link(self, meeting_id: str, space_id: str) -> bool:
        with self._connect() as db:
            cursor = db.execute(
                "DELETE FROM meeting_space_links"
                " WHERE meeting_id = ? AND space_id = ?",
                (meeting_id, space_id),
            )
        return cursor.rowcount > 0


_store: MeetingStore | None = None
_store_lock = threading.Lock()


def get_meeting_store() -> MeetingStore:
    global _store
    with _store_lock:
        if _store is None:
            from app.utils.workspace_paths import meetings_root

            _store = MeetingStore(meetings_root())
        return _store


def reset_meeting_store() -> None:
    """Forget the shared store (tests)."""

    global _store
    with _store_lock:
        _store = None
