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

"""
Knowledge base for long-term memory (issue #1099).

Stores and retrieves project-scoped knowledge entries in SQLite.
Used to inject relevant context into chat prompts so the assistant
can use persisted facts across sessions.
"""

import os
import sqlite3
import threading
import logging
from typing import Optional

logger = logging.getLogger("knowledge_base")

_DEFAULT_BASE_PATH = os.path.join(os.path.expanduser("~"), ".eigent")
_KB_SUBDIR = ".eigent_knowledge"
_DB_NAME = "knowledge.db"
_LOCK = threading.Lock()


def _get_db_path() -> str:
    """Return path to the knowledge base SQLite file."""
    base = os.environ.get("file_save_path", _DEFAULT_BASE_PATH)
    base = os.path.expanduser(base)
    kb_dir = os.path.join(base, _KB_SUBDIR)
    os.makedirs(kb_dir, exist_ok=True)
    return os.path.join(kb_dir, _DB_NAME)


def _init_schema(conn: sqlite3.Connection) -> None:
    """Create table if not exists."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS knowledge (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at REAL NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project_id)"
    )
    conn.commit()


def _get_connection() -> sqlite3.Connection:
    path = _get_db_path()
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    _init_schema(conn)
    return conn


def add_entry(project_id: str, content: str) -> int:
    """Add a knowledge entry for the project. Returns the new entry id."""
    import time
    with _LOCK:
        conn = _get_connection()
        try:
            cur = conn.execute(
                "INSERT INTO knowledge (project_id, content, created_at) VALUES (?, ?, ?)",
                (project_id, content.strip(), time.time()),
            )
            conn.commit()
            row_id = cur.lastrowid or 0
            logger.info(
                "Knowledge entry added",
                extra={"project_id": project_id, "id": row_id},
            )
            return row_id
        finally:
            conn.close()


def get_entries(
    project_id: str,
    query: Optional[str] = None,
    limit: int = 50,
) -> list[dict]:
    """List knowledge entries for the project, optionally filtered by keyword."""
    conn = _get_connection()
    try:
        if query and query.strip():
            pattern = f"%{query.strip()}%"
            cur = conn.execute(
                """
                SELECT id, project_id, content, created_at
                FROM knowledge
                WHERE project_id = ? AND content LIKE ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (project_id, pattern, limit),
            )
        else:
            cur = conn.execute(
                """
                SELECT id, project_id, content, created_at
                FROM knowledge
                WHERE project_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (project_id, limit),
            )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "project_id": row["project_id"],
                "content": row["content"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]
    finally:
        conn.close()


def delete_entry(project_id: str, entry_id: int) -> bool:
    """Delete a knowledge entry. Returns True if a row was deleted."""
    with _LOCK:
        conn = _get_connection()
        try:
            cur = conn.execute(
                "DELETE FROM knowledge WHERE project_id = ? AND id = ?",
                (project_id, entry_id),
            )
            conn.commit()
            deleted = cur.rowcount > 0
            if deleted:
                logger.info(
                    "Knowledge entry deleted",
                    extra={"project_id": project_id, "id": entry_id},
                )
            return deleted
        finally:
            conn.close()


def get_context_for_prompt(
    project_id: str,
    query: Optional[str] = None,
    max_chars: int = 4000,
    limit_entries: int = 20,
) -> str:
    """
    Build a string of relevant knowledge entries to inject into the chat prompt.
    Returns empty string if no entries or on error.
    """
    entries = get_entries(project_id, query=query, limit=limit_entries)
    if not entries:
        return ""

    parts = []
    total = 0
    for e in entries:
        content = (e["content"] or "").strip()
        if not content:
            continue
        if total + len(content) + 2 > max_chars:
            break
        parts.append(content)
        total += len(content) + 2

    if not parts:
        return ""
    return "=== Knowledge Base (long-term memory) ===\n" + "\n\n".join(parts) + "\n\n"
