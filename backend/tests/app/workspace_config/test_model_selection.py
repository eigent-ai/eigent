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

import json
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import yaml
from fastapi import HTTPException

from app.controller import chat_controller
from app.model.chat import Chat
from app.run_journal import SQLiteRunJournal
from app.workspace_bundle.runtime import (
    EnvironmentSetupRequiredError,
    RuntimeEnvironmentAssembler,
)
from app.workspace_config import WorkspaceBundleManifest
from app.workspace_config.admission import EnvironmentAdmissionService
from app.workspace_config.model_selection import installed_model_selection
from app.workspace_config.models import WorkspaceModelSelectionChangedError


@pytest.fixture(autouse=True)
def isolate_legacy_skill_configuration(monkeypatch):
    monkeypatch.setattr(Chat, "skill_config_user_id", lambda _: None)


def _install(
    journal,
    *,
    agents=(),
    ref="provider://cloud/gpt-5.5",
    number=1,
    state="materialized",
):
    manifest = WorkspaceBundleManifest.model_validate(
        {
            "apiVersion": "eigent.ai/v1alpha1",
            "kind": "WorkspaceBundle",
            "metadata": {
                "id": "model-fixture",
                "name": "Models",
                "revision": number,
            },
            "spec": {
                "agents": list(agents),
                "models": {
                    "default": {"modelRef": ref, "thinkingEffort": "medium"},
                    "worker": {
                        "modelRef": "provider://custom/azure/gpt-5.5",
                        "thinkingEffort": "high",
                    },
                },
                "git": {"enabled": False},
            },
        }
    )
    journal.put_workspace_config_revision(
        revision_id=manifest.revision_id,
        bundle_id=manifest.metadata.id,
        revision_number=number,
        manifest=manifest.canonical_payload(),
        status="published",
        created_by="fixture",
    )
    journal.put_workspace_config_materialization(
        materialization_id=f"installed-{number}",
        space_id="space-1",
        revision_id=manifest.revision_id,
        config_placement="sidecar",
        state=state,
    )
    if state != "materialized":
        return manifest
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id=f"proposal-{number}",
        request_id=f"install-{number}",
        space_id="space-1",
        bundle_id=manifest.metadata.id,
        revision_id=manifest.revision_id,
        config_placement="sidecar",
        manifest=manifest.canonical_payload(),
        assets=[],
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": [],
        },
    )
    for status in ("approved", "materializing", "materialized"):
        proposal = journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state=status,
            decided_by="fixture",
        )
    return manifest


def _write_configuration(tmp_path, manifest):
    configuration = (
        tmp_path / "workspace-git" / "spaces" / "space-1" / "configuration"
    )
    configuration.mkdir(parents=True, exist_ok=True)
    (configuration / "workspace.yaml").write_text(
        yaml.safe_dump(manifest.canonical_payload())
    )
    (configuration / "workspace.lock").write_text(
        yaml.safe_dump(
            {
                "apiVersion": "eigent.ai/lock/v1alpha1",
                "bundleRevision": manifest.revision_id,
                "manifestDigest": manifest.digest,
            }
        )
    )


def _mock_factory(monkeypatch, lock):
    module = sys.modules["app.agent.agent_model"]
    factory = MagicMock()
    monkeypatch.setattr(module, "ModelFactory", factory)
    monkeypatch.setattr(module, "ListenChatAgent", MagicMock())
    monkeypatch.setattr(module, "get_task_lock", lambda _: lock)
    monkeypatch.setattr(
        module, "instrument_model_backend", lambda backend, **_: backend
    )
    monkeypatch.setattr(module, "configure_responses_input", lambda _: None)
    monkeypatch.setattr(module, "_schedule_async_task", MagicMock())
    return module, factory


@pytest.mark.asyncio
@pytest.mark.parametrize("initial_lookup", ["absent", "manual_or_legacy"])
@pytest.mark.parametrize("materialization_race", [False, True])
async def test_initial_absence_is_checked_before_runtime_and_model_factory(
    tmp_path,
    monkeypatch,
    sample_chat_data,
    initial_lookup,
    materialization_race,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        monkeypatch.setattr(
            "app.run_journal.configured_run_journal_path", lambda: journal.path
        )
        assert installed_model_selection(journal, "space-1") is None
        payload = {
            **sample_chat_data,
            "task_id": "run-1",
            "project_id": "project-1",
            "model_platform": "azure",
            "model_type": "gpt-5.5",
            "api_key": "synthetic-global-key",
            "api_url": "https://global.example.test/v1",
            "thinking_effort": "medium",
            "session_mode": "single-agent",
        }
        if initial_lookup == "absent":
            payload["workspace_model_selection"] = None
        # Exercise the JSON distinction that the frontend sends on the wire.
        options = Chat.model_validate_json(json.dumps(payload))
        template = chat_controller._legacy_environment_template(options)
        assert template.workspace_model_selection is None
        assert template.workspace_model_selection_checked == (
            initial_lookup == "absent"
        )
        if materialization_race:
            manifest = _install(
                journal,
                ref="provider://custom/anthropic/claude-sonnet-4-5",
            )
            _write_configuration(tmp_path, manifest)
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        lock = SimpleNamespace(put_queue=MagicMock())
        module, factory = _mock_factory(monkeypatch, lock)
        assembled = []
        admitted = []

        async def start(data, _request):
            environment = EnvironmentAdmissionService(journal).persist_for_run(
                run_id="run-1",
                space_id="space-1",
                working_directory=tmp_path,
                created_by="fixture",
                template=chat_controller._legacy_environment_template(data),
            )
            runtime = RuntimeEnvironmentAssembler(
                journal, state_root=tmp_path / "workspace-git"
            ).assemble(
                environment.spec, space_id="space-1", space_root=tmp_path
            )
            assembled.append(runtime)
            chat_controller._require_supported_bundle_session_mode(
                data.session_mode, runtime
            )
            chat_controller._apply_environment_to_task_lock(
                lock,
                environment.spec,
                template=template,
                runtime_environment=runtime,
            )
            module.agent_model("single_agent", "fixture", data, [])
            admitted.append(environment)
            return iter(())

        monkeypatch.setattr(chat_controller, "start_chat_stream", start)
        if initial_lookup == "absent" and materialization_race:
            with pytest.raises(HTTPException) as caught:
                await chat_controller.post(options, MagicMock())
            assert caught.value.status_code == 409
            assert (
                caught.value.detail["code"]
                == "workspace_model_selection_changed"
            )
            assert assembled == []
            assert admitted == []
            factory.create.assert_not_called()
            assert not journal.list_run_attempts("run-1")
            assert not journal.list_model_invocations("run-1")
            assert not journal.list_events("run-1")
            return

        response = await chat_controller.post(options, MagicMock())
        assert response.status_code == 200
        assert len(admitted) == 1
        environment = admitted[0]
        assert len(assembled) == 1
        assert (assembled[0] is not None) == materialization_race
        factory.create.assert_called_once()
        request = factory.create.call_args.kwargs
        assert request["model_platform"] == "azure"
        assert request["model_type"] == "gpt-5.5"
        assert request["api_key"] == "synthetic-global-key"
        assert request["url"] == "https://global.example.test/v1"
        assert not environment.template.workspace_model_selection_checked
        assert not (
            lock.environment_admission_template.workspace_model_selection_checked
        )
        assert "workspace_model_selection_checked" not in json.dumps(
            environment.spec.semantic_spec
        )
        assert "synthetic-global-key" not in json.dumps(
            environment.spec.semantic_spec
        )

        if initial_lookup == "absent":
            # Accepted Session continuations keep their binding after setup.
            manifest = _install(
                journal,
                ref="provider://custom/anthropic/claude-sonnet-4-5",
            )
            _write_configuration(tmp_path, manifest)
            journal.ensure_run(
                run_id="run-2", project_id="project-1", status="pending"
            )
            continuation = EnvironmentAdmissionService(
                journal
            ).persist_for_run(
                run_id="run-2",
                space_id="space-1",
                working_directory=tmp_path,
                created_by="fixture",
                template=lock.environment_admission_template,
            )
            runtime = RuntimeEnvironmentAssembler(
                journal, state_root=tmp_path / "workspace-git"
            ).assemble(
                continuation.spec, space_id="space-1", space_root=tmp_path
            )
            assert runtime is not None
            facts = continuation.spec.semantic_spec[
                "runtime_capability_manifest"
            ]
            assert facts["model"]["type"] == "gpt-5.5"


@pytest.mark.parametrize("profile", ["default", "worker"])
def test_materialized_model_policy_ignores_mutable_drafts_and_uses_single_agent_profile(
    tmp_path, profile
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        assert installed_model_selection(journal, "space-1") is None
        manifest = _install(
            journal,
            agents=(
                {"id": "lead", "role": "coordinator", "modelProfile": profile},
            ),
        )
        draft = manifest.canonical_payload()
        draft["spec"]["models"][profile]["modelRef"] = (
            "provider://cloud/not-published"
        )
        journal.put_workspace_config_draft(
            space_id="space-1",
            expected_version=0,
            document=draft,
            updated_by="fixture",
        )
        before = journal._connection.total_changes
        selected = installed_model_selection(journal, "space-1")
        assert selected.model_profile == profile
        assert selected.model_ref == manifest.spec.models[profile].model_ref
        assert selected.revision_id == manifest.revision_id
        assert journal._connection.total_changes == before
        assert installed_model_selection(journal, "another-space") is None


def test_incomplete_setup_and_multi_agent_adapter_remain_blocked(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _install(journal, state="pending")
        assert installed_model_selection(journal, "space-1") is None
        _install(
            journal,
            number=2,
            agents=(
                {"id": name, "role": "worker", "modelProfile": "worker"}
                for name in ("a", "b")
            ),
        )
        with pytest.raises(EnvironmentSetupRequiredError) as caught:
            installed_model_selection(journal, "space-1")
        assert caught.value.issues == (
            "multi_agent_runtime_adapter_unavailable",
        )


@pytest.mark.asyncio
async def test_stale_selection_returns_409_before_environment_attempt_or_model(
    tmp_path, monkeypatch, sample_chat_data
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _install(journal)
        old = installed_model_selection(journal, "space-1")
        _install(journal, number=2, ref="provider://custom/azure/gpt-6-astra")
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        options = Chat(
            **{
                **sample_chat_data,
                "model_platform": "azure",
                "model_type": "gpt-5.5",
                "thinking_effort": "medium",
                "workspace_model_selection": old,
            }
        )

        async def start(data, _request):
            return EnvironmentAdmissionService(journal).persist_for_run(
                run_id="run-1",
                space_id="space-1",
                working_directory=tmp_path,
                created_by="fixture",
                template=chat_controller._legacy_environment_template(data),
            )

        monkeypatch.setattr(chat_controller, "start_chat_stream", start)
        with pytest.raises(HTTPException) as caught:
            await chat_controller.post(options, MagicMock())
        assert caught.value.status_code == 409
        assert (
            caught.value.detail["code"] == "workspace_model_selection_changed"
        )
        assert not journal.list_run_attempts("run-1")
        assert not journal.list_model_invocations("run-1")
        assert not any(
            e.event_type == "run.environment_resolved"
            for e in journal.list_events("run-1")
        )


@pytest.mark.parametrize(
    "category,platform,model,profile",
    [
        ("cloud", "azure", "gpt-5.5", "default"),
        ("custom", "openai", "gpt-5.5", "default"),
        ("local", "ollama", "local-fixture", "default"),
        ("custom", "azure", "gpt-5.5", "worker"),
    ],
)
def test_selected_complete_binding_reaches_factory_and_retains_resume_facts(
    tmp_path, monkeypatch, sample_chat_data, category, platform, model, profile
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        ref = (
            f"provider://cloud/{model}"
            if category == "cloud"
            else f"provider://{category}/{platform}/{model}"
        )
        _install(
            journal,
            ref=ref,
            agents=(
                {"id": "lead", "role": "coordinator", "modelProfile": profile},
            )
            if profile == "worker"
            else (),
        )
        selection = installed_model_selection(journal, "space-1")
        effort = selection.thinking_effort.value
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        metadata = {
            "schema_version": 1,
            "revision": "fixture-v1",
            "model_platform": platform,
            "model_type": model,
            "supported_efforts": [effort],
            "default_effort": effort,
            "provider_mapping": {effort: effort},
            "transport_parameters": {
                "chat_completions": "reasoning_effort",
                "responses": "reasoning.effort",
            },
            "default_transport": "chat_completions",
            "tools_transport": "chat_completions",
        }
        options = Chat(
            **{
                **sample_chat_data,
                "model_platform": platform,
                "model_type": model,
                "api_key": f"synthetic-{category}-key",
                "api_url": f"https://{category}.example.test/v1",
                "model_config_dict": {"temperature": 0.3},
                "extra_params": {
                    "timeout": 75,
                    "api_mode": "chat_completions",
                    "model_capability": metadata,
                },
                "thinking_effort": effort,
                "workspace_model_selection": selection,
            }
        )
        template = chat_controller._legacy_environment_template(options)
        service = EnvironmentAdmissionService(journal)
        environment = service.persist_for_run(
            run_id="run-1",
            space_id="space-1",
            working_directory=tmp_path,
            created_by="fixture",
            template=template,
        )
        assert environment.template.workspace_model_selection is None
        assert environment.spec.thinking_effort_requested.value == effort
        facts = environment.spec.semantic_spec["runtime_capability_manifest"]
        assert facts["model"]["platform"] == platform
        assert facts["model"]["type"] == model
        assert facts["space_model_selection"]["model_ref"] == ref
        assert facts["space_model_selection"]["model_profile"] == profile
        assert "materialization_id" not in facts["space_model_selection"]
        assert "synthetic-" not in json.dumps(environment.spec.semantic_spec)
        lock = SimpleNamespace(
            put_queue=MagicMock(), resolved_runtime_environment=None
        )
        chat_controller._apply_environment_to_task_lock(
            lock, environment.spec, template=template
        )
        assert (
            lock.environment_admission_template.workspace_model_selection
            is None
        )
        module = sys.modules["app.agent.agent_model"]
        factory = MagicMock()
        monkeypatch.setattr(module, "ModelFactory", factory)
        monkeypatch.setattr(module, "ListenChatAgent", MagicMock())
        monkeypatch.setattr(module, "get_task_lock", lambda _: lock)
        monkeypatch.setattr(
            module, "instrument_model_backend", lambda backend, **_: backend
        )
        monkeypatch.setattr(
            module, "configure_responses_input", lambda _: None
        )
        monkeypatch.setattr(module, "_schedule_async_task", MagicMock())
        module.agent_model("single_agent", "fixture", options, [])
        request = factory.create.call_args.kwargs
        assert request["model_type"] == model
        assert request["api_key"] == f"synthetic-{category}-key"
        assert request["url"] == f"https://{category}.example.test/v1"
        assert request["timeout"] == 75
        assert request["model_config_dict"]["temperature"] == 0.3
        _install(journal, number=2, ref="provider://cloud/new-default")
        # Existing Session continuation uses its captured model capability, not the new Space ref.
        journal.ensure_run(
            run_id="run-2", project_id="project-1", status="pending"
        )
        followup = service.persist_for_run(
            run_id="run-2",
            space_id="space-1",
            working_directory=tmp_path,
            created_by="fixture",
            template=lock.environment_admission_template,
        )
        assert (
            followup.spec.semantic_spec["runtime_capability_manifest"]["model"]
            == facts["model"]
        )
        resumed = options.model_copy(
            update={"workspace_model_selection": None}
        )
        chat_controller._validate_resume_model_capability(
            resumed, environment.spec
        )
        with pytest.raises(
            Exception, match="original model|capability changed|scope_mismatch"
        ):
            chat_controller._validate_resume_model_capability(
                resumed.model_copy(update={"model_type": "different"}),
                environment.spec,
            )


def test_unregistered_local_effort_is_not_reported_as_supported(
    tmp_path, sample_chat_data
):
    from app.workspace_config.models import UnsupportedThinkingEffortError

    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _install(journal, ref="provider://local/ollama/unregistered")
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        options = Chat(
            **{
                **sample_chat_data,
                "model_platform": "ollama",
                "model_type": "unregistered",
                "thinking_effort": "medium",
                "workspace_model_selection": installed_model_selection(
                    journal, "space-1"
                ),
            }
        )
        with pytest.raises(
            UnsupportedThinkingEffortError, match="unknown_model"
        ):
            EnvironmentAdmissionService(journal).persist_for_run(
                run_id="run-1",
                space_id="space-1",
                working_directory=tmp_path,
                created_by="fixture",
                template=chat_controller._legacy_environment_template(options),
            )
        assert not journal.list_model_invocations("run-1")


def test_selection_check_cannot_mix_two_installed_generations(
    tmp_path, monkeypatch, sample_chat_data
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _install(journal)
        old = journal.get_latest_workspace_config_materialization("space-1")
        _install(journal, number=2)
        latest = journal.get_latest_workspace_config_materialization("space-1")
        selected = installed_model_selection(journal, "space-1")
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        options = Chat(
            **{
                **sample_chat_data,
                "model_platform": "azure",
                "model_type": "gpt-5.5",
                "workspace_model_selection": selected,
            }
        )
        reads = iter([old, latest, latest])
        monkeypatch.setattr(
            journal,
            "get_latest_workspace_config_materialization",
            lambda _: next(reads),
        )
        with pytest.raises(WorkspaceModelSelectionChangedError):
            EnvironmentAdmissionService(journal).persist_for_run(
                run_id="run-1",
                space_id="space-1",
                working_directory=tmp_path,
                created_by="fixture",
                template=chat_controller._legacy_environment_template(options),
            )
        assert not journal.list_run_attempts("run-1")
