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
import logging
from typing import Any

from camel.agents.chat_agent import AsyncStreamingChatAgentResponse
from fastapi import Request

from app.agent.factory.single_agent import single_agent
from app.hands.interface import IHands
from app.model.chat import Chat, sse_json
from app.model.enums import Status
from app.service.task import (
    Action,
    ActionData,
    ActionImproveData,
    TaskLock,
    delete_task_lock,
    set_current_task_id,
)
from app.utils.agent_memory import (
    build_memory_context,
    record_agent_memory_snapshot,
)
from app.utils.file_utils import get_working_directory
from camel.responses import ChatAgentResponse

logger = logging.getLogger("single_agent_service")


def _build_single_agent_context(task_lock: TaskLock) -> str:
    if not getattr(task_lock, "conversation_history", None):
        return ""

    lines = ["=== Previous Conversation ==="]
    for entry in task_lock.conversation_history:
        role = entry.get("role", "")
        content = entry.get("content", "")
        if role == "task_result" and isinstance(content, dict):
            task_content = content.get("task_content")
            task_result = content.get("task_result")
            if task_content:
                lines.append(f"Previous task: {task_content}")
            if task_result:
                lines.append(f"Previous result: {task_result}")
        elif content:
            lines.append(f"{role}: {content}")
    memory_context = build_memory_context(task_lock)
    if memory_context:
        lines.append(memory_context.rstrip())
    lines.append("=== End Previous Conversation ===")
    return "\n".join(lines) + "\n\n"


def _build_single_agent_prompt(
    task_lock: TaskLock,
    question: str,
    attaches: list[str],
) -> str:
    context = _build_single_agent_context(task_lock)
    attachment_context = ""
    if attaches:
        attachment_context = "Attachments:\n" + "\n".join(
            f"- {path}" for path in attaches
        )
        attachment_context += "\n\n"
    return f"{context}{attachment_context}User task:\n{question}"


async def _response_content(
    response: ChatAgentResponse | AsyncStreamingChatAgentResponse,
) -> tuple[str, int]:
    def extract_tokens(response_chunk: Any) -> int:
        if response_chunk is None:
            return 0
        info = getattr(response_chunk, "info", None) or {}
        usage_info = info.get("usage") or info.get("token_usage") or {}
        return int(usage_info.get("total_tokens", 0) or 0)

    if isinstance(response, AsyncStreamingChatAgentResponse):
        content = ""
        last_chunk = None
        async for chunk in response:
            last_chunk = chunk
            if chunk.msg and chunk.msg.content:
                content += chunk.msg.content
        return content, extract_tokens(last_chunk)

    msg = getattr(response, "msg", None)
    usage_tokens = extract_tokens(response)
    if msg is not None and getattr(msg, "content", None):
        return msg.content, usage_tokens

    msgs = getattr(response, "msgs", None)
    if msgs:
        return getattr(msgs[-1], "content", "") or "", usage_tokens

    return "", usage_tokens


def _action_to_sse(item: ActionData) -> str | None:
    if item.action == Action.create_agent:
        return sse_json("create_agent", item.data)
    if item.action == Action.activate_agent:
        return sse_json("activate_agent", item.data)
    if item.action == Action.deactivate_agent:
        return sse_json("deactivate_agent", item.data)
    if item.action == Action.assign_task:
        return sse_json("assign_task", item.data)
    if item.action == Action.activate_toolkit:
        return sse_json("activate_toolkit", item.data)
    if item.action == Action.deactivate_toolkit:
        return sse_json("deactivate_toolkit", item.data)
    if item.action == Action.write_file:
        return sse_json(
            "write_file",
            {
                "file_path": item.data,
                "process_task_id": item.process_task_id,
            },
        )
    if item.action == Action.ask:
        return sse_json("ask", item.data)
    if item.action == Action.notice:
        return sse_json(
            "notice",
            {
                "notice": item.data,
                "process_task_id": item.process_task_id,
            },
        )
    if item.action == Action.terminal:
        return sse_json(
            "terminal",
            {
                "output": item.data,
                "process_task_id": item.process_task_id,
            },
        )
    if item.action == Action.todo_state:
        return sse_json("todo_state", item.data)
    if item.action == Action.ui_artifact:
        return sse_json("ui_artifact", item.data)
    if item.action == Action.budget_not_enough:
        return sse_json(
            Action.budget_not_enough, {"message": "budget not enough"}
        )
    return None


async def single_agent_solve(
    options: Chat,
    request: Request,
    task_lock: TaskLock,
    hands: IHands | None = None,
):
    pause_event = asyncio.Event()
    pause_event.set()
    agent = None
    running_turn: asyncio.Task[tuple[str, int]] | None = None
    current_task_id = options.task_id

    async def ensure_agent(task_id: str):
        nonlocal agent
        if agent is None:
            agent = await single_agent(
                options,
                task_id=task_id,
                hands=hands,
                pause_event=pause_event,
            )
        observable_todo = getattr(agent, "_observable_todo_toolkit", None)
        if observable_todo is not None:
            observable_todo.task_id = task_id
            observable_todo.agent_id = agent.agent_id
            observable_todo.emit_todo_state()
        return agent

    async def run_turn(
        question: str, attaches: list[str], task_id: str
    ) -> tuple[str, int]:
        turn_agent = await ensure_agent(task_id)
        turn_agent.process_task_id = task_id
        prompt = _build_single_agent_prompt(task_lock, question, attaches)
        response = await turn_agent.astep(prompt)
        content, total_tokens = await _response_content(response)
        record_agent_memory_snapshot(
            task_lock,
            turn_agent,
            scope="single_agent",
            task_id=task_id,
            task_content=question,
            task_result=content,
        )
        task_lock.add_conversation(
            "task_result",
            {
                "task_content": question,
                "task_result": content,
                "working_directory": get_working_directory(options, task_lock),
            },
        )
        return content, total_tokens

    pending_queue_get: asyncio.Task[Any] = asyncio.create_task(
        task_lock.get_queue()
    )

    while True:
        if await request.is_disconnected():
            logger.info(
                "Single Agent client disconnected; pausing session",
                extra={"project_id": options.project_id},
            )
            pause_event.clear()
            task_lock.status = Status.confirming
            if running_turn and not running_turn.done():
                running_turn.cancel()
            break

        wait_for = {pending_queue_get}
        if running_turn is not None:
            wait_for.add(running_turn)

        done, _ = await asyncio.wait(
            wait_for,
            timeout=1.0,
            return_when=asyncio.FIRST_COMPLETED,
        )
        if not done:
            continue

        if pending_queue_get in done:
            item = pending_queue_get.result()
            pending_queue_get = asyncio.create_task(task_lock.get_queue())

            if item.action == Action.improve:
                assert isinstance(item, ActionImproveData)
                if item.new_task_id:
                    current_task_id = item.new_task_id
                    set_current_task_id(options.project_id, current_task_id)

                if running_turn is not None and not running_turn.done():
                    yield sse_json(
                        "error",
                        {
                            "message": (
                                "Single Agent is already processing a task."
                            )
                        },
                    )
                    continue

                pause_event.set()
                task_lock.status = Status.processing
                yield sse_json("confirmed", {"question": item.data.question})
                running_turn = asyncio.create_task(
                    run_turn(
                        item.data.question,
                        item.data.attaches or [],
                        current_task_id,
                    )
                )
                task_lock.add_background_task(running_turn)
                continue

            if item.action == Action.pause:
                pause_event.clear()
                task_lock.status = Status.confirming
                continue

            if item.action == Action.resume:
                pause_event.set()
                task_lock.status = Status.processing
                continue

            if item.action == Action.skip_task:
                pause_event.clear()
                if running_turn is not None and not running_turn.done():
                    running_turn.cancel()
                task_lock.status = Status.done
                yield sse_json(
                    "end",
                    "<summary>Task stopped</summary>Task stopped by user",
                )
                continue

            if item.action == Action.stop:
                pause_event.clear()
                if agent is not None and getattr(agent, "stop_event", None):
                    agent.stop_event.set()
                if running_turn is not None and not running_turn.done():
                    running_turn.cancel()
                await delete_task_lock(task_lock.id)
                break

            payload = _action_to_sse(item)
            if payload is not None:
                if item.action == Action.budget_not_enough:
                    pause_event.clear()
                    task_lock.status = Status.confirming
                yield payload
            continue

        if running_turn is not None and running_turn in done:
            try:
                final_result, total_tokens = running_turn.result()
            except asyncio.CancelledError:
                final_result = "<summary>Task paused</summary>Task paused"
                total_tokens = 0
            except Exception as e:
                logger.error(
                    "Single Agent turn failed",
                    extra={
                        "project_id": options.project_id,
                        "task_id": current_task_id,
                    },
                    exc_info=True,
                )
                pause_event.clear()
                task_lock.status = Status.confirming
                yield sse_json("error", {"message": str(e)})
                running_turn = None
                continue

            task_lock.status = Status.done
            running_turn = None
            yield sse_json(
                "end",
                {"message": final_result, "tokens": total_tokens},
            )
            continue
