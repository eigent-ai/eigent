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

import pytest

from app.run_journal import SQLiteRunJournal
from app.workspace_config import (
    ThinkingEffort,
    WorkspaceBundleManifest,
    WorkspaceBundleReconfigurationPendingError,
)
from app.workspace_config.admission import (
    EnvironmentAdmissionService,
    LegacyEnvironmentImporter,
)
from app.workspace_git.backend import GitBackend


def test_legacy_admission_persists_redacted_spec_before_attempt(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1",
            project_id="project-1",
            status="pending",
        )
        template = LegacyEnvironmentImporter().build_template(
            model_platform="openai",
            model_type="gpt-5.5-codex",
            auth_source="codex_subscription",
            requested_effort=ThinkingEffort.MAX,
            allow_local_system=True,
            mcp_server_names=("github", "github", "linear"),
        )
        service = EnvironmentAdmissionService(journal)

        first = service.persist_for_run(
            run_id="run-1",
            space_id="space-1",
            working_directory=tmp_path / "private-workspace",
            created_by="user-1",
            template=template,
        )
        replay = service.persist_for_run(
            run_id="run-1",
            space_id="space-1",
            working_directory=tmp_path / "private-workspace",
            created_by="user-1",
            template=template,
        )
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="request-1",
            reason="initial_execution",
            environment=first.binding,
        )

        assert replay.spec.spec_id == first.spec.spec_id
        assert attempt.environment_spec_id == first.spec.spec_id
        assert attempt.thinking_effort_requested == "max"
        assert attempt.thinking_effort_effective == "max"
        assert first.spec.provider_parameter_name == "reasoning_effort"
        assert first.spec.provider_value == "xhigh"
        assert tuple(
            item.id for item in template.manifest.spec.mcp_servers
        ) == ("github", "linear")

        events = journal.list_events("run-1")
        environment_events = [
            event
            for event in events
            if event.event_type == "run.environment_resolved"
        ]
        assert len(environment_events) == 1
        payload_json = json.dumps(environment_events[0].payload)
        assert str(tmp_path) not in payload_json
        assert "private-workspace" not in payload_json
        assert (
            environment_events[0].payload["provider_parameter_value"]
            == "xhigh"
        )
        assert first.persisted_spec.spec["local_materialization"][
            "context_sources"
        ][0]["absolute_path"].endswith("private-workspace")


def test_unknown_provider_remap_is_explicit_in_run_projection(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1",
            project_id="project-1",
            status="pending",
        )
        template = LegacyEnvironmentImporter().build_template(
            model_platform="anthropic",
            model_type="claude-next",
            auth_source=None,
            requested_effort=ThinkingEffort.MAX,
            allow_local_system=False,
        )

        result = EnvironmentAdmissionService(journal).persist_for_run(
            run_id="run-1",
            space_id="space-1",
            working_directory=tmp_path,
            created_by="local-user",
            template=template,
        )

        assert result.spec.thinking_effort_requested is ThinkingEffort.MAX
        assert result.spec.thinking_effort_effective is ThinkingEffort.MEDIUM
        assert result.spec.provider_parameter_name is None
        event = next(
            item
            for item in journal.list_events("run-1")
            if item.event_type == "run.environment_resolved"
        )
        assert event.payload["thinking_effort_requested"] == "max"
        assert event.payload["thinking_effort_effective"] == "medium"


def test_personal_default_import_is_secret_free_and_checksum_rerunnable():
    importer = LegacyEnvironmentImporter()
    arguments = {
        "model_platform": "openai",
        "model_type": "gpt-5.5-codex",
        "auth_source": "codex_subscription",
        "requested_effort": None,
        "allow_local_system": False,
        "mcp_server_configs": {
            "github": {
                "command": "npx",
                "env": {
                    "GITHUB_TOKEN": "ghp_do_not_put_this_in_manifest",
                    "LOG_LEVEL": "info",
                },
            }
        },
        "skill_config": {
            "version": 1,
            "skills": {
                "pdf": {"enabled": True},
                "disabled": {"enabled": False},
            },
        },
    }

    first = importer.build_template(**arguments)
    second = importer.build_template(**arguments)
    payload = first.manifest.canonical_payload()

    assert first.manifest.digest == second.manifest.digest
    assert (
        first.runtime_capability_manifest["legacy_source_checksum"]
        == (second.runtime_capability_manifest["legacy_source_checksum"])
    )
    serialized = json.dumps(payload)
    assert "ghp_do_not_put_this_in_manifest" not in serialized
    assert payload["metadata"]["name"] == "Personal Default Bundle"
    assert payload["spec"]["mcpServers"][0]["secretSlots"] == [
        "mcp.github.env.github_token"
    ]
    assert payload["spec"]["skills"] == [
        {"ref": "registry://skills/pdf@legacy", "assignTo": []}
    ]


def test_admission_pins_secret_free_git_capability(tmp_path):
    workspace = tmp_path / "private-workspace"
    workspace.mkdir()
    backend = GitBackend()
    backend.init_repository(workspace)
    readme = workspace / "README.md"
    readme.write_text("workspace", encoding="utf-8")
    base_commit = backend.commit_paths(
        workspace,
        (readme,),
        message="Initial workspace state",
        author_name="Test User",
        author_email="test@example.com",
    )
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-git",
            project_id="project-1",
            status="pending",
        )
        journal.put_git_repository(
            repository_id="repo-local-1",
            space_id="space-1",
            repository_role="content",
            root_path=str(workspace),
            root_path_digest=hashlib.sha256(
                str(workspace).encode("utf-8")
            ).hexdigest(),
            ownership="eigent_owned",
            state="ready",
            version_coverage="managed_files_only",
        )
        template = LegacyEnvironmentImporter().build_template(
            model_platform="openai",
            model_type="gpt-5.5-codex",
            auth_source="codex_subscription",
            requested_effort=ThinkingEffort.HIGH,
            allow_local_system=True,
        )

        result = EnvironmentAdmissionService(journal).persist_for_run(
            run_id="run-git",
            space_id="space-1",
            working_directory=workspace,
            created_by="user-1",
            template=template,
        )

        capability = result.spec.semantic_spec["runtime_capability_manifest"][
            "git"
        ]
        assert capability == {
            "available": True,
            "repository_id": "repo-local-1",
            "logical_root": ".",
            "current_branch": "main",
            "base_commit": base_commit,
            "version_coverage": "managed_files_only",
            "allowed_actions": [
                "status",
                "diff",
                "log",
                "checkpoint",
                "branch_list",
                "merge_request",
                "advanced_preview",
            ],
        }
        assert str(workspace) not in json.dumps(
            result.spec.cloud_projection(), sort_keys=True
        )


def test_admission_pins_current_space_permission_profile(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1",
            project_id="project-1",
            status="pending",
        )
        profile = journal.put_space_permission_profile(
            space_id="space-1",
            profile_name="read_only",
            sandbox_mode="read-only",
            approval_mode="on-request",
            reviewer_mode="user",
            updated_by="user-1",
            now=1,
        )
        template = LegacyEnvironmentImporter().build_template(
            model_platform="openai",
            model_type="gpt-5.5-codex",
            auth_source="codex_subscription",
            requested_effort=ThinkingEffort.MEDIUM,
            allow_local_system=True,
        )

        result = EnvironmentAdmissionService(journal).persist_for_run(
            run_id="run-1",
            space_id="space-1",
            working_directory=tmp_path,
            created_by="user-1",
            template=template,
        )

        assert result.binding.permission_profile_revision == (
            f"space:space-1:{profile.revision}"
        )


def test_materialized_bundle_replaces_legacy_template_for_new_run(tmp_path):
    manifest = WorkspaceBundleManifest.model_validate(
        {
            "apiVersion": "eigent.ai/v1alpha1",
            "kind": "WorkspaceBundle",
            "metadata": {
                "id": "bundle-team",
                "name": "Team Workspace",
                "revision": 1,
            },
            "spec": {
                "context": [
                    {
                        "id": "team_docs",
                        "kind": "local_path_slot",
                        "slot": "docs_folder",
                    },
                    {
                        "id": "latest_artifacts",
                        "kind": "artifact_ref",
                        "path": "artifact://project/latest",
                        "sharing": "authorized_artifact",
                    },
                    {
                        "id": "project_memory",
                        "kind": "memory_scope",
                        "path": "memory://project/current",
                    },
                ],
                "connectors": [
                    {
                        "id": "source",
                        "connector": "github",
                        "connectionSlot": "github_readonly",
                        "requiredGrants": ["repository.read"],
                    }
                ],
                "models": {
                    "default": {
                        "modelRef": "provider://default",
                        "thinkingEffort": "high",
                    }
                },
            },
        }
    ).canonical_payload()
    docs = tmp_path / "team-docs"
    docs.mkdir()
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-installed",
            project_id="project-1",
            status="pending",
        )
        revision = journal.put_workspace_config_revision(
            revision_id="bundle-team@1",
            bundle_id="bundle-team",
            revision_number=1,
            manifest=manifest,
            status="published",
            created_by="user-1",
        )
        journal.put_workspace_config_materialization(
            materialization_id="materialization-1",
            space_id="space-1",
            revision_id=revision.revision_id,
            config_placement="sidecar",
        )
        proposal = journal.put_workspace_bundle_install_proposal(
            proposal_id="proposal-1",
            request_id="install-1",
            space_id="space-1",
            bundle_id="bundle-team",
            revision_id="bundle-team@1",
            config_placement="sidecar",
            manifest=manifest,
            assets=[],
            install_plan={
                "connector_slots": [
                    {
                        "slot_id": "github_readonly",
                        "connector_id": "github",
                        "required_grants": ["repository.read"],
                    }
                ],
                "local_path_slots": ["docs_folder"],
                "script_actions": [],
                "permission_profile": "request_approval",
                "git_policy": {},
                "automatic_grants": [],
            },
        )
        proposal = journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state="approved",
            decided_by="user-1",
        )
        _, proposal = journal.put_workspace_bundle_local_binding(
            proposal_id=proposal.proposal_id,
            expected_proposal_version=proposal.version,
            slot_id="github_readonly",
            binding_kind="connector",
            connector_id="github",
            opaque_connection_id="private-connection-id",
            local_path=None,
            required_grants=["repository.read"],
            authorized_by="user-1",
        )
        _, proposal = journal.put_workspace_bundle_local_binding(
            proposal_id=proposal.proposal_id,
            expected_proposal_version=proposal.version,
            slot_id="docs_folder",
            binding_kind="local_path",
            connector_id=None,
            opaque_connection_id=None,
            local_path=str(docs),
            required_grants=[],
            authorized_by="user-1",
        )
        proposal = journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state="materializing",
        )
        proposal = journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state="materialized",
        )

        legacy = LegacyEnvironmentImporter().build_template(
            model_platform="openai",
            model_type="gpt-5.5-codex",
            auth_source="codex_subscription",
            requested_effort=None,
            allow_local_system=True,
        )
        result = EnvironmentAdmissionService(journal).persist_for_run(
            run_id="run-installed",
            space_id="space-1",
            working_directory=tmp_path,
            created_by="user-1",
            template=legacy,
        )

        assert result.template.manifest.metadata.id == "bundle-team"
        assert result.binding.bundle_revision_id == "bundle-team@1"
        assert result.spec.thinking_effort_requested is ThinkingEffort.HIGH
        assert result.spec.thinking_effort_effective is ThinkingEffort.HIGH
        local = result.spec.local_materialization
        assert next(
            item.absolute_path
            for item in local.context_sources
            if item.id == "team_docs"
        ) == str(docs.resolve())
        logical_sources = {
            item.id: item.logical_uri for item in local.context_sources
        }
        assert logical_sources["latest_artifacts"] == (
            "artifact://project/latest"
        )
        assert logical_sources["project_memory"] == "memory://project/current"
        assert local.connector_bindings[0].local_binding_id == (
            "private-connection-id"
        )
        event = next(
            item
            for item in journal.list_events("run-installed")
            if item.event_type == "run.environment_resolved"
        )
        event_json = json.dumps(event.payload)
        assert "private-connection-id" not in event_json
        assert str(docs) not in event_json

        journal.put_workspace_bundle_install_proposal(
            proposal_id="proposal-review-only",
            request_id="install-review-only",
            space_id="space-1",
            bundle_id="bundle-team",
            revision_id="bundle-team@1",
            config_placement="sidecar",
            manifest=manifest,
            assets=[],
            install_plan=proposal.install_plan,
        )
        journal.ensure_run(
            run_id="run-while-reviewing",
            project_id="project-1",
            status="pending",
        )
        while_reviewing = EnvironmentAdmissionService(journal).persist_for_run(
            run_id="run-while-reviewing",
            space_id="space-1",
            working_directory=tmp_path,
            created_by="user-1",
            template=legacy,
        )
        assert while_reviewing.binding.bundle_revision_id == "bundle-team@1"
        assert (
            while_reviewing.spec.local_materialization.connector_bindings[
                0
            ].local_binding_id
            == "private-connection-id"
        )

        _, pending = journal.put_workspace_bundle_local_binding(
            proposal_id=proposal.proposal_id,
            expected_proposal_version=proposal.version,
            slot_id="github_readonly",
            binding_kind="connector",
            connector_id="github",
            opaque_connection_id="replacement-connection-id",
            local_path=None,
            required_grants=["repository.read"],
            authorized_by="user-1",
        )
        assert pending.state == "needs_attention"
        assert pending.error_code == "bundle_reconfiguration_pending"
        journal.ensure_run(
            run_id="run-after-rebind",
            project_id="project-1",
            status="pending",
        )

        with pytest.raises(
            WorkspaceBundleReconfigurationPendingError,
            match="must be synced",
        ) as error:
            EnvironmentAdmissionService(journal).persist_for_run(
                run_id="run-after-rebind",
                space_id="space-1",
                working_directory=tmp_path,
                created_by="user-1",
                template=legacy,
            )

        assert error.value.code == "workspace_bundle_reconfiguration_pending"
        assert error.value.proposal_id == proposal.proposal_id
        assert journal.list_events("run-after-rebind") == []

        materializing = journal.transition_workspace_bundle_install_proposal(
            pending.proposal_id,
            expected_version=pending.version,
            state="materializing",
        )
        journal.ensure_run(
            run_id="run-during-resync",
            project_id="project-1",
            status="pending",
        )
        with pytest.raises(
            WorkspaceBundleReconfigurationPendingError,
            match="must be synced",
        ) as resync_error:
            EnvironmentAdmissionService(journal).persist_for_run(
                run_id="run-during-resync",
                space_id="space-1",
                working_directory=tmp_path,
                created_by="user-1",
                template=legacy,
            )
        assert resync_error.value.state == materializing.state
        assert journal.list_events("run-during-resync") == []
