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

"""Workflow Event controller for batch ingestion and read access.

Receives canonical events from the local sync worker and provides
read endpoints for cloud-based history queries.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.core.database import session
from app.model.chat.workflow_event import (
    BatchIngestRequest,
    BatchIngestResponse,
    WorkflowEvent,
    WorkflowEventOut,
)
from app.shared.auth import auth_must

router = APIRouter(prefix="/chat", tags=["V1 Workflow Events"])


@router.post(
    "/events/batch",
    name="batch ingest workflow events",
    response_model=BatchIngestResponse,
)
async def batch_ingest(
    body: BatchIngestRequest,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    """Idempotent batch ingestion of canonical events.

    - Duplicate ``event_id`` is silently skipped (idempotent).
    - Conflicting ``(run_id, seq)`` with a different
      ``event_id`` is rejected.
    """
    accepted: list[str] = []
    rejected: list[dict] = []

    if not body.events:
        return BatchIngestResponse(
            accepted=accepted, rejected=rejected
        )

    # Preflight: find existing event_ids to skip duplicates
    incoming_ids = [e.event_id for e in body.events]
    existing_rows = db_session.exec(
        select(WorkflowEvent.event_id).where(
            WorkflowEvent.event_id.in_(incoming_ids)
        )
    ).all()
    existing_ids = set(existing_rows)

    for event_in in body.events:
        if event_in.event_id in existing_ids:
            # Already ingested -- idempotent skip
            accepted.append(event_in.event_id)
            continue

        try:
            db_event = WorkflowEvent(
                event_id=event_in.event_id,
                run_id=event_in.run_id,
                task_id=event_in.task_id,
                project_id=event_in.project_id,
                user_id=auth.user.id,
                seq=event_in.seq,
                event_type=event_in.event_type,
                occurred_at=event_in.occurred_at,
                source=event_in.source,
                agent_id=event_in.agent_id,
                agent_name=event_in.agent_name,
                schema_version=event_in.schema_version,
                payload=event_in.payload,
            )
            db_session.add(db_event)
            db_session.flush()
            accepted.append(event_in.event_id)
        except Exception as e:
            db_session.rollback()
            error_msg = str(e)
            if "uq_workflow_event_run_seq" in error_msg:
                rejected.append(
                    {
                        "event_id": event_in.event_id,
                        "reason": (
                            f"Conflicting (run_id="
                            f"{event_in.run_id}, "
                            f"seq={event_in.seq})"
                        ),
                    }
                )
            else:
                rejected.append(
                    {
                        "event_id": event_in.event_id,
                        "reason": error_msg[:200],
                    }
                )

    # Commit all accepted events
    try:
        db_session.commit()
    except Exception as e:
        db_session.rollback()
        return BatchIngestResponse(
            accepted=[],
            rejected=[
                {
                    "event_id": eid,
                    "reason": str(e)[:200],
                }
                for eid in incoming_ids
            ],
        )

    return BatchIngestResponse(
        accepted=accepted, rejected=rejected
    )


@router.get(
    "/events",
    name="list workflow events",
    response_model=List[WorkflowEventOut],
)
async def list_events(
    run_id: Optional[str] = Query(None),
    task_id: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    after_seq: Optional[int] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    """Read events filtered by run_id, task_id, or project_id.

    Ownership-checked: only returns events belonging to the
    authenticated user.
    """
    if not any([run_id, task_id, project_id]):
        raise HTTPException(
            status_code=400,
            detail=(
                "At least one of run_id, task_id, "
                "or project_id is required"
            ),
        )

    query = select(WorkflowEvent).where(
        WorkflowEvent.user_id == auth.user.id
    )

    if run_id:
        query = query.where(WorkflowEvent.run_id == run_id)
    if task_id:
        query = query.where(WorkflowEvent.task_id == task_id)
    if project_id:
        query = query.where(
            WorkflowEvent.project_id == project_id
        )
    if after_seq is not None:
        query = query.where(WorkflowEvent.seq > after_seq)

    query = query.order_by(
        WorkflowEvent.run_id, WorkflowEvent.seq
    ).limit(limit)

    return list(db_session.exec(query).all())


@router.get(
    "/events/{event_id}",
    name="get workflow event",
    response_model=WorkflowEventOut,
)
async def get_event(
    event_id: str,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    """Get a single event by event_id. Ownership-checked."""
    event = db_session.get(WorkflowEvent, event_id)
    if not event or event.user_id != auth.user.id:
        raise HTTPException(
            status_code=404, detail="Event not found"
        )
    return event
