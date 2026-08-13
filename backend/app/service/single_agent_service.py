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
import os
from typing import Any

from camel.agents.chat_agent import AsyncStreamingChatAgentResponse
from camel.responses import ChatAgentResponse
from fastapi import Request

from app.agent.factory.single_agent import single_agent
from app.hands.interface import IHands
from app.memory import (
    build_durable_context_for_task_lock,
    finalize_task_lock_run_memory,
)
from app.model.chat import Chat, sse_json
from app.model.enums import Status
from app.service.task import (
    Action,
    ActionData,
    ActionImproveData,
    ImprovePayload,
    TaskLock,
    delete_task_lock,
    set_current_task_id,
)
from app.utils.agent_memory import (
    build_memory_context,
    record_agent_memory_snapshot,
)
from app.utils.file_utils import get_working_directory

logger = logging.getLogger("single_agent_service")

# Char budget for the durable memory bundle (~32k chars at 4 chars/token).
# Override via EIGENT_MEMORY_TOKEN_BUDGET if you need to tune in the field.
try:
    _MEMORY_TOKEN_BUDGET = int(
        os.environ.get("EIGENT_MEMORY_TOKEN_BUDGET", "8000")
    )
except ValueError:
    _MEMORY_TOKEN_BUDGET = 8000


def _apply_model_override(options: Chat, payload: ImprovePayload) -> bool:
    """Apply a user-selected model override to options for a follow-up turn.

    Returns True when the model actually changed (so the caller knows to
    rebuild the cached agent), False when there is no override or it matches
    the current configuration.

    The frontend sends the full resolved model config on the improve request so
    a mid-conversation model switch is honored even though the conversation's
    project pin / history still references the original model.
    """
    if not payload.model_platform and not payload.model_type:
        # No override supplied on this turn.
        return False

    # "changed" reflects a change to the model identity (platform / type /
    # auth_source) which is what the cached agent was built from. Only these
    # force a rebuild. Credentials and extra config are still applied so a
    # custom/local provider switch propagates correctly, but they do not by
    # themselves invalidate the cached agent (e.g. sending `{}` where the
    # current config is `None` should not trigger a pointless rebuild).
    changed = False

    if (
        payload.model_platform
        and payload.model_platform != options.model_platform
    ):
        options.model_platform = payload.model_platform
        changed = True
    if payload.model_type and payload.model_type != options.model_type:
        options.model_type = payload.model_type
        changed = True
    if (
        getattr(options, "auth_source", None) != payload.auth_source
        and payload.auth_source is not None
    ):
        options.auth_source = payload.auth_source
        changed = True

    if payload.api_key is not None and payload.api_key != options.api_key:
        options.api_key = payload.api_key
    if payload.api_url is not None and payload.api_url != options.api_url:
        options.api_url = payload.api_url
    if payload.model_config_dict is not None:
        # Avoid treating a populated config replacing an empty one as no-op.
        options.model_config_dict = payload.model_config_dict
    if payload.extra_params is not None:
        options.extra_params = payload.extra_params

    if changed:
        logger.info(
            "Model override applied for follow-up turn",
            extra={
                "project_id": options.project_id,
                "model_platform": options.model_platform,
                "model_type": options.model_type,
                "auth_source": getattr(options, "auth_source", None),
            },
        )
    return changed


def _build_single_agent_context(
    task_lock: TaskLock,
    project_context: str | None = None,
    current_user_prompt: str = "",
) -> str:
    # 1. Durable cross-restart context from LocalMemoryStore (M4 path).
    durable = build_durable_context_for_task_lock(
        task_lock,
        mode="single_agent",
        current_user_prompt=current_user_prompt,
        token_budget=_MEMORY_TOKEN_BUDGET,
    )
    if durable:
        return durable + "\n\n"

    # 2. In-process conversation history (hot follow-up turns).
    if getattr(task_lock, "conversation_history", None):
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

    # 3. Phase-0 bridge fallback (frontend-sent project_context).
    durable_context = (project_context or "").strip()
    if not durable_context:
        return ""
    return (
        "=== Persisted Project Context ===\n"
        f"{durable_context}\n"
        "=== End Persisted Project Context ===\n\n"
    )


def _finalize_memory_for_turn(
    task_lock: TaskLock,
    *,
    state: str,
    final_result: str | None = None,
    error: str | None = None,
) -> None:
    """Best-effort end-of-run memory write."""

    finalize_task_lock_run_memory(
        task_lock,
        state=state,  # type: ignore[arg-type]
        final_result=final_result,
        error=error,
    )


def _build_single_agent_prompt(
    task_lock: TaskLock,
    question: str,
    attaches: list[str],
    project_context: str | None = None,
) -> str:
    context = _build_single_agent_context(
        task_lock, project_context, current_user_prompt=question
    )
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
    if item.action == Action.request_usage:
        return sse_json("request_usage", item.data)
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
        question: str,
        attaches: list[str],
        task_id: str,
        project_context: str | None = None,
    ) -> tuple[str, int]:
        turn_agent = await ensure_agent(task_id)
        turn_agent.process_task_id = task_id
        prompt = _build_single_agent_prompt(
            task_lock,
            question,
            attaches,
            project_context,
        )
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

    try:
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
                        set_current_task_id(
                            options.project_id, current_task_id
                        )

                    # If the user switched the model mid-conversation, rebuild
                    # the cached agent so the new model is used from this turn
                    # onward while preserving conversation context.
                    if _apply_model_override(options, item.data):
                        if agent is not None:
                            logger.info(
                                "Model changed on follow-up turn; rebuilding "
                                "single agent",
                                extra={
                                    "project_id": options.project_id,
                                    "model_platform": options.model_platform,
                                    "model_type": options.model_type,
                                },
                            )
                        agent = None

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
                    yield sse_json(
                        "confirmed", {"question": item.data.question}
                    )
                    running_turn = asyncio.create_task(
                        run_turn(
                            item.data.question,
                            item.data.attaches or [],
                            current_task_id,
                            item.data.project_context
                            or options.project_context,
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
                    stop_message = (
                        "<summary>Task stopped</summary>Task stopped by user"
                    )
                    cancelled_turn = running_turn
                    # Drop our reference first so the next asyncio.wait does
                    # not block on the cancelled task, and so the duplicate
                    # "end" path further down cannot re-surface it.
                    running_turn = None
                    if (
                        cancelled_turn is not None
                        and not cancelled_turn.done()
                    ):
                        cancelled_turn.cancel()

                        # Attach a done callback that swallows CancelledError /
                        # whatever exception the turn surfaces post-cancel, so
                        # the asyncio loop does not log "Task exception was
                        # never retrieved". We deliberately do NOT await the
                        # task here: model HTTP calls, browser actions, or
                        # MCP tool calls may not propagate CancelledError
                        # promptly, and awaiting would block the SSE response
                        # generator -- the user would press Skip and see
                        # nothing happen.
                        def _swallow(task: asyncio.Task) -> None:
                            try:
                                task.result()
                            except (asyncio.CancelledError, Exception):
                                pass

                        cancelled_turn.add_done_callback(_swallow)
                    task_lock.status = Status.done
                    _finalize_memory_for_turn(
                        task_lock,
                        state="cancelled",
                        final_result=stop_message,
                    )
                    yield sse_json("end", stop_message)
                    continue

                if item.action == Action.stop:
                    pause_event.clear()
                    if agent is not None and getattr(
                        agent, "stop_event", None
                    ):
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
                    _finalize_memory_for_turn(
                        task_lock, state="failed", error=str(e)
                    )
                    yield sse_json("error", {"message": str(e)})
                    running_turn = None
                    continue

                task_lock.status = Status.done
                running_turn = None
                _finalize_memory_for_turn(
                    task_lock,
                    state="done",
                    final_result=final_result,
                )
                yield sse_json(
                    "end",
                    {"message": final_result, "tokens": total_tokens},
                )
                continue
    finally:
        if pending_queue_get is not None and not pending_queue_get.done():
            pending_queue_get.cancel()
        if running_turn is not None and not running_turn.done():
            pause_event.clear()
            task_lock.status = Status.confirming
            running_turn.cancel()
        # If the loop exits without a clean done/failed end-of-turn (client
        # disconnect, stop, exception), record a cancelled run. The
        # `_memory_finalized_runs` set on task_lock makes this idempotent:
        # a prior done/failed write wins, this only catches the unfinished
        # case.
        _finalize_memory_for_turn(task_lock, state="cancelled")
        if agent is not None:
            release_cdp = getattr(agent, "_cdp_release_callback", None)
            if callable(release_cdp):
                try:
                    release_cdp(agent)
                except Exception:
                    logger.warning(
                        "Failed to release Single Agent browser resource",
                        extra={
                            "project_id": options.project_id,
                            "task_id": current_task_id,
                        },
                        exc_info=True,
                    )
