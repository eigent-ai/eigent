from __future__ import annotations

import math

from app.permission_policy import (
    PRESET_PROFILES,
    ActionDescriptor,
    PermissionPolicyEngine,
    PermissionProfileName,
    PolicyEffect,
    PolicyRule,
    build_tool_action_descriptor,
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


def test_auto_reviewer_uses_workspace_and_sensitive_path_risk_tags(tmp_path):
    engine = PermissionPolicyEngine()
    profile = PRESET_PROFILES[PermissionProfileName.AUTO_REVIEWER]

    def descriptor(path: str) -> ActionDescriptor:
        return build_tool_action_descriptor(
            action_id=f"action-{path}",
            tool_name="write_to_file",
            toolkit_name="File Toolkit",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            arguments={"filename": path, "content": "value"},
            run_id="run-1",
            attempt_id="attempt-1",
            environment_spec_digest="e" * 64,
            idempotency_key=None,
            workspace_root=tmp_path,
        )

    local = engine.evaluate(descriptor("report.md"), profile=profile)
    credential = engine.evaluate(
        descriptor(str(tmp_path.parent / ".ssh" / "authorized_keys")),
        profile=profile,
    )
    policy_db = engine.evaluate(
        descriptor(str(tmp_path / ".eigent" / "policy.sqlite3")),
        profile=profile,
    )

    assert local.auto_review_eligible is True
    assert credential.effect is PolicyEffect.PROMPT
    assert credential.auto_review_eligible is False
    assert policy_db.effect is PolicyEffect.DENY
    assert policy_db.reason == "platform_hard_deny_resource"


def test_literal_resource_rule_does_not_expand_model_supplied_glob():
    engine = PermissionPolicyEngine()
    profile = PRESET_PROFILES[PermissionProfileName.REQUEST_APPROVAL]
    rule = PolicyRule(
        rule_id="literal-star",
        effect=PolicyEffect.ALLOW,
        action_pattern="filesystem.write",
        resource_pattern="out[*].txt",
    )
    literal = _action()
    literal = ActionDescriptor(
        **{
            **literal.__dict__,
            "target_resources": ("out*.txt",),
        }
    )
    other = ActionDescriptor(
        **{
            **literal.__dict__,
            "action_id": "action-2",
            "target_resources": ("output.txt",),
        }
    )

    assert engine.evaluate(literal, profile=profile, rules=(rule,)).effect is (
        PolicyEffect.ALLOW
    )
    assert engine.evaluate(other, profile=profile, rules=(rule,)).effect is (
        PolicyEffect.PROMPT
    )


def test_resource_rule_must_cover_every_resource_in_a_multi_path_action():
    action = _action()
    action = ActionDescriptor(
        **{
            **action.__dict__,
            "target_resources": ("/ws/notes.md", "/ws/.git/config"),
        }
    )
    rule = PolicyRule(
        rule_id="notes-only",
        effect=PolicyEffect.ALLOW,
        action_pattern="filesystem.write",
        resource_pattern="/ws/notes.md",
    )

    decision = PermissionPolicyEngine().evaluate(
        action,
        profile=PRESET_PROFILES[PermissionProfileName.REQUEST_APPROVAL],
        rules=(rule,),
    )

    assert decision.effect is PolicyEffect.PROMPT
    assert decision.matched_rule_id is None


def test_resource_deny_still_matches_any_sensitive_target():
    action = _action()
    action = ActionDescriptor(
        **{
            **action.__dict__,
            "target_resources": ("/ws/notes.md", "/ws/.git/config"),
        }
    )
    rule = PolicyRule(
        rule_id="deny-git-config",
        effect=PolicyEffect.DENY,
        action_pattern="filesystem.write",
        resource_pattern="/ws/.git/config",
    )

    decision = PermissionPolicyEngine().evaluate(
        action,
        profile=PRESET_PROFILES[PermissionProfileName.FULL_ACCESS],
        rules=(rule,),
    )

    assert decision.effect is PolicyEffect.DENY
    assert decision.matched_rule_id == "deny-git-config"


def test_git_config_and_terminal_journal_mutation_are_high_risk(tmp_path):
    profile = PRESET_PROFILES[PermissionProfileName.AUTO_REVIEWER]
    engine = PermissionPolicyEngine()
    git_config = build_tool_action_descriptor(
        action_id="git-config",
        tool_name="write_to_file",
        toolkit_name="File Toolkit",
        safety_class=ToolSafetyClass.UNSAFE_WRITE,
        arguments={"filename": str(tmp_path / ".git" / "config")},
        run_id="run-1",
        attempt_id="attempt-1",
        environment_spec_digest="e" * 64,
        idempotency_key=None,
        workspace_root=tmp_path,
    )
    journal_edit = build_tool_action_descriptor(
        action_id="terminal-journal",
        tool_name="shell_exec",
        toolkit_name="Terminal Toolkit",
        safety_class=ToolSafetyClass.UNSAFE_WRITE,
        arguments={
            "command": "sqlite3 ~/.eigent/run-journal.sqlite3 'UPDATE approvals SET status=approved'"
        },
        run_id="run-1",
        attempt_id="attempt-1",
        environment_spec_digest="e" * 64,
        idempotency_key=None,
        workspace_root=tmp_path,
    )

    git_decision = engine.evaluate(git_config, profile=profile)
    journal_decision = engine.evaluate(journal_edit, profile=profile)

    assert "untrusted_hook" in git_config.risk_tags
    assert git_decision.auto_review_eligible is False
    assert "policy_control_plane" in journal_edit.risk_tags
    assert journal_decision.effect is PolicyEffect.DENY


def test_normal_eigent_terminal_workspace_is_not_a_control_plane_path(tmp_path):
    action = build_tool_action_descriptor(
        action_id="terminal-output",
        tool_name="write_to_file",
        toolkit_name="File Toolkit",
        safety_class=ToolSafetyClass.UNSAFE_WRITE,
        arguments={"filename": str(tmp_path / ".eigent" / "terminal" / "out.txt")},
        run_id="run-1",
        attempt_id="attempt-1",
        environment_spec_digest="e" * 64,
        idempotency_key=None,
        workspace_root=tmp_path,
    )

    assert "policy_control_plane" not in action.risk_tags


def test_persistence_payload_redacts_secrets_but_keeps_a_bounded_preview():
    action = _action(
        arguments={
            "path": "report.md",
            "apiKeys": ["sk-never-persist-this"],
            "command": "curl -H 'Authorization: Bearer abcdefghijklmnop'",
            "content": "x" * 20_000,
        }
    )

    payload = action.persistence_payload()
    display = payload["normalized_arguments"]

    assert display["truncated"] is True
    assert "sk-never-persist-this" not in display["preview"]
    assert "abcdefghijklmnop" not in display["preview"]
    assert "[REDACTED]" in display["preview"]
    assert len(display["preview"]) <= 4000
    assert action.action_digest


def test_non_finite_model_argument_is_bound_without_crashing():
    action = _action(arguments={"path": "report.md", "score": math.nan})

    assert action.action_digest
    assert action.canonical_payload()["normalized_arguments"]["score"] == {
        "__eigent_non_finite_float__": "nan"
    }
