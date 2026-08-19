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
# Licensed under the Apache License, Version 2.0 (the "License");

"""Bounded, failure-independent incremental Memory maintenance."""

from __future__ import annotations

import hashlib
import logging
import re
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from typing import Protocol

from app.lightweight_memory.service import (
    HistoryQueryResult,
    LightweightMemoryService,
    count_tokens,
    format_project_cursor,
    parse_project_cursor,
)
from app.run_journal import MemoryScopeStateRecord

logger = logging.getLogger("lightweight_memory")
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="memory-v2")
_FUTURES: set[Future] = set()
_SCHEDULE_LOCK = threading.Lock()
_PROJECT_SCHEDULES: dict[str, _ProjectMaintenanceSchedule] = {}
_MAX_FAILURE_RETRIES = 5
_MAX_RETRY_DELAY_SECONDS = 60.0
_CONTINUATION_DELAY_SECONDS = 0.5

_EXPLICIT_MEMORY_PATTERNS = (
    re.compile(r"\b(?:please\s+)?remember(?:\s+that)?\s+(.+)", re.I | re.S),
    re.compile(r"\bI\s+prefer\s+(.+)", re.I | re.S),
    re.compile(r"\bmy\s+(?:preference|default)\s+is\s+(.+)", re.I | re.S),
    re.compile(
        r"\b(?:for|in)\s+(?:this|the\s+current)\s+"
        r"(?:project|space|workspace)\s*[:,]?\s*(.+)",
        re.I | re.S,
    ),
    re.compile(
        r"\b(?:for|across)\s+all\s+(?:projects|spaces)\s*[:,]?\s*(.+)",
        re.I | re.S,
    ),
    re.compile(r"(?:请)?记住[：,:]?\s*(.+)", re.S),
    re.compile(
        r"(?:这个|当前)(?:项目|空间|工作区)(?:中|里)?[：,:，]?\s*(.+)",
        re.S,
    ),
    re.compile(r"(?:所有项目|所有空间)(?:中|里)?[：,:，]?\s*(.+)", re.S),
    re.compile(r"我(?:更)?(?:偏好|喜欢)[：,:，]?\s*(.+)", re.S),
)
_USER_SCOPE_MARKERS = (
    "across all projects",
    "across all spaces",
    "for all projects",
    "for all spaces",
    "always remember",
    "my preference",
    "my default",
    "my personal preference",
    "所有项目",
    "所有空间",
    "所有 space",
    "以后都",
    "永远记住",
    "我的偏好",
    "个人偏好",
    "我偏好",
    "我喜欢",
)
_SPACE_SCOPE_MARKERS = (
    "this space",
    "current space",
    "this workspace",
    "our team",
    "这个空间",
    "当前空间",
    "这个 space",
    "当前 space",
    "这个工作区",
    "当前工作区",
    "团队",
)


@dataclass(frozen=True)
class ProposedMemoryMutation:
    kind: str
    content: str
    source_trust: str
    source_event_ids: tuple[str, ...]
    confidence: float
    sensitivity: str = "normal"
    target_scope: str = "project"


@dataclass
class _ProjectMaintenanceSchedule:
    future: Future | None = None
    timer: threading.Timer | None = None
    failure_attempts: int = 0


class MemoryExtractor(Protocol):
    version: str

    def extract(
        self,
        *,
        active_memory: tuple,
        history_delta: tuple[HistoryQueryResult, ...],
        target_scope: str = "project",
    ) -> tuple[ProposedMemoryMutation, ...]: ...


class ConservativeMemoryExtractor:
    """Extract only explicit user requests; Agent CRUD handles inferred notes.

    This deliberately avoids turning tool/web text or model prose into durable
    instructions. A model-backed extractor can implement the same protocol,
    but must retain these trust and mutation bounds.
    """

    version = "memory-v2-explicit-user-v1"

    def extract(
        self,
        *,
        active_memory: tuple,
        history_delta: tuple[HistoryQueryResult, ...],
        target_scope: str = "project",
    ) -> tuple[ProposedMemoryMutation, ...]:
        known = {entry.content.casefold().strip() for entry in active_memory}
        proposals: list[ProposedMemoryMutation] = []
        for item in history_delta:
            if item.event_type != "user.message":
                continue
            raw = item.content.get("content")
            if not isinstance(raw, str):
                continue
            for pattern in _EXPLICIT_MEMORY_PATTERNS:
                match = pattern.search(raw.strip())
                if match is None:
                    continue
                proposal_scope = self._target_scope(raw, match)
                if proposal_scope != target_scope:
                    continue
                content = match.group(1).strip().rstrip()
                if not content or len(content) > 1000:
                    break
                normalized = content.casefold()
                if normalized in known:
                    break
                matched_text = match.group(0).casefold()
                kind = (
                    "preference"
                    if any(
                        marker in matched_text
                        for marker in ("prefer", "preference", "偏好", "喜欢")
                    )
                    else "fact"
                )
                proposals.append(
                    ProposedMemoryMutation(
                        kind=kind,
                        content=content,
                        source_trust="user_asserted",
                        source_event_ids=(item.event_id,),
                        confidence=1.0,
                        target_scope=proposal_scope,
                    )
                )
                known.add(normalized)
                break
            if len(proposals) == 3:
                break
        return tuple(proposals)

    @staticmethod
    def _target_scope(raw: str, match: re.Match[str]) -> str:
        normalized = raw.casefold()
        if re.match(r"\bi\s+prefer\b", match.group(0), re.I):
            return "user"
        if any(marker in normalized for marker in _USER_SCOPE_MARKERS):
            return "user"
        if any(marker in normalized for marker in _SPACE_SCOPE_MARKERS):
            return "space"
        return "project"


class IncrementalMemoryMaintainer:
    """Advance only after a bounded delta is durably applied.

    Mutations are deterministic/idempotent. If the process crashes after a
    mutation but before the watermark CAS, replay returns the original result
    and cannot duplicate Memory.
    """

    def __init__(
        self,
        service: LightweightMemoryService,
        extractor: MemoryExtractor | None = None,
    ) -> None:
        self._service = service
        self._extractor = extractor or ConservativeMemoryExtractor()

    def process_project(self, project_id: str) -> MemoryScopeStateRecord:
        space_id, user_id = self._service.journal.get_memory_project_scopes(
            project_id
        )
        targets = [("project", project_id)]
        if space_id:
            targets.append(("space", space_id))
        if user_id:
            targets.append(("user", user_id))

        failures: list[tuple[str, str, Exception]] = []
        for scope_type, scope_id in targets:
            state = self._service.scope(scope_type, scope_id)
            if not state.capture_enabled:
                continue
            try:
                self._process_target(
                    source_project_id=project_id,
                    scope_type=scope_type,
                    scope_id=scope_id,
                )
            except Exception as exc:
                self._record_failure(
                    source_project_id=project_id,
                    scope_type=scope_type,
                    scope_id=scope_id,
                    error=exc,
                )
                failures.append((scope_type, scope_id, exc))

        if failures:
            scope_type, scope_id, error = failures[0]
            raise RuntimeError(
                f"Memory extraction failed for {scope_type}:{scope_id}: {error}"
            ) from error
        return self._service.scope("project", project_id)

    def _process_target(
        self,
        *,
        source_project_id: str,
        scope_type: str,
        scope_id: str,
    ) -> None:
        state = self._service.scope(scope_type, scope_id)
        ratio = state.current_token_count / state.token_limit
        if ratio >= state.consolidate_threshold and (
            state.last_consolidated_at is None
            or state.updated_at > state.last_consolidated_at
        ):
            state = self._service.consolidate_scope(
                scope_type=scope_type,
                scope_id=scope_id,
                reason="automatic bounded Memory consolidation",
                request_id=(
                    f"memory-auto-consolidate:{scope_type}:{scope_id}:"
                    f"{state.revision}"
                ),
            ).scope_state

        # One terminal trigger may represent a very long Run. Process a
        # bounded number of pages; the scheduler queues another pass whenever
        # any enabled target scope remains behind this Project History.
        for _ in range(10):
            after = self._target_watermark(
                source_project_id=source_project_id,
                scope_type=scope_type,
                scope_id=scope_id,
                state=state,
            )
            page = self._service.search_history(
                project_id=source_project_id,
                after_cursor=after,
                limit=100,
                byte_budget=256 * 1024,
                token_budget=16384,
            )
            if parse_project_cursor(page.next_cursor) == parse_project_cursor(
                after
            ):
                if page.complete:
                    if scope_type == "project":
                        if state.last_error is not None:
                            state = self._service.journal.record_memory_maintenance_result(
                                scope_type,
                                scope_id,
                                expected_revision=state.revision,
                                processed_through_watermark=page.next_cursor,
                                watermark_kind="journal_cursor",
                                extractor_version=self._extractor.version,
                            )
                    else:
                        self._service.journal.record_memory_extraction_watermark(
                            target_scope_type=scope_type,
                            target_scope_id=scope_id,
                            source_project_id=source_project_id,
                            processed_through_watermark=page.next_cursor,
                            watermark_kind="journal_cursor",
                            extractor_version=self._extractor.version,
                        )
                    return
                raise RuntimeError(
                    "History page exceeded the bounded extraction budget "
                    "before its first event"
                )

            active = self._service.list_entries(scope_type, scope_id)
            proposals = self._extractor.extract(
                active_memory=active,
                history_delta=page.items,
                target_scope=scope_type,
            )[:3]
            projected_tokens = state.current_token_count
            bounded_proposals: list[ProposedMemoryMutation] = []
            for proposal in proposals:
                proposal_tokens = count_tokens(proposal.content)
                if (
                    projected_tokens + proposal_tokens
                    > state.token_limit * 0.9
                ):
                    continue
                bounded_proposals.append(proposal)
                projected_tokens += proposal_tokens
            proposals = tuple(bounded_proposals)
            cursor_from = after or format_project_cursor(0)
            if not proposals and scope_type == "project":
                identity = hashlib.sha256(
                    (
                        f"{self._extractor.version}|{scope_type}|{scope_id}|"
                        f"{source_project_id}|{cursor_from}|"
                        f"{page.next_cursor}|noop"
                    ).encode()
                ).hexdigest()
                self._service.journal.apply_memory_mutation(
                    mutation_id=f"mut_{identity[:32]}",
                    idempotency_key=f"memory-extract-noop:{identity}",
                    operation="noop",
                    scope_type=scope_type,
                    scope_id=scope_id,
                    memory_id=None,
                    actor_type="extractor",
                    reason=(
                        "incremental extraction found no durable Memory "
                        f"in {cursor_from}..{page.next_cursor}"
                    ),
                    source_refs=tuple(
                        item.event_id for item in page.items[:32]
                    ),
                )
            for index, proposal in enumerate(proposals):
                identity = hashlib.sha256(
                    (
                        f"{self._extractor.version}|{scope_type}|{scope_id}|"
                        f"{source_project_id}|{cursor_from}|"
                        f"{page.next_cursor}|{index}|{proposal.kind}|"
                        f"{proposal.content}"
                    ).encode()
                ).hexdigest()
                self._service.create_entry(
                    scope_type=scope_type,
                    scope_id=scope_id,
                    kind=proposal.kind,
                    content=proposal.content,
                    actor_type="extractor",
                    reason=(
                        "incremental extraction "
                        f"{cursor_from}..{page.next_cursor}"
                    ),
                    source_trust=proposal.source_trust,
                    source_refs=proposal.source_event_ids,
                    sensitivity=proposal.sensitivity,
                    request_id=f"memory-extract:{identity}",
                )

            state = self._service.scope(scope_type, scope_id)
            if scope_type == "project":
                state = self._service.journal.record_memory_maintenance_result(
                    scope_type,
                    scope_id,
                    expected_revision=state.revision,
                    processed_through_watermark=page.next_cursor,
                    watermark_kind="journal_cursor",
                    extractor_version=self._extractor.version,
                )
            else:
                self._service.journal.record_memory_extraction_watermark(
                    target_scope_type=scope_type,
                    target_scope_id=scope_id,
                    source_project_id=source_project_id,
                    processed_through_watermark=page.next_cursor,
                    watermark_kind="journal_cursor",
                    extractor_version=self._extractor.version,
                )
            if page.complete:
                return

    def _target_watermark(
        self,
        *,
        source_project_id: str,
        scope_type: str,
        scope_id: str,
        state: MemoryScopeStateRecord,
    ) -> str | None:
        if scope_type == "project":
            return state.processed_through_watermark
        return self._service.journal.get_memory_extraction_watermark(
            target_scope_type=scope_type,
            target_scope_id=scope_id,
            source_project_id=source_project_id,
        )

    def _record_failure(
        self,
        *,
        source_project_id: str,
        scope_type: str,
        scope_id: str,
        error: Exception,
    ) -> None:
        try:
            if scope_type == "project":
                current = self._service.scope(scope_type, scope_id)
                self._service.journal.record_memory_maintenance_result(
                    scope_type,
                    scope_id,
                    expected_revision=current.revision,
                    processed_through_watermark=None,
                    watermark_kind=None,
                    extractor_version=self._extractor.version,
                    last_error=str(error),
                )
            else:
                self._service.journal.record_memory_extraction_watermark(
                    target_scope_type=scope_type,
                    target_scope_id=scope_id,
                    source_project_id=source_project_id,
                    processed_through_watermark=None,
                    watermark_kind=None,
                    extractor_version=self._extractor.version,
                    last_error=str(error),
                )
        except Exception:
            logger.exception(
                "Failed to record Memory extraction error",
                extra={"scope_type": scope_type, "scope_id": scope_id},
            )


def _maintenance_retry_delay(failure_attempts: int) -> float | None:
    if failure_attempts < 1 or failure_attempts > _MAX_FAILURE_RETRIES:
        return None
    return min(2 ** (failure_attempts - 1), _MAX_RETRY_DELAY_SECONDS)


def _memory_maintenance_is_behind(
    service: LightweightMemoryService, project_id: str
) -> bool:
    available = service.journal.get_project_history_cursor(project_id)
    project_state = service.scope("project", project_id)
    if project_state.capture_enabled and (
        parse_project_cursor(project_state.processed_through_watermark)
        < available
    ):
        return True
    space_id, user_id = service.journal.get_memory_project_scopes(project_id)
    for scope_type, scope_id in (("space", space_id), ("user", user_id)):
        if not scope_id:
            continue
        state = service.scope(scope_type, scope_id)
        if not state.capture_enabled:
            continue
        watermark = service.journal.get_memory_extraction_watermark(
            target_scope_type=scope_type,
            target_scope_id=scope_id,
            source_project_id=project_id,
        )
        if parse_project_cursor(watermark) < available:
            return True
    return False


def _submit_project_memory_maintenance(project_id: str) -> None:
    """Submit one pass, coalescing all triggers for the same Project."""

    from app.lightweight_memory.service import get_lightweight_memory_service

    with _SCHEDULE_LOCK:
        state = _PROJECT_SCHEDULES.setdefault(
            project_id, _ProjectMaintenanceSchedule()
        )
        state.timer = None
        # A completed Future remains the lane owner until its callback clears
        # it. Treating future.done() as idle opens a submit/callback race.
        if state.future is not None:
            return
        # Reserve the Project lane while the scheduler lock is held. Without
        # this, two terminal notifications can both observe an empty lane and
        # submit concurrent extraction passes for the same durable cursor.
        future = _EXECUTOR.submit(
            IncrementalMemoryMaintainer(
                get_lightweight_memory_service()
            ).process_project,
            project_id,
        )
        state.future = future
    _FUTURES.add(future)

    def _done(completed: Future) -> None:
        _FUTURES.discard(completed)
        with _SCHEDULE_LOCK:
            current = _PROJECT_SCHEDULES.setdefault(
                project_id, _ProjectMaintenanceSchedule()
            )
            if current.future is completed:
                current.future = None
        try:
            scope_state = completed.result()
            if scope_state.last_error is not None:
                with _SCHEDULE_LOCK:
                    current.failure_attempts += 1
                    failure_attempts = current.failure_attempts
                delay = _maintenance_retry_delay(failure_attempts)
                if delay is not None:
                    logger.warning(
                        "Incremental Memory maintenance returned an error",
                        extra={
                            "project_id": project_id,
                            "failure_attempts": failure_attempts,
                            "last_error": scope_state.last_error,
                        },
                    )
                    _schedule_project_memory_maintenance_after(
                        project_id, delay
                    )
                else:
                    with _SCHEDULE_LOCK:
                        _PROJECT_SCHEDULES.pop(project_id, None)
                    logger.error(
                        "Incremental Memory maintenance retry budget exhausted",
                        extra={
                            "project_id": project_id,
                            "last_error": scope_state.last_error,
                        },
                    )
                return
            behind = _memory_maintenance_is_behind(
                get_lightweight_memory_service(), project_id
            )
            if behind:
                with _SCHEDULE_LOCK:
                    current.failure_attempts = 0
                _schedule_project_memory_maintenance_after(
                    project_id, _CONTINUATION_DELAY_SECONDS
                )
            else:
                with _SCHEDULE_LOCK:
                    _PROJECT_SCHEDULES.pop(project_id, None)
        except Exception:
            with _SCHEDULE_LOCK:
                current.failure_attempts += 1
                failure_attempts = current.failure_attempts
            logger.exception(
                "Incremental Memory maintenance failed",
                extra={
                    "project_id": project_id,
                    "failure_attempts": failure_attempts,
                },
            )
            delay = _maintenance_retry_delay(failure_attempts)
            if delay is not None:
                _schedule_project_memory_maintenance_after(project_id, delay)
            else:
                with _SCHEDULE_LOCK:
                    _PROJECT_SCHEDULES.pop(project_id, None)
                logger.error(
                    "Incremental Memory maintenance retry budget exhausted",
                    extra={"project_id": project_id},
                )

    future.add_done_callback(_done)


def _schedule_project_memory_maintenance_after(
    project_id: str, delay_seconds: float
) -> None:
    with _SCHEDULE_LOCK:
        state = _PROJECT_SCHEDULES.setdefault(
            project_id, _ProjectMaintenanceSchedule()
        )
        if state.future is not None:
            return
        if state.timer is not None and state.timer.is_alive():
            return
        timer = threading.Timer(
            delay_seconds, _submit_project_memory_maintenance, (project_id,)
        )
        timer.daemon = True
        state.timer = timer
        timer.start()


def schedule_project_memory_maintenance(project_id: str) -> None:
    """Best-effort terminal trigger with bounded retry and continuation pace."""

    normalized = project_id.strip()
    if not normalized:
        return
    with _SCHEDULE_LOCK:
        state = _PROJECT_SCHEDULES.setdefault(
            normalized, _ProjectMaintenanceSchedule()
        )
        active = state.future is not None or (
            state.timer is not None and state.timer.is_alive()
        )
        if active:
            return
        # A later terminal Run is a new trigger and gets a fresh bounded retry
        # budget even when an earlier pass exhausted its own attempts.
        state.failure_attempts = 0
    _submit_project_memory_maintenance(normalized)
