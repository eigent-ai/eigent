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

from app.permission_policy import (
    ActionDescriptor,
    PermissionPolicyService,
    PolicyEffect,
    build_tool_action_descriptor,
)
from app.run_journal import AttemptEnvironmentBinding, SQLiteRunJournal
from app.run_policy import ToolSafetyClass
from app.workspace_config import (
    EnvironmentConfigResolver,
    LocalMaterialization,
    ProviderModelCapability,
    ThinkingEffort,
    parse_workspace_manifest,
)


def _create_bound_attempt(
    journal: SQLiteRunJournal,
    *,
    run_id: str,
    permission_profile_revision: str,
):
    manifest = parse_workspace_manifest(
        f"""
apiVersion: eigent.ai/v1alpha1
kind: WorkspaceBundle
metadata:
  id: bundle_{run_id}
  name: Permission test
  revision: 1
spec:
  models:
    default:
      modelRef: provider://default
      thinkingEffort: medium
"""
    )
    journal.put_workspace_config_revision(
        revision_id=manifest.revision_id,
        bundle_id=manifest.metadata.id,
        revision_number=manifest.metadata.revision,
        manifest=manifest.canonical_payload(),
        created_by="test",
    )
    capability = ProviderModelCapability(
        supported_efforts=tuple(ThinkingEffort),
        default_effort=ThinkingEffort.MEDIUM,
        provider_mapping={effort: effort.value for effort in ThinkingEffort},
        capability_revision="capability-v1",
    )
    spec = EnvironmentConfigResolver().resolve(
        manifest=manifest,
        owner_type="run",
        owner_id=run_id,
        local_materialization=LocalMaterialization(),
        provider_capability=capability,
        permission_profile_revision_override=permission_profile_revision,
    )
    journal.put_effective_environment_spec(spec)
    return journal.create_run_attempt(
        run_id,
        request_id="initial",
        reason="initial_execution",
        activate=True,
        environment=AttemptEnvironmentBinding(
            environment_spec_id=spec.spec_id,
            environment_spec_digest=spec.digest,
            bundle_revision_id=spec.bundle_revision_id,
            permission_profile_revision=spec.permission_profile_revision,
            thinking_effort_requested=spec.thinking_effort_requested.value,
            thinking_effort_effective=spec.thinking_effort_effective.value,
            provider_capability_revision=spec.provider_capability_revision,
        ),
    )


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
        assert result.approval.expires_at is not None
        assert result.approval.expiry_action == "reject"
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
        journal.ensure_run(run_id="run-2", project_id="project-2")
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
        journal.ensure_run(run_id="run-3", project_id="project-3")
        mcp_attempt = journal.create_run_attempt(
            "run-3",
            request_id="mcp",
            reason="initial_execution",
            activate=True,
            now=3,
        )
        mcp_result = PermissionPolicyService(
            journal
        ).evaluate_and_request_approval(
            build_tool_action_descriptor(
                action_id="mcp-action",
                tool_name="search_actions",
                toolkit_name="MCPToolkit",
                safety_class=ToolSafetyClass.UNSAFE_WRITE,
                arguments={"query": "calendar"},
                run_id="run-3",
                attempt_id=mcp_attempt.attempt_id,
                environment_spec_digest="e" * 64,
                idempotency_key=None,
            ),
            space_id="space-1",
            prompt={"title": "search actions"},
        )

        assert file_result.approval is not None
        assert file_result.approval.prompt["allowed_scopes"] == [
            "once",
            "space",
        ]
        matcher = file_result.approval.prompt["rule_matcher"]
        assert matcher == {
            "action_pattern": matcher["action_pattern"],
            "display_operation": "filesystem.write",
            "resource_pattern": "out[*].txt",
            "matcher_kind": "literal_resource",
        }
        assert matcher["action_pattern"].startswith("action-identity:sha256:")
        assert terminal_result.approval is not None
        assert terminal_result.approval.prompt["allowed_scopes"] == ["once"]
        assert terminal_result.approval.prompt["rule_matcher"] is None
        assert mcp_result.approval is not None
        assert mcp_result.approval.prompt["allowed_scopes"] == [
            "once",
            "space",
        ]
        mcp_matcher = mcp_result.approval.prompt["rule_matcher"]
        assert mcp_matcher["action_pattern"].startswith(
            "action-identity:sha256:"
        )
        assert mcp_matcher["display_operation"] == "mcp.tool.write"
        assert mcp_matcher["resource_pattern"].startswith(
            "tool-identity:sha256:"
        )
        assert mcp_matcher["matcher_kind"] == "literal_tool"


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


def test_space_tool_rule_allows_only_the_same_opaque_tool(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        search = build_tool_action_descriptor(
            action_id="search-1",
            tool_name="search_actions",
            toolkit_name="MCPToolkit",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            arguments={"query": "calendar"},
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            environment_spec_digest="e" * 64,
            idempotency_key=None,
        )
        journal.create_approval_rule(
            rule_id="allow-search-actions",
            space_id="space-1",
            effect="allow",
            action_pattern="mcp.tool.write",
            resource_pattern=search.target_resources[0],
            scope="space",
            run_id=None,
            source_interaction_id=None,
            expires_at=None,
            created_by="user-1",
            now=2,
        )
        repeated_search = build_tool_action_descriptor(
            action_id="search-2",
            tool_name="search_actions",
            toolkit_name="MCPToolkit",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            arguments={"query": "email"},
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            environment_spec_digest="e" * 64,
            idempotency_key=None,
        )
        execute = build_tool_action_descriptor(
            action_id="execute-1",
            tool_name="execute_action",
            toolkit_name="MCPToolkit",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            arguments={"action": "send"},
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            environment_spec_digest="e" * 64,
            idempotency_key=None,
        )
        service = PermissionPolicyService(journal)

        assert (
            service.evaluate(repeated_search, space_id="space-1").effect
            is PolicyEffect.ALLOW
        )
        assert (
            service.evaluate(execute, space_id="space-1").effect
            is PolicyEffect.PROMPT
        )


def test_policy_service_uses_pinned_profile_revision(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
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
        attempt = _create_bound_attempt(
            journal,
            run_id="run-1",
            permission_profile_revision=pinned_revision,
        )
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
        assert current.effect is PolicyEffect.PROMPT


def test_auto_reviewer_approves_routine_actions_and_prompts_for_danger(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
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
        attempt = _create_bound_attempt(
            journal,
            run_id="run-1",
            permission_profile_revision=revision,
        )
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
        routine_mcp_write = ActionDescriptor(
            action_id="action-mcp",
            tool_name="todo_write",
            operation="mcp.tool.write",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            normalized_arguments={"todo": "finish report"},
            target_resources=("tool-identity:sha256:todo-write",),
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
        mcp_allowed = service.evaluate_and_request_approval(
            routine_mcp_write,
            space_id="space-1",
            prompt={"title": "update todo"},
            permission_profile_revision=revision,
        )

        assert allowed.decision.effect is PolicyEffect.ALLOW
        assert allowed.decision.reason == "auto_reviewer_approved"
        assert allowed.approval is None
        assert prompted.decision.effect is PolicyEffect.PROMPT
        assert prompted.approval is not None
        assert mcp_allowed.decision.effect is PolicyEffect.ALLOW
        assert mcp_allowed.decision.reason == "auto_reviewer_approved"
        assert mcp_allowed.approval is None


def test_sqlite_tampering_cannot_enable_profile_or_allow_rule(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
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
        with journal._lock:
            journal._connection.execute(
                """
                UPDATE run_attempts
                SET permission_profile_revision = 'preset:full_access:v1'
                WHERE attempt_id = ?
                """,
                (attempt.attempt_id,),
            )
            journal._connection.execute(
                """
                INSERT INTO approval_rules(
                    rule_id, space_id, effect, action_pattern,
                    resource_pattern, scope, run_id,
                    source_interaction_id, expires_at, created_by, created_at
                ) VALUES (
                    'forged-rule', 'space-1', 'allow', '*', NULL, 'space',
                    NULL, NULL, NULL, 'sqlite-tamper', 1
                )
                """
            )

        # Idempotent recovery reads must not turn forged rows into live
        # control-plane attestations.
        journal.create_approval_rule(
            rule_id="forged-rule",
            space_id="space-1",
            effect="allow",
            action_pattern="*",
            resource_pattern=None,
            scope="space",
            run_id=None,
            source_interaction_id=None,
            expires_at=None,
            created_by="sqlite-tamper",
            now=1,
        )

        decision = PermissionPolicyService(journal).evaluate(
            descriptor,
            space_id="space-1",
            permission_profile_revision="preset:full_access:v1",
        )

        assert decision.effect is PolicyEffect.PROMPT
        assert decision.matched_rule_id is None
