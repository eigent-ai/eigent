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
import logging
from collections.abc import Callable
from typing import Any

from app.run_journal.models import CommittedRunEvent, RunEventDraft
from app.run_journal.semantic_events import project_legacy_semantic_event
from app.run_journal.store import SQLiteRunJournal

logger = logging.getLogger("event_recorder")

_WORKFORCE_SUBTASK_EVENT_TYPES = frozenset(
    {
        "subtask.created",
        "subtask.queued",
        "subtask.started",
        "subtask.completed",
        "subtask.failed",
        "subtask.cancelled",
    }
)


class EventRecorder:
    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        on_commit: Callable[[], None] | None = None,
    ) -> None:
        self._journal = journal
        self._on_commit = on_commit

    def _notify_commit(self) -> None:
        if self._on_commit is None:
            return
        try:
            self._on_commit()
        except Exception:
            # The SQLite commit is already authoritative. A wakeup failure may
            # delay Cloud freshness but must never make the producer retry the
            # canonical local event.
            logger.exception("Run event sync wakeup failed after commit")

    async def commit(
        self,
        run_id: str,
        draft: RunEventDraft,
        *,
        expected_version: int | None = None,
    ) -> CommittedRunEvent:
        """Commit a typed event and its sync outbox row before publication."""

        event = await asyncio.to_thread(
            self._journal.append_event,
            run_id,
            draft,
            expected_version=expected_version,
        )
        self._notify_commit()
        return event

    async def record_legacy_step(
        self,
        *,
        project_id: str,
        run_id: str,
        step: str,
        data: dict[str, Any],
        event_id: str | None = None,
        created_at: float | None = None,
        allow_terminal: bool = False,
    ) -> CommittedRunEvent:
        """Persist one legacy SSE/ChatStep for an already admitted Run."""

        if step == "end" and not allow_terminal:
            raise ValueError(
                "legacy end is reserved for the trusted execution stream"
            )

        enriched_data = dict(data)
        step_id = str(enriched_data.get("step_id") or "").strip() or None
        semantic = project_legacy_semantic_event(
            step=step,
            data=enriched_data,
            run_id=run_id,
        )
        if step_id is None:
            from app.run_runtime.step_coordinator import (
                RunStepCoordinator,
                get_current_step_id,
                stable_step_id,
            )

            # A Workforce subtask has a deterministic identity. Resolve it
            # before the generic ContextVar/sole-running-Step fallback so a
            # queued sibling can never inherit another task's running Step.
            if (
                semantic is not None
                and semantic.event_type in _WORKFORCE_SUBTASK_EVENT_TYPES
            ):
                task_id = str(semantic.payload.get("task_id") or "").strip()
                if task_id:
                    step_id = stable_step_id(
                        run_id,
                        f"subtask:{task_id}",
                    )
            if step_id is None:
                step_id = get_current_step_id()
            if step_id is None:
                step_id = await asyncio.to_thread(
                    RunStepCoordinator(self._journal).current_running_step_id,
                    run_id,
                )
        if step_id:
            enriched_data["step_id"] = step_id

        projected_payload = (
            dict(semantic.payload) if semantic is not None else enriched_data
        )
        if step_id:
            projected_payload["step_id"] = step_id
            envelope = projected_payload.get("semantic")
            if isinstance(envelope, dict):
                correlation = envelope.get("correlation")
                if not isinstance(correlation, dict):
                    correlation = {}
                    envelope["correlation"] = correlation
                correlation["step_id"] = step_id
        values: dict[str, Any] = {
            "event_type": (
                semantic.event_type
                if semantic is not None
                else f"legacy.{step}"
            ),
            "payload": projected_payload,
            "legacy_step": step,
        }
        if event_id is not None:
            values["event_id"] = event_id
        if created_at is not None:
            values["created_at"] = created_at
        draft = RunEventDraft(**values)
        if (
            semantic is not None
            and semantic.event_type in _WORKFORCE_SUBTASK_EVENT_TYPES
        ):
            event = await asyncio.to_thread(
                self._journal.append_event_with_workforce_step_projection,
                run_id,
                draft,
                expected_project_id=project_id,
            )
        else:
            event = await asyncio.to_thread(
                self._journal.append_event,
                run_id,
                draft,
                expected_project_id=project_id,
            )
        self._notify_commit()
        return event

    async def record_assistant_final(
        self,
        *,
        project_id: str,
        run_id: str,
        data: Any,
        created_at: float | None = None,
    ) -> CommittedRunEvent:
        """Reject the obsolete standalone final-result write path.

        A successful result is only canonical when the Journal commits it in
        the same transaction as ``run.completed`` and its latest Artifact
        manifest.  Keeping this compatibility method fail-closed prevents a
        future caller from reintroducing a split result/terminal write.
        """

        del project_id, run_id, data, created_at
        raise RuntimeError(
            "assistant.final must be committed atomically via "
            "SQLiteRunJournal.complete_successful_run"
        )

    async def record_user_message(
        self,
        *,
        project_id: str,
        run_id: str,
        request_id: str,
        content: str,
        source: str,
        attachment_names: list[str] | None = None,
        review_handoff_ids: list[str] | None = None,
        created_at: float | None = None,
    ) -> CommittedRunEvent:
        """Commit the Run's canonical user instruction before execution."""

        payload: dict[str, Any] = {
            "content": content,
            "source": source,
            "attachment_names": list(attachment_names or []),
            "review_handoff_ids": list(review_handoff_ids or []),
        }
        values: dict[str, Any] = {
            "event_id": f"user-message:{request_id}",
            "event_type": "user.message",
            "payload": payload,
        }
        if created_at is not None:
            values["created_at"] = created_at
        event = await asyncio.to_thread(
            self._journal.append_event,
            run_id,
            RunEventDraft(**values),
            expected_project_id=project_id,
        )
        self._notify_commit()
        return event
