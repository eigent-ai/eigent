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
"""Batch sync of local events to the cloud server.

Called after task completion to push all unsynced events in one
efficient batch.  Only runs when ``CLOUD_SYNC_ENABLED=true`` and
``SERVER_URL`` are set.

Environment variables (passed by Electron via process env):
    SERVER_URL  -- resolved from VITE_PROXY_URL in .env.development
                   (Electron passes this to the backend process)
    SERVER_TOKEN -- JWT auth token for cloud API

    CLOUD_SYNC_ENABLED -- set to "true" to enable sync
    (toggle via Electron IPC / ~/.eigent/.env)
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import httpx

from app.component.environment import env
from app.event_store.config import get_event_db_path
from app.event_store.sqlite_store import SQLiteTranscriptStore

logger = logging.getLogger("event_sync")

BATCH_SIZE = 100
HTTP_TIMEOUT = 30.0


def _is_enabled() -> bool:
    return env("CLOUD_SYNC_ENABLED", "").lower() == "true" and bool(
        env("SERVER_URL", "")
    )


async def sync_pending_events() -> None:
    """Push all unsynced local events to the cloud server in batches.

    Intended to be called once after task completion (fire-and-forget
    via ``asyncio.create_task``).  Silently no-ops when cloud sync is
    disabled or SERVER_URL is not set.
    """
    if not _is_enabled():
        return

    db_path = get_event_db_path()
    if not db_path.exists():
        return

    server_url = env("SERVER_URL", "").rstrip("/")
    batch_url = f"{server_url}/chat/events/batch"
    token = env("SERVER_TOKEN", "")
    headers: dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    total_synced = 0

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            while True:
                unsynced = _read_unsynced(db_path, limit=BATCH_SIZE)
                if not unsynced:
                    break

                # Strip local-only columns before sending
                payload_events = [
                    {
                        k: v
                        for k, v in e.items()
                        if k not in ("synced_at", "sync_attempts")
                    }
                    for e in unsynced
                ]

                response = await client.post(
                    batch_url,
                    json={"events": payload_events},
                    headers=headers,
                )

                if response.status_code == 200:
                    data = response.json()
                    accepted = data.get("accepted", [])
                    if accepted:
                        _mark_synced(db_path, accepted)
                        total_synced += len(accepted)

                    rejected = data.get("rejected", [])
                    if rejected:
                        logger.warning(
                            f"Cloud rejected {len(rejected)} events: "
                            f"{rejected[:3]}"
                        )
                        # Don't retry rejected events this round
                        _increment_attempts(
                            db_path, [r["event_id"] for r in rejected]
                        )

                    # If nothing was accepted and nothing rejected,
                    # all were duplicates -- we're done
                    if not accepted and not rejected:
                        break
                else:
                    logger.warning(
                        f"Cloud sync failed: HTTP {response.status_code}"
                    )
                    _increment_attempts(
                        db_path, [e["event_id"] for e in unsynced]
                    )
                    break  # Don't retry on this call; next task will pick up

    except httpx.ConnectError:
        logger.debug("Cloud server unreachable, sync deferred to next task")
    except httpx.TimeoutException:
        logger.warning("Cloud sync timed out, sync deferred to next task")
    except Exception as e:
        logger.error(f"Unexpected sync error: {type(e).__name__}: {e}")

    if total_synced:
        logger.info(f"Synced {total_synced} events to cloud")


# -------------------------------------------------------------------
# SQLite helpers (one-shot connections to avoid holding locks)
# -------------------------------------------------------------------


def _read_unsynced(db_path: Path, limit: int) -> list[dict]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        table_exists = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name='event_log'"
        ).fetchone()
        if not table_exists:
            return []

        rows = conn.execute(
            "SELECT * FROM event_log "
            "WHERE synced_at IS NULL "
            "ORDER BY run_id, seq "
            "LIMIT ?",
            (limit,),
        ).fetchall()
        return [SQLiteTranscriptStore._row_to_canonical_dict(r) for r in rows]
    finally:
        conn.close()


def _mark_synced(db_path: Path, event_ids: list[str]) -> None:
    if not event_ids:
        return
    now = datetime.now(UTC).isoformat()
    placeholders = ",".join("?" for _ in event_ids)
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            f"UPDATE event_log SET synced_at = ? "  # nosec B608
            f"WHERE event_id IN ({placeholders})",  # nosec B608
            [now, *event_ids],
        )
        conn.commit()
    finally:
        conn.close()


def _increment_attempts(db_path: Path, event_ids: list[str]) -> None:
    if not event_ids:
        return
    placeholders = ",".join("?" for _ in event_ids)
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            f"UPDATE event_log SET sync_attempts = sync_attempts + 1 "  # nosec B608
            f"WHERE event_id IN ({placeholders})",  # nosec B608
            event_ids,
        )
        conn.commit()
    finally:
        conn.close()
