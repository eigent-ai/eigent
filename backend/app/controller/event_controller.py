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
"""Local API endpoints for querying the SQLite event log.

These endpoints serve the frontend's local-first data loading path.
They read directly from the local SQLite database -- no cloud
dependency required.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.event_store.config import get_event_db_path
from app.event_store.sqlite_store import SQLiteTranscriptStore

logger = logging.getLogger("event_controller")

router = APIRouter(tags=["Events"])


@router.get("/events", name="query local events")
def query_events(
    run_id: str | None = Query(None, description="Filter by run/workforce ID"),
    task_id: str | None = Query(None, description="Filter by task ID"),
    project_id: str | None = Query(None, description="Filter by project ID"),
    after_seq: int | None = Query(
        None, description="Return events after this seq"
    ),
    limit: int = Query(200, ge=1, le=1000, description="Max events to return"),
) -> list[dict[str, Any]]:
    """Query the local event log with optional filters.

    At least one of ``run_id``, ``task_id``, or ``project_id`` must be
    provided.  Returns canonical event envelopes ordered by
    ``(run_id, seq)``.
    """
    if not any([run_id, task_id, project_id]):
        raise HTTPException(
            status_code=400,
            detail="At least one of run_id, task_id, or project_id is required",
        )

    db_path = get_event_db_path()
    if not db_path.exists():
        return []

    return SQLiteTranscriptStore.query_events(
        db_path,
        run_id=run_id,
        task_id=task_id,
        project_id=project_id,
        after_seq=after_seq,
        limit=limit,
    )


@router.get("/events/runs", name="list local runs")
def list_runs(
    project_id: str | None = Query(None, description="Filter by project ID"),
) -> list[dict[str, Any]]:
    """List all runs with aggregated metadata from the local event log."""
    db_path = get_event_db_path()
    if not db_path.exists():
        return []

    return SQLiteTranscriptStore.query_runs(db_path, project_id=project_id)


@router.get("/events/projects", name="list local projects")
def list_projects() -> list[dict[str, Any]]:
    """List projects with aggregated stats from the local event log."""
    db_path = get_event_db_path()
    if not db_path.exists():
        return []

    return SQLiteTranscriptStore.query_projects(db_path)
