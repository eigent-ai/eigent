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

"""Async EventRecorder façade over the single-writer RunJournal."""

from __future__ import annotations

import asyncio
from typing import Any

from app.run_journal.models import CommittedRunEvent, RunEventDraft
from app.run_journal.store import SQLiteRunJournal


class EventRecorder:
    def __init__(self, journal: SQLiteRunJournal) -> None:
        self._journal = journal

    async def commit(
        self,
        run_id: str,
        draft: RunEventDraft,
        *,
        expected_version: int | None = None,
    ) -> CommittedRunEvent:
        """Commit a typed event and its sync outbox row before publication."""

        return await asyncio.to_thread(
            self._journal.append_event,
            run_id,
            draft,
            expected_version=expected_version,
        )

    async def record_legacy_step(
        self,
        *,
        project_id: str,
        run_id: str,
        step: str,
        data: dict[str, Any],
        event_id: str | None = None,
        created_at: float | None = None,
    ) -> CommittedRunEvent:
        """Persist one legacy SSE/ChatStep for an already admitted Run."""

        values: dict[str, Any] = {
            "event_type": f"legacy.{step}",
            "payload": data,
            "legacy_step": step,
        }
        if event_id is not None:
            values["event_id"] = event_id
        if created_at is not None:
            values["created_at"] = created_at
        draft = RunEventDraft(**values)
        return await asyncio.to_thread(
            self._journal.append_event,
            run_id,
            draft,
            expected_project_id=project_id,
        )
