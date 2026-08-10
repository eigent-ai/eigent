"""Deterministic permission evaluation over trusted action metadata."""

from __future__ import annotations

from fnmatch import fnmatchcase

from app.permission_policy.models import (
    ActionDescriptor,
    PermissionProfile,
    PermissionProfileName,
    PolicyDecision,
    PolicyEffect,
    PolicyRule,
)
from app.run_policy import ToolSafetyClass

_RULE_PRECEDENCE = {
    PolicyEffect.DENY: 3,
    PolicyEffect.PROMPT: 2,
    PolicyEffect.ALLOW: 1,
}
_AUTO_REVIEW_FORBIDDEN_OPERATIONS = frozenset(
    {
        "filesystem.delete",
        "connector.delete",
        "skill.script.execute",
        "git.history_rewrite",
        "git.destructive",
        "git.remote_write",
        "git.config_sensitive",
        "permission.rule.create",
        "permission.profile.modify",
    }
)
_AUTO_REVIEW_FORBIDDEN_RISK_TAGS = frozenset(
    {
        "credential_export",
        "external_send",
        "external_publish",
        "finance",
        "new_filesystem_root",
        "permanent_delete",
        "untrusted_hook",
        "untrusted_script",
    }
)
_AUTO_REVIEW_ELIGIBLE_OPERATIONS = frozenset(
    {
        "filesystem.write",
        "git.local_write",
        "git.integrate",
    }
)
_PLATFORM_HARD_DENY_OPERATIONS = frozenset(
    {"permission.rule.create", "permission.profile.modify"}
)
_PLATFORM_HARD_DENY_RISK_TAGS = frozenset({"policy_control_plane"})


class PermissionPolicyEngine:
    def __init__(
        self,
        *,
        platform_hard_denies: frozenset[str] = _PLATFORM_HARD_DENY_OPERATIONS,
    ):
        self._platform_hard_denies = platform_hard_denies

    def evaluate(
        self,
        descriptor: ActionDescriptor,
        *,
        profile: PermissionProfile,
        rules: tuple[PolicyRule, ...] = (),
    ) -> PolicyDecision:
        if descriptor.operation in self._platform_hard_denies:
            return self._decision(
                PolicyEffect.DENY,
                "platform_hard_deny",
                descriptor,
                profile,
            )
        if set(descriptor.risk_tags) & _PLATFORM_HARD_DENY_RISK_TAGS:
            return self._decision(
                PolicyEffect.DENY,
                "platform_hard_deny_resource",
                descriptor,
                profile,
            )

        matched = sorted(
            (rule for rule in rules if self._matches(rule, descriptor)),
            key=lambda rule: (-_RULE_PRECEDENCE[rule.effect], rule.rule_id),
        )
        if (
            profile.name is PermissionProfileName.READ_ONLY
            and descriptor.safety_class is not ToolSafetyClass.SAFE_READ
        ):
            return self._decision(
                PolicyEffect.DENY,
                "read_only_profile",
                descriptor,
                profile,
            )
        if matched:
            rule = matched[0]
            return self._decision(
                rule.effect,
                f"matched_{rule.effect.value}_rule",
                descriptor,
                profile,
                matched_rule_id=rule.rule_id,
                auto_review_eligible=(
                    rule.effect is PolicyEffect.PROMPT
                    and self._auto_review_eligible(descriptor, profile)
                ),
            )

        if descriptor.safety_class is ToolSafetyClass.SAFE_READ:
            return self._decision(
                PolicyEffect.ALLOW,
                "trusted_safe_read",
                descriptor,
                profile,
            )
        if profile.name is PermissionProfileName.FULL_ACCESS:
            return self._decision(
                PolicyEffect.ALLOW,
                "full_access_profile",
                descriptor,
                profile,
            )
        return self._decision(
            PolicyEffect.PROMPT,
            "profile_requires_approval",
            descriptor,
            profile,
            auto_review_eligible=self._auto_review_eligible(
                descriptor, profile
            ),
        )

    @staticmethod
    def _matches(rule: PolicyRule, descriptor: ActionDescriptor) -> bool:
        if rule.scope == "run" and rule.run_id != descriptor.run_id:
            return False
        if not fnmatchcase(descriptor.operation, rule.action_pattern):
            return False
        if rule.resource_pattern is None:
            return True
        resource_matches = tuple(
            fnmatchcase(resource, rule.resource_pattern)
            for resource in descriptor.target_resources
        )
        if rule.effect is PolicyEffect.ALLOW:
            # An allow rule grants the entire action, so every target must be
            # within its matcher. This prevents a safe path from carrying an
            # unrelated sensitive target in the same tool call.
            return bool(resource_matches) and all(resource_matches)
        # A deny or prompt rule is protective: one matching target is enough.
        return any(resource_matches)

    @staticmethod
    def _auto_review_eligible(
        descriptor: ActionDescriptor,
        profile: PermissionProfile,
    ) -> bool:
        if profile.name is not PermissionProfileName.AUTO_REVIEWER:
            return False
        if descriptor.operation not in _AUTO_REVIEW_ELIGIBLE_OPERATIONS:
            return False
        if descriptor.operation in _AUTO_REVIEW_FORBIDDEN_OPERATIONS:
            return False
        return not bool(
            set(descriptor.risk_tags) & _AUTO_REVIEW_FORBIDDEN_RISK_TAGS
        )

    @staticmethod
    def _decision(
        effect: PolicyEffect,
        reason: str,
        descriptor: ActionDescriptor,
        profile: PermissionProfile,
        *,
        matched_rule_id: str | None = None,
        auto_review_eligible: bool = False,
    ) -> PolicyDecision:
        return PolicyDecision(
            effect=effect,
            reason=reason,
            profile=profile.name,
            action_digest=descriptor.action_digest,
            matched_rule_id=matched_rule_id,
            auto_review_eligible=auto_review_eligible,
        )
