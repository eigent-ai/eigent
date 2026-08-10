"""Persistence-aware policy evaluation and Approval creation."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, replace
from typing import Any

from app.permission_policy.engine import PermissionPolicyEngine
from app.permission_policy.models import (
    PRESET_PROFILES,
    ActionDescriptor,
    PermissionProfile,
    PermissionProfileName,
    PolicyDecision,
    PolicyEffect,
    PolicyRule,
    literal_resource_pattern,
)
from app.run_journal import ApprovalRecord, SQLiteRunJournal

DEFAULT_TOOL_APPROVAL_TTL_SECONDS = 24 * 60 * 60


@dataclass(frozen=True)
class PolicyEvaluationResult:
    decision: PolicyDecision
    approval: ApprovalRecord | None


class PermissionPolicyService:
    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        engine: PermissionPolicyEngine | None = None,
    ) -> None:
        self._journal = journal
        self._engine = engine or PermissionPolicyEngine()

    def profile_for_space(self, space_id: str) -> PermissionProfile:
        record = self._journal.get_space_permission_profile(space_id)
        if record is None:
            return PRESET_PROFILES[PermissionProfileName.REQUEST_APPROVAL]
        return PermissionProfile(
            name=PermissionProfileName(record.profile_name),
            sandbox_mode=record.sandbox_mode,
            approval_mode=record.approval_mode,
            reviewer_mode=record.reviewer_mode,
            revision=f"space:{space_id}:{record.revision}",
        )

    def profile_for_revision(
        self,
        *,
        space_id: str,
        revision: str | None,
    ) -> PermissionProfile:
        if revision is None:
            return self.profile_for_space(space_id)
        for preset in PRESET_PROFILES.values():
            if preset.revision == revision:
                return preset
        record = self._journal.get_space_permission_profile_revision(revision)
        if record is not None and record.space_id == space_id:
            return PermissionProfile(
                name=PermissionProfileName(record.profile_name),
                sandbox_mode=record.sandbox_mode,
                approval_mode=record.approval_mode,
                reviewer_mode=record.reviewer_mode,
                revision=record.revision_id,
            )
        # Legacy EnvironmentSpecs carry the Bundle permission digest rather
        # than a Space profile revision. Preserve the identifier for audit
        # while using the conservative request-approval behavior.
        return replace(
            PRESET_PROFILES[PermissionProfileName.REQUEST_APPROVAL],
            revision=revision,
        )

    def evaluate(
        self,
        descriptor: ActionDescriptor,
        *,
        space_id: str,
        permission_profile_revision: str | None = None,
    ) -> PolicyDecision:
        profile = self.profile_for_revision(
            space_id=space_id,
            revision=permission_profile_revision,
        )
        profile_trusted = self._journal.attempt_permission_profile_is_trusted(
            descriptor.attempt_id,
            profile.revision,
        )
        if (
            profile.name
            in {
                PermissionProfileName.AUTO_REVIEWER,
                PermissionProfileName.FULL_ACCESS,
            }
            and not profile_trusted
        ):
            profile = replace(
                PRESET_PROFILES[PermissionProfileName.REQUEST_APPROVAL],
                revision=f"untrusted:{profile.revision}",
            )
        records = self._journal.list_approval_rules(
            space_id=space_id,
            run_id=descriptor.run_id,
        )
        rules = tuple(
            PolicyRule(
                rule_id=record.rule_id,
                effect=PolicyEffect(record.effect),
                action_pattern=record.action_pattern,
                resource_pattern=record.resource_pattern,
                scope=record.scope,
                run_id=record.run_id,
            )
            for record in records
            if record.effect != PolicyEffect.ALLOW.value
            or self._journal.approval_rule_is_trusted(record.rule_id)
        )
        return self._engine.evaluate(
            descriptor,
            profile=profile,
            rules=rules,
        )

    def evaluate_and_request_approval(
        self,
        descriptor: ActionDescriptor,
        *,
        space_id: str,
        prompt: dict[str, Any],
        approval_id: str | None = None,
        expires_at: float | None = None,
        permission_profile_revision: str | None = None,
    ) -> PolicyEvaluationResult:
        decision = self.evaluate(
            descriptor,
            space_id=space_id,
            permission_profile_revision=permission_profile_revision,
        )
        auto_reviewed = (
            decision.effect is PolicyEffect.PROMPT
            and decision.auto_review_eligible
        )
        if auto_reviewed:
            decision = replace(
                decision,
                effect=PolicyEffect.ALLOW,
                reason="auto_reviewer_approved",
            )
        audit_id = f"policy-evaluation:{descriptor.action_id}:{decision.action_digest}"
        self._journal.append_security_audit_event(
            audit_event_id=audit_id,
            space_id=space_id,
            run_id=descriptor.run_id,
            event_type=f"permission.action.{decision.effect.value}",
            actor_type="auto_reviewer" if auto_reviewed else "system",
            action_digest=descriptor.action_digest,
            details={
                "operation": descriptor.operation,
                "tool_name": descriptor.tool_name,
                "reason": decision.reason,
                "matched_rule_id": decision.matched_rule_id,
                "auto_review_eligible": decision.auto_review_eligible,
                "auto_reviewed": auto_reviewed,
            },
        )
        if decision.effect is not PolicyEffect.PROMPT:
            return PolicyEvaluationResult(decision=decision, approval=None)
        profile = self.profile_for_revision(
            space_id=space_id,
            revision=permission_profile_revision,
        )
        identifier = approval_id or f"approval_{uuid.uuid4().hex}"
        if expires_at is None:
            existing = next(
                (
                    item
                    for item in self._journal.list_approvals(descriptor.run_id)
                    if item.approval_id == identifier
                ),
                None,
            )
            expires_at = (
                existing.expires_at
                if existing is not None and existing.expires_at is not None
                else time.time() + DEFAULT_TOOL_APPROVAL_TTL_SECONDS
            )
        persistent_scopes_allowed = (
            len(descriptor.target_resources) == 1
            and descriptor.operation != "terminal.execute"
        )
        resource_matcher = (
            literal_resource_pattern(descriptor.target_resources[0])
            if persistent_scopes_allowed
            else None
        )
        approval = self._journal.create_approval(
            approval_id=identifier,
            run_id=descriptor.run_id,
            attempt_id=descriptor.attempt_id,
            prompt={
                **prompt,
                "space_id": space_id,
                "action": descriptor.persistence_payload(),
                # Persistent rules are only sound when the approved action
                # has one exact code-owned resource matcher. Shell commands,
                # broad multi-file calls, and opaque MCP actions remain
                # approve-once until a typed matcher exists for them.
                "allowed_scopes": (
                    ["once", "run", "space"]
                    if persistent_scopes_allowed
                    else ["once"]
                ),
                "rule_matcher": {
                    "action_pattern": descriptor.operation,
                    "resource_pattern": resource_matcher,
                    "matcher_kind": "literal_resource",
                }
                if resource_matcher is not None
                else None,
                "auto_review_eligible": decision.auto_review_eligible,
            },
            action_digest=descriptor.action_digest,
            policy_revision=profile.revision,
            safety_class=descriptor.safety_class.value,
            decision_scope="once",
            expires_at=expires_at,
            expiry_action="reject",
        )
        return PolicyEvaluationResult(decision=decision, approval=approval)
