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

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Literal

from app.permission_policy import redact_action_arguments
from app.run_journal import (
    InvalidRunTransitionError,
    MemoryEntryRecord,
    MemoryMutationResult,
    MemoryScopeStateRecord,
    SQLiteRunJournal,
    get_default_run_journal,
)
from app.run_journal.memory_policy import assert_memory_entry_policy

try:
    import tiktoken
except ImportError:  # pragma: no cover - production bundle includes it
    tiktoken = None


_TOKEN_LIMITS = {"project": 1024, "space": 640, "user": 384}
_QUERY_TOKEN_RE = re.compile(r"[\w.-]+", re.UNICODE)
_HISTORY_ARTIFACT_FIELDS = frozenset(
    {
        "artifact_id",
        "filename",
        "relativePath",
        "changeType",
        "size",
        "mimeType",
        "scan_status",
        "truncated",
        "artifact_count",
        "manifest_digest",
    }
)


def _history_payload_projection(
    event_type: str, payload: dict[str, Any]
) -> dict[str, Any]:
    """Return the model-visible, normalized History projection.

    Canonical Run events remain untouched in SQLite.  The Agent History Tool
    gets only redacted arguments, connector/tool outcome metadata, and
    Artifact metadata.  Raw Connector bodies, tool results and local Artifact
    paths are deliberately unavailable through this principal.
    """

    redacted = redact_action_arguments(payload)
    if event_type.startswith("tool."):
        return {
            key: value
            for key, value in redacted.items()
            if key
            in {
                "tool_call_id",
                "attempt_id",
                "tool_name",
                "safety_class",
                "status",
                "outcome",
                "timeout_reason",
                "request",
            }
        }
    if event_type.startswith("artifact."):
        if event_type == "artifact.manifest.finalized":
            artifacts = redacted.get("artifacts")
            projected_artifacts = (
                [
                    {
                        key: value
                        for key, value in artifact.items()
                        if key in _HISTORY_ARTIFACT_FIELDS
                    }
                    for artifact in artifacts
                    if isinstance(artifact, dict)
                ]
                if isinstance(artifacts, list)
                else []
            )
            return {
                key: value
                for key, value in redacted.items()
                if key in _HISTORY_ARTIFACT_FIELDS
            } | {"artifacts": projected_artifacts}
        return {
            key: value
            for key, value in redacted.items()
            if key in _HISTORY_ARTIFACT_FIELDS
        }
    return redacted


@dataclass(frozen=True)
class HistoryQueryResult:
    citation_id: str
    journal_cursor: int
    event_id: str
    run_id: str
    event_type: str
    content: dict[str, Any]
    source_trust: str
    created_at: float


@dataclass(frozen=True)
class HistoryQueryPage:
    source: str
    project_id: str
    complete: bool
    freshness: str
    watermark_kind: str
    source_watermark: str
    available_through_watermark: str
    items: tuple[HistoryQueryResult, ...]
    next_cursor: str
    redactions: tuple[str, ...]


@dataclass(frozen=True)
class MemoryConsolidationResult:
    scope_state: MemoryScopeStateRecord
    removed_memory_ids: tuple[str, ...]
    retained_memory_ids: tuple[str, ...]
    tokens_released: int


class LightweightMemoryService:
    """Typed boundary shared by local UI and Agent tools.

    The service never reads legacy LocalMemory as History.  Canonical events
    come only from the RunJournal Project cursor.
    """

    def __init__(self, journal: SQLiteRunJournal) -> None:
        self._journal = journal

    @property
    def journal(self) -> SQLiteRunJournal:
        return self._journal

    def scope(self, scope_type: str, scope_id: str) -> MemoryScopeStateRecord:
        return self._journal.ensure_memory_scope_state(
            scope_type,
            scope_id,
            token_limit=_TOKEN_LIMITS[scope_type],
        )

    def list_entries(
        self,
        scope_type: str,
        scope_id: str,
        *,
        include_deleted: bool = False,
    ) -> tuple[MemoryEntryRecord, ...]:
        self.scope(scope_type, scope_id)
        return tuple(
            self._journal.list_memory_entries(
                scope_type,
                scope_id,
                include_deleted=include_deleted,
            )
        )

    def resolve_reconciliation(
        self,
        reconciliation_id: str,
        *,
        account_owner_id: str,
        decision: Literal["local", "cloud", "dismiss"],
    ):
        """Resolve a visible cross-device conflict without silent LWW."""

        item = self._journal.get_memory_reconciliation_item(reconciliation_id)
        if item is None:
            raise KeyError(reconciliation_id)
        if item.account_owner_id != account_owner_id:
            raise PermissionError(
                "Memory reconciliation belongs to another account"
            )
        if decision in {"local", "dismiss"}:
            resolution = (
                "accepted_local" if decision == "local" else "dismissed"
            )
            return self._journal.resolve_memory_reconciliation_item(
                reconciliation_id,
                resolution=resolution,
            )
        cloud = item.cloud_entry
        existing = self._require_entry(item.memory_id)
        if (
            existing.scope_type != item.scope_type
            or existing.scope_id != item.scope_id
        ):
            raise PermissionError("Memory reconciliation scope changed")
        current_shape = {
            "kind": existing.kind,
            "content": existing.content,
            "priority": existing.priority,
            "token_count": existing.token_count,
            "created_by": existing.created_by,
            "source_trust": existing.source_trust,
            "sensitivity": existing.sensitivity,
            "source_refs": list(existing.source_refs),
            "deleted_at": existing.deleted_at,
        }
        if current_shape != item.local_entry:
            raise InvalidRunTransitionError(
                "Local Memory changed after this review item was created; "
                "refresh conflicts before choosing the Cloud version"
            )
        cloud_deleted = cloud.get("deleted_at") is not None
        request_prefix = f"memory-reconciliation:{reconciliation_id}"
        if cloud_deleted:
            if existing.deleted_at is None:
                self._journal.apply_memory_mutation(
                    mutation_id=stable_memory_id(
                        "mutation", request_prefix, "remove"
                    ),
                    idempotency_key=f"{request_prefix}:remove",
                    operation="remove",
                    scope_type=existing.scope_type,
                    scope_id=existing.scope_id,
                    memory_id=existing.memory_id,
                    expected_version=existing.version,
                    actor_type="user",
                    reason="Accepted Cloud Memory deletion in Memory Center",
                )
        else:
            content = str(cloud.get("content") or "")
            kind = str(cloud.get("kind") or "")
            source_trust = str(cloud.get("source_trust") or "")
            cloud_created_by = str(cloud.get("created_by") or "")
            cloud_refs = tuple(cloud.get("source_refs") or ())
            assert_memory_entry_policy(
                kind=kind,
                content=content,
                created_by=cloud_created_by,
                source_trust=source_trust,
                confirmed_by_user=bool(cloud.get("confirmed_by_user")),
                source_refs=cloud_refs,
                cloud_projection=True,
            )
            if existing.deleted_at is not None:
                self._journal.apply_memory_mutation(
                    mutation_id=stable_memory_id(
                        "mutation", request_prefix, "restore"
                    ),
                    idempotency_key=f"{request_prefix}:restore",
                    operation="restore",
                    scope_type=existing.scope_type,
                    scope_id=existing.scope_id,
                    memory_id=existing.memory_id,
                    expected_version=existing.version,
                    actor_type="user",
                    reason="Accepted active Cloud Memory in Memory Center",
                )
                existing = self._require_entry(item.memory_id)
            local_semantic = (
                existing.kind,
                existing.content,
                existing.priority,
                existing.created_by,
                existing.source_trust,
                existing.sensitivity,
                existing.source_refs,
            )
            cloud_semantic = (
                kind,
                content,
                str(cloud.get("priority") or "normal"),
                cloud_created_by,
                source_trust,
                str(cloud.get("sensitivity") or "normal"),
                cloud_refs,
            )
            if local_semantic != cloud_semantic:
                self._journal.apply_memory_mutation(
                    mutation_id=stable_memory_id(
                        "mutation", request_prefix, "replace"
                    ),
                    idempotency_key=f"{request_prefix}:replace",
                    operation="replace",
                    scope_type=existing.scope_type,
                    scope_id=existing.scope_id,
                    memory_id=existing.memory_id,
                    expected_version=existing.version,
                    actor_type="system",
                    reason="Accepted Cloud Memory content in Memory Center",
                    content=content,
                    kind=kind,
                    priority=str(cloud.get("priority") or "normal"),
                    token_count=count_tokens(content),
                    created_by=cloud_created_by,
                    source_trust=source_trust,
                    sensitivity=str(cloud.get("sensitivity") or "normal"),
                    source_refs=cloud_refs,
                )
        return self._journal.resolve_memory_reconciliation_item(
            reconciliation_id,
            resolution="accepted_cloud",
        )

    def create_entry(
        self,
        *,
        scope_type: str,
        scope_id: str,
        kind: str,
        content: str,
        actor_type: Literal["agent", "user", "extractor", "importer"],
        reason: str,
        source_trust: str,
        source_refs: tuple[str, ...] = (),
        priority: str = "normal",
        sensitivity: str = "normal",
        memory_id: str | None = None,
        request_id: str | None = None,
        actor_id: str | None = None,
        run_id: str | None = None,
        activity_id: str | None = None,
        decision_id: str | None = None,
        confirmed_by_user_action: bool = False,
        adopted_by_user: bool = False,
        reviewed_source_memory_id: str | None = None,
    ) -> MemoryMutationResult:
        source_refs = tuple(dict.fromkeys(source_refs))
        if adopted_by_user and not (
            actor_type == "agent"
            and confirmed_by_user_action
            and decision_id
            and reviewed_source_memory_id
        ):
            raise PermissionError(
                "User-adopted Memory requires an exact durable review"
            )
        entry_created_by = "user" if adopted_by_user else actor_type
        entry_source_trust = (
            "user_confirmed" if adopted_by_user else source_trust
        )
        self._assert_mutation_policy(
            scope_type=scope_type,
            kind=kind,
            content=content,
            actor_type=actor_type,
            source_trust=entry_source_trust,
            confirmed_by_user_action=confirmed_by_user_action,
            entry_created_by=entry_created_by,
        )
        if actor_type == "agent" and not adopted_by_user:
            self._assert_agent_provenance(
                scope_type=scope_type,
                scope_id=scope_id,
                source_trust=entry_source_trust,
                source_refs=source_refs,
            )
        state = self.scope(scope_type, scope_id)
        if (
            actor_type in {"agent", "extractor"}
            and state.current_token_count >= state.token_limit * 0.9
        ):
            raise InvalidRunTransitionError(
                "Memory is at least 90% full. Search the current Memory and "
                "replace, remove, or consolidate an existing item before "
                "adding another one. Canonical History remains searchable."
            )
        resolved_request_id = request_id or f"memreq_{uuid.uuid4().hex}"
        resolved_memory_id = memory_id or stable_memory_id(
            "entry", scope_type, scope_id, resolved_request_id
        )
        return self._journal.apply_memory_mutation(
            mutation_id=stable_memory_id("mutation", resolved_request_id),
            idempotency_key=resolved_request_id,
            operation="add",
            scope_type=scope_type,
            scope_id=scope_id,
            memory_id=resolved_memory_id,
            actor_type=actor_type,
            actor_id=actor_id,
            reason=reason,
            content=content,
            kind=kind,
            priority=priority,
            token_count=count_tokens(content),
            created_by=entry_created_by,
            source_trust=entry_source_trust,
            sensitivity=sensitivity,
            source_refs=source_refs,
            run_id=run_id,
            activity_id=activity_id,
            decision_id=decision_id,
            confirmed_by_user_action=confirmed_by_user_action,
            reviewed_operation="promote" if adopted_by_user else None,
            reviewed_memory_id=reviewed_source_memory_id,
        )

    def consolidate_scope(
        self,
        *,
        scope_type: str,
        scope_id: str,
        reason: str,
        request_id: str,
        actor_type: Literal["user", "extractor"] = "extractor",
    ) -> MemoryConsolidationResult:
        """Safely remove exact duplicate, unreviewed machine-created items.

        Consolidation is intentionally conservative: it does not summarize
        History, semantically merge unrelated statements, or alter anything
        the user created, confirmed, or pinned. More subjective changes remain
        explicit user edits/HumanInteractions.
        """

        if not request_id.strip():
            raise ValueError("Memory consolidation request_id is required")
        entries = self.list_entries(scope_type, scope_id)
        groups: dict[tuple[str, str], list[MemoryEntryRecord]] = {}
        for entry in entries:
            key = (entry.kind, _normalized_memory_content(entry.content))
            groups.setdefault(key, []).append(entry)

        removed: list[str] = []
        retained: list[str] = []
        released = 0
        for duplicates in groups.values():
            if len(duplicates) < 2:
                continue
            ordered = sorted(duplicates, key=_memory_retention_key)
            keeper = ordered[0]
            retained.append(keeper.memory_id)
            for candidate in ordered[1:]:
                if (
                    candidate.created_by == "user"
                    or candidate.confirmed_by_user
                    or candidate.pinned_by_user
                ):
                    retained.append(candidate.memory_id)
                    continue
                result = self._journal.apply_memory_mutation(
                    mutation_id=stable_memory_id(
                        "mutation", request_id, candidate.memory_id
                    ),
                    idempotency_key=(
                        f"{request_id}:remove-exact-duplicate:"
                        f"{candidate.memory_id}"
                    ),
                    operation="remove",
                    scope_type=scope_type,
                    scope_id=scope_id,
                    memory_id=candidate.memory_id,
                    expected_version=candidate.version,
                    actor_type=actor_type,
                    reason=(
                        f"{reason}; exact duplicate of {keeper.memory_id}"
                    ),
                    source_refs=candidate.source_refs,
                )
                if result.entry is not None and result.entry.deleted_at:
                    removed.append(candidate.memory_id)
                    released += candidate.token_count

        current = self.scope(scope_type, scope_id)
        final_state = self._journal.record_memory_consolidation_result(
            scope_type,
            scope_id,
            expected_revision=current.revision,
        )
        return MemoryConsolidationResult(
            scope_state=final_state,
            removed_memory_ids=tuple(removed),
            retained_memory_ids=tuple(dict.fromkeys(retained)),
            tokens_released=released,
        )

    def update_entry(
        self,
        *,
        memory_id: str,
        expected_version: int,
        content: str,
        kind: str,
        actor_type: Literal["agent", "user", "extractor"],
        reason: str,
        request_id: str,
        priority: str = "normal",
        source_trust: str | None = None,
        source_refs: tuple[str, ...] = (),
        sensitivity: str = "normal",
        actor_id: str | None = None,
        run_id: str | None = None,
        activity_id: str | None = None,
        decision_id: str | None = None,
        confirmed_by_user_action: bool = False,
    ) -> MemoryMutationResult:
        existing = self._require_entry(memory_id)
        # Rewritten model text is a new claim. It must not inherit a stronger
        # user/tool provenance merely because it replaced an older entry.
        trust = (
            "model_inferred"
            if actor_type == "agent"
            else source_trust or existing.source_trust
        )
        self._assert_mutation_policy(
            scope_type=existing.scope_type,
            kind=kind,
            content=content,
            actor_type=actor_type,
            source_trust=trust,
            confirmed_by_user_action=confirmed_by_user_action,
        )
        return self._journal.apply_memory_mutation(
            mutation_id=stable_memory_id("mutation", request_id),
            idempotency_key=request_id,
            operation="replace",
            scope_type=existing.scope_type,
            scope_id=existing.scope_id,
            memory_id=memory_id,
            expected_version=expected_version,
            actor_type=actor_type,
            actor_id=actor_id,
            reason=reason,
            content=content,
            kind=kind,
            priority=priority,
            token_count=count_tokens(content),
            created_by=actor_type,
            source_trust=trust,
            sensitivity=sensitivity,
            source_refs=source_refs,
            run_id=run_id,
            activity_id=activity_id,
            decision_id=decision_id,
            confirmed_by_user_action=confirmed_by_user_action,
        )

    def transition_entry(
        self,
        *,
        memory_id: str,
        expected_version: int,
        operation: Literal["remove", "restore", "confirm", "pin"],
        actor_type: Literal["agent", "user"],
        reason: str,
        request_id: str,
        actor_id: str | None = None,
        run_id: str | None = None,
        activity_id: str | None = None,
        decision_id: str | None = None,
    ) -> MemoryMutationResult:
        existing = self._require_entry(memory_id)
        if (
            actor_type == "agent"
            and decision_id is None
            and (
                existing.scope_type != "project"
                or existing.created_by != "agent"
                or existing.confirmed_by_user
                or existing.pinned_by_user
                or operation in {"confirm", "pin"}
            )
        ):
            raise PermissionError(
                "Agent Memory changes outside unconfirmed Project entries "
                "require a HumanInteraction"
            )
        return self._journal.apply_memory_mutation(
            mutation_id=stable_memory_id("mutation", request_id),
            idempotency_key=request_id,
            operation=operation,
            scope_type=existing.scope_type,
            scope_id=existing.scope_id,
            memory_id=memory_id,
            expected_version=expected_version,
            actor_type=actor_type,
            actor_id=actor_id,
            reason=reason,
            run_id=run_id,
            activity_id=activity_id,
            decision_id=decision_id,
            confirmed_by_user_action=decision_id is not None,
        )

    def search_memory(
        self,
        *,
        project_id: str,
        space_id: str | None = None,
        user_id: str | None = None,
        query: str = "",
        token_budget: int = 2048,
    ) -> tuple[MemoryEntryRecord, ...]:
        if token_budget < 1 or token_budget > 2048:
            raise ValueError("Memory token budget must be between 1 and 2048")
        candidates: list[MemoryEntryRecord] = []
        scopes = [("project", project_id)]
        if space_id:
            scopes.append(("space", space_id))
        if user_id:
            scopes.append(("user", user_id))
        query_tokens = {
            token.casefold() for token in _QUERY_TOKEN_RE.findall(query)
        }
        for scope_type, scope_id in scopes:
            state = self.scope(scope_type, scope_id)
            if not state.use_enabled:
                continue
            candidates.extend(self.list_entries(scope_type, scope_id))
        candidates.sort(
            key=lambda entry: (
                {"project": 0, "space": 1, "user": 2}[entry.scope_type],
                not entry.pinned_by_user,
                not entry.confirmed_by_user,
                entry.priority != "high",
                -entry.updated_at,
            )
        )
        selected: list[MemoryEntryRecord] = []
        used = 0
        for entry in candidates:
            if query_tokens and not (
                query_tokens
                & {
                    token.casefold()
                    for token in _QUERY_TOKEN_RE.findall(entry.content)
                }
            ):
                continue
            if used + entry.token_count > token_budget:
                continue
            selected.append(entry)
            used += entry.token_count
        return tuple(selected)

    def search_history(
        self,
        *,
        project_id: str,
        query: str = "",
        after_cursor: str | None = None,
        limit: int = 50,
        byte_budget: int = 64 * 1024,
        token_budget: int = 4096,
    ) -> HistoryQueryPage:
        cursor = parse_project_cursor(after_cursor)
        if limit < 1 or limit > 100:
            raise ValueError("History limit must be between 1 and 100")
        if byte_budget < 256 or byte_budget > 512 * 1024:
            raise ValueError("History byte budget is out of bounds")
        if token_budget < 64 or token_budget > 16384:
            raise ValueError("History token budget is out of bounds")
        query_text = query.casefold().strip()
        scan_cursor = cursor
        selected: list[HistoryQueryResult] = []
        used_bytes = 0
        used_tokens = 0
        source_watermark = self._journal.get_project_history_cursor(project_id)
        exhausted = False
        while len(selected) < limit and scan_cursor < source_watermark:
            page = self._journal.list_project_history_events(
                project_id,
                after_cursor=scan_cursor,
                limit=min(100, max(limit * 2, 20)),
            )
            if not page:
                exhausted = True
                break
            for item in page:
                previous_cursor = scan_cursor
                scan_cursor = item.journal_cursor
                payload = _history_payload_projection(
                    item.event.event_type, item.event.payload
                )
                searchable = json.dumps(payload, ensure_ascii=False).casefold()
                if (
                    query_text
                    and query_text not in searchable
                    and query_text not in item.event.event_type.casefold()
                ):
                    continue
                encoded = json.dumps(
                    payload, ensure_ascii=False, separators=(",", ":")
                )
                item_bytes = len(encoded.encode("utf-8"))
                item_tokens = count_tokens(encoded)
                if (
                    used_bytes + item_bytes > byte_budget
                    or used_tokens + item_tokens > token_budget
                ):
                    # The unreturned item remains addressable by the next page;
                    # never advance a durable cursor past evidence the caller
                    # did not receive.
                    scan_cursor = previous_cursor
                    exhausted = False
                    break
                selected.append(
                    HistoryQueryResult(
                        citation_id=(
                            f"history:{project_id}:{item.journal_cursor}"
                        ),
                        journal_cursor=item.journal_cursor,
                        event_id=item.event.event_id,
                        run_id=item.event.run_id,
                        event_type=item.event.event_type,
                        content=payload,
                        source_trust=event_source_trust(item.event.event_type),
                        created_at=item.event.created_at,
                    )
                )
                used_bytes += item_bytes
                used_tokens += item_tokens
                if len(selected) >= limit:
                    break
            else:
                if scan_cursor >= source_watermark:
                    exhausted = True
                continue
            break
        complete = exhausted or scan_cursor >= source_watermark
        next_cursor = format_project_cursor(scan_cursor)
        current = format_project_cursor(source_watermark)
        return HistoryQueryPage(
            source="sqlite",
            project_id=project_id,
            complete=complete,
            freshness="current",
            watermark_kind="journal_cursor",
            source_watermark=current,
            available_through_watermark=current,
            items=tuple(selected),
            next_cursor=next_cursor,
            redactions=(
                "credential_keys_and_recognized_values",
                "raw_connector_tool_results",
                "local_artifact_paths_and_content",
            ),
        )

    @staticmethod
    def _assert_mutation_policy(
        *,
        scope_type: str,
        kind: str,
        content: str,
        actor_type: str,
        source_trust: str,
        confirmed_by_user_action: bool = False,
        entry_created_by: str | None = None,
    ) -> None:
        assert_memory_entry_policy(
            kind=kind,
            content=content,
            created_by=entry_created_by or actor_type,
            source_trust=source_trust,
            confirmed_by_user=(
                actor_type == "user" or confirmed_by_user_action
            ),
        )
        if (
            actor_type == "agent"
            and scope_type != "project"
            and not confirmed_by_user_action
        ):
            raise PermissionError(
                "Agent Space/User Memory mutations require HumanInteraction"
            )

    def _require_entry(self, memory_id: str) -> MemoryEntryRecord:
        entry = self._journal.get_memory_entry(memory_id)
        if entry is None:
            raise KeyError(memory_id)
        return entry

    def _assert_agent_provenance(
        self,
        *,
        scope_type: str,
        scope_id: str,
        source_trust: str,
        source_refs: tuple[str, ...],
    ) -> None:
        """Prevent model-authored Memory from laundering source authority."""

        if source_trust != "user_asserted":
            return
        if scope_type != "project" or not source_refs:
            raise PermissionError(
                "Agent user_asserted Memory requires cited user History events"
            )
        events = self._journal.get_events_by_id(source_refs)
        valid = len(events) == len(source_refs)
        for event in events:
            run = self._journal.get_run(event.run_id)
            if (
                event.event_type != "user.message"
                or run is None
                or run.project_id != scope_id
            ):
                valid = False
                break
        if not valid:
            raise PermissionError(
                "Agent user_asserted Memory citations must be user.message "
                "events from the same Project"
            )


def event_source_trust(event_type: str) -> str:
    if event_type == "user.message" or event_type.startswith("legacy.human"):
        return "user_asserted"
    if event_type.startswith("tool."):
        return "tool_observed"
    if event_type.startswith(("run.", "approval.", "human_interaction.")):
        return "system_verified"
    if event_type == "assistant.final" or event_type.startswith("assistant."):
        return "model_inferred"
    if event_type.startswith("legacy."):
        return "legacy_unverified"
    return "system_verified"


def stable_memory_id(namespace: str, *parts: str) -> str:
    digest = hashlib.sha256(
        json.dumps(
            [namespace, *parts],
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    prefix = "mut" if namespace == "mutation" else "mem"
    return f"{prefix}_{digest[:32]}"


def _normalized_memory_content(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def _memory_retention_key(entry: MemoryEntryRecord) -> tuple:
    trust_rank = {
        "user_confirmed": 0,
        "user_asserted": 1,
        "system_verified": 2,
        "tool_observed": 3,
        "model_inferred": 4,
        "external_untrusted": 5,
        "legacy_unverified": 6,
    }
    return (
        not entry.pinned_by_user,
        not entry.confirmed_by_user,
        entry.created_by != "user",
        entry.priority != "high",
        trust_rank.get(entry.source_trust, 99),
        -entry.updated_at,
        entry.memory_id,
    )


def format_project_cursor(value: int) -> str:
    return f"sqlite-project-v1:{value}"


def parse_project_cursor(value: str | None) -> int:
    if value is None or value == "":
        return 0
    prefix = "sqlite-project-v1:"
    if not value.startswith(prefix):
        raise ValueError("unsupported Project History cursor")
    try:
        cursor = int(value.removeprefix(prefix))
    except ValueError as exc:
        raise ValueError("invalid Project History cursor") from exc
    if cursor < 0:
        raise ValueError("invalid Project History cursor")
    return cursor


@lru_cache(maxsize=1)
def _token_encoding():
    if tiktoken is None:
        return None
    try:
        # Some tiktoken builds lazily download their vocabulary. Memory must
        # remain available offline, so a missing cache falls back once to the
        # conservative local estimate instead of creating a network loop.
        return tiktoken.get_encoding("cl100k_base")
    except Exception:  # noqa: BLE001 - optional offline optimization
        return None


def count_tokens(value: str) -> int:
    encoding = _token_encoding()
    if encoding is None:
        return max(1, (len(value) + 2) // 3)
    return max(1, len(encoding.encode(value)))


def get_lightweight_memory_service() -> LightweightMemoryService:
    return LightweightMemoryService(get_default_run_journal())
