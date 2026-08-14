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

_EXPLICIT_MEMORY_PATTERNS = (
    re.compile(r"\b(?:please\s+)?remember(?:\s+that)?\s+(.+)", re.I | re.S),
    re.compile(r"\bI\s+prefer\s+(.+)", re.I | re.S),
    re.compile(r"(?:请)?记住[：,:]?\s*(.+)", re.S),
)


@dataclass(frozen=True)
class ProposedMemoryMutation:
    kind: str
    content: str
    source_trust: str
    source_event_ids: tuple[str, ...]
    confidence: float
    sensitivity: str = "normal"


class MemoryExtractor(Protocol):
    version: str

    def extract(
        self,
        *,
        active_memory: tuple,
        history_delta: tuple[HistoryQueryResult, ...],
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
                content = match.group(1).strip().rstrip()
                if not content or len(content) > 1000:
                    break
                normalized = content.casefold()
                if normalized in known:
                    break
                kind = (
                    "preference"
                    if "prefer" in match.group(0).casefold()
                    else "fact"
                )
                proposals.append(
                    ProposedMemoryMutation(
                        kind=kind,
                        content=content,
                        source_trust="user_asserted",
                        source_event_ids=(item.event_id,),
                        confidence=1.0,
                    )
                )
                known.add(normalized)
                break
            if len(proposals) == 3:
                break
        return tuple(proposals)


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
        state = self._service.scope("project", project_id)
        if not state.capture_enabled:
            return state
        try:
            ratio = state.current_token_count / state.token_limit
            if ratio >= state.consolidate_threshold and (
                state.last_consolidated_at is None
                or state.updated_at > state.last_consolidated_at
            ):
                state = self._service.consolidate_scope(
                    scope_type="project",
                    scope_id=project_id,
                    reason="automatic bounded Memory consolidation",
                    request_id=(
                        f"memory-auto-consolidate:{project_id}:"
                        f"{state.revision}"
                    ),
                ).scope_state
            # One terminal trigger may represent a very long Run. Process a
            # bounded number of pages instead of silently stopping after the
            # first 100 events. The scheduler queues another bounded pass when
            # history still remains.
            for _ in range(10):
                after = state.processed_through_watermark
                page = self._service.search_history(
                    project_id=project_id,
                    after_cursor=after,
                    limit=100,
                    byte_budget=256 * 1024,
                    token_budget=16384,
                )
                if parse_project_cursor(
                    page.next_cursor
                ) == parse_project_cursor(after):
                    current = self._service.scope("project", project_id)
                    return (
                        self._service.journal.record_memory_maintenance_result(
                            "project",
                            project_id,
                            expected_revision=current.revision,
                            processed_through_watermark=None,
                            watermark_kind=None,
                            extractor_version=self._extractor.version,
                            last_error=(
                                "History page exceeded the bounded extraction "
                                "budget before its first event"
                            ),
                        )
                    )
                active = self._service.list_entries("project", project_id)
                proposals = self._extractor.extract(
                    active_memory=active,
                    history_delta=page.items,
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
                if not proposals:
                    identity = hashlib.sha256(
                        (
                            f"{self._extractor.version}|{project_id}|"
                            f"{cursor_from}|{page.next_cursor}|noop"
                        ).encode()
                    ).hexdigest()
                    self._service.journal.apply_memory_mutation(
                        mutation_id=f"mut_{identity[:32]}",
                        idempotency_key=f"memory-extract-noop:{identity}",
                        operation="noop",
                        scope_type="project",
                        scope_id=project_id,
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
                            f"{self._extractor.version}|{project_id}|"
                            f"{cursor_from}|{page.next_cursor}|{index}|"
                            f"{proposal.kind}|{proposal.content}"
                        ).encode()
                    ).hexdigest()
                    self._service.create_entry(
                        scope_type="project",
                        scope_id=project_id,
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
                current = self._service.scope("project", project_id)
                state = self._service.journal.record_memory_maintenance_result(
                    "project",
                    project_id,
                    expected_revision=current.revision,
                    processed_through_watermark=page.next_cursor,
                    watermark_kind="journal_cursor",
                    extractor_version=self._extractor.version,
                )
                if page.complete:
                    return state
            return state
        except Exception as exc:
            current = self._service.scope("project", project_id)
            try:
                self._service.journal.record_memory_maintenance_result(
                    "project",
                    project_id,
                    expected_revision=current.revision,
                    processed_through_watermark=None,
                    watermark_kind=None,
                    extractor_version=self._extractor.version,
                    last_error=str(exc),
                )
            except Exception:
                pass
            raise


def schedule_project_memory_maintenance(project_id: str) -> None:
    """Best-effort, bounded terminal trigger with strong task references."""

    from app.lightweight_memory.service import get_lightweight_memory_service

    future = _EXECUTOR.submit(
        IncrementalMemoryMaintainer(
            get_lightweight_memory_service()
        ).process_project,
        project_id,
    )
    _FUTURES.add(future)

    def _done(completed: Future) -> None:
        _FUTURES.discard(completed)
        try:
            state = completed.result()
            if (
                state.last_error is None
                and parse_project_cursor(state.processed_through_watermark)
                < get_lightweight_memory_service().journal.get_project_history_cursor(
                    project_id
                )
            ):
                schedule_project_memory_maintenance(project_id)
        except Exception:
            logger.exception(
                "Incremental Memory maintenance failed",
                extra={"project_id": project_id},
            )

    future.add_done_callback(_done)
