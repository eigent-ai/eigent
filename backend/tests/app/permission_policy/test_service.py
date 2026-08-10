from __future__ import annotations

from app.permission_policy import (
    ActionDescriptor,
    PermissionPolicyService,
    PolicyEffect,
)
from app.run_journal import SQLiteRunJournal
from app.run_policy import ToolSafetyClass


def test_policy_service_creates_digest_bound_approval_and_audit(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        descriptor = ActionDescriptor(
            action_id="action-1",
            tool_name="write_file",
            operation="filesystem.write",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            normalized_arguments={"path": "report.md"},
            target_resources=("report.md",),
            external_side_effect=True,
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            environment_spec_digest="e" * 64,
        )

        result = PermissionPolicyService(
            journal
        ).evaluate_and_request_approval(
            descriptor,
            space_id="space-1",
            prompt={"title": "Allow file write?"},
            approval_id="approval-1",
        )

        assert result.decision.effect is PolicyEffect.PROMPT
        assert result.approval is not None
        assert result.approval.action_digest == descriptor.action_digest
        interaction = journal.get_human_interaction("approval-1")
        assert interaction is not None
        assert interaction.interaction_type == "approval"
        with journal._lock:
            audit = journal._connection.execute(
                "SELECT * FROM security_audit_events"
            ).fetchall()
        assert len(audit) == 1


def test_persistent_approval_uses_literal_matcher_and_shell_is_once_only(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        common = {
            "safety_class": ToolSafetyClass.UNSAFE_WRITE,
            "external_side_effect": True,
            "run_id": "run-1",
            "attempt_id": attempt.attempt_id,
            "environment_spec_digest": "e" * 64,
        }
        file_result = PermissionPolicyService(
            journal
        ).evaluate_and_request_approval(
            ActionDescriptor(
                action_id="file-action",
                tool_name="write_to_file",
                operation="filesystem.write",
                normalized_arguments={"filename": "out*.txt"},
                target_resources=("out*.txt",),
                **common,
            ),
            space_id="space-1",
            prompt={"title": "write"},
        )
        journal.ensure_run(run_id="run-2", project_id="project-1")
        shell_attempt = journal.create_run_attempt(
            "run-2",
            request_id="shell",
            reason="initial_execution",
            activate=True,
            now=2,
        )
        terminal_result = PermissionPolicyService(
            journal
        ).evaluate_and_request_approval(
            ActionDescriptor(
                action_id="shell-action",
                tool_name="shell_exec",
                operation="terminal.execute",
                normalized_arguments={"command": "ls"},
                target_resources=("terminal-command:sha256:digest",),
                safety_class=ToolSafetyClass.UNSAFE_WRITE,
                external_side_effect=True,
                run_id="run-2",
                attempt_id=shell_attempt.attempt_id,
                environment_spec_digest="e" * 64,
            ),
            space_id="space-1",
            prompt={"title": "shell"},
        )

        assert file_result.approval is not None
        assert file_result.approval.prompt["allowed_scopes"] == [
            "once",
            "run",
            "space",
        ]
        assert file_result.approval.prompt["rule_matcher"] == {
            "action_pattern": "filesystem.write",
            "resource_pattern": "out[*].txt",
            "matcher_kind": "literal_resource",
        }
        assert terminal_result.approval is not None
        assert terminal_result.approval.prompt["allowed_scopes"] == ["once"]
        assert terminal_result.approval.prompt["rule_matcher"] is None


def test_large_approval_projection_is_bounded_but_digest_is_full(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        descriptor = ActionDescriptor(
            action_id="large-action",
            tool_name="write_to_file",
            operation="filesystem.write",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            normalized_arguments={
                "filename": "report.md",
                "content": "x" * 20_000,
            },
            target_resources=("report.md",),
            external_side_effect=True,
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            environment_spec_digest="e" * 64,
        )

        result = PermissionPolicyService(
            journal
        ).evaluate_and_request_approval(
            descriptor,
            space_id="space-1",
            prompt={"title": "write"},
        )

        assert result.approval is not None
        persisted = result.approval.prompt["action"]["normalized_arguments"]
        assert persisted["truncated"] is True
        assert persisted["size_bytes"] > 16 * 1024
        assert result.approval.action_digest == descriptor.action_digest


def test_policy_service_uses_pinned_profile_revision(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        first = journal.put_space_permission_profile(
            space_id="space-1",
            profile_name="read_only",
            sandbox_mode="read-only",
            approval_mode="on-request",
            reviewer_mode="user",
            updated_by="user-1",
            now=2,
        )
        pinned_revision = f"space:space-1:{first.revision}"
        journal.put_space_permission_profile(
            space_id="space-1",
            profile_name="full_access",
            sandbox_mode="danger-full-access",
            approval_mode="never",
            reviewer_mode="none",
            updated_by="user-1",
            expected_revision=first.revision,
            now=3,
        )
        descriptor = ActionDescriptor(
            action_id="action-1",
            tool_name="write_file",
            operation="filesystem.write",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            normalized_arguments={"path": "report.md"},
            target_resources=("report.md",),
            external_side_effect=True,
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            environment_spec_digest="e" * 64,
        )
        service = PermissionPolicyService(journal)

        pinned = service.evaluate(
            descriptor,
            space_id="space-1",
            permission_profile_revision=pinned_revision,
        )
        current = service.evaluate(descriptor, space_id="space-1")

        assert pinned.effect is PolicyEffect.DENY
        assert current.effect is PolicyEffect.ALLOW


def test_auto_reviewer_approves_only_eligible_actions(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        profile = journal.put_space_permission_profile(
            space_id="space-1",
            profile_name="auto_reviewer",
            sandbox_mode="workspace-write",
            approval_mode="on-request",
            reviewer_mode="auto_reviewer",
            updated_by="user-1",
            now=2,
        )
        revision = f"space:space-1:{profile.revision}"
        service = PermissionPolicyService(journal)

        eligible = ActionDescriptor(
            action_id="action-write",
            tool_name="write_file",
            operation="filesystem.write",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            normalized_arguments={"path": "report.md"},
            target_resources=("report.md",),
            external_side_effect=True,
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            environment_spec_digest="e" * 64,
        )
        forbidden = ActionDescriptor(
            action_id="action-delete",
            tool_name="delete_file",
            operation="filesystem.delete",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            normalized_arguments={"path": "report.md"},
            target_resources=("report.md",),
            external_side_effect=True,
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            environment_spec_digest="e" * 64,
        )

        allowed = service.evaluate_and_request_approval(
            eligible,
            space_id="space-1",
            prompt={"title": "write"},
            permission_profile_revision=revision,
        )
        prompted = service.evaluate_and_request_approval(
            forbidden,
            space_id="space-1",
            prompt={"title": "delete"},
            permission_profile_revision=revision,
        )

        assert allowed.decision.effect is PolicyEffect.ALLOW
        assert allowed.decision.reason == "auto_reviewer_approved"
        assert allowed.approval is None
        assert prompted.decision.effect is PolicyEffect.PROMPT
        assert prompted.approval is not None
