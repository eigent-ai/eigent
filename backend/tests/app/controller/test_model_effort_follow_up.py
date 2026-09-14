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

"""New follow-up admissions refresh capabilities without changing old facts."""

import asyncio
import json
import sys
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException
from openai import AzureOpenAI, OpenAI

from app.agent.agent_model import agent_model
from app.controller import chat_controller as controller
from app.exception.exception import UserException
from app.model.chat import Chat, SupplementChat
from app.model.enums import Status
from app.run_context import RunContext, run_context_scope
from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.run_runtime.coordinator import RunCoordinator
from app.workspace_config.admission import (
    EnvironmentAdmissionService,
    LegacyEnvironmentImporter,
)


@pytest.fixture
def catalog(tmp_path, monkeypatch):
    path = tmp_path / "catalog.json"
    monkeypatch.setenv("EIGENT_MODEL_CAPABILITY_CATALOG", str(path))

    def write(platform="openai", revision="fixture-v1", value="max"):
        efforts = ["low", "medium", "high", "xhigh", "max"]
        metadata = {
            "schema_version": 1,
            "revision": revision,
            "model_platform": platform,
            "model_type": "fixture-deployment",
            "supported_efforts": efforts,
            "default_effort": "medium",
            "provider_mapping": {effort: effort for effort in efforts},
            "transport_parameters": {
                "chat_completions": "reasoning_effort",
                "responses": "reasoning.effort",
            },
            # Responses must come from the original explicit selection.
            "default_transport": "chat_completions",
        }
        metadata["provider_mapping"]["max"] = value
        path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "revision": revision,
                    "models": [metadata],
                }
            )
        )
        return metadata

    return SimpleNamespace(path=path, write=write)


def chat_options(sample_chat_data, platform="openai", cloud=False):
    return Chat(
        **{
            **sample_chat_data,
            "model_platform": platform,
            "model_type": "fixture-deployment",
            "api_url": "https://proxy.eigent.ai"
            if cloud
            else "https://provider.invalid",
            "thinking_effort": "max",
            "extra_params": {"api_mode": "responses"},
            "model_config_dict": {"stream": False},
        }
    )


@asynccontextmanager
async def live_follow_up(tmp_path, monkeypatch, options):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-old", project_id="project-1", status="pending"
        )
        initial = EnvironmentAdmissionService(journal).persist_for_run(
            run_id="run-old",
            space_id="space-1",
            working_directory=tmp_path,
            created_by="fixture",
            template=controller._legacy_environment_template(options),
        )
        old_attempt = journal.create_run_attempt(
            "run-old",
            request_id="request-old",
            reason="initial_execution",
            environment=initial.binding,
            activate=True,
        )
        journal.append_event(
            "run-old",
            RunEventDraft(
                event_id="run-failed:run-old",
                event_type="run.failed",
                payload={"reason": "fixture_failure"},
            ),
            expected_project_id="project-1",
        )
        old_attempt = journal.get_run_attempt(old_attempt.attempt_id)
        context = RunContext(
            space_id="space-1",
            project_id="project-1",
            run_id="run-old",
            task_id="run-old",
            email="fixture@example.invalid",
            user_id="fixture",
            working_directory=tmp_path,
            task_output_root=tmp_path / "old-output",
            camel_log_dir=tmp_path / "old-log",
            binding_source="test",
            workdir_mode=None,
            browser_port=9222,
            attempt_id=old_attempt.attempt_id,
        )

        async def enqueue(action):
            # Admission and its environment must be durable before dispatch.
            attempts = journal.list_run_attempts("run-new")
            assert len(attempts) == 1
            assert attempts[0].attempt_id == action.attempt_id
            assert (
                controller._load_attempt_environment_spec(journal, attempts[0])
                is not None
            )
            assert any(
                event.event_type == "run.environment_resolved"
                for event in journal.list_events("run-new")
            )

        lock = SimpleNamespace(
            id="project-1",
            email=context.email,
            user_id=context.user_id,
            space_id=context.space_id,
            status=Status.done,
            put_queue=AsyncMock(side_effect=enqueue),
            run_context=context,
            runtime_session_mode="single-agent",
        )
        controller._apply_environment_to_task_lock(
            lock, initial.spec, template=initial.template
        )
        coordinator = RunCoordinator()
        release = asyncio.Event()

        async def source():
            await release.wait()
            yield "fixture"

        subscription = await coordinator.start_with_subscription(
            run_id="run-old", stream_factory=source
        )
        resolver = MagicMock()
        resolver.freeze_task_directories_for.return_value = SimpleNamespace(
            working_directory=tmp_path,
            task_output_root=tmp_path / "new-output",
            snapshot=MagicMock(),
            binding_source="test",
            workdir_mode=None,
            base_snapshot_id=None,
        )
        with monkeypatch.context() as scoped:
            for name, replacement in {
                "get_task_lock": lambda _: lock,
                "get_default_run_coordinator": lambda: coordinator,
                "get_default_run_journal": lambda: journal,
                "get_workspace_resolver": lambda: resolver,
                "_prepare_browser_for_request_with_timeout": AsyncMock(
                    return_value=True
                ),
                "_camel_log_dir": lambda *args: tmp_path / "new-log",
                "_space_root_for_run": lambda _: tmp_path,
                "apply_run_env_for_third_party": MagicMock(),
                "_assemble_runtime_environment": lambda *args: None,
            }.items():
                scoped.setattr(controller, name, replacement)
            try:
                yield SimpleNamespace(
                    journal=journal,
                    initial=initial,
                    old_attempt=old_attempt,
                    context=context,
                    lock=lock,
                    coordinator=coordinator,
                    handle=subscription.handle,
                    request=SimpleNamespace(
                        state=SimpleNamespace(browser_port=9222, cdp_url=None)
                    ),
                )
            finally:
                await subscription.aclose()
                release.set()
                await subscription.handle.wait()


def capture_wire(state, options, monkeypatch):
    requests = []

    def handle(request):
        requests.append((request.url.path, json.loads(request.content)))
        return httpx.Response(
            200,
            json={
                "id": "resp-fixture",
                "object": "response",
                "created_at": 1,
                "status": "completed",
                "model": options.model_type,
                "output": [],
            },
        )

    direct_azure = (
        options.model_platform == "azure"
        and options.api_url != "https://proxy.eigent.ai"
    )
    sdk_type = AzureOpenAI if direct_azure else OpenAI
    sdk_options = (
        {"azure_endpoint": options.api_url, "api_version": "2024-10-21"}
        if direct_azure
        else {"base_url": options.api_url}
    )
    with sdk_type(
        api_key="fixture-key",
        max_retries=0,
        **sdk_options,
        http_client=httpx.Client(transport=httpx.MockTransport(handle)),
    ) as client:
        options.extra_params.update(client=client, async_client=object())
        if direct_azure:
            options.extra_params["api_version"] = "2024-10-21"
        module = sys.modules["app.agent.agent_model"]
        monkeypatch.setattr(module, "get_task_lock", lambda _: state.lock)
        monkeypatch.setattr(module, "_schedule_async_task", lambda _: None)
        monkeypatch.setattr(
            module,
            "ListenChatAgent",
            lambda *a, **kw: SimpleNamespace(model=kw["model"]),
        )
        monkeypatch.setattr(
            "app.run_journal.model_capture.get_default_run_journal",
            lambda: state.journal,
        )
        with patch.object(
            state.lock, "put_queue", MagicMock(return_value=None)
        ):
            agent = agent_model(
                "FixtureAgent", "Fixture instructions", options, [MagicMock()]
            )
            with run_context_scope(state.lock.run_context):
                agent.model.run([{"role": "user", "content": "fixture"}])
    assert len(requests) == 1
    assert requests[0][0] == (
        "/openai/responses" if direct_azure else "/responses"
    )
    return requests[0][1]


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", [False, True])
@pytest.mark.parametrize(
    "selection", ["openai", "azure", "cloud_azure", "provider_override"]
)
async def test_follow_up_uses_current_capability_and_preserves_selection(
    tmp_path, monkeypatch, sample_chat_data, catalog, changed, selection
):
    platform = "azure" if selection in {"azure", "cloud_azure"} else "openai"
    metadata = catalog.write(platform=platform)
    options = chat_options(
        sample_chat_data, platform, selection == "cloud_azure"
    )
    if selection == "provider_override":
        override = deepcopy(metadata)
        override["provider_mapping"]["max"] = "high"
        options.extra_params["model_capability"] = override
    async with live_follow_up(tmp_path, monkeypatch, options) as state:
        old_record = state.journal.get_effective_environment_spec(
            state.initial.spec.spec_id
        )
        old_events = state.journal.list_events("run-old")
        controller._validate_resume_model_capability(
            options, state.initial.spec
        )
        if changed:
            catalog.write(
                platform=platform, revision="fixture-v2", value="xhigh"
            )
        current = controller._legacy_environment_template(
            options
        ).provider_capability
        response = await controller.improve(
            "project-1",
            SupplementChat(question="next fixture", task_id="run-new"),
            state.request,
        )
        assert response.status_code == 201
        assert await state.coordinator.get_handle("run-old") is None
        assert await state.coordinator.get_handle("run-new") is state.handle
        state.lock.put_queue.assert_awaited_once()
        attempts = state.journal.list_run_attempts("run-new")
        assert len(attempts) == 1
        spec = controller._load_attempt_environment_spec(
            state.journal, attempts[0]
        )
        assert (
            attempts[0].provider_capability_revision
            == current.capability_revision
        )
        assert attempts[0].thinking_effort_requested == "max"
        assert attempts[0].thinking_effort_effective == "max"
        assert (
            spec.semantic_spec["runtime_capability_manifest"][
                "model_capability"
            ]
            == current.snapshot()
        )
        assert "model_capability_inputs" not in json.dumps(spec.semantic_spec)
        assert (
            state.lock.environment_admission_template.provider_capability
            == current
        )
        assert state.lock.provider_model_transport == "responses"
        expected = (
            "high"
            if selection == "provider_override"
            else "xhigh"
            if changed
            else "max"
        )
        assert spec.provider_value == expected
        assert spec.provider_parameter_name == "reasoning.effort"
        body = capture_wire(state, options, monkeypatch)
        assert body["model"] == "fixture-deployment"
        assert body["reasoning"] == {"effort": expected}
        assert "reasoning_effort" not in body
        assert "model_capability" not in body
        invocation = state.journal.list_model_invocations("run-new")
        assert len(invocation) == 1
        assert invocation[0].thinking_effort == expected
        controller._validate_resume_model_capability(options, spec)
        if changed and selection != "provider_override":
            with pytest.raises(UserException, match="capability changed"):
                controller._validate_resume_model_capability(
                    options, state.initial.spec
                )
        else:
            controller._validate_resume_model_capability(
                options, state.initial.spec
            )
        assert state.journal.list_run_attempts("run-old") == [
            state.old_attempt
        ]
        assert (
            state.journal.get_effective_environment_spec(
                state.initial.spec.spec_id
            )
            == old_record
        )
        assert state.journal.list_events("run-old") == old_events


def test_refresh_preserves_subscription_authentication_and_requested_effort():
    template = LegacyEnvironmentImporter().build_template(
        model_platform="openai",
        model_type="gpt-5.5-codex",
        auth_source="codex_subscription",
        requested_effort="max",
        api_mode="chat_completions",
        allow_local_system=False,
    )
    refreshed = template.refresh_model_capability()
    assert refreshed is not template
    assert refreshed.manifest is template.manifest
    assert refreshed.thinking_effort_requested == "max"
    assert refreshed.provider_capability.source == "codex_subscription"
    assert refreshed.provider_capability.transport == "responses"
    assert (
        refreshed.provider_capability.resolve("max").provider_value == "xhigh"
    )
    assert (
        refreshed.runtime_capability_manifest
        == template.runtime_capability_manifest
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["removed_effort", "invalid_catalog"])
async def test_rejected_catalog_refresh_rolls_back_follow_up(
    tmp_path, monkeypatch, sample_chat_data, catalog, change
):
    catalog.write()
    options = chat_options(sample_chat_data)
    async with live_follow_up(tmp_path, monkeypatch, options) as state:
        old_events = state.journal.list_events("run-old")
        if change == "invalid_catalog":
            catalog.path.write_text("{")
            expected_code = "invalid_model_capability"
        else:
            payload = json.loads(catalog.path.read_text())
            payload["revision"] = "fixture-v2"
            payload["models"][0]["supported_efforts"].remove("max")
            del payload["models"][0]["provider_mapping"]["max"]
            catalog.path.write_text(json.dumps(payload))
            expected_code = "unsupported_thinking_effort"
        with pytest.raises(HTTPException) as error:
            await controller.improve(
                "project-1",
                SupplementChat(question="next fixture", task_id="run-new"),
                state.request,
            )
        assert error.value.status_code == 422
        assert error.value.detail["code"] == expected_code
        assert await state.coordinator.get_handle("run-old") is state.handle
        assert await state.coordinator.get_handle("run-new") is None
        assert state.lock.run_context == state.context
        assert state.lock.status == Status.done
        assert (
            state.lock.environment_admission_template is state.initial.template
        )
        assert state.lock.provider_effort_parameter_value == "max"
        state.lock.put_queue.assert_not_awaited()
        assert state.journal.list_run_attempts("run-new") == []
        assert not state.journal.list_model_invocations("run-new")
        assert not state.journal.list_events("run-new")
        assert state.journal.list_run_attempts("run-old") == [
            state.old_attempt
        ]
        assert state.journal.list_events("run-old") == old_events
        # The rejected request stays retryable after a valid declaration.
        catalog.write(revision="fixture-v2", value="xhigh")
        response = await controller.improve(
            "project-1",
            SupplementChat(question="next fixture", task_id="run-new"),
            state.request,
        )
        assert response.status_code == 201
        assert await state.coordinator.get_handle("run-new") is state.handle
        assert len(state.journal.list_run_attempts("run-new")) == 1
        assert state.lock.provider_effort_parameter_value == "xhigh"
        state.lock.put_queue.assert_awaited_once()
