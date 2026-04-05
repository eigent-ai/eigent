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

"""Append-only workflow event model for the canonical event log.

This table stores raw events synced from local SQLite databases.
It is NOT a replacement for ChatStep -- both coexist. ChatStep
serves real-time UI playback; WorkflowEvent is the durable
canonical history.
"""

import json
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, field_validator
from sqlalchemy import TIMESTAMP, UniqueConstraint, text
from sqlmodel import Field, JSON

from app.model.abstract.model import AbstractModel


class WorkflowEvent(AbstractModel, table=True):
    """Append-only event from agent execution.

    Does NOT inherit DefaultTimes because events are immutable --
    no updated_at or deleted_at.
    """

    __table_args__ = (
        UniqueConstraint(
            "run_id", "seq", name="uq_workflow_event_run_seq"
        ),
    )

    event_id: str = Field(primary_key=True)
    run_id: str = Field(index=True)
    task_id: Optional[str] = Field(default=None, index=True)
    project_id: str = Field(index=True)
    user_id: int = Field(index=True)
    seq: int
    event_type: str
    occurred_at: str  # ISO-8601 from the local client
    source: str = Field(default="camel")
    agent_id: Optional[str] = Field(default=None)
    agent_name: Optional[str] = Field(default=None)
    schema_version: int = Field(default=1)
    payload: str = Field(sa_type=JSON, default="{}")
    ingested_at: Optional[datetime] = Field(
        default_factory=datetime.now,
        sa_type=TIMESTAMP,
        sa_column_kwargs={
            "server_default": text("CURRENT_TIMESTAMP")
        },
    )

    @field_validator("payload", mode="before")
    @classmethod
    def serialize_payload(cls, v):
        if isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False)
        return v

    @field_validator("payload", mode="after")
    @classmethod
    def deserialize_payload(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return v
        return v


# -------------------------------------------------------------------
# Pydantic companion schemas
# -------------------------------------------------------------------


class WorkflowEventIn(BaseModel):
    """Ingestion payload for a single event (from sync worker)."""

    event_id: str
    run_id: str
    task_id: Optional[str] = None
    project_id: str
    seq: int
    event_type: str
    occurred_at: str
    source: str = "camel"
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    schema_version: int = 1
    payload: Any = {}


class WorkflowEventOut(BaseModel):
    """Read response for a single event."""

    event_id: str
    run_id: str
    task_id: Optional[str] = None
    project_id: str
    user_id: int
    seq: int
    event_type: str
    occurred_at: str
    source: str
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    schema_version: int
    payload: Any
    ingested_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BatchIngestRequest(BaseModel):
    """Batch ingestion request body."""

    events: list[WorkflowEventIn]

    @field_validator("events")
    @classmethod
    def limit_batch_size(cls, v):
        if len(v) > 200:
            raise ValueError(
                "Batch size must not exceed 200 events"
            )
        return v


class BatchIngestResponse(BaseModel):
    """Batch ingestion response body."""

    accepted: list[str] = []  # event_ids that were ingested
    rejected: list[dict[str, Any]] = []  # {event_id, reason}
