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
import inspect
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

from camel.agents.chat_agent import AsyncStreamingChatAgentResponse
from camel.responses import ChatAgentResponse
from fastapi import Request

from app.agent.factory.single_agent import single_agent
from app.hands.interface import IHands
from app.memory import (
    build_durable_context_projection_for_task_lock,
    finalize_task_lock_run_memory,
)
from app.model.chat import Chat, sse_json
from app.model.enums import Status
from app.run_journal.context_projection import (
    build_project_execution_context_projection,
    persist_context_projection_diagnostic,
)
from app.run_journal.runtime import get_default_run_journal
from app.run_runtime.admission import activate_improve_admission
from app.run_runtime.coordinator import RunInterruptedError
from app.service.task import (
    Action,
    ActionData,
    ActionImproveData,
    TaskLock,
    delete_task_lock,
    notice_event_payload,
    set_current_task_id,
    write_file_event_payload,
)
from app.utils.agent_memory import (
    build_memory_context,
    record_agent_memory_snapshot,
)
from app.utils.file_utils import get_working_directory

logger = logging.getLogger("single_agent_service")

_RETRYABLE_MODEL_STATUS_CODES = frozenset(
    {408, 425, 429, 499, 500, 502, 503, 504}
)

TaskSummaryCallback = Callable[[str, str], Awaitable[str]]


def _is_retryable_turn_error(error: Exception) -> bool:
    """Return whether a failed model turn can safely continue in a new Attempt.

    These failures happen before Eigent receives a model response, so no tool
    call from that response has been dispatched. Completed tool checkpoints
    from earlier turns remain authoritative and are not replayed implicitly.
    """

    status_code = getattr(error, "status_code", None)
    if status_code in _RETRYABLE_MODEL_STATUS_CODES:
        return True
    if type(error).__name__ in {"APIConnectionError", "APITimeoutError"}:
        return True
    message = str(error).strip().lower()
    return message in {
        "client closed request",
        "connection error",
        "request timed out",
    }


async def _dispose_stale_agent_runtime(
    agent: Any,
    task_lock: TaskLock,
    *,
    task_id: str,
) -> None:
    """Dispose every stale adapter before a replacement can be assembled."""

    failures: list[Exception] = []
    release_cdp = getattr(agent, "_cdp_release_callback", None)
    if callable(release_cdp):
        try:
            release_cdp(agent)
            agent._cdp_release_callback = None
        except Exception as exc:
            failures.append(exc)
            logger.exception(
                "Failed to release stale Agent browser runtime",
                extra={"task_id": task_id},
            )

    remaining_toolkits: list[Any] = []
    for toolkit in getattr(agent, "_runtime_cleanup_toolkits", ()):
        disposed = False
        try:
            cleanup = getattr(toolkit, "disconnect", None)
            if cleanup is None:
                cleanup = getattr(toolkit, "cleanup", None)
            if cleanup is not None:
                outcome = cleanup()
                if inspect.isawaitable(outcome):
                    await outcome
            disposed = True
        except Exception as exc:
            failures.append(exc)
            remaining_toolkits.append(toolkit)
            logger.exception(
                "Failed to dispose stale Agent toolkit",
                extra={
                    "task_id": task_id,
                    "toolkit": type(toolkit).__name__,
                },
            )
        if disposed:
            task_lock.registered_toolkits = [
                item
                for item in task_lock.registered_toolkits
                if item is not toolkit
            ]
    agent._runtime_cleanup_toolkits = tuple(remaining_toolkits)

    if failures:
        raise RuntimeError(
            "Failed to dispose stale Agent runtime; replacement blocked"
        ) from failures[0]


async def _reset_agent_for_run(
    agent: Any,
    *,
    task_id: str,
) -> None:
    """Reset semantic state while retaining the compatible warm runtime."""

    reset = getattr(agent, "reset", None)
    if not callable(reset):
        raise RuntimeError("Reusable Agent does not expose reset()")
    outcome = reset()
    if inspect.isawaitable(outcome):
        await outcome
    agent.process_task_id = task_id
    stop_event = getattr(agent, "stop_event", None)
    clear_stop = getattr(stop_event, "clear", None)
    if callable(clear_stop):
        clear_stop()


# Char budget for the durable memory bundle (~32k chars at 4 chars/token).
# Override via EIGENT_MEMORY_TOKEN_BUDGET if you need to tune in the field.
try:
    _MEMORY_TOKEN_BUDGET = int(
        os.environ.get("EIGENT_MEMORY_TOKEN_BUDGET", "8000")
    )
except ValueError:
    _MEMORY_TOKEN_BUDGET = 8000


def _build_single_agent_context(
    task_lock: TaskLock,
    project_context: str | None = None,
    current_user_prompt: str = "",
) -> str:
    run_context = getattr(task_lock, "run_context", None)
    canonical_execution = ""
    execution_event_ids: tuple[str, ...] = ()
    project_id = getattr(run_context, "project_id", None)
    run_id = getattr(run_context, "run_id", None)
    if isinstance(project_id, str) and isinstance(run_id, str):
        try:
            execution_projection = build_project_execution_context_projection(
                get_default_run_journal(),
                project_id=project_id,
                current_run_id=run_id,
            )
            canonical_execution = execution_projection.text
            execution_event_ids = execution_projection.source_event_ids
        except Exception:
            logger.warning(
                "Canonical execution context unavailable; using Memory fallback",
                extra={"project_id": project_id, "run_id": run_id},
                exc_info=True,
            )

    # Project Memory owns durable summaries/facts/artifacts. Conversation and
    # tool history come from the canonical RunJournal when it is available.
    memory_projection = build_durable_context_projection_for_task_lock(
        task_lock,
        mode="single_agent",
        current_user_prompt=current_user_prompt,
        token_budget=_MEMORY_TOKEN_BUDGET,
        include_conversation=not bool(canonical_execution),
    )
    durable = memory_projection.text if memory_projection is not None else None

    def record_projection(projected_text: str) -> str:
        if isinstance(project_id, str) and isinstance(run_id, str):
            persist_context_projection_diagnostic(
                get_default_run_journal(),
                project_id=project_id,
                run_id=run_id,
                projected_text=projected_text,
                source_event_ids=execution_event_ids,
                source_memory_ids=(
                    memory_projection.source_memory_ids
                    if memory_projection is not None
                    else ()
                ),
            )
        return projected_text

    durable_parts = [
        part.strip()
        for part in (durable, canonical_execution)
        if isinstance(part, str) and part.strip()
    ]
    if durable_parts:
        projected = "\n\n".join(durable_parts) + "\n\n"
        return record_projection(projected)

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
        return record_projection("\n".join(lines) + "\n\n")

    # 3. Phase-0 bridge fallback (frontend-sent project_context).
    durable_context = (project_context or "").strip()
    if not durable_context:
        return record_projection("")
    return record_projection(
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
    # The current instruction is appended below exactly once. Durable memory
    # owns cross-Run history; it must not also render the current user message
    # as a synthetic history section.
    context = _build_single_agent_context(
        task_lock, project_context, current_user_prompt=""
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
        return sse_json("write_file", write_file_event_payload(item))
    if item.action == Action.ask:
        return sse_json("ask", item.data)
    if item.action == Action.notice:
        return sse_json("notice", notice_event_payload(item))
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
    summarize_task: TaskSummaryCallback | None = None,
):
    pause_event = asyncio.Event()
    pause_event.set()
    agent = None
    agent_run_id: str | None = None
    agent_runtime_key: tuple[str | None, str, str | None] | None = None
    running_turn: asyncio.Task[tuple[str, int]] | None = None
    running_summary: asyncio.Task[str] | None = None
    summary_task_id: str | None = None
    summary_fallback_content = ""
    pending_turn_result: tuple[str, int] | None = None
    current_task_id = options.task_id

    def cancel_running_summary() -> None:
        nonlocal running_summary, summary_task_id, summary_fallback_content
        if running_summary is not None and not running_summary.done():
            running_summary.cancel()
        running_summary = None
        summary_task_id = None
        summary_fallback_content = ""

    def project_summary_payload(summary: str, task_id: str) -> dict[str, str]:
        project_name, separator, project_summary = summary.partition("|")
        project_name = project_name.strip()
        project_summary = project_summary.strip() if separator else ""
        return {
            "project_id": options.project_id,
            "task_id": task_id,
            "summary_task": summary,
            "project_name": project_name,
            "project_summary": project_summary,
        }

    async def ensure_agent(task_id: str):
        nonlocal agent, agent_run_id, agent_runtime_key
        current_environment_spec_id = getattr(
            task_lock,
            "environment_spec_id",
            None,
        )
        current_runtime_key = (
            current_environment_spec_id,
            get_working_directory(options, task_lock),
            getattr(task_lock, "permission_profile_revision", None),
        )
        if agent is not None and agent_runtime_key != current_runtime_key:
            await _dispose_stale_agent_runtime(
                agent,
                task_lock,
                task_id=task_id,
            )
            agent = None
            agent_run_id = None
            agent_runtime_key = None
        if agent is None:
            agent = await single_agent(
                options,
                task_id=task_id,
                hands=hands,
                pause_event=pause_event,
                runtime_environment=getattr(
                    task_lock,
                    "resolved_runtime_environment",
                    None,
                ),
            )
            agent_run_id = task_id
            agent_runtime_key = current_runtime_key
        elif agent_run_id != task_id:
            await _reset_agent_for_run(agent, task_id=task_id)
            agent_run_id = task_id
        observable_todo = getattr(agent, "_observable_todo_toolkit", None)
        if observable_todo is not None:
            observable_todo.bind_run(task_id, agent_id=agent.agent_id)
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
            if pending_turn_result is not None and running_summary is None:
                final_result, total_tokens = pending_turn_result
                pending_turn_result = None
                task_lock.status = Status.done
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

            wait_for = {pending_queue_get}
            if running_turn is not None:
                wait_for.add(running_turn)
            if running_summary is not None:
                wait_for.add(running_summary)

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
                    if not await activate_improve_admission(
                        task_lock,
                        item,
                        project_id=options.project_id,
                        logger=logger,
                    ):
                        continue
                    if item.new_task_id:
                        current_task_id = item.new_task_id
                        set_current_task_id(
                            options.project_id, current_task_id
                        )

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
                    if summarize_task is not None:
                        cancel_running_summary()
                        summary_task_id = current_task_id
                        summary_fallback_content = item.data.question
                        running_summary = asyncio.create_task(
                            summarize_task(
                                item.data.question,
                                current_task_id,
                            )
                        )
                        task_lock.add_background_task(running_summary)
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
                    cancel_running_summary()
                    pending_turn_result = None
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
                    from app.service.run_cancellation import (
                        cancel_current_turn_durable,
                    )

                    await cancel_current_turn_durable(task_lock)
                    _finalize_memory_for_turn(
                        task_lock,
                        state="cancelled",
                        final_result=stop_message,
                    )
                    yield sse_json("end", stop_message)
                    continue

                if item.action == Action.stop:
                    pause_event.clear()
                    cancel_running_summary()
                    pending_turn_result = None
                    if agent is not None and getattr(
                        agent, "stop_event", None
                    ):
                        agent.stop_event.set()
                    if running_turn is not None and not running_turn.done():
                        running_turn.cancel()
                    from app.service.run_cancellation import (
                        cancel_current_turn_durable,
                    )

                    await cancel_current_turn_durable(task_lock)
                    await delete_task_lock(task_lock.id)
                    break

                payload = _action_to_sse(item)
                if payload is not None:
                    if item.action == Action.budget_not_enough:
                        pause_event.clear()
                        task_lock.status = Status.confirming
                    yield payload
                continue

            if running_summary is not None and running_summary in done:
                completed_summary = running_summary
                completed_task_id = summary_task_id or current_task_id
                try:
                    summary = completed_summary.result()
                except asyncio.CancelledError:
                    running_summary = None
                    summary_task_id = None
                    summary_fallback_content = ""
                    continue
                except Exception:
                    logger.exception(
                        "Single Agent project metadata generation failed",
                        extra={
                            "project_id": options.project_id,
                            "task_id": completed_task_id,
                        },
                    )
                    fallback = " ".join(summary_fallback_content.split())
                    summary = f"Task|{fallback}"

                task_lock.summary_generated = True
                task_lock.summary_task_content = summary
                running_summary = None
                summary_task_id = None
                summary_fallback_content = ""
                yield sse_json(
                    "project_metadata",
                    project_summary_payload(summary, completed_task_id),
                )
                continue

            if running_turn is not None and running_turn in done:
                try:
                    final_result, total_tokens = running_turn.result()
                except asyncio.CancelledError:
                    final_result = "<summary>Task paused</summary>Task paused"
                    total_tokens = 0
                except Exception as e:
                    retryable = _is_retryable_turn_error(e)
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
                        task_lock,
                        state="interrupted" if retryable else "failed",
                        error=str(e),
                    )
                    yield sse_json(
                        "error",
                        {
                            "message": str(e),
                            "retryable": retryable,
                            "reason": (
                                "model_transport_error" if retryable else None
                            ),
                        },
                    )
                    running_turn = None
                    cancel_running_summary()
                    pending_turn_result = None
                    try:
                        await delete_task_lock(task_lock.id)
                    except Exception:
                        # Cleanup failure must not downgrade a retryable model
                        # interruption into a non-resumable execution failure.
                        logger.exception(
                            "Failed to clean task lock after turn error",
                            extra={"task_id": task_lock.id},
                        )
                    if retryable:
                        raise RunInterruptedError(
                            str(e), reason="model_transport_error"
                        ) from e
                    raise

                running_turn = None
                if running_summary is not None:
                    pending_turn_result = (final_result, total_tokens)
                    continue

                task_lock.status = Status.done
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
        cancel_running_summary()
        # If the loop exits without a clean done/failed/cancelled end-of-turn,
        # project it as interrupted. Only an explicit cancel may produce the
        # cancelled state; transport/process teardown is resumable. The
        # `_memory_finalized_runs` set on task_lock makes this idempotent:
        # a prior done/failed write wins, this only catches the unfinished
        # case.
        _finalize_memory_for_turn(task_lock, state="interrupted")
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
