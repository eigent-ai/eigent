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

"""The chat boundary returns actionable effort errors before any invocation."""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.controller import chat_controller
from app.model.chat import Chat
from app.run_journal import SQLiteRunJournal
from app.workspace_config import WorkspaceBundleManifest
from app.workspace_config.admission import EnvironmentAdmissionService


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "model,effort",
    [
        ("gpt-6-sol", "xhigh"),
        ("gpt-6-sol", "max"),
    ],
)
async def test_unsupported_effort_returns_422_without_attempt_or_invocation(
    tmp_path, monkeypatch, sample_chat_data, model, effort
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )

        async def admit(data, request):
            return EnvironmentAdmissionService(journal).persist_for_run(
                run_id="run-1",
                space_id="space-1",
                working_directory=tmp_path,
                created_by="fixture",
                template=chat_controller._legacy_environment_template(data),
            )

        monkeypatch.setattr(chat_controller, "start_chat_stream", admit)
        options = Chat(
            **{
                **sample_chat_data,
                "model_type": model,
                "model_platform": "azure",
                "thinking_effort": effort,
            }
        )
        with pytest.raises(HTTPException) as error:
            await chat_controller.post(options, MagicMock())
        assert error.value.status_code == 422
        assert error.value.detail["code"] == "unsupported_thinking_effort"
        assert "supported: low, medium, high" in error.value.detail["message"]
        assert not journal.list_model_invocations("run-1")
        assert not journal.list_run_attempts("run-1")
        assert all(
            event.event_type != "run.environment_resolved"
            for event in journal.list_events("run-1")
        )


@pytest.mark.asyncio
async def test_bad_metadata_returns_422_without_echoing_provider_secrets(
    tmp_path, monkeypatch, sample_chat_data
):
    async def admit(data, request):
        chat_controller._legacy_environment_template(data)

    monkeypatch.setattr(chat_controller, "start_chat_stream", admit)
    options = Chat(
        **{
            **sample_chat_data,
            "model_type": "gpt-6-astra",
            "model_platform": "azure",
            "extra_params": {
                "model_capability": {"api_key": "fixture-secret"}
            },
        }
    )
    with pytest.raises(HTTPException) as error:
        await chat_controller.post(options, MagicMock())
    assert error.value.status_code == 422
    assert error.value.detail["code"] == "invalid_model_capability"
    assert error.value.detail["message"] == "invalid_model_capability_override"
    assert "fixture-secret" not in str(error.value.detail)


# Bring-your-own-key models without registered effort capabilities.
_UNREGISTERED_MODELS = [
    ("anthropic", "claude-sonnet-4-5"),
    ("gemini", "gemini-2.5-pro"),
    ("deepseek", "deepseek-chat"),
    ("openai-compatible-model", "grok-4"),
    ("ollama", "qwen3:8b"),
    ("azure", "unknown-deployment"),
]


async def _admit_chat(journal, tmp_path, monkeypatch, options):
    admitted = []

    async def admit(data, request):
        admitted.append(
            EnvironmentAdmissionService(journal).persist_for_run(
                run_id="run-1",
                space_id="space-1",
                working_directory=tmp_path,
                created_by="fixture",
                template=chat_controller._legacy_environment_template(data),
            )
        )

    monkeypatch.setattr(chat_controller, "start_chat_stream", admit)
    await chat_controller.post(options, MagicMock())
    [result] = admitted
    return result


def _assert_admitted_at_provider_default(journal, result, requested):
    spec = result.spec
    assert spec.provider_value == "provider_default"
    assert spec.provider_parameter_name is None
    # The request is recorded although no effort is sent.
    assert spec.thinking_effort_requested.value == requested
    assert spec.thinking_effort_effective.value == "medium"
    assert result.binding.thinking_effort_requested == requested
    capability = spec.semantic_spec["runtime_capability_manifest"][
        "model_capability"
    ]
    assert capability["status"] == "unknown_model"
    assert capability["supported_efforts"] == []
    assert any(
        event.event_type == "run.environment_resolved"
        for event in journal.list_events("run-1")
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("effort", ["low", "medium", "high", "xhigh", "max"])
@pytest.mark.parametrize("platform,model", _UNREGISTERED_MODELS)
@pytest.mark.parametrize("cloud", [False, True])
async def test_unknown_model_runs_at_provider_default_with_explicit_effort(
    tmp_path, monkeypatch, sample_chat_data, platform, model, effort, cloud
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        options = Chat(
            **{
                **sample_chat_data,
                "model_type": model,
                "model_platform": platform,
                "api_url": "https://proxy.eigent.ai"
                if cloud
                else "https://api.example.invalid/v1",
                "thinking_effort": effort,
            }
        )
        result = await _admit_chat(journal, tmp_path, monkeypatch, options)
        _assert_admitted_at_provider_default(journal, result, effort)


def _install_bundle(journal, effort):
    """Materialize a Bundle whose default model profile pins ``effort``."""
    manifest = WorkspaceBundleManifest.model_validate(
        {
            "apiVersion": "eigent.ai/v1alpha1",
            "kind": "WorkspaceBundle",
            "metadata": {
                "id": "bundle-fixture",
                "name": "Fixture",
                "revision": 1,
            },
            "spec": {
                "models": {
                    "default": {
                        "modelRef": "provider://default",
                        "thinkingEffort": effort,
                    }
                }
            },
        }
    ).canonical_payload()
    revision = journal.put_workspace_config_revision(
        revision_id="bundle-fixture@1",
        bundle_id="bundle-fixture",
        revision_number=1,
        manifest=manifest,
        status="published",
        created_by="fixture",
    )
    journal.put_workspace_config_materialization(
        materialization_id="materialization-fixture",
        space_id="space-1",
        revision_id=revision.revision_id,
        config_placement="sidecar",
    )
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-fixture",
        request_id="install-fixture",
        space_id="space-1",
        bundle_id="bundle-fixture",
        revision_id=revision.revision_id,
        config_placement="sidecar",
        manifest=manifest,
        assets=[],
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": [],
        },
    )
    for state in ("approved", "materializing", "materialized"):
        proposal = journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state=state,
            decided_by="fixture",
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("composer", [None, "high"])
@pytest.mark.parametrize("effort", ["low", "medium", "high", "xhigh", "max"])
@pytest.mark.parametrize("platform,model", _UNREGISTERED_MODELS)
async def test_unknown_model_runs_in_a_bundle_space_at_provider_default(
    tmp_path, monkeypatch, sample_chat_data, platform, model, effort, composer
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _install_bundle(journal, effort)
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        options = Chat(
            **{
                **sample_chat_data,
                "model_type": model,
                "model_platform": platform,
                "api_url": "https://api.example.invalid/v1",
                # None is the composer's Default: the Bundle profile applies.
                "thinking_effort": composer,
            }
        )
        result = await _admit_chat(journal, tmp_path, monkeypatch, options)
        _assert_admitted_at_provider_default(
            journal, result, composer or effort
        )
        assert result.spec.bundle_revision_id == "bundle-fixture@1"
        assert not journal.list_model_invocations("run-1")


@pytest.mark.asyncio
@pytest.mark.parametrize("platform", ["azure", "openai"])
@pytest.mark.parametrize("effort", ["low", "medium", "high", "xhigh", "max"])
async def test_sol_runs_in_a_bundle_space_within_its_efforts(
    tmp_path, monkeypatch, sample_chat_data, platform, effort
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _install_bundle(journal, effort)
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        admitted = []

        async def admit(data, request):
            admitted.append(
                EnvironmentAdmissionService(journal).persist_for_run(
                    run_id="run-1",
                    space_id="space-1",
                    working_directory=tmp_path,
                    created_by="fixture",
                    template=chat_controller._legacy_environment_template(
                        data
                    ),
                )
            )

        monkeypatch.setattr(chat_controller, "start_chat_stream", admit)
        options = Chat(
            **{
                **sample_chat_data,
                "model_type": "gpt-6-sol",
                "model_platform": platform,
                "thinking_effort": None,
            }
        )
        if effort in {"xhigh", "max"}:
            with pytest.raises(HTTPException) as error:
                await chat_controller.post(options, MagicMock())
            assert error.value.status_code == 422
            assert error.value.detail["code"] == "unsupported_thinking_effort"
            assert "low, medium, high" in error.value.detail["message"]
            assert not admitted
            return
        await chat_controller.post(options, MagicMock())
        [result] = admitted
        assert result.spec.thinking_effort_effective.value == effort
        assert result.spec.provider_value == effort


@pytest.mark.asyncio
@pytest.mark.parametrize("platform", ["azure", "openai"])
@pytest.mark.parametrize("effort", ["xhigh", "max"])
async def test_dynamic_openai_reasoning_model_runs_a_higher_effort_at_high(
    tmp_path, monkeypatch, sample_chat_data, platform, effort
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        options = Chat(
            **{
                **sample_chat_data,
                "model_type": "gpt-5.5",
                "model_platform": platform,
                "thinking_effort": effort,
            }
        )
        result = await _admit_chat(journal, tmp_path, monkeypatch, options)
        assert result.spec.thinking_effort_requested.value == effort
        assert result.spec.thinking_effort_effective.value == "high"
        assert result.spec.provider_parameter_name == "reasoning_effort"
        assert result.spec.provider_value == "high"


@pytest.mark.asyncio
@pytest.mark.parametrize("effort", ["xhigh", "max"])
async def test_dynamic_openai_reasoning_model_runs_in_a_bundle_space_at_high(
    tmp_path, monkeypatch, sample_chat_data, effort
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _install_bundle(journal, effort)
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        options = Chat(
            **{
                **sample_chat_data,
                "model_type": "gpt-5.5",
                "model_platform": "openai",
                "thinking_effort": None,
            }
        )
        result = await _admit_chat(journal, tmp_path, monkeypatch, options)
        assert result.spec.thinking_effort_requested.value == effort
        assert result.spec.thinking_effort_effective.value == "high"
        assert result.spec.provider_value == "high"
        assert result.spec.bundle_revision_id == "bundle-fixture@1"


@pytest.mark.asyncio
@pytest.mark.parametrize("effort", ["low", "medium", "high"])
async def test_dynamic_openai_reasoning_model_still_sends_its_effort(
    tmp_path, monkeypatch, sample_chat_data, effort
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        options = Chat(
            **{
                **sample_chat_data,
                "model_type": "gpt-5.5",
                "model_platform": "openai",
                "thinking_effort": effort,
            }
        )
        result = await _admit_chat(journal, tmp_path, monkeypatch, options)
        assert result.spec.thinking_effort_requested.value == effort
        assert result.spec.thinking_effort_effective.value == effort
        assert result.spec.provider_parameter_name == "reasoning_effort"
        assert result.spec.provider_value == effort
