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
from app.run_journal.memory_policy import (
    INSTRUCTION_MEMORY_KINDS,
    assert_memory_entry_policy,
    is_pending_memory_proposal,
    is_user_authored_message_source,
)
from app.run_journal.models import MemoryExtractionEventRecord
from app.tool_validation import ToolPreWriteValidationError
from app.workspace_config.models import WorkspaceConfigError

try:
    import tiktoken
except ImportError:  # pragma: no cover - production bundle includes it
    tiktoken = None


_TOKEN_LIMITS = {"project": 1024, "space": 640, "user": 384}
_RULE_PROPOSAL_MAX_CHARS = 300
_MAX_PENDING_RULE_PROPOSALS = 5
# Pending suggestions may use at most 1/N of a scope's token limit.
_PENDING_RULE_SHARE = 4
_SOURCE_EXCERPT_MAX_CHARS = 200
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


@dataclass(frozen=True)
class MemoryRuleProposal:
    status: Literal[
        "proposed",
        "already_saved",
        "previously_dismissed",
        "too_many_pending",
        "capture_disabled",
    ]
    entry: MemoryEntryRecord | None


@dataclass(frozen=True)
class MemoryExtractionPage:
    """Internal maintenance page, separate from the Agent History contract."""

    items: tuple[HistoryQueryResult, ...]
    receipts: tuple[tuple[MemoryExtractionEventRecord, str, str | None], ...]
    next_cursor: str
    complete: bool


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
            source_refs=source_refs,
            confirmed_by_user_action=confirmed_by_user_action,
            entry_created_by=entry_created_by,
        )
        if actor_type == "agent" and not adopted_by_user:
            pending_proposal = is_pending_memory_proposal(
                created_by=entry_created_by,
                kind=kind,
                confirmed_by_user=confirmed_by_user_action,
            )
            self._assert_agent_provenance(
                scope_type=scope_type,
                scope_id=scope_id,
                source_trust=entry_source_trust,
                source_refs=source_refs,
                proposal_run_id=run_id if pending_proposal else None,
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

    def propose_rule(
        self,
        *,
        project_id: str,
        scope_type: str,
        kind: str,
        content: str,
        reason: str,
        source_refs: tuple[str, ...],
        run_id: str,
        actor_id: str | None = None,
        activity_id: str | None = None,
        decision_id: str | None = None,
    ) -> MemoryRuleProposal:
        """Save a rule the user stated as a pending suggestion.

        The suggestion stays out of the prompt until the user adopts it on
        the Memory page. Every refusal is a known failure raised before any
        write.
        """

        if kind not in INSTRUCTION_MEMORY_KINDS:
            raise ValueError("A Memory rule is a preference or constraint")
        if scope_type not in _TOKEN_LIMITS:
            raise ValueError(f"Unknown Memory scope: {scope_type!r}")
        content = content.strip()
        source_refs = tuple(sorted(set(source_refs)))
        if not content or len(content) > _RULE_PROPOSAL_MAX_CHARS:
            raise _rule_rejection(
                "A Memory rule must be one statement of at most "
                f"{_RULE_PROPOSAL_MAX_CHARS} characters",
                error_code="MEMORY_CONTENT_REJECTED",
                field="content",
                instruction=(
                    "Restate the rule in one short sentence that keeps the "
                    "user's meaning, then retry."
                ),
            )
        if not reason.strip():
            raise _rule_rejection(
                "A Memory rule proposal needs a reason",
                error_code="MEMORY_ARGUMENT_VALIDATION_FAILED",
                field="reason",
                instruction="Say why the rule applies to future work.",
            )
        scope_id = (
            project_id
            if scope_type == "project"
            else self._bound_scope_id(project_id, scope_type)
        )
        if scope_id is None:
            raise _rule_rejection(
                f"This Project has no {scope_type} Memory",
                error_code="MEMORY_SCOPE_REJECTED",
                field="scope",
                instruction=(
                    "Propose the rule for project scope instead, or skip it "
                    "and continue delivering the work."
                ),
            )
        state = self.scope(scope_type, scope_id)
        if not state.capture_enabled:
            # The user turned Auto Memory off for this scope, so Eigent does
            # not learn rules there, not even as suggestions.
            return MemoryRuleProposal(status="capture_disabled", entry=None)
        self._assert_agent_provenance(
            scope_type="project",
            scope_id=project_id,
            source_trust="user_asserted",
            source_refs=source_refs,
            proposal_run_id=run_id,
        )
        try:
            assert_memory_entry_policy(
                kind=kind,
                content=content,
                created_by="agent",
                source_trust="user_asserted",
                confirmed_by_user=False,
                source_refs=source_refs,
                cloud_projection=True,
            )
        except WorkspaceConfigError as exc:
            raise _rule_rejection(
                "A Memory rule must not contain secrets or local home paths",
                error_code="MEMORY_CONTENT_REJECTED",
                field="content",
                instruction=(
                    "Leave secrets and device paths out of the rule, or skip "
                    "it and continue delivering the work."
                ),
            ) from exc

        normalized = _normalized_memory_content(content)

        def same(entry: MemoryEntryRecord) -> bool:
            return _normalized_memory_content(entry.content) == normalized

        # Listed apart, so archived entries never crowd active ones out.
        entries = self._journal.list_memory_entries(
            scope_type, scope_id, limit=500
        )
        active = next(filter(same, entries), None)
        if active is not None:
            # A retry finds its own suggestion, still waiting for the user.
            return MemoryRuleProposal(
                status=(
                    "proposed"
                    if is_pending_rule_proposal(active)
                    else "already_saved"
                ),
                entry=active,
            )
        dismissed = next(
            (
                entry
                for entry in self._journal.list_memory_entries(
                    scope_type, scope_id, include_deleted=True, limit=500
                )
                if entry.deleted_at is not None and same(entry)
            ),
            None,
        )
        if dismissed is not None:
            return MemoryRuleProposal(
                status="previously_dismissed", entry=dismissed
            )
        # Suggestions count toward capacity, since adopting one needs the
        # room, but they may only take a quarter of it. The rest stays free
        # for adopted Memory and the user's explicit requests.
        pending_budget = state.token_limit // _PENDING_RULE_SHARE
        tokens = count_tokens(content)
        if tokens > pending_budget:
            raise _rule_rejection(
                f"The rule is too long to suggest for {scope_type} Memory",
                error_code="MEMORY_CONTENT_REJECTED",
                field="content",
                instruction=(
                    "Restate the rule more briefly while keeping the user's "
                    "meaning, or skip it and continue delivering the work."
                ),
            )
        pending = [
            entry for entry in entries if is_pending_rule_proposal(entry)
        ]
        if (
            len(pending) >= _MAX_PENDING_RULE_PROPOSALS
            or sum(entry.token_count for entry in pending) + tokens
            > pending_budget
        ):
            return MemoryRuleProposal(status="too_many_pending", entry=None)
        if (
            state.current_token_count >= state.token_limit * 0.9
            or state.current_token_count + tokens > state.token_limit
        ):
            # Raising later, after dispatch, would leave the outcome unknown.
            raise _rule_rejection(
                "Memory is too full for another suggestion",
                error_code="MEMORY_CAPACITY_REJECTED",
                field="scope",
                instruction=(
                    "Skip this proposal and continue delivering the work. "
                    "The user can free space on the Memory page."
                ),
            )
        digest = hashlib.sha256(
            json.dumps(
                [run_id, scope_type, kind, normalized, list(source_refs)],
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        result = self.create_entry(
            scope_type=scope_type,
            scope_id=scope_id,
            kind=kind,
            content=content,
            actor_type="agent",
            reason=reason,
            source_trust="user_asserted",
            source_refs=source_refs,
            request_id=f"memory-propose:{digest}",
            actor_id=actor_id,
            run_id=run_id,
            activity_id=activity_id,
            decision_id=decision_id,
        )
        return MemoryRuleProposal(status="proposed", entry=result.entry)

    def source_excerpts(self, entry: MemoryEntryRecord) -> tuple[str, ...]:
        """The cited user messages behind a suggestion, for the Memory page."""

        excerpts: list[str] = []
        for event in self._journal.get_events_by_id(entry.source_refs):
            if event.event_type != "user.message":
                continue
            text = _history_payload_projection(
                event.event_type, event.payload
            ).get("content")
            if not isinstance(text, str) or not text.strip():
                continue
            text = text.strip()
            if len(text) > _SOURCE_EXCERPT_MAX_CHARS:
                text = text[: _SOURCE_EXCERPT_MAX_CHARS - 1].rstrip() + "…"
            excerpts.append(text)
        return tuple(excerpts)

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
            # A suggestion has no effect, so it never outlives saved Memory
            # with the same words, e.g. a newer suggestion beside an entry
            # restored or synced from another device.
            ordered = sorted(
                duplicates,
                key=lambda entry: (
                    is_pending_rule_proposal(entry),
                    _memory_retention_key(entry),
                ),
            )
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
            source_refs=source_refs or existing.source_refs,
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
        include_pending: bool = False,
    ) -> tuple[MemoryEntryRecord, ...]:
        """Select active Memory for the prompt or for an Agent search.

        Pending rule suggestions never reach the prompt. Only the Agent's own
        search includes them, so it neither follows nor repeats them.
        """

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
            candidates.extend(
                entry
                for entry in self.list_entries(scope_type, scope_id)
                if include_pending or not is_pending_rule_proposal(entry)
            )
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

    def read_memory_extraction_page(
        self,
        *,
        project_id: str,
        scope_type: str,
        scope_id: str,
        after_cursor: str | None,
        through_cursor: int,
        include_deferred: bool = True,
        byte_budget: int = 256 * 1024,
        token_budget: int = 16384,
    ) -> MemoryExtractionPage:
        """Read at most 100 metadata rows / three explicit-user candidates.

        The current extractor only accepts user.message written by the user.
        Other event types and trigger messages get an explicit exclusion
        receipt without loading their payloads.
        Oversized user events are deferred whole; no truncated statement is
        allowed to become durable Memory. The caller persists these outcomes
        after extraction and maintains a separate contiguous success frontier.
        """

        if not 256 <= byte_budget <= 256 * 1024:
            raise ValueError("Extraction byte budget is out of bounds")
        if not 64 <= token_budget <= 16384:
            raise ValueError("Extraction token budget is out of bounds")
        cursor = parse_project_cursor(after_cursor)
        events = self._journal.list_memory_extraction_events(
            source_project_id=project_id,
            target_scope_type=scope_type,
            target_scope_id=scope_id,
            after_cursor=cursor,
            through_cursor=through_cursor,
            include_deferred=include_deferred,
            prioritize_fewer_attempts=include_deferred,
        )
        items: list[HistoryQueryResult] = []
        receipts: list[
            tuple[MemoryExtractionEventRecord, str, str | None]
        ] = []
        used_bytes = used_projected_bytes = used_tokens = 0
        for event in events:
            disposition = "excluded"
            error = None
            if event.event_type == "user.message" and self._written_by_user(
                event_id=event.event_id,
                run_id=event.run_id,
                project_id=project_id,
                source=event.message_source,
            ):
                if len(items) == 3:
                    break
                if event.payload_bytes > byte_budget:
                    error = "payload_bytes"
                else:
                    if used_bytes + event.payload_bytes > byte_budget:
                        break
                    source = self._journal.get_events_by_id((event.event_id,))
                    if len(source) != 1:
                        raise RuntimeError("Extraction source disappeared")
                    used_bytes += event.payload_bytes
                    payload = _history_payload_projection(
                        event.event_type, source[0].payload
                    )
                    encoded = json.dumps(
                        payload, ensure_ascii=False, separators=(",", ":")
                    )
                    projected_bytes = len(encoded.encode("utf-8"))
                    tokens = count_tokens(encoded)
                    if projected_bytes > byte_budget:
                        error = "projected_bytes"
                    elif tokens > token_budget:
                        error = "payload_tokens"
                    elif (
                        used_tokens + tokens > token_budget
                        or used_projected_bytes + projected_bytes > byte_budget
                    ):
                        break
                    else:
                        used_tokens += tokens
                        used_projected_bytes += projected_bytes
                        disposition = "processed"
                        items.append(
                            HistoryQueryResult(
                                citation_id=f"history:{project_id}:{event.journal_cursor}",
                                journal_cursor=event.journal_cursor,
                                event_id=event.event_id,
                                run_id=event.run_id,
                                event_type=event.event_type,
                                content=payload,
                                source_trust=event_source_trust(
                                    event.event_type, user_authored=True
                                ),
                                created_at=event.created_at,
                            )
                        )
                if error:
                    disposition = "deferred_budget"
                    error = (
                        f"extraction budget deferred event={event.event_id} "
                        f"cursor={event.journal_cursor} reason={error} "
                        f"byte_budget={byte_budget} token_budget={token_budget}"
                    )
            receipts.append((event, disposition, error))
            cursor = event.journal_cursor
        if not events:
            cursor = through_cursor
        return MemoryExtractionPage(
            items=tuple(items),
            receipts=tuple(receipts),
            next_cursor=format_project_cursor(cursor),
            complete=cursor >= through_cursor,
        )

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
                        source_trust=event_source_trust(
                            item.event.event_type,
                            user_authored=(
                                item.event.event_type == "user.message"
                                and self._written_by_user(
                                    event_id=item.event.event_id,
                                    run_id=item.event.run_id,
                                    project_id=project_id,
                                    source=item.event.payload.get("source"),
                                )
                            ),
                        ),
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
        source_refs: tuple[str, ...] = (),
        confirmed_by_user_action: bool = False,
        entry_created_by: str | None = None,
    ) -> None:
        created_by = entry_created_by or actor_type
        confirmed_by_user = actor_type == "user" or confirmed_by_user_action
        assert_memory_entry_policy(
            kind=kind,
            content=content,
            created_by=created_by,
            source_trust=source_trust,
            confirmed_by_user=confirmed_by_user,
            source_refs=source_refs,
        )
        # A pending rule suggestion has no effect until the user adopts it on
        # the Memory page, and that adoption is its Space/User review.
        if (
            actor_type == "agent"
            and scope_type != "project"
            and not confirmed_by_user_action
            and not is_pending_memory_proposal(
                created_by=created_by,
                kind=kind,
                confirmed_by_user=confirmed_by_user,
            )
        ):
            raise ToolPreWriteValidationError(
                "Agent Space/User Memory mutations require HumanInteraction",
                error_code="MEMORY_SCOPE_REJECTED",
                field="scope",
                recovery={
                    "tool": "promote_project_memory",
                    "instruction": (
                        "Direct agent writes are limited to current Project "
                        "Memory. Use promote_project_memory with an exact "
                        "user review for Space/User Memory, or skip this "
                        "Memory write and continue delivering the work."
                    ),
                },
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
        proposal_run_id: str | None = None,
    ) -> None:
        """Prevent model-authored Memory from laundering source authority.

        Citations must come from the Project that owns the Memory. A pending
        rule suggestion (``proposal_run_id``) may instead target the
        Space/User Memory that its Run's Project feeds, citing that Project.
        """

        if source_trust != "user_asserted":
            return
        recovery = {
            "tool": "search_project_history",
            "instruction": (
                "Search current Project History for the user's statement. "
                "Retry with source_event_ids containing the returned event_id "
                "of matching user.message events, not citation_id or Run IDs. "
                "Every event must belong to this Project and have "
                "source_trust user_asserted; trigger messages from schedules, "
                "webhooks or Slack are not the user's words. Never invent IDs "
                "or label model/tool text user_asserted. "
                + (
                    # Saving an unstated rule another way would bypass the
                    # user's adoption.
                    "If the user did not state this rule, do not propose or "
                    "save it in another form; continue delivering the work."
                    if proposal_run_id is not None
                    else "If no matching user statement exists, use "
                    "model_inferred for your inference or tool_observed for "
                    "a tool observation only when accurate, or skip this "
                    "Memory write and continue delivering the work."
                )
            ),
        }
        project_id: str | None = scope_id
        if scope_type != "project":
            source_run = (
                self._journal.get_run(proposal_run_id)
                if proposal_run_id
                else None
            )
            project_id = (
                source_run.project_id
                if source_run is not None
                and self._bound_scope_id(source_run.project_id, scope_type)
                == scope_id
                else None
            )
        if project_id is None or not source_refs:
            raise ToolPreWriteValidationError(
                "Agent user_asserted Memory requires cited user History events",
                error_code="MEMORY_PROVENANCE_REJECTED",
                field="source_event_ids",
                recovery=recovery,
            )
        events = self._journal.get_events_by_id(source_refs)
        valid = len(events) == len(source_refs)
        for event in events:
            run = self._journal.get_run(event.run_id)
            if (
                event.event_type != "user.message"
                or run is None
                or run.project_id != project_id
                or not self._written_by_user(
                    event_id=event.event_id,
                    run_id=event.run_id,
                    project_id=project_id,
                    source=event.payload.get("source"),
                )
            ):
                valid = False
                break
        if not valid:
            raise ToolPreWriteValidationError(
                "Agent user_asserted Memory citations must be user.message "
                "events the user wrote in the same Project",
                error_code="MEMORY_PROVENANCE_REJECTED",
                field="source_event_ids",
                recovery=recovery,
            )

    def _bound_scope_id(self, project_id: str, scope_type: str) -> str | None:
        """The Space or User Memory this Project feeds, if bound."""

        space_id, user_id = self._journal.get_memory_project_scopes(project_id)
        return space_id if scope_type == "space" else user_id

    def _written_by_user(
        self, *, event_id: str, run_id: str, project_id: str, source: object
    ) -> bool:
        """Whether a user.message holds the user's own words (fail closed)."""

        if source is None and event_id.startswith("execution-input:"):
            # Managed input recorded before user.message carried its source.
            # Its Run id is the admitting request, which keeps the source.
            source = self._journal.get_instruction_source(
                project_id=project_id, request_id=run_id
            )
        return is_user_authored_message_source(source)


def _rule_rejection(
    message: str, *, error_code: str, field: str, instruction: str
) -> ToolPreWriteValidationError:
    return ToolPreWriteValidationError(
        message,
        error_code=error_code,
        field=field,
        recovery={"tool": "propose_memory_rule", "instruction": instruction},
    )


def is_pending_rule_proposal(entry: MemoryEntryRecord) -> bool:
    """An active rule suggestion the user has not adopted or dismissed."""

    return entry.deleted_at is None and is_pending_memory_proposal(
        created_by=entry.created_by,
        kind=entry.kind,
        confirmed_by_user=entry.confirmed_by_user,
    )


def event_source_trust(event_type: str, *, user_authored: bool = False) -> str:
    if event_type == "user.message":
        # Trigger text and messages of unknown authorship are external data.
        return "user_asserted" if user_authored else "external_untrusted"
    if event_type.startswith("legacy.human"):
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
