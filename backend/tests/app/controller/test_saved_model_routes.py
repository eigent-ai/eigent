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

"""Routes that take a model saved on the device by reference, not by key."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.component.model_validation import ValidationResult
from app.controller import chat_controller, model_controller, task_controller
from app.controller.model_controller import (
    ListProviderModelsRequest,
    ValidateModelRequest,
    list_provider_models,
    validate_model,
)
from app.model import local_model_configuration as local
from app.model.chat import AgentModelConfig, Chat, NewAgent
from app.model.local_model_configuration import (
    SAVED_VALUE_MARKER,
    LocalModelConfiguration,
    LocalModelConfigurationError,
    ModelCredentialReference,
)

SCOPE = "a" * 64
KEY = "unit-test-model-key-0001"
REFERENCE = ModelCredentialReference(account_scope=SCOPE, credential_id=7)
SAVED = LocalModelConfiguration(
    provider_name="openai",
    model_type="gpt-test",
    endpoint_url="https://models.example.test/v1",
    api_key=KEY,
    api_url="https://models.example.test/v1",
    config={
        "aws_secret_access_key": "unit-test-secret-value",
        "model_config_dict": {"temperature": 0.2},
    },
)


@pytest.fixture
def saved(monkeypatch):
    """The device has one saved model; record every lookup."""

    lookups: list[ModelCredentialReference] = []

    def resolve(reference):
        lookups.append(reference)
        return SAVED

    monkeypatch.setattr(local, "resolve_local_model_configuration", resolve)
    return lookups


@pytest.fixture
def missing_key(monkeypatch):
    def resolve(reference):
        raise LocalModelConfigurationError("model_key_required")

    monkeypatch.setattr(local, "resolve_local_model_configuration", resolve)


def _valid() -> ValidationResult:
    result = ValidationResult()
    result.is_valid = True
    result.is_tool_calls = True
    return result


@pytest.mark.asyncio
async def test_model_check_fills_the_saved_key_without_returning_it(saved):
    with patch.object(
        model_controller, "validate_model_with_details", return_value=_valid()
    ) as check:
        response = await validate_model(
            ValidateModelRequest(
                model_platform="openai",
                model_type="gpt-test",
                api_key=None,
                url="https://models.example.test/v1",
                extra_params={"aws_secret_access_key": SAVED_VALUE_MARKER},
                model_credential=REFERENCE,
            )
        )

    assert saved == [REFERENCE]
    assert check.call_args.kwargs["api_key"] == KEY
    assert (
        check.call_args.kwargs["aws_secret_access_key"]
        == "unit-test-secret-value"
    )
    assert response.is_valid is True
    assert KEY not in response.model_dump_json()
    assert "unit-test-secret-value" not in response.model_dump_json()


@pytest.mark.asyncio
async def test_model_check_refuses_a_saved_key_for_another_host(saved):
    with (
        patch.object(model_controller, "validate_model_with_details") as check,
        pytest.raises(HTTPException) as caught,
    ):
        await validate_model(
            ValidateModelRequest(
                model_platform="openai",
                model_type="gpt-test",
                url="https://elsewhere.example.test/v1",
                model_credential=REFERENCE,
            )
        )

    check.assert_not_called()
    assert caught.value.status_code == 409
    assert caught.value.detail["error_code"] == "model_key_endpoint_changed"
    assert KEY not in str(caught.value.detail)


@pytest.mark.asyncio
async def test_model_check_without_a_reference_is_unchanged(saved):
    with patch.object(
        model_controller, "validate_model_with_details", return_value=_valid()
    ) as check:
        await validate_model(
            ValidateModelRequest(
                model_platform="openai",
                model_type="gpt-test",
                api_key="unit-test-typed-key",
                url="https://models.example.test/v1",
            )
        )

    assert saved == []
    assert check.call_args.kwargs["api_key"] == "unit-test-typed-key"


@pytest.mark.asyncio
async def test_model_list_needs_a_key_or_a_saved_model(saved):
    with pytest.raises(HTTPException) as caught:
        await list_provider_models(
            ListProviderModelsRequest(
                api_host="https://models.example.test/v1",
                models_endpoint="/models",
            )
        )
    assert caught.value.status_code == 422
    assert saved == []


@pytest.mark.asyncio
async def test_model_list_refuses_a_saved_key_for_another_host(saved):
    with pytest.raises(HTTPException) as caught:
        await list_provider_models(
            ListProviderModelsRequest(
                api_host="https://elsewhere.example.test/v1",
                models_endpoint="/models",
                model_credential=REFERENCE,
            )
        )

    assert caught.value.status_code == 409
    assert caught.value.detail["error_code"] == "model_key_endpoint_changed"
    assert KEY not in str(caught.value.detail)


@pytest.mark.asyncio
async def test_model_list_reports_a_key_that_is_not_on_the_device(missing_key):
    with pytest.raises(HTTPException) as caught:
        await list_provider_models(
            ListProviderModelsRequest(
                api_host="https://models.example.test/v1",
                models_endpoint="/models",
                model_credential=REFERENCE,
            )
        )

    assert caught.value.status_code == 409
    assert caught.value.detail["error_code"] == "model_key_required"


def _chat(**overrides) -> Chat:
    return Chat(
        **{
            "task_id": "task-1",
            "project_id": "project-1",
            "question": "hello",
            "email": "person@example.test",
            "model_platform": "openai",
            "model_type": "gpt-test",
            "api_key": "",
            **overrides,
        }
    )


@pytest.mark.asyncio
async def test_run_start_reads_the_saved_key_before_the_run_is_admitted(
    saved,
):
    seen: dict[str, object] = {}

    async def start(data, request):
        seen["api_key"] = data.api_key
        seen["api_url"] = data.api_url
        return iter(())

    with patch.object(chat_controller, "start_chat_stream", start):
        await chat_controller.post(
            _chat(
                model_credential=REFERENCE,
                api_url="https://other-host.example.test/v1",
            ),
            MagicMock(),
        )

    assert saved == [REFERENCE]
    assert seen == {"api_key": KEY, "api_url": SAVED.api_url}


@pytest.mark.asyncio
async def test_run_start_stops_when_the_key_is_not_on_the_device(missing_key):
    start = MagicMock()
    with (
        patch.object(chat_controller, "start_chat_stream", start),
        pytest.raises(HTTPException) as caught,
    ):
        await chat_controller.post(
            _chat(model_credential=REFERENCE), MagicMock()
        )

    start.assert_not_called()
    assert caught.value.status_code == 409
    assert caught.value.detail["code"] == "model_key_required"
    assert "Settings > Models" in caught.value.detail["message"]


def test_run_records_that_its_model_key_came_from_the_device():
    request = SimpleNamespace(
        state=SimpleNamespace(), headers={"authorization": "Bearer t"}
    )
    frozen = SimpleNamespace(
        working_directory="/tmp/work",
        task_output_root="/tmp/out",
        binding_source="legacy",
        workdir_mode=None,
        base_snapshot_id=None,
    )
    with patch("app.run_sync.runtime.configure_default_cloud_sync_worker"):
        context = chat_controller._build_run_context(
            _chat(model_credential=REFERENCE, api_key=KEY),
            frozen,
            request,
            Path("camel-log"),
        )

    assert context.credential_sources["model"] == "device_model_configuration"


def test_added_agent_gets_its_saved_key_before_it_is_queued(saved):
    agent = NewAgent(
        name="researcher",
        description="",
        tools=[],
        mcp_tools=None,
        custom_model_config=AgentModelConfig(
            model_platform="openai",
            model_type="gpt-test",
            model_credential=REFERENCE,
        ),
    )
    queued: list[object] = []
    with (
        patch.object(
            task_controller, "get_task_lock", return_value=MagicMock()
        ),
        patch.object(
            task_controller,
            "_queue_action_from_worker",
            lambda lock, action, name: queued.append(action),
        ),
    ):
        response = task_controller.add_agent("task-1", agent)

    assert response.status_code == 204
    assert saved == [REFERENCE]
    assert queued[0].custom_model_config.api_key == KEY
    assert queued[0].custom_model_config.api_url == SAVED.api_url


def test_added_agent_is_refused_when_its_key_is_not_on_the_device(missing_key):
    agent = NewAgent(
        name="researcher",
        description="",
        tools=[],
        mcp_tools=None,
        custom_model_config=AgentModelConfig(model_credential=REFERENCE),
    )
    with (
        patch.object(task_controller, "_queue_action_from_worker") as queue,
        pytest.raises(HTTPException) as caught,
    ):
        task_controller.add_agent("task-1", agent)

    queue.assert_not_called()
    assert caught.value.status_code == 409
    assert caught.value.detail["code"] == "model_key_required"
