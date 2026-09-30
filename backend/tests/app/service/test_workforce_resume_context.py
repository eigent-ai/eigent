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

"""Actual legacy Workforce entry regressions for Resume context ownership."""

import asyncio
from functools import partial
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from camel.tasks import Task

from app.controller.chat_controller import _EXPLICIT_RESUME_INSTRUCTION
from app.model.chat import Chat
from app.run_journal import SQLiteRunJournal
from app.run_journal.models import RunEventDraft
from app.run_policy import ToolSafetyClass
from app.service import chat_service
from app.service.task import ActionImproveData, ImprovePayload
from app.utils.workforce import Workforce

pytestmark = pytest.mark.unit


class QuestionAgent:
    """Keep a transcript like CAMEL so tests detect repeated injection."""

    def __init__(self, complex_task):
        self.complex_task = complex_task
        self.history = ["STALE HOT MODEL HISTORY"]
        self.inputs = []

    def reset(self):
        self.history = []

    def step(self, prompt):
        self.history.append(prompt)
        self.inputs.append("\n".join(self.history))
        response = (
            ("yes" if self.complex_task else "no")
            if "Is this a complex task?" in prompt
            else "Direct answer"
        )
        return SimpleNamespace(msgs=[SimpleNamespace(content=response)])


@pytest.fixture
def checkpoint(tmp_path):
    with SQLiteRunJournal(tmp_path / "resume.sqlite3") as journal:
        journal.ensure_run(run_id="current", project_id="project", now=2)
        journal.append_event(
            "current",
            RunEventDraft(
                event_type="user.message",
                payload={"content": "CURRENT_OBJECTIVE"},
            ),
        )
        for state in ("prepared", "dispatched", "completed"):
            journal.checkpoint_tool_call(
                run_id="current",
                attempt_id=None,
                tool_call_id="read-report",
                tool_name="read_report",
                safety_class=ToolSafetyClass.SAFE_READ,
                status=state,
                request={},
                result={"data": "CURRENT_EVIDENCE"}
                if state == "completed"
                else None,
            )
        yield journal


async def run_entry(
    journal,
    *,
    hot=False,
    memory=False,
    complex_task=True,
    request_id="resume-1",
    oversized=False,
    attaches=False,
    fresh=False,
):
    journal.reconcile_startup()
    attempt = journal.create_run_attempt(
        "current",
        request_id=request_id,
        reason="initial_execution" if fresh else "explicit_resume",
    )
    if oversized:
        journal.append_event(
            "current",
            RunEventDraft(
                event_type="user.message",
                payload={"content": "mandatory constraint " * 2000},
            ),
        )
    question_agent = QuestionAgent(complex_task)
    if not hot:
        question_agent.history = []
    lock = MagicMock()
    lock.run_context = SimpleNamespace(
        project_id="project", run_id="current", attempt_id=attempt.attempt_id
    )
    lock.conversation_history = (
        [{"role": "assistant", "content": "HOT CACHE"}] if hot else []
    )
    lock.agent_memory_history = []
    lock.memory_summary = ""
    lock.question_agent = question_agent
    lock.new_folder_path = None
    lock.put_queue = AsyncMock()
    initial = ActionImproveData(
        data=ImprovePayload(
            question="QUEUED FRESH TEXT"
            if fresh
            else _EXPLICIT_RESUME_INSTRUCTION,
            project_context="STALE BRIDGE",
        ),
        run_id="current",
        attempt_id=attempt.attempt_id,
    )
    background = []
    first = True

    async def get_queue():
        nonlocal first
        if first:
            first = False
            return initial
        for task in background:
            await asyncio.wait_for(task, 5)
        raise asyncio.CancelledError()

    lock.get_queue = get_queue
    lock.add_background_task = background.append
    options = Chat(
        task_id="current",
        project_id="project",
        run_id="current",
        question="CURRENT_OBJECTIVE",
        email="test@example.test",
        model_platform="openai",
        model_type="gpt-4o",
        api_key="mock",
        session_mode="workforce",
        resume_request_id=None if fresh else request_id,
        summary_prompt="",
        attaches=["report.csv"] if attaches else [],
    )
    workforce = MagicMock()
    workforce._callbacks = []
    decomposition_inputs = []

    def decompose(task, **kwargs):
        decomposition_inputs.append(task.content)
        return [Task(content="One subtask", id="subtask")]

    workforce._decompose_task = decompose
    workforce.handle_decompose_append_task = partial(
        Workforce.handle_decompose_append_task, workforce
    )
    workforce.eigent_make_sub_tasks = MagicMock(
        side_effect=partial(Workforce.eigent_make_sub_tasks, workforce)
    )
    core = next(
        cell.cell_contents
        for cell in chat_service.step_solve.__closure__
        if callable(cell.cell_contents)
        and cell.cell_contents.__name__ == "step_solve"
    )
    with (
        patch.object(
            chat_service, "get_default_run_journal", return_value=journal
        ),
        patch.object(
            chat_service,
            "build_durable_context_projection_for_task_lock",
            return_value=SimpleNamespace(
                text="MEMORY_REFERENCE", source_memory_ids=("memory-1",)
            )
            if memory
            else None,
        ),
        patch.object(
            chat_service,
            "build_project_execution_context_projection",
            wraps=chat_service.build_project_execution_context_projection,
        ) as projector,
        patch.object(
            chat_service,
            "_activate_improve_admission",
            AsyncMock(return_value=True),
        ),
        patch.object(
            chat_service,
            "construct_workforce",
            AsyncMock(return_value=(workforce, None)),
        ) as factory,
        patch.object(
            chat_service, "task_summary_agent", return_value=object()
        ) as summary_factory,
        patch.object(
            chat_service,
            "summary_task",
            AsyncMock(return_value="Task|Summary"),
        ),
        patch.object(chat_service, "record_agent_memory_snapshot"),
        patch.object(chat_service, "finalize_task_lock_run_memory"),
    ):
        stream = core(
            options, SimpleNamespace(state=SimpleNamespace(hands=None)), lock
        )
        try:
            while True:
                await anext(stream)
        except asyncio.CancelledError:
            pass
        finally:
            await stream.aclose()
        return SimpleNamespace(
            routing=question_agent.inputs,
            decomposition=decomposition_inputs,
            coordinator=workforce.eigent_make_sub_tasks.call_args_list,
            projection_count=projector.call_count,
            factory_count=factory.await_count,
            summary_count=summary_factory.call_count,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("hot", [False, True])
@pytest.mark.parametrize(
    "prior,memory",
    [(False, False), (True, False), (False, True), (True, True)],
)
@pytest.mark.parametrize("complex_task", [False, True])
async def test_resume_entry_projects_once_for_every_inference(
    checkpoint, hot, prior, memory, complex_task
):
    if prior:
        checkpoint.ensure_run(run_id="prior", project_id="project", now=1)
        checkpoint.append_event(
            "prior",
            RunEventDraft(
                event_type="user.message",
                payload={"content": "PRIOR_OBJECTIVE"},
            ),
        )
    for index in range(2):
        result = await run_entry(
            checkpoint,
            hot=hot,
            memory=memory,
            complex_task=complex_task,
            request_id=f"resume-{index}",
        )
        assert result.projection_count == 1
        assert len(result.routing) == (1 if complex_task else 2)
        assert len(result.decomposition) == int(complex_task)
        assembled = result.routing + result.decomposition
        for call in result.coordinator:
            task, context, *_ = call.args
            assembled.append(context + task.content)
        for prompt in assembled:
            assert prompt.count("CURRENT_OBJECTIVE") == 1
            assert prompt.count("CURRENT_EVIDENCE") == 1
            assert prompt.count(_EXPLICIT_RESUME_INSTRUCTION) == 1
            assert (
                prompt.count("=== Canonical Project Recovery Context ===") == 1
            )
            assert ("PRIOR_OBJECTIVE" in prompt) is prior
            assert ("MEMORY_REFERENCE" in prompt) is memory
            assert "STALE" not in prompt
            assert "HOT CACHE" not in prompt


@pytest.mark.asyncio
@pytest.mark.parametrize("hot", [False, True])
@pytest.mark.parametrize(
    "complex_task,attaches", [(False, False), (True, False), (True, True)]
)
async def test_resume_budget_gate_prevents_all_inference(
    checkpoint, hot, complex_task, attaches
):
    result = await run_entry(
        checkpoint,
        hot=hot,
        memory=True,
        complex_task=complex_task,
        oversized=True,
        attaches=attaches,
    )
    assert result.routing == []
    assert result.coordinator == []
    assert result.decomposition == []
    assert result.factory_count == 0
    assert result.summary_count == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("complex_task", [False, True])
@pytest.mark.parametrize("hot", [False, True])
async def test_fresh_entry_preserves_original_question_and_routing(
    checkpoint, complex_task, hot
):
    result = await run_entry(
        checkpoint, fresh=True, complex_task=complex_task, hot=hot
    )
    assert "User Query: CURRENT_OBJECTIVE" in result.routing[0]
    assert "QUEUED FRESH TEXT" not in result.routing[0]
    assert _EXPLICIT_RESUME_INSTRUCTION not in result.routing[0]
    assert "Canonical Project Recovery" not in result.routing[0]
    assert result.projection_count == int(complex_task)


@pytest.mark.asyncio
async def test_resume_attachments_validate_and_reuse_context_without_routing(
    checkpoint,
):
    result = await run_entry(checkpoint, hot=True, attaches=True)
    assert result.projection_count == 1
    assert not result.routing
    assert len(result.decomposition) == 1
    assert result.decomposition[0].count("CURRENT_OBJECTIVE") == 1
    assert result.decomposition[0].count("CURRENT_EVIDENCE") == 1
    assert result.decomposition[0].count(_EXPLICIT_RESUME_INSTRUCTION) == 1
