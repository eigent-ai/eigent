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

"""Admission -> agent factory -> CAMEL -> SDK JSON -> invocation, no network."""

import json
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
from openai import AsyncAzureOpenAI, AsyncOpenAI, AzureOpenAI, OpenAI

from app.agent.agent_model import agent_model
from app.controller.chat_controller import (
    _apply_environment_to_task_lock,
    _legacy_environment_template,
)
from app.model.chat import Chat
from app.run_context import RunContext, run_context_scope
from app.run_journal import SQLiteRunJournal
from app.workspace_config.admission import EnvironmentAdmissionService
from app.workspace_config.models import ThinkingEffort


@pytest.mark.asyncio
@pytest.mark.parametrize("effort", tuple(ThinkingEffort))
@pytest.mark.parametrize("platform", ["azure", "openai", "cloud_azure"])
@pytest.mark.parametrize("source", ["builtin", "catalog", "provider_override"])
@pytest.mark.parametrize("with_image", [False, True])
async def test_admitted_effort_matches_sdk_body_and_invocation(
    tmp_path,
    monkeypatch,
    sample_chat_data,
    caplog,
    effort,
    platform,
    source,
    with_image,
):
    caplog.set_level("INFO", logger="provider_wait")
    model_type = "gpt-6-astra" if source == "builtin" else "nebula-2027"
    model_platform = "openai" if platform == "openai" else "azure"
    metadata = {
        "schema_version": 1,
        "revision": "fixture-v1",
        "model_platform": model_platform,
        "model_type": model_type,
        "supported_efforts": [item.value for item in ThinkingEffort],
        "default_effort": "medium",
        "provider_mapping": {
            item.value: item.value for item in ThinkingEffort
        },
        "transport_parameters": {
            "chat_completions": "reasoning_effort",
            "responses": "reasoning.effort",
        },
        "default_transport": "chat_completions",
        "tools_transport": "responses",
    }
    if source == "catalog":
        catalog = tmp_path / "catalog.json"
        catalog.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "revision": "fixture-v1",
                    "models": [metadata],
                }
            )
        )
        monkeypatch.setenv("EIGENT_MODEL_CAPABILITY_CATALOG", str(catalog))
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
                "model": model_type,
                "output": [
                    {
                        "type": "message",
                        "id": "msg-fixture",
                        "role": "assistant",
                        "status": "completed",
                        "content": [
                            {
                                "type": "output_text",
                                "text": "fixture",
                                "annotations": [],
                            }
                        ],
                    }
                ],
                "usage": {
                    "input_tokens": 3,
                    "output_tokens": 1,
                    "total_tokens": 4,
                },
            },
        )

    sdk_config = {"api_key": "fixture-key", "max_retries": 0}
    if platform == "azure":
        sdk_config.update(
            azure_endpoint="https://azure.invalid", api_version="2024-10-21"
        )
        sync_type, async_type = AzureOpenAI, AsyncAzureOpenAI
        endpoint = "https://azure.invalid"
    else:
        endpoint = (
            "https://proxy.eigent.ai"
            if platform == "cloud_azure"
            else "https://openai.invalid/v1"
        )
        sdk_config["base_url"] = endpoint
        sync_type, async_type = OpenAI, AsyncOpenAI
    sync_client = sync_type(
        **sdk_config,
        http_client=httpx.Client(transport=httpx.MockTransport(handle)),
    )
    async_client = async_type(
        **sdk_config,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handle)),
    )
    options = Chat(
        **{
            **sample_chat_data,
            "model_platform": "openai" if platform == "openai" else "azure",
            "model_type": model_type,
            "api_url": endpoint,
            "thinking_effort": effort,
            "extra_params": {
                "api_mode": "chat_completions",
                "api_version": "2024-10-21",
                "client": sync_client,
                "async_client": async_client,
            },
            "model_config_dict": {
                "stream": False,
                "reasoning_effort": "low",
                "stream_options": {"include_usage": True},
                "extra_body": {
                    "reasoning": {"effort": "low"},
                    "reasoning_effort": "low",
                    "stream_options": {"include_usage": True},
                },
            },
        }
    )
    if source == "provider_override":
        options.extra_params["model_capability"] = metadata
    # OpenAI constructors must not receive an Azure-only init option.
    if platform == "openai":
        options.extra_params.pop("api_version")

    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        template = _legacy_environment_template(options)
        environment = EnvironmentAdmissionService(journal).persist_for_run(
            run_id="run-1",
            space_id="space-1",
            working_directory=tmp_path,
            created_by="fixture",
            template=template,
        )
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="request-1",
            reason="initial_execution",
            environment=environment.binding,
        )
        task_lock = SimpleNamespace(put_queue=MagicMock(return_value=None))
        _apply_environment_to_task_lock(
            task_lock, environment.spec, template=template
        )
        module = sys.modules["app.agent.agent_model"]
        monkeypatch.setattr(module, "get_task_lock", lambda _: task_lock)
        monkeypatch.setattr(module, "_schedule_async_task", lambda _: None)
        monkeypatch.setattr(
            module,
            "ListenChatAgent",
            lambda *a, **kw: SimpleNamespace(model=kw["model"]),
        )
        monkeypatch.setattr(
            "app.run_journal.model_capture.get_default_run_journal",
            lambda: journal,
        )
        agent = agent_model(
            "FixtureAgent", "Trusted instructions", options, [MagicMock()]
        )
        context = RunContext(
            space_id="space-1",
            project_id="project-1",
            run_id="run-1",
            task_id="task-1",
            email="fixture@example.com",
            user_id="fixture",
            working_directory=tmp_path,
            task_output_root=tmp_path,
            camel_log_dir=tmp_path / "logs",
            binding_source="test",
            workdir_mode="test",
            browser_port=9222,
            attempt_id=attempt.attempt_id,
        )
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "fixture_tool",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ]

        def messages(text):
            content = text
            if with_image:
                content = [
                    {"type": "text", "text": text},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "https://images.invalid/fixture.png",
                            "detail": "high",
                        },
                    },
                ]
            return [{"role": "user", "content": content}]

        with run_context_scope(context):
            agent.model.run(messages("fixture"), tools=tools)
            await agent.model.arun(messages("async fixture"), tools=tools)
        assert len(requests) == 2
        for path, body in requests:
            assert (
                path
                == {
                    "azure": "/openai/responses",
                    "openai": "/v1/responses",
                    "cloud_azure": "/responses",
                }[platform]
            )
            assert body["model"] == model_type
            assert body["reasoning"] == {"effort": effort.value}
            assert body["instructions"] == "Trusted instructions"
            assert body["tools"][0]["type"] == "function"
            assert "reasoning_effort" not in body
            assert "reasoning.effort" not in body
            assert "model_capability" not in body
            assert "stream_options" not in body
            if with_image:
                assert body["input"][0]["content"][1] == {
                    "type": "input_image",
                    "image_url": "https://images.invalid/fixture.png",
                    "detail": "high",
                }
        assert template.provider_capability.source == (
            "catalog" if source == "builtin" else source
        )
        assert environment.spec.thinking_effort_requested == effort
        assert environment.spec.thinking_effort_effective == effort
        assert environment.spec.provider_parameter_name == "reasoning.effort"
        assert environment.spec.provider_value == effort.value
        assert attempt.thinking_effort_requested == effort.value
        assert attempt.thinking_effort_effective == effort.value
        records = journal.list_model_invocations("run-1")
        assert len(records) == 2
        observations = [
            item.provider_wait
            for item in caplog.records
            if hasattr(item, "provider_wait")
        ]
        assert {item["invocation_id"] for item in observations} == {
            record.invocation_id for record in records
        }
        for record in records:
            assert record.transport == "responses"
            assert record.thinking_effort == effort.value
            assert record.status == "completed"
            assert (
                record.request["model_config_dict"]["reasoning"]["effort"]
                == effort.value
            )
            correlated = [
                item
                for item in observations
                if item["invocation_id"] == record.invocation_id
            ]
            assert (
                len(
                    [
                        item
                        for item in correlated
                        if item.get("stage") == "dispatch"
                    ]
                )
                == 1
            )
            assert correlated[-1]["phase"] == "completed"
            assert all(item["run_id"] == "run-1" for item in correlated)
            assert all(
                item["run_attempt_id"] == attempt.attempt_id
                for item in correlated
            )
    sync_client.close()
    await async_client.close()
