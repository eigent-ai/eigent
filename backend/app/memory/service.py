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

"""MemoryService — Run/Project/Space lifecycle hooks (§7 of design doc).

Thin orchestration layer above LocalMemoryStore that callers (chat_controller,
single_agent_service) use without having to know how the on-disk layout works.

Every hook is wrapped so a memory write failure logs and returns silently --
chat must not break because the memory writer hit an OSError. Callers can
treat the return values as best-effort.

Backward compatibility:
- existing Phase-0 path (`project_context` bridge + in-process `agent_memory`
  snapshots) keeps working; this service simply also persists a durable copy.
- on_run_start is idempotent on Space/Project json files: it only overwrites
  fields known to be authoritative right now (name, updated_at, last_run_id);
  other fields are preserved if the file already exists.
"""

from __future__ import annotations

import hashlib
import logging
import os
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from app.memory.context_builder import ContextMode, ProjectContextBuilder
from app.memory.events import (
    ConversationEvent,
    MemoryArtifact,
    ProjectMemory,
    RunMemory,
    RunStatus,
    SpaceMemory,
)
from app.memory.local_store import LocalMemoryStore
from app.memory.paths import canonical_user_id
from app.run_context import RunContext

logger = logging.getLogger("memory.service")


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _sha256(content: str) -> str:
    return "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest()


def _resolve_user_key(run_context: RunContext) -> str | None:
    try:
        return canonical_user_id(run_context.user_id, email=run_context.email)
    except ValueError:
        logger.warning(
            "memory.service: no user identity on RunContext; skipping write",
            extra={
                "project_id": run_context.project_id,
                "run_id": run_context.run_id,
            },
        )
        return None


def _new_event_id() -> str:
    return "evt_" + uuid.uuid4().hex[:16]


def _new_artifact_id() -> str:
    return "art_" + uuid.uuid4().hex[:16]


def _default_memory_token_budget() -> int:
    raw = os.environ.get("EIGENT_MEMORY_TOKEN_BUDGET")
    if not raw:
        return 8000
    try:
        return int(raw)
    except ValueError:
        logger.warning(
            "Invalid EIGENT_MEMORY_TOKEN_BUDGET=%r; using default 8000", raw
        )
        return 8000


def build_durable_context_for_task_lock(
    task_lock: Any,
    *,
    mode: ContextMode,
    current_user_prompt: str,
    token_budget: int | None = None,
) -> str | None:
    """Read the durable Project memory bundle for the run on this task lock.

    Returns a rendered prompt fragment (string) when the bundle has any
    signal, else None. Best-effort: any read error logs + returns None so
    chat never breaks on a memory glitch.

    Shared by Single Agent and Workforce paths so both modes recover from
    `~/.eigent/memory` after restart with the same code path. The mode arg
    drives how the bundle is rendered (single_agent narrative vs
    workforce_coordinator planning view).
    """

    run_context = getattr(task_lock, "run_context", None)
    if run_context is None:
        return None

    service = getattr(task_lock, "memory_service", None)
    if service is None:
        return None

    try:
        user_key = canonical_user_id(
            run_context.user_id, email=run_context.email
        )
    except ValueError:
        return None

    budget = (
        token_budget
        if token_budget is not None
        else _default_memory_token_budget()
    )
    try:
        builder = ProjectContextBuilder(service.store)
        bundle = builder.build(
            user_key=user_key,
            space_id=run_context.space_id,
            project_id=run_context.project_id,
            run_id=run_context.run_id,
            mode=mode,
            token_budget=budget,
            current_user_prompt=current_user_prompt,
        )
    except Exception:  # noqa: BLE001 — best-effort read
        logger.warning(
            "memory.context_builder: build failed; falling back to legacy context",
            extra={
                "project_id": run_context.project_id,
                "run_id": run_context.run_id,
                "mode": mode,
            },
            exc_info=True,
        )
        return None

    if bundle.is_empty():
        return None
    return bundle.to_prompt(mode)


def finalize_task_lock_run_memory(
    task_lock: Any,
    *,
    state: Literal["done", "failed", "cancelled"],
    final_result: str | None = None,
    summary: str | None = None,
    error: str | None = None,
) -> bool:
    """Finalize durable memory for the Run currently attached to a TaskLock.

    Shared by Single Agent and Workforce paths. The helper is intentionally
    best-effort and idempotent per run id so duplicate SSE end/finally paths do
    not rewrite a successful `done` as `cancelled`.
    """

    service = getattr(task_lock, "memory_service", None)
    run_context = getattr(task_lock, "run_context", None)
    if service is None or run_context is None:
        return False

    finalized = getattr(task_lock, "_memory_finalized_runs", None)
    if finalized is None:
        finalized = set()
        task_lock._memory_finalized_runs = finalized
    if run_context.run_id in finalized:
        return False

    try:
        service.register_runtime_log_artifact(
            run_context=run_context,
            relative_path=f"task_{run_context.run_id}/camel_logs",
        )
        service.on_run_end(
            run_context=run_context,
            state=state,
            final_result=final_result,
            summary=summary,
            error=error,
        )
        return True
    except Exception:  # noqa: BLE001
        logger.warning(
            "memory finalize for task lock failed",
            extra={
                "project_id": getattr(run_context, "project_id", None),
                "run_id": getattr(run_context, "run_id", None),
                "state": state,
            },
            exc_info=True,
        )
        return False
    finally:
        finalized.add(run_context.run_id)


class MemoryService:
    """Lifecycle facade over LocalMemoryStore.

    One service instance per Brain process is enough; the LocalMemoryStore
    underneath is filesystem-backed and concurrency-safe per path.
    """

    def __init__(self, store: LocalMemoryStore | None = None) -> None:
        self._store = store or LocalMemoryStore()

    @property
    def store(self) -> LocalMemoryStore:
        return self._store

    # ----- Run Start -----

    def on_run_start(
        self,
        *,
        run_context: RunContext,
        space_name: str | None,
        project_name: str | None,
        space_source_type: Literal["folder", "blank", "legacy"] = "blank",
        mode: Literal["single_agent", "workforce"] | None,
        user_prompt: str,
        prompt_source: Literal[
            "chat", "trigger", "improve", "imported"
        ] = "chat",
    ) -> str | None:
        """Initialise Space/Project/Run records and append the user prompt.

        Returns the conversation event_id for the appended user message, or
        None if memory write was skipped (no identity / disk error).
        """

        user_key = _resolve_user_key(run_context)
        if user_key is None:
            return None
        now = _utc_now()

        try:
            self._ensure_space(
                user_key=user_key,
                run_context=run_context,
                name=space_name,
                source_type=space_source_type,
                now=now,
            )
            self._ensure_project(
                user_key=user_key,
                run_context=run_context,
                name=project_name,
                mode=mode,
                now=now,
            )
            self._write_run_header(
                user_key=user_key,
                run_context=run_context,
                mode=mode,
                user_prompt=user_prompt,
                now=now,
            )
            self._set_run_status(
                user_key=user_key,
                run_context=run_context,
                state="running",
                started_at=now,
                ended_at=None,
                error=None,
            )
            event_id = self._append_conversation(
                user_key=user_key,
                run_context=run_context,
                role="user",
                content=user_prompt,
                source=prompt_source,
                now=now,
            )
            return event_id
        except Exception:  # noqa: BLE001 — service is best-effort
            logger.warning(
                "memory.service.on_run_start: write failed; chat continues",
                extra={
                    "project_id": run_context.project_id,
                    "run_id": run_context.run_id,
                },
                exc_info=True,
            )
            return None

    # ----- Per-turn writes -----

    def on_assistant_message(
        self,
        *,
        run_context: RunContext,
        content: str,
        source: Literal["chat", "trigger", "improve", "imported"] = "chat",
    ) -> str | None:
        # TODO(memory-streaming): wire this when assistant chunks/coordinator
        # narration are persisted incrementally instead of only at on_run_end.
        if not content.strip():
            return None
        user_key = _resolve_user_key(run_context)
        if user_key is None:
            return None
        try:
            return self._append_conversation(
                user_key=user_key,
                run_context=run_context,
                role="assistant",
                content=content,
                source=source,
                now=_utc_now(),
            )
        except Exception:  # noqa: BLE001
            logger.warning(
                "memory.service.on_assistant_message: append failed",
                extra={
                    "project_id": run_context.project_id,
                    "run_id": run_context.run_id,
                },
                exc_info=True,
            )
            return None

    # ----- Run End -----

    def on_run_end(
        self,
        *,
        run_context: RunContext,
        state: Literal["done", "failed", "cancelled"],
        final_result: str | None = None,
        summary: str | None = None,
        error: str | None = None,
    ) -> None:
        user_key = _resolve_user_key(run_context)
        if user_key is None:
            return
        now = _utc_now()
        try:
            # Persist the assistant's final response on the Project transcript
            # so cross-restart continuation sees it.
            if final_result and final_result.strip():
                self._append_conversation(
                    user_key=user_key,
                    run_context=run_context,
                    role="assistant",
                    content=final_result,
                    source="chat",
                    now=now,
                )
            self._set_run_status(
                user_key=user_key,
                run_context=run_context,
                state=state,
                started_at=None,
                ended_at=now,
                error=error,
            )
            if summary:
                self._store.write_run_summary(
                    user_key,
                    run_context.space_id,
                    run_context.project_id,
                    run_context.run_id,
                    summary,
                )

            # Touch project.json so updated_at + last_run_id stay current.
            self._touch_project(
                user_key=user_key,
                run_context=run_context,
                now=now,
            )
        except Exception:  # noqa: BLE001
            logger.warning(
                "memory.service.on_run_end: write failed",
                extra={
                    "project_id": run_context.project_id,
                    "run_id": run_context.run_id,
                    "state": state,
                },
                exc_info=True,
            )

    def register_runtime_log_artifact(
        self,
        *,
        run_context: RunContext,
        relative_path: str,
        kind: Literal["runtime_log"] = "runtime_log",
    ) -> None:
        """Register a runtime log (e.g. camel_logs) so it shows up in the
        artifact manifest but stays excluded from user file UI and context."""

        user_key = _resolve_user_key(run_context)
        if user_key is None:
            return
        try:
            self._store.upsert_artifact(
                user_key,
                run_context.space_id,
                run_context.project_id,
                MemoryArtifact(
                    artifact_id=_new_artifact_id(),
                    run_id=run_context.run_id,
                    path=relative_path,
                    kind=kind,
                    visible_to_user=False,
                    eligible_for_context=False,
                    hash="",
                    created_at=_utc_now(),
                ),
            )
        except Exception:  # noqa: BLE001
            logger.warning(
                "memory.service.register_runtime_log_artifact failed",
                extra={
                    "project_id": run_context.project_id,
                    "run_id": run_context.run_id,
                    "relative_path": relative_path,
                },
                exc_info=True,
            )

    # ----- Internals -----

    def _ensure_space(
        self,
        *,
        user_key: str,
        run_context: RunContext,
        name: str | None,
        source_type: Literal["folder", "blank", "legacy"],
        now: str,
    ) -> None:
        existing = self._store.read_space(user_key, run_context.space_id)
        canonical_name = (name or "").strip()
        if existing is None:
            payload = SpaceMemory(
                space_id=run_context.space_id,
                user_id=str(run_context.user_id or ""),
                name=canonical_name or run_context.space_id,
                source_type=(
                    "legacy"
                    if run_context.space_id.startswith("legacy_")
                    else source_type
                ),
                created_at=now,
                updated_at=now,
            )
            self._store.write_space(user_key, payload)
            return
        # Only update name + updated_at when a meaningful name comes in.
        if canonical_name and canonical_name != existing.name:
            updated = SpaceMemory(
                space_id=existing.space_id,
                user_id=existing.user_id,
                name=canonical_name,
                source_type=existing.source_type,
                created_at=existing.created_at,
                updated_at=now,
                root_fingerprint=existing.root_fingerprint,
                sync=existing.sync,
                schema_version=existing.schema_version,
            )
            self._store.write_space(user_key, updated)

    def _ensure_project(
        self,
        *,
        user_key: str,
        run_context: RunContext,
        name: str | None,
        mode: Literal["single_agent", "workforce"] | None,
        now: str,
    ) -> None:
        existing = self._store.read_project(
            user_key, run_context.space_id, run_context.project_id
        )
        canonical_name = (name or "").strip()
        if existing is None:
            payload = ProjectMemory(
                project_id=run_context.project_id,
                space_id=run_context.space_id,
                name=canonical_name or run_context.project_id,
                created_at=now,
                updated_at=now,
                mode=mode,
                last_run_id=run_context.run_id,
            )
            self._store.write_project(user_key, payload)
            return
        # Refresh name + mode + last_run_id; never resurrect a missing
        # created_at.
        new_name = (
            canonical_name
            if canonical_name and canonical_name != existing.name
            else existing.name
        )
        new_mode = mode if mode is not None else existing.mode
        payload = ProjectMemory(
            project_id=existing.project_id,
            space_id=existing.space_id,
            name=new_name,
            created_at=existing.created_at,
            updated_at=now,
            mode=new_mode,
            last_run_id=run_context.run_id,
            sync=existing.sync,
            schema_version=existing.schema_version,
        )
        self._store.write_project(user_key, payload)

    def _touch_project(
        self,
        *,
        user_key: str,
        run_context: RunContext,
        now: str,
    ) -> None:
        existing = self._store.read_project(
            user_key, run_context.space_id, run_context.project_id
        )
        if existing is None:
            return
        payload = ProjectMemory(
            project_id=existing.project_id,
            space_id=existing.space_id,
            name=existing.name,
            created_at=existing.created_at,
            updated_at=now,
            mode=existing.mode,
            last_run_id=run_context.run_id,
            sync=existing.sync,
            schema_version=existing.schema_version,
        )
        self._store.write_project(user_key, payload)

    def _write_run_header(
        self,
        *,
        user_key: str,
        run_context: RunContext,
        mode: Literal["single_agent", "workforce"] | None,
        user_prompt: str,
        now: str,
    ) -> None:
        # Follow-up turns (improve / supplement) pass mode=None to avoid
        # overwriting project.json. The run header still needs the right mode
        # so ContextBuilder can pick the matching profile -- inherit from
        # project.json when available.
        if mode is None:
            existing_project = self._store.read_project(
                user_key, run_context.space_id, run_context.project_id
            )
            if (
                existing_project is not None
                and existing_project.mode is not None
            ):
                mode = existing_project.mode
        self._store.write_run(
            user_key,
            RunMemory(
                run_id=run_context.run_id,
                project_id=run_context.project_id,
                space_id=run_context.space_id,
                mode=mode,
                user_prompt=user_prompt,
                started_at=now,
            ),
        )

    def _set_run_status(
        self,
        *,
        user_key: str,
        run_context: RunContext,
        state: Literal["running", "done", "failed", "cancelled"],
        started_at: str | None,
        ended_at: str | None,
        error: str | None,
    ) -> None:
        # Preserve started_at across status transitions.
        existing = self._store.read_run_status(
            user_key,
            run_context.space_id,
            run_context.project_id,
            run_context.run_id,
        )
        resolved_start = started_at or (
            existing.started_at if existing is not None else _utc_now()
        )
        self._store.write_run_status(
            user_key,
            run_context.space_id,
            run_context.project_id,
            run_context.run_id,
            RunStatus(
                run_id=run_context.run_id,
                state=state,
                started_at=resolved_start,
                ended_at=ended_at,
                last_error=error,
            ),
        )

    def _append_conversation(
        self,
        *,
        user_key: str,
        run_context: RunContext,
        role: Literal["user", "assistant", "system"],
        content: str,
        source: Literal["chat", "trigger", "improve", "imported"],
        now: str,
    ) -> str:
        event_id = _new_event_id()
        self._store.append_conversation(
            user_key,
            run_context.space_id,
            run_context.project_id,
            ConversationEvent(
                event_id=event_id,
                run_id=run_context.run_id,
                timestamp=now,
                role=role,
                content=content,
                source=source,
                visibility="context",
                hash=_sha256(content),
            ),
        )
        return event_id


# Module-level singleton for callers that don't need to inject a custom store.
_DEFAULT_SERVICE: MemoryService | None = None


def get_memory_service() -> MemoryService:
    global _DEFAULT_SERVICE
    if _DEFAULT_SERVICE is None:
        _DEFAULT_SERVICE = MemoryService()
    return _DEFAULT_SERVICE


def _reset_memory_service_for_tests(
    service: MemoryService | None = None,
) -> None:
    """Test seam — replace or clear the singleton."""

    global _DEFAULT_SERVICE
    _DEFAULT_SERVICE = service
