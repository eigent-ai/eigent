from __future__ import annotations

from app.permission_policy import (
    PRESET_PROFILES,
    ActionDescriptor,
    PermissionPolicyEngine,
    PermissionProfileName,
    PolicyEffect,
    PolicyRule,
)
from app.run_policy import ToolSafetyClass


def _action(
    *,
    operation: str = "filesystem.write",
    safety: ToolSafetyClass = ToolSafetyClass.UNSAFE_WRITE,
    arguments: dict | None = None,
    risk_tags: tuple[str, ...] = (),
) -> ActionDescriptor:
    return ActionDescriptor(
        action_id="action-1",
        tool_name="write_file",
        operation=operation,
        safety_class=safety,
        normalized_arguments=arguments or {"path": "report.md"},
        target_resources=("report.md",),
        external_side_effect=safety is not ToolSafetyClass.SAFE_READ,
        run_id="run-1",
        attempt_id="attempt-1",
        environment_spec_digest="e" * 64,
        risk_tags=risk_tags,
    )


def test_action_digest_changes_when_bound_arguments_change():
    first = _action(arguments={"path": "report.md", "content": "one"})
    second = _action(arguments={"path": "report.md", "content": "two"})

    assert first.action_digest != second.action_digest


def test_profile_defaults_are_deterministic():
    engine = PermissionPolicyEngine()
    write = _action()
    read = _action(
        operation="filesystem.read", safety=ToolSafetyClass.SAFE_READ
    )

    assert (
        engine.evaluate(
            read, profile=PRESET_PROFILES[PermissionProfileName.READ_ONLY]
        ).effect
        is PolicyEffect.ALLOW
    )
    assert (
        engine.evaluate(
            write, profile=PRESET_PROFILES[PermissionProfileName.READ_ONLY]
        ).effect
        is PolicyEffect.DENY
    )
    assert (
        engine.evaluate(
            write,
            profile=PRESET_PROFILES[PermissionProfileName.REQUEST_APPROVAL],
        ).effect
        is PolicyEffect.PROMPT
    )
    assert (
        engine.evaluate(
            write, profile=PRESET_PROFILES[PermissionProfileName.FULL_ACCESS]
        ).effect
        is PolicyEffect.ALLOW
    )


def test_rule_precedence_is_deny_then_prompt_then_allow():
    decision = PermissionPolicyEngine().evaluate(
        _action(),
        profile=PRESET_PROFILES[PermissionProfileName.FULL_ACCESS],
        rules=(
            PolicyRule(
                rule_id="allow",
                effect=PolicyEffect.ALLOW,
                action_pattern="filesystem.*",
            ),
            PolicyRule(
                rule_id="prompt",
                effect=PolicyEffect.PROMPT,
                action_pattern="filesystem.write",
            ),
            PolicyRule(
                rule_id="deny",
                effect=PolicyEffect.DENY,
                action_pattern="filesystem.write",
            ),
        ),
    )

    assert decision.effect is PolicyEffect.DENY
    assert decision.matched_rule_id == "deny"


def test_auto_reviewer_never_auto_approves_forbidden_actions():
    engine = PermissionPolicyEngine()
    profile = PRESET_PROFILES[PermissionProfileName.AUTO_REVIEWER]

    normal = engine.evaluate(_action(), profile=profile)
    delete = engine.evaluate(
        _action(operation="filesystem.delete"), profile=profile
    )
    finance = engine.evaluate(
        _action(operation="connector.write", risk_tags=("finance",)),
        profile=profile,
    )

    assert normal.auto_review_eligible is True
    assert delete.auto_review_eligible is False
    assert finance.auto_review_eligible is False


def test_read_only_profile_cannot_be_bypassed_by_allow_rule():
    decision = PermissionPolicyEngine().evaluate(
        _action(),
        profile=PRESET_PROFILES[PermissionProfileName.READ_ONLY],
        rules=(
            PolicyRule(
                rule_id="legacy-space-allow",
                effect=PolicyEffect.ALLOW,
                action_pattern="filesystem.write",
            ),
        ),
    )

    assert decision.effect is PolicyEffect.DENY
    assert decision.reason == "read_only_profile"


def test_auto_reviewer_only_marks_bounded_local_writes_eligible():
    engine = PermissionPolicyEngine()
    profile = PRESET_PROFILES[PermissionProfileName.AUTO_REVIEWER]

    local_write = engine.evaluate(_action(), profile=profile)
    external_write = engine.evaluate(
        _action(operation="connector.write"), profile=profile
    )

    assert local_write.auto_review_eligible is True
    assert external_write.auto_review_eligible is False
