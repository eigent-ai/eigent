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
from app.workspace_config.admission import EnvironmentAdmissionService


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "model,effort",
    [
        ("unknown-deployment", value)
        for value in ["low", "medium", "high", "xhigh", "max"]
    ]
    + [("gpt-5.5", "xhigh"), ("gpt-5.5", "max")],
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
        assert (
            "unknown_model"
            if model == "unknown-deployment"
            else "supported: low, medium, high"
        ) in error.value.detail["message"]
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
