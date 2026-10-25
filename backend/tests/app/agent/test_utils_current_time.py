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

import datetime
from dataclasses import replace
from unittest.mock import patch

import pytest

from app.agent.factory.question_confirm import question_confirm_agent
from app.agent.utils import agent_current_time, current_time_str
from app.model.chat import Chat
from app.run_context import RunContext, run_context_scope


@pytest.mark.parametrize(
    ("instant", "zone", "expected"),
    [
        (
            "2026-07-01T12:34:56+00:00",
            "Europe/London",
            "2026-07-01 13:00:00 Europe/London (BST, UTC+01:00)",
        ),
        (
            "2026-12-01T12:34:56+00:00",
            "Europe/London",
            "2026-12-01 12:00:00 Europe/London (GMT, UTC+00:00)",
        ),
        (
            "2026-07-01T02:34:56+00:00",
            "America/New_York",
            "2026-06-30 22:00:00 America/New_York (EDT, UTC-04:00)",
        ),
        (
            "2026-12-01T02:34:56+00:00",
            "America/New_York",
            "2026-11-30 21:00:00 America/New_York (EST, UTC-05:00)",
        ),
    ],
)
def test_current_time_in_user_zone(instant, zone, expected):
    assert (
        current_time_str(zone, datetime.datetime.fromisoformat(instant))
        == expected
    )


@pytest.mark.parametrize("zone", [None, "invalid/zone", "/etc/passwd", ""])
def test_unknown_zone_uses_brain_local_time(zone):
    instant = datetime.datetime(2026, 7, 1, tzinfo=datetime.UTC)
    local = instant.astimezone()
    result = current_time_str(zone, instant)
    assert result.startswith(local.strftime("%Y-%m-%d %H:00:00"))
    assert local.tzname() in result


def test_clock_changes_after_module_import_and_factory_construction(
    sample_chat_data,
):
    import app.agent.utils as utils

    options = Chat(**sample_chat_data, timezone="Europe/London")
    with (
        patch.object(
            utils.datetime, "datetime", wraps=datetime.datetime
        ) as clock,
        patch("app.agent.factory.question_confirm.agent_model") as model,
    ):
        clock.now.return_value = datetime.datetime(
            2026, 7, 1, 22, tzinfo=datetime.UTC
        )
        question_confirm_agent(options)
        assert "2026-07-01 23:00:00" in model.call_args.args[1]
        clock.now.return_value = datetime.datetime(
            2026, 7, 2, 1, tzinfo=datetime.UTC
        )
        question_confirm_agent(options)
        assert "2026-07-02 02:00:00" in model.call_args.args[1]


def test_attempt_clock_is_stable_and_resume_and_foreign_runs_are_isolated(
    sample_chat_data, tmp_path
):
    options = Chat(**sample_chat_data, timezone="Europe/London")
    context = RunContext(
        space_id="space-1",
        project_id=options.project_id,
        run_id=options.task_id,
        task_id=options.task_id,
        email=options.email,
        user_id=None,
        working_directory=tmp_path,
        task_output_root=tmp_path,
        camel_log_dir=tmp_path,
        binding_source="test",
        workdir_mode=None,
        browser_port=9222,
        prompt_current_time="2026-07-01 23:00:00 Europe/London (BST, UTC+01:00)",
    )
    with run_context_scope(context):
        assert agent_current_time(options) == context.prompt_current_time
        foreign = options.model_copy(update={"task_id": "foreign"})
        assert agent_current_time(foreign) != context.prompt_current_time
    resumed = replace(
        context,
        attempt_id="attempt-2",
        prompt_current_time="2026-07-02 02:00:00",
    )
    with run_context_scope(resumed):
        assert agent_current_time(options) == resumed.prompt_current_time


def test_timezone_is_optional_and_invalid_value_does_not_reject_old_clients(
    sample_chat_data,
):
    assert Chat(**sample_chat_data).timezone is None
    assert (
        Chat(**sample_chat_data, timezone="Unknown/Zone").timezone
        == "Unknown/Zone"
    )


def test_retained_agent_updates_only_the_clock_without_resetting_memory():
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from camel.messages import BaseMessage

    from app.agent.utils import refresh_agent_current_time

    old = "2026-07-01 23:00:00 Europe/London (BST, UTC+01:00)"
    new = "2026-07-02 02:00:00 Europe/London (BST, UTC+01:00)"
    agent = SimpleNamespace(
        _prompt_current_time=old,
        _original_system_message=BaseMessage.make_assistant_message(
            role_name="Single Agent",
            content=f"Instructions\nCurrent date/time: {old}\nTools",
        ),
        update_system_message=MagicMock(),
    )
    refresh_agent_current_time(agent, old)
    agent.update_system_message.assert_not_called()
    refresh_agent_current_time(agent, new)
    message = agent.update_system_message.call_args.args[0]
    assert message.content == f"Instructions\nCurrent date/time: {new}\nTools"
    assert agent.update_system_message.call_args.kwargs == {
        "reset_memory": False
    }


def test_refreshed_time_reaches_the_model_context_of_a_retained_agent():
    from camel.agents import ChatAgent
    from camel.messages import BaseMessage
    from camel.models import ModelFactory
    from camel.types import ModelPlatformType, ModelType, OpenAIBackendRole

    from app.agent.utils import refresh_agent_current_time

    agent = ChatAgent(
        system_message="The current date is 2026-10-21 14:00:00 UTC.",
        model=ModelFactory.create(ModelPlatformType.STUB, ModelType.STUB),
    )
    agent._prompt_current_time = "2026-10-21 14:00:00 UTC"
    agent.update_memory(
        BaseMessage.make_user_message("user", "hello"),
        OpenAIBackendRole.USER,
    )

    refresh_agent_current_time(agent, "2026-10-22 16:00:00 UTC")

    context, _ = agent.memory.get_context()
    assert context[0]["content"] == (
        "The current date is 2026-10-22 16:00:00 UTC."
    )
    assert context[-1]["content"] == "hello"
