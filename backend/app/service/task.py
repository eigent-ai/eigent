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
import time
import weakref
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Literal

from camel.tasks import Task
from pydantic import BaseModel
from typing_extensions import TypedDict

from app.exception.exception import ProgramException
from app.model.chat import (
    AgentModelConfig,
    McpServers,
    SupplementChat,
    UpdateData,
)
from app.model.enums import Status
from app.run_context import RunContext

logger = logging.getLogger("task_service")

TASK_LOCK_CLEANUP_SENTINEL = "__task_lock_cleanup__"


class Action(str, Enum):
    improve = "improve"  # user -> backend
    update_task = "update_task"  # user -> backend
    task_state = "task_state"  # backend -> user
    new_task_state = "new_task_state"  # backend -> user
    # backend -> user (streaming decomposition)
    decompose_progress = "decompose_progress"
    decompose_text = "decompose_text"  # backend -> user (raw streaming text)
    start = "start"  # user -> backend
    create_agent = "create_agent"  # backend -> user
    activate_agent = "activate_agent"  # backend -> user
    deactivate_agent = "deactivate_agent"  # backend -> user
    request_usage = "request_usage"  # backend -> user
    assign_task = "assign_task"  # backend -> user
    activate_toolkit = "activate_toolkit"  # backend -> user
    deactivate_toolkit = "deactivate_toolkit"  # backend -> user
    write_file = "write_file"  # backend -> user
    ask = "ask"  # backend -> user
    notice = "notice"  # backend -> user
    search_mcp = "search_mcp"  # backend -> user
    install_mcp = "install_mcp"  # backend -> user
    terminal = "terminal"  # backend -> user
    todo_state = "todo_state"  # backend -> user
    end = "end"  # backend -> user
    stop = "stop"  # user -> backend
    supplement = "supplement"  # user -> backend
    pause = "pause"  # user -> backend  user take control
    resume = "resume"  # user -> backend  user take control
    new_agent = "new_agent"  # user -> backend
    budget_not_enough = "budget_not_enough"  # backend -> user
    add_task = "add_task"  # user -> backend
    remove_task = "remove_task"  # user -> backend
    skip_task = "skip_task"  # user -> backend
    timeout = "timeout"  # backend -> user (task timeout error)


class ImprovePayload(BaseModel):
    """User input payload for an improve action."""

    question: str
    attaches: list[str] = []
    project_context: str | None = None


class ActionImproveData(BaseModel):
    action: Literal[Action.improve] = Action.improve
    data: ImprovePayload
    new_task_id: str | None = None
    request_id: str | None = None
    run_id: str | None = None
    attempt_id: str | None = None


class ActionStartData(BaseModel):
    action: Literal[Action.start] = Action.start


class ActionUpdateTaskData(BaseModel):
    action: Literal[Action.update_task] = Action.update_task
    data: UpdateData


class ActionTaskStateData(BaseModel):
    action: Literal[Action.task_state] = Action.task_state
    data: dict[
        Literal["task_id", "content", "state", "result", "failure_count"],
        str | int,
    ]


class ActionDecomposeProgressData(BaseModel):
    action: Literal[Action.decompose_progress] = Action.decompose_progress
    data: dict


class ActionDecomposeTextData(BaseModel):
    action: Literal[Action.decompose_text] = Action.decompose_text
    data: dict


class ActionNewTaskStateData(BaseModel):
    action: Literal[Action.new_task_state] = Action.new_task_state
    data: dict[
        Literal["task_id", "content", "state", "result", "failure_count"],
        str | int,
    ]


class ActionAskData(BaseModel):
    action: Literal[Action.ask] = Action.ask
    data: dict[str, Any]


class AgentDataDict(TypedDict):
    agent_name: str
    agent_id: str
    tools: list[str]


class ActionCreateAgentData(BaseModel):
    action: Literal[Action.create_agent] = Action.create_agent
    data: AgentDataDict


class ActionActivateAgentData(BaseModel):
    action: Literal[Action.activate_agent] = Action.activate_agent
    data: dict[
        Literal[
            "agent_name",
            "process_task_id",
            "agent_id",
            "agent_turn_id",
            "message",
        ],
        str,
    ]


class DataDict(TypedDict):
    agent_name: str
    agent_id: str
    agent_turn_id: str
    process_task_id: str
    message: str
    status: str
    tokens: int


class ActionDeactivateAgentData(BaseModel):
    action: Literal[Action.deactivate_agent] = Action.deactivate_agent
    data: DataDict


class RequestUsageDataDict(TypedDict):
    agent_name: str
    agent_id: str
    process_task_id: str
    tokens: int
    request_index: int
    response_id: str
    step_total_tokens: int


class ActionRequestUsageData(BaseModel):
    action: Literal[Action.request_usage] = Action.request_usage
    data: RequestUsageDataDict


class ActionAssignTaskData(BaseModel):
    action: Literal[Action.assign_task] = Action.assign_task
    data: dict[
        Literal["assignee_id", "task_id", "content", "state", "failure_count"],
        str | int,
    ]


class ActionActivateToolkitData(BaseModel):
    action: Literal[Action.activate_toolkit] = Action.activate_toolkit
    data: dict[
        Literal[
            "agent_name",
            "toolkit_name",
            "process_task_id",
            "method_name",
            "message",
            "tool_call_id",
        ],
        str,
    ]


class ActionDeactivateToolkitData(BaseModel):
    action: Literal[Action.deactivate_toolkit] = Action.deactivate_toolkit
    data: dict[
        Literal[
            "agent_name",
            "toolkit_name",
            "process_task_id",
            "method_name",
            "message",
            "tool_call_id",
        ],
        str,
    ]


class ActionWriteFileData(BaseModel):
    action: Literal[Action.write_file] = Action.write_file
    process_task_id: str
    data: str
    relative_path: str | None = None


def write_file_event_payload(item: ActionWriteFileData) -> dict[str, str]:
    payload = {
        "file_path": item.data,
        "process_task_id": item.process_task_id,
    }
    if item.relative_path:
        payload["relative_path"] = item.relative_path
    return payload


class ActionNoticeData(BaseModel):
    action: Literal[Action.notice] = Action.notice
    process_task_id: str
    data: str
    title: str | None = None
    notice_id: str | None = None
    purpose: Literal["progress", "result", "decision", "status"] = "progress"
    severity: Literal["info", "success", "warning", "error"] = "info"
    tool_call_id: str | None = None


def notice_event_payload(item: ActionNoticeData) -> dict[str, str]:
    """Return typed notice data while retaining legacy field names."""

    payload = {
        "notice": item.data,
        "content": item.data,
        "message_description": item.data,
        "process_task_id": item.process_task_id,
        "purpose": item.purpose,
        "severity": item.severity,
    }
    if item.title:
        payload["title"] = item.title
        payload["message_title"] = item.title
    if item.notice_id:
        payload["notice_id"] = item.notice_id
    if item.tool_call_id:
        payload["tool_call_id"] = item.tool_call_id
    return payload


class ActionSearchMcpData(BaseModel):
    action: Literal[Action.search_mcp] = Action.search_mcp
    data: Any


class ActionInstallMcpData(BaseModel):
    action: Literal[Action.install_mcp] = Action.install_mcp
    data: McpServers


class ActionTerminalData(BaseModel):
    action: Literal[Action.terminal] = Action.terminal
    process_task_id: str
    data: str


class ActionTodoStateData(BaseModel):
    action: Literal[Action.todo_state] = Action.todo_state
    data: dict


class ActionStopData(BaseModel):
    action: Literal[Action.stop] = Action.stop


class ActionEndData(BaseModel):
    action: Literal[Action.end] = Action.end


class ActionTimeoutData(BaseModel):
    action: Literal[Action.timeout] = Action.timeout
    data: dict[
        Literal[
            "message",
            "in_flight_tasks",
            "pending_tasks",
            "timeout_seconds",
            "timeout_scope",
        ],
        str | int | float,
    ]


class ActionSupplementData(BaseModel):
    action: Literal[Action.supplement] = Action.supplement
    data: SupplementChat


class ActionTakeControl(BaseModel):
    action: Literal[Action.pause, Action.resume]


class ActionNewAgent(BaseModel):
    action: Literal[Action.new_agent] = Action.new_agent
    name: str
    description: str
    tools: list[str]
    mcp_tools: McpServers | None
    custom_model_config: "AgentModelConfig | None" = None


class ActionBudgetNotEnough(BaseModel):
    action: Literal[Action.budget_not_enough] = Action.budget_not_enough


class ActionAddTaskData(BaseModel):
    action: Literal[Action.add_task] = Action.add_task
    content: str
    project_id: str | None = None
    task_id: str | None = None
    additional_info: dict | None = None
    insert_position: int = -1


class ActionRemoveTaskData(BaseModel):
    action: Literal[Action.remove_task] = Action.remove_task
    task_id: str
    project_id: str


class ActionSkipTaskData(BaseModel):
    action: Literal[Action.skip_task] = Action.skip_task
    project_id: str


ActionData = (
    ActionImproveData
    | ActionStartData
    | ActionUpdateTaskData
    | ActionTaskStateData
    | ActionAskData
    | ActionCreateAgentData
    | ActionActivateAgentData
    | ActionDeactivateAgentData
    | ActionRequestUsageData
    | ActionAssignTaskData
    | ActionActivateToolkitData
    | ActionDeactivateToolkitData
    | ActionWriteFileData
    | ActionNoticeData
    | ActionSearchMcpData
    | ActionInstallMcpData
    | ActionTerminalData
    | ActionTodoStateData
    | ActionStopData
    | ActionEndData
    | ActionTimeoutData
    | ActionSupplementData
    | ActionTakeControl
    | ActionNewAgent
    | ActionBudgetNotEnough
    | ActionAddTaskData
    | ActionRemoveTaskData
    | ActionSkipTaskData
    | ActionDecomposeTextData
    | ActionDecomposeProgressData
)


class Agents(str, Enum):
    task_agent = "task_agent"
    coordinator_agent = "coordinator_agent"
    new_worker_agent = "new_worker_agent"
    developer_agent = "developer_agent"
    browser_agent = "browser_agent"
    document_agent = "document_agent"
    multi_modal_agent = "multi_modal_agent"
    social_media_agent = "social_media_agent"
    mcp_agent = "mcp_agent"
    single_agent = "single_agent"


class TaskLock:
    id: str
    status: Status = Status.confirming
    active_agent: str = ""
    mcp: list[str]
    queue: asyncio.Queue[ActionData]
    """Queue monitoring for SSE response"""
    human_input: dict[str, asyncio.Queue[str]]
    """After receiving user's reply, put the reply into the
    corresponding agent's queue"""
    human_input_waiters: dict[str, list[asyncio.Future[Any]]]
    """Live human-input waits. Replies are delivered directly to one waiter
    so stale or duplicate HTTP requests cannot leak into a future question."""
    created_at: datetime
    last_accessed: datetime
    execution_progress_revision: int
    """Monotonic producer-side progress marker for long-running execution."""
    _active_execution_pause_depth: int
    _active_execution_pause_started_at: float | None
    _active_execution_paused_seconds: float
    background_tasks: set[asyncio.Task]
    """Track all background tasks for cleanup"""
    registered_toolkits: list[Any]
    """Track toolkits for cleanup (e.g., TerminalToolkit venvs)"""

    # Context management fields
    conversation_history: list[dict[str, Any]]
    """Store conversation history for context"""
    agent_memory_history: list[dict[str, Any]]
    """Serialized ChatAgent memory snapshots for session continuity"""
    memory_summary: str
    """Compressed summary of older serialized agent memory"""
    last_task_summary: str
    """Store the last generated task summary"""
    question_agent: Any | None
    """Persistent question confirmation agent"""
    summary_generated: bool
    """Track if summary has been generated for this project"""
    current_task_id: str | None
    """Current task ID to be used in SSE responses"""
    run_context: RunContext | None
    """Current task-scoped runtime context for this Project."""
    user_id: str | int | None
    """Canonical user id when provided by the control plane."""
    working_directory: str | None
    """Resolved source/work directory for the current Run."""
    task_output_root: str | None
    """Resolved artifact/output directory for the current Run."""
    task_start_time: float | None
    """Timestamp captured when the current Run directories were frozen."""
    email: str | None
    """Legacy/display user email associated with the current Run."""
    project_id: str | None
    """Project id associated with the current Run."""
    space_id: str | None
    """Space id associated with the current Run."""
    workdir_mode: str | None
    """Actual workdir mode used by the current Run."""
    base_snapshot_id: str | None
    """Project workdir baseline snapshot id, when available."""
    new_folder_path: Any | None
    """Legacy cleanup marker for default output directories."""
    memory_service: Any | None
    """MemoryService bound for this Run; used by single_agent_service for on_run_end."""
    local_history_degraded: bool
    """True after a Phase 1 RunJournal write failure; never auto-cleared."""
    local_history_last_error: str | None
    """Latest local history persistence error for diagnostics."""
    _memory_finalized_runs: set[str]
    """Run ids whose durable memory lifecycle has already been finalized."""
    processed_improve_request_ids: set[str]
    """In-process dedupe for durable admission retries that enqueue twice."""
    environment_admission_template: Any | None
    resolved_runtime_environment: Any | None
    """Secret-free pinned Bundle runtime declaration for the live Attempt."""
    runtime_session_mode: str | None
    """Secret-free execution mode currently bound to this Project runtime."""
    """Secret-free template used to bind follow-up Runs in this process."""
    environment_spec_id: str | None
    """Immutable EnvironmentSpec currently driving model/tool assembly."""
    thinking_effort_requested: str | None
    thinking_effort_effective: str | None
    provider_effort_parameter_name: str | None
    provider_effort_parameter_value: str | None
    provider_capability_revision: str | None

    def __init__(
        self, id: str, queue: asyncio.Queue, human_input: dict
    ) -> None:
        self.id = id
        self.queue = queue
        self.human_input = human_input
        self.human_input_waiters = {}
        self.created_at = datetime.now()
        self.last_accessed = datetime.now()
        self.execution_progress_revision = 0
        self._active_execution_pause_depth = 0
        self._active_execution_pause_started_at = None
        self._active_execution_paused_seconds = 0.0
        self.background_tasks = set()
        self.registered_toolkits = []

        # Initialize context management fields
        self.conversation_history = []
        self.agent_memory_history = []
        self.memory_summary = ""
        self.last_task_summary = ""
        self.question_agent = None
        self.summary_generated = False
        self.current_task_id = None
        self.run_context = None
        self.user_id = None
        self.working_directory = None
        self.task_output_root = None
        self.task_start_time = None
        self.email = None
        self.project_id = None
        self.space_id = None
        self.workdir_mode = None
        self.base_snapshot_id = None
        self.new_folder_path = None
        self.memory_service = None
        self.processed_improve_request_ids = set()
        self.environment_admission_template = None
        self.resolved_runtime_environment = None
        self.runtime_session_mode = None
        self.environment_spec_id = None
        self.thinking_effort_requested = None
        self.thinking_effort_effective = None
        self.provider_effort_parameter_name = None
        self.provider_effort_parameter_value = None
        self.provider_capability_revision = None
        self.local_history_degraded = False
        self.local_history_last_error = None
        self._memory_finalized_runs = set()

        logger.info(
            "Task lock initialized",
            extra={"task_id": id, "created_at": self.created_at.isoformat()},
        )

    async def put_queue(self, data: ActionData):
        self.last_accessed = datetime.now()
        self.execution_progress_revision += 1
        logger.debug(
            "Adding item to task queue",
            extra={"task_id": self.id, "action": data.action},
        )
        await self.queue.put(data)

    def pause_active_execution_budget(self) -> None:
        """Start excluding a nested user-owned wait from runtime budgets."""

        self._active_execution_pause_depth += 1
        if self._active_execution_pause_depth == 1:
            self._active_execution_pause_started_at = time.monotonic()

    def resume_active_execution_budget(self) -> None:
        """Finish one nested exclusion without losing earlier pause time."""

        if self._active_execution_pause_depth <= 0:
            raise RuntimeError("active execution budget is not paused")
        self._active_execution_pause_depth -= 1
        if self._active_execution_pause_depth != 0:
            return
        if self._active_execution_pause_started_at is not None:
            self._active_execution_paused_seconds += max(
                0.0,
                time.monotonic() - self._active_execution_pause_started_at,
            )
        self._active_execution_pause_started_at = None

    @property
    def active_execution_budget_paused(self) -> bool:
        return self._active_execution_pause_depth > 0

    def active_execution_paused_seconds(self) -> float:
        """Return cumulative pause time, including an in-progress wait."""

        total = self._active_execution_paused_seconds
        if self._active_execution_pause_started_at is not None:
            total += max(
                0.0,
                time.monotonic() - self._active_execution_pause_started_at,
            )
        return total

    def mark_local_history_degraded(self, error: str) -> None:
        """Record a non-fatal Phase 1 RunJournal persistence failure."""

        first_failure = not self.local_history_degraded
        self.local_history_degraded = True
        self.local_history_last_error = error
        logger.warning(
            "Task local history is degraded",
            extra={
                "task_id": self.id,
                "first_failure": first_failure,
                "journal_error": error,
            },
        )

    async def get_queue(self):
        self.last_accessed = datetime.now()
        logger.debug(
            "Getting item from task queue", extra={"task_id": self.id}
        )
        return await self.queue.get()

    async def put_human_input(self, agent: str, data: Any = None):
        logger.debug(
            "Adding human input",
            extra={
                "task_id": self.id,
                "agent": agent,
                "has_data": data is not None,
            },
        )
        if agent not in self.human_input:
            raise KeyError(agent)

        waiters = self.human_input_waiters.get(agent, [])
        while waiters:
            waiter = waiters.pop(0)
            if waiter.done():
                continue
            waiter.set_result(data)
            return

        raise KeyError(agent)

    async def get_human_input(self, agent: str):
        logger.debug(
            "Getting human input", extra={"task_id": self.id, "agent": agent}
        )
        if agent not in self.human_input:
            raise KeyError(agent)

        waiter = asyncio.get_running_loop().create_future()
        waiters = self.human_input_waiters.setdefault(agent, [])
        waiters.append(waiter)
        try:
            return await waiter
        finally:
            if waiter in waiters:
                waiters.remove(waiter)

    def add_human_input_listen(self, agent: str):
        logger.debug(
            "Adding human input listener",
            extra={"task_id": self.id, "agent": agent},
        )
        # Toolkit recreation must not replace a queue while an earlier
        # instance is already waiting for the user's answer.
        self.human_input.setdefault(agent, asyncio.Queue(1))
        self.human_input_waiters.setdefault(agent, [])

    def add_background_task(self, task: asyncio.Task) -> None:
        r"""Add a task to track and clean up weak references"""
        logger.debug(
            "Adding background task",
            extra={
                "task_id": self.id,
                "background_tasks_count": len(self.background_tasks),
            },
        )
        self.background_tasks.add(task)
        task.add_done_callback(lambda t: self.background_tasks.discard(t))

    async def cleanup(self):
        r"""Cancel all background tasks and clean up resources"""
        logger.info(
            "Starting task lock cleanup",
            extra={
                "task_id": self.id,
                "background_tasks_count": len(self.background_tasks),
            },
        )
        for task in list(self.background_tasks):
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self.background_tasks.clear()

        # Unblock every agent currently waiting on human input so shutdown can
        # proceed. Future-based delivery avoids leaving cleanup sentinels in a
        # queue where a later question could consume them.
        for waiters in self.human_input_waiters.values():
            for waiter in list(waiters):
                if not waiter.done():
                    waiter.set_result(TASK_LOCK_CLEANUP_SENTINEL)
            waiters.clear()

        # Clean up registered toolkits (e.g., remove TerminalToolkit venvs)
        for toolkit in self.registered_toolkits:
            try:
                if hasattr(toolkit, "cleanup"):
                    toolkit.cleanup()
                    logger.info(
                        "Toolkit cleanup completed",
                        extra={
                            "task_id": self.id,
                            "toolkit": type(toolkit).__name__,
                        },
                    )
            except Exception as e:
                logger.warning(
                    f"Failed to cleanup toolkit: {e}",
                    extra={
                        "task_id": self.id,
                        "toolkit": type(toolkit).__name__,
                    },
                )
        self.registered_toolkits.clear()

        logger.info("Task lock cleanup completed", extra={"task_id": self.id})

    def register_toolkit(self, toolkit: Any) -> None:
        """Register a toolkit for cleanup when task ends.

        This is used to track toolkits that create resources (like venvs) that
        should be cleaned up when the task is complete.

        Note: Duplicate registrations of the same toolkit instance are ignored.
        """
        # Prevent duplicate registration of the same toolkit instance
        if any(t is toolkit for t in self.registered_toolkits):
            logger.debug(
                "Toolkit already registered, skipping",
                extra={"task_id": self.id, "toolkit": type(toolkit).__name__},
            )
            return

        self.registered_toolkits.append(toolkit)
        logger.debug(
            "Toolkit registered for cleanup",
            extra={
                "task_id": self.id,
                "toolkit": type(toolkit).__name__,
                "total_registered": len(self.registered_toolkits),
            },
        )

    def add_conversation(self, role: str, content: str | dict):
        """Add a conversation entry to history"""
        logger.debug(
            "Adding conversation entry",
            extra={
                "task_id": self.id,
                "role": role,
                "content_length": len(str(content)),
            },
        )
        self.conversation_history.append(
            {
                "role": role,
                "content": content,
                "timestamp": datetime.now().isoformat(),
            }
        )

    def add_agent_memory_snapshot(self, snapshot: dict[str, Any]) -> None:
        logger.debug(
            "Adding agent memory snapshot",
            extra={
                "task_id": self.id,
                "scope": snapshot.get("scope"),
                "agent_name": snapshot.get("agent_name"),
                "message_count": len(snapshot.get("messages", [])),
            },
        )
        self.agent_memory_history.append(snapshot)

    def get_recent_context(self, max_entries: int = None) -> str:
        """Get recent conversation context as a formatted string"""
        if not self.conversation_history:
            return ""

        context = "=== Recent Conversation ===\n"
        if max_entries is None:
            history_to_use = self.conversation_history
        else:
            history_to_use = self.conversation_history[-max_entries:]
        for entry in history_to_use:
            context += f"{entry['role']}: {entry['content']}\n"
        return context


task_locks = dict[str, TaskLock]()
# Cleanup task for removing stale task locks
_cleanup_task: asyncio.Task | None = None
task_index: dict[str, weakref.ref[Task]] = {}


def get_task_lock(id: str) -> TaskLock:
    if id not in task_locks:
        logger.error("Task lock not found", extra={"task_id": id})
        raise ProgramException("Task not found")
    logger.debug("Task lock retrieved", extra={"task_id": id})
    return task_locks[id]


def get_task_lock_if_exists(id: str) -> TaskLock | None:
    """Get task lock if it exists, otherwise return None"""
    return task_locks.get(id)


def set_current_task_id(project_id: str, task_id: str) -> None:
    """Set the current task ID for a project's task lock"""
    task_lock = get_task_lock(project_id)
    task_lock.current_task_id = task_id
    logger.info(
        "Updated current task ID",
        extra={"project_id": project_id, "task_id": task_id},
    )


def create_task_lock(id: str) -> TaskLock:
    if id in task_locks:
        logger.warning(
            "Attempting to create task lock that already exists",
            extra={"task_id": id},
        )
        raise ProgramException("Task already exists")

    logger.info("Creating new task lock", extra={"task_id": id})
    task_locks[id] = TaskLock(id=id, queue=asyncio.Queue(), human_input={})

    # Start cleanup task if not running
    # global _cleanup_task
    # if _cleanup_task is None or _cleanup_task.done():
    #     _cleanup_task = asyncio.create_task(_periodic_cleanup())

    logger.info(
        "Task lock created successfully",
        extra={"task_id": id, "total_task_locks": len(task_locks)},
    )
    return task_locks[id]


def get_or_create_task_lock(id: str) -> TaskLock:
    """Get existing task lock or create a new one if it doesn't exist"""
    if id in task_locks:
        logger.debug("Using existing task lock", extra={"task_id": id})
        return task_locks[id]
    logger.info("Task lock not found, creating new one", extra={"task_id": id})
    return create_task_lock(id)


async def delete_task_lock(id: str):
    if id not in task_locks:
        logger.warning(
            "Attempting to delete non-existent task lock",
            extra={"task_id": id},
        )
        raise ProgramException("Task not found")

    # Clean up background tasks before deletion
    task_lock = task_locks[id]
    logger.info(
        "Cleaning up task lock",
        extra={
            "task_id": id,
            "background_tasks": len(task_lock.background_tasks),
        },
    )
    await task_lock.cleanup()

    del task_locks[id]
    logger.info(
        "Task lock deleted successfully",
        extra={"task_id": id, "remaining_task_locks": len(task_locks)},
    )


def get_camel_task(id: str, tasks: list[Task]) -> None | Task:
    if id in task_index:
        task_ref = task_index[id]
        task = task_ref()
        if task is not None:
            return task
        else:
            # Weak reference died, remove from index
            del task_index[id]

    # Fallback to search and rebuild index
    for item in tasks:
        # Add to index
        task_index[item.id] = weakref.ref(item)

        if item.id == id:
            return item
        else:
            task = get_camel_task(id, item.subtasks)
            if task is not None:
                return task
    return None


async def _periodic_cleanup():
    r"""Periodically clean up stale task locks"""
    while True:
        try:
            await asyncio.sleep(300)  # Run every 5 minutes

            current_time = datetime.now()
            stale_timeout = timedelta(
                hours=4
            )  # Consider tasks stale after 4 hours

            stale_ids = []
            for task_id, task_lock in task_locks.items():
                if current_time - task_lock.last_accessed > stale_timeout:
                    stale_ids.append(task_id)

            for task_id in stale_ids:
                logger.warning(f"Cleaning up stale task lock: {task_id}")
                await delete_task_lock(task_id)

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in periodic cleanup: {e}")


process_task = ContextVar[str]("id")


@contextmanager
def set_process_task(process_task_id: str):
    origin = process_task.set(process_task_id)
    try:
        yield
    finally:
        process_task.reset(origin)
