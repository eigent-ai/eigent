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

import importlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

sync_step_module = importlib.import_module("app.utils.server.sync_step")


@pytest.fixture(autouse=True)
def clear_step_buffers():
    sync_step_module._text_buffers.clear()
    sync_step_module._local_text_buffers.clear()
    yield
    sync_step_module._text_buffers.clear()
    sync_step_module._local_text_buffers.clear()


@pytest.mark.parametrize(
    "server_url",
    [
        "http://localhost:3001",
        "http://127.0.0.1:3001/api/v1",
        "https://self-host.example.test",
    ],
)
def test_self_hosted_server_does_not_enable_cloud_step_projection(
    monkeypatch, server_url
):
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    chat = SimpleNamespace(server_url=server_url)

    assert sync_step_module._get_config((chat,)) is None


def test_eigent_hosted_server_enables_cloud_step_projection(monkeypatch):
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    chat = SimpleNamespace(server_url="https://dev.eigent.ai")

    assert (
        sync_step_module._get_config((chat,))
        == "https://dev.eigent.ai/api/v1/chat/steps"
    )


@pytest.mark.asyncio
async def test_sse_step_is_committed_before_it_is_yielded(monkeypatch):
    order: list[str] = []

    async def record_legacy_step(**_kwargs):
        order.append("committed")

    recorder = SimpleNamespace(record_legacy_step=record_legacy_step)
    monkeypatch.setattr(
        sync_step_module, "get_default_event_recorder", lambda: recorder
    )
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    @sync_step_module.sync_step
    async def stream(chat, _request):
        yield 'data: {"step":"activate_agent","data":{"agent":"browser"}}'

    chat = SimpleNamespace(task_id="run-1", project_id="project-1")
    iterator = stream(chat, SimpleNamespace(headers={})).__aiter__()
    value = await iterator.__anext__()
    order.append("yielded")

    assert value.startswith("data: ")
    assert order == ["committed", "yielded"]


@pytest.mark.asyncio
async def test_non_sse_payload_is_not_written(monkeypatch):
    recorder = SimpleNamespace(record_legacy_step=AsyncMock())
    monkeypatch.setattr(
        sync_step_module, "get_default_event_recorder", lambda: recorder
    )
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    @sync_step_module.sync_step
    async def stream(chat, _request):
        yield ": heartbeat"

    chat = SimpleNamespace(task_id="run-1", project_id="project-1")
    assert [value async for value in stream(chat, SimpleNamespace(headers={}))]
    recorder.record_legacy_step.assert_not_awaited()


@pytest.mark.asyncio
async def test_decompose_text_commits_once_at_word_threshold(monkeypatch):
    recorder = SimpleNamespace(record_legacy_step=AsyncMock())
    monkeypatch.setattr(
        sync_step_module, "get_default_event_recorder", lambda: recorder
    )
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    @sync_step_module.sync_step
    async def stream(chat, _request):
        for word in ("one ", "two ", "three ", "four ", "five"):
            yield (
                'data: {"step":"decompose_text","data":{"content":"'
                + word
                + '"}}'
            )

    chat = SimpleNamespace(task_id="run-1", project_id="project-1")
    values = [
        value async for value in stream(chat, SimpleNamespace(headers={}))
    ]

    assert len(values) == 5
    recorder.record_legacy_step.assert_awaited_once()
    kwargs = recorder.record_legacy_step.await_args.kwargs
    assert kwargs["step"] == "decompose_text"
    assert kwargs["data"] == {"content": "one two three four five"}


@pytest.mark.asyncio
async def test_non_text_step_flushes_text_batch_before_its_own_commit(
    monkeypatch,
):
    recorder = SimpleNamespace(record_legacy_step=AsyncMock())
    monkeypatch.setattr(
        sync_step_module, "get_default_event_recorder", lambda: recorder
    )
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    @sync_step_module.sync_step
    async def stream(chat, _request):
        yield 'data: {"step":"decompose_text","data":{"content":"one "}}'
        yield 'data: {"step":"decompose_text","data":{"content":"two"}}'
        yield 'data: {"step":"activate_agent","data":{"agent":"browser"}}'

    chat = SimpleNamespace(task_id="run-1", project_id="project-1")
    assert (
        len(
            [
                value
                async for value in stream(chat, SimpleNamespace(headers={}))
            ]
        )
        == 3
    )

    assert recorder.record_legacy_step.await_count == 2
    first, second = recorder.record_legacy_step.await_args_list
    assert first.kwargs["step"] == "decompose_text"
    assert first.kwargs["data"] == {"content": "one two"}
    assert second.kwargs["step"] == "activate_agent"


@pytest.mark.asyncio
async def test_stream_end_flushes_sub_threshold_text_tail(monkeypatch):
    recorder = SimpleNamespace(record_legacy_step=AsyncMock())
    monkeypatch.setattr(
        sync_step_module, "get_default_event_recorder", lambda: recorder
    )
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    @sync_step_module.sync_step
    async def stream(chat, _request):
        yield 'data: {"step":"decompose_text","data":{"content":"tail"}}'

    chat = SimpleNamespace(task_id="run-1", project_id="project-1")
    assert [value async for value in stream(chat, SimpleNamespace(headers={}))]
    recorder.record_legacy_step.assert_awaited_once()
    assert recorder.record_legacy_step.await_args.kwargs["data"] == {
        "content": "tail"
    }


@pytest.mark.asyncio
async def test_end_finalizes_artifacts_before_assistant_result_and_terminal(
    monkeypatch,
):
    order: list[str] = []
    from app import run_runtime

    async def complete_turn(_run_id, *, project_id, assistant_data):
        assert project_id == "project-1"
        assert assistant_data == {"message": "done"}
        order.extend(
            [
                "artifact.manifest.finalized",
                "assistant.final+run.completed",
            ]
        )
        return True

    monkeypatch.setattr(
        run_runtime,
        "get_default_run_coordinator",
        lambda: SimpleNamespace(
            complete_turn=AsyncMock(side_effect=complete_turn)
        ),
    )
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    @sync_step_module.sync_step
    async def stream(chat, _request):
        yield 'data: {"step":"end","data":{"message":"done"}}'

    chat = SimpleNamespace(task_id="run-1", project_id="project-1")
    values = [
        value async for value in stream(chat, SimpleNamespace(headers={}))
    ]
    order.append("yielded")

    assert len(values) == 1
    assert order == [
        "artifact.manifest.finalized",
        "assistant.final+run.completed",
        "yielded",
    ]


@pytest.mark.asyncio
async def test_direct_answer_terminalizes_before_wait_confirm_is_yielded(
    monkeypatch,
):
    order: list[str] = []
    from app import run_runtime

    async def complete_turn(_run_id, *, project_id, assistant_data):
        assert project_id == "project-1"
        assert assistant_data == {
            "content": "direct answer",
            "question": "status?",
        }
        order.append("assistant.final+run.completed")
        return True

    monkeypatch.setattr(
        run_runtime,
        "get_default_run_coordinator",
        lambda: SimpleNamespace(
            complete_turn=AsyncMock(side_effect=complete_turn)
        ),
    )
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    @sync_step_module.sync_step
    async def stream(chat, _request):
        yield (
            'data: {"step":"wait_confirm","data":'
            '{"content":"direct answer","question":"status?"}}'
        )

    chat = SimpleNamespace(task_id="run-1", project_id="project-1")
    values = [
        value async for value in stream(chat, SimpleNamespace(headers={}))
    ]
    order.append("yielded")

    assert len(values) == 1
    assert order == ["assistant.final+run.completed", "yielded"]


@pytest.mark.asyncio
async def test_direct_answer_terminalization_failure_stops_success_frame(
    monkeypatch,
):
    from app import run_runtime

    monkeypatch.setattr(
        run_runtime,
        "get_default_run_coordinator",
        lambda: SimpleNamespace(complete_turn=AsyncMock(return_value=False)),
    )
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    @sync_step_module.sync_step
    async def stream(chat, _request):
        yield (
            'data: {"step":"wait_confirm","data":'
            '{"content":"direct answer","question":"status?"}}'
        )

    chat = SimpleNamespace(task_id="run-1", project_id="project-1")
    iterator = stream(chat, SimpleNamespace(headers={})).__aiter__()

    with pytest.raises(RuntimeError, match="could not terminalize"):
        await iterator.__anext__()


@pytest.mark.asyncio
async def test_journal_failure_marks_degraded_but_does_not_stop_sse(
    monkeypatch,
):
    recorder = SimpleNamespace(
        record_legacy_step=AsyncMock(side_effect=OSError("disk full"))
    )
    task_lock = SimpleNamespace(
        current_task_id="run-1",
        mark_local_history_degraded=MagicMock(),
    )
    monkeypatch.setattr(
        sync_step_module, "get_default_event_recorder", lambda: recorder
    )
    monkeypatch.setattr(
        sync_step_module,
        "get_task_lock_if_exists",
        lambda _project_id: task_lock,
    )
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    @sync_step_module.sync_step
    async def stream(chat, _request):
        yield 'data: {"step":"activate_agent","data":{"agent":"browser"}}'

    chat = SimpleNamespace(task_id="run-1", project_id="project-1")
    values = [
        value async for value in stream(chat, SimpleNamespace(headers={}))
    ]

    assert len(values) == 1
    task_lock.mark_local_history_degraded.assert_called_once_with(
        "OSError: disk full"
    )


@pytest.mark.asyncio
async def test_explicit_step_is_persisted_without_cloud_configuration(
    monkeypatch,
):
    recorder = SimpleNamespace(record_legacy_step=AsyncMock())
    monkeypatch.setattr(
        sync_step_module, "get_default_event_recorder", lambda: recorder
    )
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    await sync_step_module.sync_step_event(
        project_id="project-1",
        task_id="run-1",
        run_id="run-1",
        step="human_reply",
        data={"reply": "yes"},
        authorization=None,
    )

    recorder.record_legacy_step.assert_awaited_once()
    kwargs = recorder.record_legacy_step.await_args.kwargs
    assert kwargs["project_id"] == "project-1"
    assert kwargs["run_id"] == "run-1"
    assert kwargs["step"] == "human_reply"
    assert kwargs["data"] == {"reply": "yes"}


@pytest.mark.asyncio
async def test_explicit_step_does_not_project_to_self_hosted_server(
    monkeypatch,
):
    recorder = SimpleNamespace(record_legacy_step=AsyncMock())
    send = AsyncMock()
    monkeypatch.setattr(
        sync_step_module, "get_default_event_recorder", lambda: recorder
    )
    monkeypatch.setattr(sync_step_module, "_send", send)

    await sync_step_module.sync_step_event(
        project_id="project-1",
        task_id="run-1",
        run_id="run-1",
        step="human_reply",
        data={"reply": "yes"},
        authorization="Bearer local-token",
        server_url="http://localhost:3001",
    )

    recorder.record_legacy_step.assert_awaited_once()
    send.assert_not_awaited()


@pytest.mark.asyncio
async def test_explicit_step_failure_is_fail_open_and_marks_degraded(
    monkeypatch,
):
    recorder = SimpleNamespace(
        record_legacy_step=AsyncMock(side_effect=OSError("busy timeout"))
    )
    task_lock = SimpleNamespace(mark_local_history_degraded=MagicMock())
    monkeypatch.setattr(
        sync_step_module, "get_default_event_recorder", lambda: recorder
    )
    monkeypatch.setattr(
        sync_step_module,
        "get_task_lock_if_exists",
        lambda _project_id: task_lock,
    )
    monkeypatch.setattr(sync_step_module, "env", lambda *_args: "")

    await sync_step_module.sync_step_event(
        project_id="project-1",
        task_id="run-1",
        run_id="run-1",
        step="human_reply",
        data={"reply": "yes"},
        authorization=None,
    )

    task_lock.mark_local_history_degraded.assert_called_once_with(
        "OSError: busy timeout"
    )


def test_event_attribution_prefers_immutable_run_context(monkeypatch):
    mutable_task_lock = SimpleNamespace(current_task_id="mutable-run")
    monkeypatch.setattr(
        sync_step_module,
        "get_current_run_context",
        lambda: SimpleNamespace(run_id="immutable-run"),
    )
    monkeypatch.setattr(
        sync_step_module,
        "get_task_lock_if_exists",
        lambda _project_id: mutable_task_lock,
    )
    chat = SimpleNamespace(task_id="chat-task", project_id="project-1")

    assert sync_step_module._get_task_id((chat,)) == "immutable-run"


def test_event_attribution_never_falls_back_to_mutable_task_lock(monkeypatch):
    monkeypatch.setattr(
        sync_step_module,
        "get_current_run_context",
        lambda: None,
    )
    monkeypatch.setattr(
        sync_step_module,
        "get_task_lock_if_exists",
        lambda _project_id: SimpleNamespace(current_task_id="wrong-run"),
    )
    chat = SimpleNamespace(
        run_id="immutable-request-run",
        task_id="legacy-request-run",
        project_id="project-1",
    )

    assert sync_step_module._get_task_id((chat,)) == "immutable-request-run"
