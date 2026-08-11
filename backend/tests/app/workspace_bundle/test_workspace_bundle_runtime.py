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
import shlex
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import yaml

from app.agent.toolkit.terminal_toolkit import _shell_command_argv
from app.controller.chat_controller import _load_attempt_environment_spec
from app.exception.exception import UserException
from app.permission_policy import ActionDescriptor, PermissionPolicyService
from app.run_journal import AttemptEnvironmentBinding, SQLiteRunJournal
from app.run_policy import ToolSafetyClass
from app.workspace_bundle.mcp_destination import (
    attestation_grant,
    inspect_bundle_mcp_destination,
    secret_binding_attestation,
    secret_binding_grant,
)
from app.workspace_bundle.runtime import (
    EnvironmentSetupRequiredError,
    ResolvedRuntimeEnvironment,
    RuntimeEnvironmentAssembler,
    bundle_runtime_binding_digest,
)
from app.workspace_bundle.secrets import (
    WorkspaceSecretIdentity,
    WorkspaceSecretResolution,
    WorkspaceSecretVerification,
)
from app.workspace_config import (
    EnvironmentConfigResolver,
    LocalMaterialization,
    ResolvedContextSource,
    WorkspaceBundleManifest,
)
from app.workspace_config.admission import (
    EnvironmentAdmissionService,
    LegacyEnvironmentImporter,
)


class _SecretBroker:
    MAX_BATCH_BINDINGS = 100

    def __init__(self, value: str) -> None:
        self.value = value
        self.calls = 0

    def resolve_many(self, identities):
        self.calls += 1
        return tuple(
            WorkspaceSecretResolution(identity=item, value=self.value)
            for item in identities
        )

    def verify_many(self, identities):
        self.calls += 1
        return tuple(
            WorkspaceSecretVerification(identity=item, state="available")
            for item in identities
        )


def test_protected_bundle_commands_use_explicit_shell_argv():
    command = "printf 'safe' && printf ' shell'"

    assert _shell_command_argv(command, os_name="posix") == [
        "/bin/sh",
        "-c",
        command,
    ]
    assert _shell_command_argv(
        command,
        os_name="nt",
        comspec=r"C:\Windows\System32\cmd.exe",
    ) == [
        r"C:\Windows\System32\cmd.exe",
        "/d",
        "/s",
        "/c",
        command,
    ]


def _installed_spec(
    tmp_path: Path,
    journal: SQLiteRunJournal,
    *,
    bind_environment: bool = True,
    agent_ids: tuple[str, ...] = ("single_agent",),
    mcp_secret_slots: tuple[str, ...] = (),
):
    contents = {
        "instructions/coordinator.md": b"Prefer the verified dataset.\n",
        "context/domain.md": b"Domain context from the pinned revision.\n",
        "skills/demo/SKILL.md": (
            b"---\nname: demo\ndescription: Pinned demo skill\n---\n"
            b"Always use the pinned procedure.\n"
        ),
        "mcp/local.json": json.dumps(
            {
                "mcpServers": {
                    "bundle-local": {
                        "command": "python",
                        "args": ["-c", "print('ready')"],
                    }
                }
            }
        ).encode(),
    }
    if mcp_secret_slots:
        mcp_definition = json.loads(contents["mcp/local.json"])
        mcp_definition["mcpServers"]["bundle-local"]["env"] = {
            slot: f"slot://{slot}" for slot in mcp_secret_slots
        }
        contents["mcp/local.json"] = json.dumps(mcp_definition).encode()
    manifest = WorkspaceBundleManifest.model_validate(
        {
            "apiVersion": "eigent.ai/v1alpha1",
            "kind": "WorkspaceBundle",
            "metadata": {
                "id": "bundle-runtime",
                "name": "Runtime Bundle",
                "revision": 1,
            },
            "spec": {
                "instructions": {
                    "coordinator": "bundle://instructions/coordinator.md"
                },
                "context": [
                    {
                        "id": "domain",
                        "kind": "bundle_asset",
                        "path": "bundle://context/domain.md",
                    },
                    {
                        "id": "guardrail",
                        "kind": "inline",
                        "content": "Never invent a source.",
                    },
                ],
                "skills": [
                    {
                        "ref": "bundle://skills/demo/SKILL.md",
                        "assignTo": list(agent_ids),
                    }
                ],
                "mcpServers": [
                    {
                        "id": "bundle-local",
                        "definition": "bundle://mcp/local.json",
                        "secretSlots": list(mcp_secret_slots),
                        "assignTo": list(agent_ids),
                    }
                ],
                "agents": [
                    {
                        "id": agent_id,
                        "role": "coordinator",
                        "modelProfile": "default",
                    }
                    for agent_id in agent_ids
                ],
                "environment": {
                    "variables": [
                        {
                            "name": "WORKSPACE_TOKEN",
                            "required": True,
                            "sensitive": True,
                        }
                    ]
                },
                "permissions": {
                    "profile": "request_approval",
                    "rules": [
                        {"action": "git.remote_write", "effect": "deny"}
                    ],
                },
                "models": {
                    "default": {
                        "modelRef": "provider://default",
                        "thinkingEffort": "high",
                    }
                },
            },
        }
    )
    assets = [
        {
            "id": f"asset-{index}",
            "logical_path": path,
            "content_digest": hashlib.sha256(content).hexdigest(),
            "media_type": "text/plain",
            "size_bytes": len(content),
            "provenance": "bundle_author",
            "executable": False,
        }
        for index, (path, content) in enumerate(contents.items())
    ]
    mcp_destination = inspect_bundle_mcp_destination(
        revision_id=manifest.revision_id,
        mcp_id="bundle-local",
        definition_ref="bundle://mcp/local.json",
        definition_digest=hashlib.sha256(
            contents["mcp/local.json"]
        ).hexdigest(),
        content=contents["mcp/local.json"],
        secret_slots=mcp_secret_slots,
        executable_assets_by_ref={
            f"bundle://{item['logical_path']}": item for item in assets
        },
    )
    journal.ensure_run(
        run_id="run-runtime",
        project_id="project-runtime",
        status="pending",
    )
    journal.put_workspace_config_revision(
        revision_id=manifest.revision_id,
        bundle_id=manifest.metadata.id,
        revision_number=manifest.metadata.revision,
        manifest=manifest.canonical_payload(),
        status="published",
        created_by="user-1",
    )
    journal.put_workspace_config_materialization(
        materialization_id="materialization-runtime",
        space_id="space-runtime",
        revision_id=manifest.revision_id,
        config_placement="sidecar",
    )
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-runtime",
        request_id="request-runtime",
        space_id="space-runtime",
        bundle_id=manifest.metadata.id,
        revision_id=manifest.revision_id,
        config_placement="sidecar",
        manifest=manifest.canonical_payload(),
        assets=assets,
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": [
                "skill.script.execute:bundle://skills/demo/SKILL.md",
                "mcp.server.start:bundle-local",
            ],
            "environment_requirements": [
                {
                    "requirement_key": "environment:WORKSPACE_TOKEN",
                    "name": "WORKSPACE_TOKEN",
                    "required": True,
                    "sensitive": True,
                }
            ],
            "mcp_secret_requirements": [
                {
                    "requirement_key": (f"mcp_secret:bundle-local:{slot}"),
                    "mcp_id": "bundle-local",
                    "slot_id": slot,
                    "required": True,
                }
                for slot in mcp_secret_slots
            ],
            "mcp_destinations": [mcp_destination],
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
    secret_binding_payloads = []
    if bind_environment:
        secret_binding_payloads.append(
            {
                "requirement_key": "environment:WORKSPACE_TOKEN",
                "requirement_kind": "environment",
                "secret_ref": "wsvault_" + "a" * 32,
                "account_scope_digest": "b" * 64,
            }
        )
    secret_binding_payloads.extend(
        {
            "requirement_key": f"mcp_secret:bundle-local:{slot}",
            "requirement_kind": "mcp_secret",
            "secret_ref": "wsvault_" + "c" * 32,
            "account_scope_digest": "d" * 64,
        }
        for slot in mcp_secret_slots
    )
    if secret_binding_payloads:
        _, proposal = journal.put_workspace_bundle_secret_bindings(
            proposal_id=proposal.proposal_id,
            client_request_id="bind-runtime-secret",
            expected_proposal_version=proposal.version,
            bindings=secret_binding_payloads,
            authorized_by="user-1",
        )
    for action in (
        "skill.script.execute:bundle://skills/demo/SKILL.md",
        "mcp.server.start:bundle-local",
    ):
        required_grants: list[str] = []
        if action == "mcp.server.start:bundle-local" and mcp_secret_slots:
            current_secret_bindings = (
                journal.list_workspace_bundle_secret_bindings(
                    proposal.proposal_id
                )
            )
            required_grants = [
                attestation_grant(mcp_destination["attestation_digest"]),
                secret_binding_grant(
                    secret_binding_attestation(
                        mcp_id="bundle-local",
                        bindings=[
                            {
                                "requirement_key": item.requirement_key,
                                "secret_ref": item.secret_ref,
                                "binding_version": item.binding_version,
                                "account_scope_digest": (
                                    item.account_scope_digest
                                ),
                            }
                            for item in current_secret_bindings
                        ],
                    )
                ),
            ]
        _, proposal = journal.put_workspace_bundle_local_binding(
            proposal_id=proposal.proposal_id,
            expected_proposal_version=proposal.version,
            slot_id=action,
            binding_kind="script_approval",
            connector_id=None,
            opaque_connection_id=None,
            local_path=None,
            required_grants=required_grants,
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

    state_root = tmp_path / "workspace-git"
    configuration_root = (
        state_root / "spaces" / "space-runtime" / "configuration"
    )
    configuration_root.mkdir(parents=True)
    (configuration_root / "workspace.yaml").write_text(
        yaml.safe_dump(
            manifest.canonical_payload(),
            sort_keys=False,
            allow_unicode=True,
        ),
        encoding="utf-8",
    )
    lock = {
        "apiVersion": "eigent.ai/lock/v1alpha1",
        "bundleRevision": manifest.revision_id,
        "manifestDigest": manifest.digest,
        "assets": [
            {
                "ref": f"bundle://{item['logical_path']}",
                "digest": item["content_digest"],
                "provenance": item["provenance"],
                "executable": item["executable"],
            }
            for item in assets
        ],
        "skills": [],
        "mcpPackages": [],
    }
    (configuration_root / "workspace.lock").write_text(
        yaml.safe_dump(lock, sort_keys=False),
        encoding="utf-8",
    )
    for logical_path, content in contents.items():
        target = configuration_root / logical_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    local_bindings = journal.list_workspace_bundle_local_bindings(
        proposal.proposal_id
    )
    secret_bindings = journal.list_workspace_bundle_secret_bindings(
        proposal.proposal_id
    )
    local = LocalMaterialization(
        context_sources=(
            ResolvedContextSource(
                id="workspace_root",
                kind="local_path_slot",
                slot_id="workspace_root",
                absolute_path=str(tmp_path),
            ),
        ),
        bundle_proposal_id=proposal.proposal_id,
        bundle_proposal_version=proposal.version,
        bundle_binding_digest=bundle_runtime_binding_digest(
            proposal,
            local_bindings,
            secret_bindings,
        ),
        configuration_root=str(configuration_root),
    )
    capability = (
        LegacyEnvironmentImporter()
        .build_template(
            model_platform="openai",
            model_type="gpt-5.5-codex",
            auth_source="codex_subscription",
            requested_effort="high",
            allow_local_system=False,
        )
        .provider_capability
    )
    spec = EnvironmentConfigResolver().resolve(
        manifest=manifest,
        owner_type="run",
        owner_id="run-runtime",
        local_materialization=local,
        provider_capability=capability,
        permission_profile_revision_override="preset:request_approval:v1",
        runtime_capability_manifest={
            "workspace_bundle": {
                "revision_id": manifest.revision_id,
                "config_placement": "sidecar",
            }
        },
    )
    return manifest, proposal, spec, state_root, configuration_root


def test_runtime_assembles_pinned_bundle_without_persisting_secret(
    tmp_path,
    monkeypatch,
):
    from app.agent.toolkit.skill_toolkit import SkillToolkit
    from app.agent.toolkit.terminal_toolkit import TerminalToolkit

    secret = "runtime-only-secret"
    broker = _SecretBroker(secret)
    database = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(database) as journal:
        _, _, spec, state_root, root = _installed_spec(tmp_path, journal)
        runtime = RuntimeEnvironmentAssembler(
            journal,
            state_root=state_root,
            secret_broker_factory=lambda: broker,
        ).assemble(
            spec,
            space_id="space-runtime",
            space_root=tmp_path,
        )
        assert runtime is not None
        assert "Prefer the verified dataset" in runtime.prompt_context()
        assert "Domain context from the pinned revision" in (
            runtime.prompt_context()
        )
        assert runtime.permission_profile == "request_approval"
        assert runtime.permission_rules == (("git.remote_write", "deny"),)
        assert set(runtime.pinned_skill_sources()) == {
            str(root / "skills/demo/SKILL.md")
        }
        assert set(runtime.mcp_config_without_secrets()["mcpServers"]) == {
            "bundle-local"
        }
        environment_ref = None
        with runtime.process_environment() as environment:
            environment_ref = environment
            assert environment == {"WORKSPACE_TOKEN": secret}
        assert environment_ref == {}
        assert secret not in repr(runtime)
        monkeypatch.setattr(
            TerminalToolkit,
            "_setup_cloned_environment",
            lambda self: None,
        )
        monkeypatch.setenv("LEGACY_SPACE_API_KEY", "legacy-space-secret")
        monkeypatch.setenv("file_save_path", str(tmp_path / "terminal"))
        terminal = TerminalToolkit(
            "project-runtime",
            "single_agent",
            working_directory=str(tmp_path),
            runtime_env_provider=runtime.process_environment,
        )
        streamed_output: list[str] = []
        monkeypatch.setattr(
            terminal,
            "_update_terminal_output",
            streamed_output.append,
        )
        with pytest.raises(RuntimeError, match="authorized process spawn"):
            terminal._get_env_vars()
        raw_shell_exec = TerminalToolkit.shell_exec.__closure__[
            0
        ].cell_contents
        output = raw_shell_exec(
            terminal,
            'python -c "import os; '
            "print(os.getenv('WORKSPACE_TOKEN')); "
            "print(os.getenv('LEGACY_SPACE_API_KEY', 'missing'))\"",
        )
        assert output == "[REDACTED_WORKSPACE_SECRET]\nmissing\n"
        assert secret not in output
        assert "legacy-space-secret" not in output
        ansi_output = raw_shell_exec(
            terminal,
            "python -c \"import os; value=os.getenv('WORKSPACE_TOKEN'); "
            "print(value[:8]+'\\033[31m'+value[8:])\"",
        )
        assert ansi_output == "[REDACTED_WORKSPACE_SECRET]\n"
        assert secret not in "".join(streamed_output)

        mutation_service = MagicMock()
        with (
            patch(
                "app.agent.toolkit.terminal_toolkit.run_context_for_task",
                return_value=object(),
            ),
            patch(
                "app.agent.toolkit.terminal_toolkit."
                "get_default_workspace_mutation_service",
                return_value=mutation_service,
            ),
        ):
            assert raw_shell_exec(
                terminal,
                "sleep 5",
                block=False,
            ).startswith("Error: Background terminal sessions are unavailable")
        mutation_service.prepare_broad_write.assert_not_called()

        leaked_secret_path = tmp_path / "daemon-secret.txt"
        child_script = tmp_path / "protected-child.py"
        child_script.write_text(
            "import os, pathlib, time\n"
            "time.sleep(0.35)\n"
            f"pathlib.Path({str(leaked_secret_path)!r}).write_text("
            "os.getenv('WORKSPACE_TOKEN', ''), encoding='utf-8')\n",
            encoding="utf-8",
        )
        parent_script = tmp_path / "protected-parent.py"
        parent_script.write_text(
            "import subprocess, sys\n"
            "subprocess.Popen([sys.executable, "
            f"{str(child_script)!r}], stdin=subprocess.DEVNULL, "
            "stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n",
            encoding="utf-8",
        )
        raw_shell_exec(
            terminal,
            "python " + shlex.quote(str(parent_script)),
        )
        time.sleep(0.6)
        assert not leaked_secret_path.exists()

        timeout_started = time.monotonic()
        timeout_output = raw_shell_exec(
            terminal,
            "sleep 5",
            timeout=0.05,
        )
        assert timeout_output.startswith(
            "Error: Protected Bundle command exceeded the timeout"
        )
        assert time.monotonic() - timeout_started < 1.5
        assert not hasattr(terminal, "_runtime_environment_values")
        assert terminal._runtime_env_overlay is None
        assert terminal._active_runtime_secret_values == ()
        for log_path in Path(terminal.log_dir).glob("*.log"):
            assert secret not in log_path.read_text(encoding="utf-8")
            assert "legacy-space-secret" not in log_path.read_text(
                encoding="utf-8"
            )

        (root / "instructions/coordinator.md").write_text(
            "mutated after admission",
            encoding="utf-8",
        )
        (root / "skills/demo/SKILL.md").write_text(
            "mutated after admission",
            encoding="utf-8",
        )
        assert "Prefer the verified dataset" in runtime.prompt_context()
        assert "Always use the pinned procedure" in next(
            iter(runtime.pinned_skill_sources().values())
        )
        skill_toolkit = SkillToolkit(
            "project-runtime",
            "single_agent",
            working_directory=str(tmp_path),
            pinned_skill_sources=runtime.pinned_skill_sources("single_agent"),
        )
        assert "Always use the pinned procedure" in (
            skill_toolkit.load_skill("demo")
        )
        assert "mutated after admission" not in (
            skill_toolkit.load_skill("demo")
        )
        with pytest.raises(
            EnvironmentSetupRequiredError,
            match="bundle_asset_digest_changed",
        ):
            RuntimeEnvironmentAssembler(
                journal,
                state_root=state_root,
                secret_broker_factory=lambda: broker,
            ).assemble(
                spec,
                space_id="space-runtime",
                space_root=tmp_path,
            )

    assert secret.encode() not in database.read_bytes()


def test_runtime_missing_binding_fails_closed(tmp_path):
    broker = _SecretBroker("value")
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _, _, spec, state_root, _ = _installed_spec(
            tmp_path,
            journal,
            bind_environment=False,
        )
        with pytest.raises(EnvironmentSetupRequiredError) as error:
            RuntimeEnvironmentAssembler(
                journal,
                state_root=state_root,
                secret_broker_factory=lambda: broker,
            ).assemble(
                spec,
                space_id="space-runtime",
                space_root=tmp_path,
            )
        assert "secret_binding_missing:environment:WORKSPACE_TOKEN" in (
            error.value.issues
        )
        assert broker.calls == 0


def test_multi_agent_bundle_fails_before_runtime_dispatch(tmp_path):
    broker = _SecretBroker("must-not-be-resolved")
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _, _, spec, state_root, _ = _installed_spec(
            tmp_path,
            journal,
            agent_ids=("coordinator", "researcher"),
        )
        with pytest.raises(EnvironmentSetupRequiredError) as error:
            RuntimeEnvironmentAssembler(
                journal,
                state_root=state_root,
                secret_broker_factory=lambda: broker,
            ).assemble(
                spec,
                space_id="space-runtime",
                space_root=tmp_path,
            )
        assert error.value.issues == (
            "multi_agent_runtime_adapter_unavailable",
        )
        assert broker.calls == 0


def test_single_portable_agent_id_maps_to_desktop_single_agent(tmp_path):
    broker = _SecretBroker("runtime-secret")
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _, _, spec, state_root, root = _installed_spec(
            tmp_path,
            journal,
            agent_ids=("coordinator",),
        )
        runtime = RuntimeEnvironmentAssembler(
            journal,
            state_root=state_root,
            secret_broker_factory=lambda: broker,
        ).assemble(
            spec,
            space_id="space-runtime",
            space_root=tmp_path,
        )

        assert runtime is not None
        assert runtime.agent_aliases == ("coordinator",)
        assert set(runtime.pinned_skill_sources("single_agent")) == {
            str(root / "skills/demo/SKILL.md")
        }


def test_runtime_rejects_secret_value_over_64_kib_at_process_spawn(tmp_path):
    broker = _SecretBroker("s" * (64 * 1024 + 1))
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _, _, spec, state_root, _ = _installed_spec(tmp_path, journal)
        runtime = RuntimeEnvironmentAssembler(
            journal,
            state_root=state_root,
            secret_broker_factory=lambda: broker,
        ).assemble(
            spec,
            space_id="space-runtime",
            space_root=tmp_path,
        )
        assert runtime is not None
        with pytest.raises(EnvironmentSetupRequiredError) as error:
            with runtime.process_environment():
                pass
        assert error.value.issues == ("workspace_secret_value_invalid",)


def test_secret_bearing_mcp_requires_destination_confirmation(tmp_path):
    broker = _SecretBroker("must-not-be-resolved")
    runtime = ResolvedRuntimeEnvironment(
        environment_spec_id="envspec-secret-mcp",
        bundle_revision_id="bundle@1",
        proposal_id="proposal-1",
        configuration_root=str(tmp_path),
        instructions=(),
        context=(),
        skills=(),
        connectors=(),
        agent_aliases=(),
        permission_profile="request_approval",
        permission_rules=(),
        _mcp_servers={
            "private": {
                "command": "python",
                "env": {"TOKEN": "slot://mcp_secret:private:token"},
            }
        },
        _secret_identities=(
            WorkspaceSecretIdentity(
                secret_ref="wsvault_" + "a" * 32,
                account_scope_digest="b" * 64,
                space_id="space-1",
                revision_id="bundle@1",
                slot_id="mcp_secret:private:token",
            ),
        ),
        _environment_bindings=(),
        _secret_broker_factory=lambda: broker,
    )

    with pytest.raises(EnvironmentSetupRequiredError) as error:
        runtime.mcp_config_without_secrets()
    assert error.value.issues == ("mcp_destination_confirmation_required",)
    assert broker.calls == 0


def test_secret_bearing_mcp_fails_during_assembly_without_resolving_secret(
    tmp_path,
):
    broker = _SecretBroker("must-not-be-resolved")
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _, _, spec, state_root, _ = _installed_spec(
            tmp_path,
            journal,
            mcp_secret_slots=("API_TOKEN",),
        )

        with pytest.raises(EnvironmentSetupRequiredError) as error:
            RuntimeEnvironmentAssembler(
                journal,
                state_root=state_root,
                secret_broker_factory=lambda: broker,
            ).assemble(
                spec,
                space_id="space-runtime",
                space_root=tmp_path,
            )

        assert error.value.issues == (
            "mcp_secret_stdio_runtime_adapter_unavailable:bundle-local",
        )
        assert broker.calls == 0


def test_rotated_mcp_secret_makes_destination_approval_stale_before_broker(
    tmp_path,
):
    broker = _SecretBroker("must-not-be-resolved")
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _, proposal, spec, state_root, _ = _installed_spec(
            tmp_path,
            journal,
            mcp_secret_slots=("API_TOKEN",),
        )
        existing = next(
            item
            for item in journal.list_workspace_bundle_secret_bindings(
                proposal.proposal_id
            )
            if item.requirement_key == "mcp_secret:bundle-local:API_TOKEN"
        )
        _, proposal = journal.put_workspace_bundle_secret_bindings(
            proposal_id=proposal.proposal_id,
            client_request_id="rotate-runtime-secret",
            expected_proposal_version=proposal.version,
            bindings=[
                {
                    "requirement_key": existing.requirement_key,
                    "requirement_kind": "mcp_secret",
                    "secret_ref": "wsvault_" + "e" * 32,
                    "account_scope_digest": "f" * 64,
                    "expected_binding_version": existing.binding_version,
                }
            ],
            authorized_by="user-1",
        )
        local_bindings = journal.list_workspace_bundle_local_bindings(
            proposal.proposal_id
        )
        secret_bindings = journal.list_workspace_bundle_secret_bindings(
            proposal.proposal_id
        )
        local = spec.local_materialization.model_copy(
            update={
                "bundle_proposal_version": proposal.version,
                "bundle_binding_digest": bundle_runtime_binding_digest(
                    proposal,
                    local_bindings,
                    secret_bindings,
                ),
            }
        )
        refreshed_spec = spec.model_copy(
            update={"local_materialization": local}
        )

        with pytest.raises(EnvironmentSetupRequiredError) as error:
            RuntimeEnvironmentAssembler(
                journal,
                state_root=state_root,
                secret_broker_factory=lambda: broker,
            ).assemble(
                refreshed_spec,
                space_id="space-runtime",
                space_root=tmp_path,
            )

        assert error.value.issues == (
            "mcp_destination_confirmation_stale:bundle-local",
        )
        assert broker.calls == 0


def test_mcp_definition_drift_blocks_before_secret_broker(tmp_path):
    broker = _SecretBroker("must-not-be-resolved")
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _, _, spec, state_root, configuration_root = _installed_spec(
            tmp_path,
            journal,
            mcp_secret_slots=("API_TOKEN",),
        )
        (configuration_root / "mcp/local.json").write_text(
            '{"mcpServers":{"bundle-local":{"command":"other"}}}',
            encoding="utf-8",
        )

        with pytest.raises(EnvironmentSetupRequiredError) as error:
            RuntimeEnvironmentAssembler(
                journal,
                state_root=state_root,
                secret_broker_factory=lambda: broker,
            ).assemble(
                spec,
                space_id="space-runtime",
                space_root=tmp_path,
            )

        assert error.value.issues == (
            "mcp_destination_confirmation_stale:bundle-local",
        )
        assert broker.calls == 0


def test_bundle_permission_narrows_space_profile_and_rules_are_evaluated(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _, _, pinned_spec, _, _ = _installed_spec(tmp_path, journal)
        journal.put_space_permission_profile(
            space_id="space-runtime",
            profile_name="full_access",
            sandbox_mode="danger-full-access",
            approval_mode="never",
            reviewer_mode="none",
            updated_by="user-1",
        )
        journal.ensure_run(
            run_id="run-admission",
            project_id="project-runtime",
            status="pending",
        )
        template = LegacyEnvironmentImporter().build_template(
            model_platform="openai",
            model_type="gpt-5.5-codex",
            auth_source="codex_subscription",
            requested_effort="high",
            allow_local_system=True,
        )
        admitted = EnvironmentAdmissionService(journal).persist_for_run(
            run_id="run-admission",
            space_id="space-runtime",
            working_directory=tmp_path,
            space_root=tmp_path,
            created_by="user-1",
            template=template,
        )
        assert admitted.binding.permission_profile_revision == (
            "preset:request_approval:v1"
        )

        journal.put_effective_environment_spec(
            pinned_spec,
            emit_run_event=True,
        )
        attempt = journal.create_run_attempt(
            "run-runtime",
            request_id="permission-attempt",
            reason="initial_execution",
            environment=AttemptEnvironmentBinding(
                environment_spec_id=pinned_spec.spec_id,
                environment_spec_digest=pinned_spec.digest,
                bundle_revision_id=pinned_spec.bundle_revision_id,
                permission_profile_revision=(
                    pinned_spec.permission_profile_revision
                ),
                thinking_effort_requested=(
                    pinned_spec.thinking_effort_requested.value
                ),
                thinking_effort_effective=(
                    pinned_spec.thinking_effort_effective.value
                ),
                provider_capability_revision=(
                    pinned_spec.provider_capability_revision
                ),
            ),
        )
        decision = PermissionPolicyService(journal).evaluate(
            ActionDescriptor(
                action_id="action-1",
                tool_name="git_push",
                operation="git.remote_write",
                safety_class=ToolSafetyClass.UNSAFE_WRITE,
                normalized_arguments={},
                target_resources=("origin/main",),
                external_side_effect=True,
                run_id="run-runtime",
                attempt_id=attempt.attempt_id,
                environment_spec_digest=pinned_spec.digest,
            ),
            space_id="space-runtime",
            permission_profile_revision=(
                pinned_spec.permission_profile_revision
            ),
        )
        assert decision.effect.value == "deny"
        assert decision.matched_rule_id is not None
        assert decision.matched_rule_id.startswith("bundle:")


def test_resume_revalidates_persisted_environment_binding(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _, _, spec, _, _ = _installed_spec(tmp_path, journal)
        journal.put_effective_environment_spec(spec)
        attempt = journal.create_run_attempt(
            "run-runtime",
            request_id="attempt-with-environment",
            reason="initial_execution",
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
        assert _load_attempt_environment_spec(journal, attempt) == spec

        with journal._write_transaction() as connection:
            connection.execute(
                """
                UPDATE effective_environment_specs
                SET environment_spec_digest = ?
                WHERE environment_spec_id = ?
                """,
                ("0" * 64, spec.spec_id),
            )

        with pytest.raises(UserException, match="binding is inconsistent"):
            _load_attempt_environment_spec(journal, attempt)
