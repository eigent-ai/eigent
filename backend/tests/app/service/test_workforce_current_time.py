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

import asyncio
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

import app.agent.utils as clock_utils
import app.service.chat_service as service
from app.model.chat import Chat, NewAgent
from app.run_context import RunContext, run_context_scope
from app.service.task import (
    ActionDecomposeTextData,
    ActionImproveData,
    ActionNewAgent,
    Agents,
    ImprovePayload,
)


@pytest.mark.asyncio
async def test_warm_follow_up_keeps_all_workers_on_attempt_clock(
    sample_chat_data, mock_task_lock, monkeypatch, tmp_path
):
    initial_time = "2026-07-01 22:00:00 Europe/London (BST, UTC+01:00)"
    follow_up_time = "2026-07-01 23:00:00 Europe/London (BST, UTC+01:00)"
    after_midnight = "2026-07-02 00:00:00 Europe/London (BST, UTC+01:00)"
    custom = dict(description="Local helper", tools=[], mcp_tools=None)
    options = Chat(
        **{
            **sample_chat_data,
            "timezone": "Europe/London",
            "new_agents": [NewAgent(name="configured-worker", **custom)],
        }
    )
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
        browser_port=0,
        prompt_current_time=initial_time,
        timezone=options.timezone,
    )
    follow_up = replace(
        context,
        run_id="follow-up-run",
        task_id="follow-up-run",
        prompt_current_time=follow_up_time,
    )
    mock_task_lock.question_agent = MagicMock()
    mock_task_lock.conversation_history = []
    mock_task_lock.agent_memory_history = []
    queue = asyncio.Queue()
    for item in [
        ActionImproveData(data=ImprovePayload(question=options.question)),
        ActionImproveData(
            data=ImprovePayload(question="Write a dated report"),
            new_task_id=follow_up.task_id,
            run_id=follow_up.run_id,
        ),
        ActionNewAgent(name="added-worker", **custom),
        ActionDecomposeTextData(data={"content": "workers ready"}),
    ]:
        queue.put_nowait(item)
    mock_task_lock.get_queue = queue.get
    background_tasks = []
    mock_task_lock.add_background_task.side_effect = background_tasks.append
    request = SimpleNamespace(
        state=SimpleNamespace(
            hands=SimpleNamespace(can_execute_terminal=lambda: False)
        ),
        headers={},
    )
    wall_clock = MagicMock(return_value=after_midnight)
    monkeypatch.setattr(clock_utils, "current_time_str", wall_clock)
    monkeypatch.setattr(
        service, "_activate_improve_admission", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(
        service, "_build_workforce_resume_context", lambda *_: None
    )
    monkeypatch.setattr(
        service, "_build_question_context", lambda *_, **__: ""
    )
    monkeypatch.setattr(
        service, "build_context_for_workforce", lambda *_, **__: ""
    )
    monkeypatch.setattr(
        service, "question_confirm", AsyncMock(side_effect=[False, True])
    )
    monkeypatch.setattr(
        service, "_answer_simple_question", AsyncMock(return_value="hello")
    )
    for name in [
        "record_agent_memory_snapshot",
        "finalize_task_lock_run_memory",
        "set_current_task_id",
        "WorkforceMetricsCallback",
    ]:
        monkeypatch.setattr(service, name, MagicMock())
    monkeypatch.setattr(
        service, "get_working_directory", lambda *_: str(tmp_path)
    )
    monkeypatch.setattr(service, "remote_sub_agent_enabled", lambda *_: False)
    monkeypatch.setattr(
        service,
        "attach_remote_sub_agent_if_enabled",
        lambda **kw: kw["system_message"],
    )
    monkeypatch.setattr(
        service, "append_connected_app_mcp_notice", lambda message: message
    )
    monkeypatch.setattr(service, "get_toolkits", AsyncMock(return_value=[]))
    for name in ["HumanToolkit", "NoteTakingToolkit", "SkillToolkit"]:
        toolkit = MagicMock()
        toolkit.get_can_use_tools.return_value = []
        toolkit.return_value.get_tools.return_value = []
        monkeypatch.setattr(service, name, toolkit)
    integration = MagicMock()
    integration.return_value.register_toolkits.side_effect = (
        lambda toolkit: toolkit
    )
    monkeypatch.setattr(service, "ToolkitMessageIntegration", integration)
    monkeypatch.setattr(service, "Workforce", MagicMock())

    factory_times = {}
    factory_options = []

    def factory(name):
        def create(agent_options, **_):
            factory_times[name] = clock_utils.agent_current_time(agent_options)
            factory_options.append(agent_options)
            return MagicMock()

        return create

    for name in ["browser_agent", "multi_modal_agent"]:
        monkeypatch.setattr(service, name, factory(name))
    for name in ["developer_agent", "document_agent", "mcp_agent"]:
        monkeypatch.setattr(
            service, name, AsyncMock(side_effect=factory(name))
        )

    prompts = {}

    def agent_model(name, prompt, agent_options, *_args, **_kwargs):
        prompts[name] = prompt
        factory_options.append(agent_options)
        return MagicMock()

    monkeypatch.setattr(service, "agent_model", agent_model)
    monkeypatch.setattr(
        "app.utils.server.sync_step._record_local_step_fail_open",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        "app.utils.server.sync_step._flush_local_text_for_args_fail_open",
        AsyncMock(),
    )
    stream = service.step_solve(options, request, mock_task_lock)
    try:
        with run_context_scope(context):
            assert '"wait_confirm"' in await asyncio.wait_for(anext(stream), 5)
        with run_context_scope(follow_up):
            assert '"confirmed"' in await asyncio.wait_for(anext(stream), 5)
            assert "workers ready" in await asyncio.wait_for(anext(stream), 5)
        assert set(factory_times) == {
            "browser_agent",
            "multi_modal_agent",
            "developer_agent",
            "document_agent",
            "mcp_agent",
        }
        assert set(factory_times.values()) == {follow_up_time}
        assert set(prompts) == {
            Agents.coordinator_agent,
            Agents.task_agent,
            Agents.new_worker_agent,
            "configured-worker",
            "added-worker",
        }
        for prompt in prompts.values():
            assert follow_up_time in prompt
            assert after_midnight not in prompt
        assert all(
            item.task_id == follow_up.task_id for item in factory_options
        )
        assert options.task_id == context.task_id
        wall_clock.assert_not_called()
    finally:
        await stream.aclose()
        for task in background_tasks:
            task.cancel()
        await asyncio.gather(*background_tasks, return_exceptions=True)
