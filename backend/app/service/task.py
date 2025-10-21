from typing_extensions import Any, Literal, TypedDict
from typing import List, Dict, Optional
from pydantic import BaseModel
from app.exception.exception import ProgramException
from app.model.chat import McpServers, Status, SupplementChat, Chat, UpdateData
import asyncio
from enum import Enum
from camel.tasks import Task
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta
import weakref
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("task_service")


class Action(str, Enum):
    improve = "improve"  # user -> backend
    update_task = "update_task"  # user -> backend
    task_state = "task_state"  # backend -> user
    new_task_state = "new_task_state"  # backend -> user
    start = "start"  # user -> backend
    create_agent = "create_agent"  # backend -> user
    activate_agent = "activate_agent"  # backend -> user
    deactivate_agent = "deactivate_agent"  # backend -> user
    assign_task = "assign_task"  # backend -> user
    activate_toolkit = "activate_toolkit"  # backend -> user
    deactivate_toolkit = "deactivate_toolkit"  # backend -> user
    write_file = "write_file"  # backend -> user
    ask = "ask"  # backend -> user
    notice = "notice"  # backend -> user
    search_mcp = "search_mcp"  # backend -> user
    install_mcp = "install_mcp"  # backend -> user
    terminal = "terminal"  # backend -> user
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


class ActionImproveData(BaseModel):
    action: Literal[Action.improve] = Action.improve
    data: str


class ActionStartData(BaseModel):
    action: Literal[Action.start] = Action.start


class ActionUpdateTaskData(BaseModel):
    action: Literal[Action.update_task] = Action.update_task
    data: UpdateData


class ActionTaskStateData(BaseModel):
    action: Literal[Action.task_state] = Action.task_state
    data: dict[Literal["task_id", "content", "state", "result", "failure_count"], str | int]

class ActionNewTaskStateData(BaseModel):
    action: Literal[Action.new_task_state] = Action.new_task_state
    data: dict[Literal["task_id", "content", "state", "result", "failure_count"], str | int]


class ActionAskData(BaseModel):
    action: Literal[Action.ask] = Action.ask
    data: dict[Literal["question", "agent"], str]


class AgentDataDict(TypedDict):
    agent_name: str
    agent_id: str
    tools: list[str]


class ActionCreateAgentData(BaseModel):
    action: Literal[Action.create_agent] = Action.create_agent
    data: AgentDataDict


class ActionActivateAgentData(BaseModel):
    action: Literal[Action.activate_agent] = Action.activate_agent
    data: dict[Literal["agent_name", "process_task_id", "agent_id", "message"], str]


class DataDict(TypedDict):
    agent_name: str
    agent_id: str
    process_task_id: str
    message: str
    tokens: int


class ActionDeactivateAgentData(BaseModel):
    action: Literal[Action.deactivate_agent] = Action.deactivate_agent
    data: DataDict


class ActionAssignTaskData(BaseModel):
    action: Literal[Action.assign_task] = Action.assign_task
    data: dict[Literal["assignee_id", "task_id", "content", "state", "failure_count"], str | int]


class ActionActivateToolkitData(BaseModel):
    action: Literal[Action.activate_toolkit] = Action.activate_toolkit
    data: dict[
        Literal["agent_name", "toolkit_name", "process_task_id", "method_name", "message"],
        str,
    ]


class ActionDeactivateToolkitData(BaseModel):
    action: Literal[Action.deactivate_toolkit] = Action.deactivate_toolkit
    data: dict[
        Literal["agent_name", "toolkit_name", "process_task_id", "method_name", "message"],
        str,
    ]


class ActionWriteFileData(BaseModel):
    action: Literal[Action.write_file] = Action.write_file
    process_task_id: str
    data: str


class ActionNoticeData(BaseModel):
    action: Literal[Action.notice] = Action.notice
    process_task_id: str
    data: str


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


class ActionStopData(BaseModel):
    action: Literal[Action.stop] = Action.stop


class ActionEndData(BaseModel):
    action: Literal[Action.end] = Action.end


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
    | ActionAssignTaskData
    | ActionActivateToolkitData
    | ActionDeactivateToolkitData
    | ActionWriteFileData
    | ActionNoticeData
    | ActionSearchMcpData
    | ActionInstallMcpData
    | ActionTerminalData
    | ActionStopData
    | ActionEndData
    | ActionSupplementData
    | ActionTakeControl
    | ActionNewAgent
    | ActionBudgetNotEnough
    | ActionAddTaskData
    | ActionRemoveTaskData
    | ActionSkipTaskData
)


class Agents(str, Enum):
    task_agent = "task_agent"
    coordinator_agent = "coordinator_agent"
    new_worker_agent = "new_worker_agent"
    developer_agent = "developer_agent"
    search_agent = "search_agent"
    document_agent = "document_agent"
    multi_modal_agent = "multi_modal_agent"
    social_medium_agent = "social_medium_agent"
    mcp_agent = "mcp_agent"


class TaskLock:
    id: str
    status: Status = Status.confirming
    active_agent: str = ""
    mcp: list[str]
    queue: asyncio.Queue[ActionData]
    """Queue monitoring for SSE response"""
    human_input: dict[str, asyncio.Queue[str]]
    """After receiving user's reply, put the reply into the corresponding agent's queue"""
    created_at: datetime
    last_accessed: datetime
    background_tasks: set[asyncio.Task]
    """Track all background tasks for cleanup"""

    # Context management fields
    conversation_history: List[Dict[str, Any]]
    """Store conversation history for context"""
    last_task_result: str
    """Store the last task execution result"""
    question_agent: Optional[Any]
    """Persistent question confirmation agent"""
    summary_generated: bool
    """Track if summary has been generated for this project"""

    def __init__(self, id: str, queue: asyncio.Queue, human_input: dict) -> None:
        self.id = id
        self.queue = queue
        self.human_input = human_input
        self.created_at = datetime.now()
        self.last_accessed = datetime.now()
        self.background_tasks = set()

        # Initialize context management fields
        self.conversation_history = []
        self.last_task_result = ""
        self.last_task_summary = ""
        self.question_agent = None

    async def put_queue(self, data: ActionData):
        self.last_accessed = datetime.now()
        await self.queue.put(data)

    async def get_queue(self):
        self.last_accessed = datetime.now()
        return await self.queue.get()

    async def put_human_input(self, agent: str, data: Any = None):
        await self.human_input[agent].put(data)

    async def get_human_input(self, agent: str):
        return await self.human_input[agent].get()

    def add_human_input_listen(self, agent: str):
        self.human_input[agent] = asyncio.Queue(1)

    def add_background_task(self, task: asyncio.Task) -> None:
        r"""Add a task to track and clean up weak references"""
        self.background_tasks.add(task)
        task.add_done_callback(lambda t: self.background_tasks.discard(t))

    async def cleanup(self):
        r"""Cancel all background tasks and clean up resources"""
        for task in list(self.background_tasks):
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self.background_tasks.clear()

    def add_conversation(self, role: str, content: str | dict):
        """Add a conversation entry to history"""
        self.conversation_history.append({
            'role': role,
            'content': content,
            'timestamp': datetime.now().isoformat()
        })

    def get_recent_context(self, max_entries: int = None) -> str:
        """Get recent conversation context as a formatted string"""
        if not self.conversation_history:
            return ""

        context = "=== Recent Conversation ===\n"
        history_to_use = self.conversation_history if max_entries is None else self.conversation_history[-max_entries:]
        for entry in history_to_use:
            context += f"{entry['role']}: {entry['content']}\n"
        return context


task_locks = dict[str, TaskLock]()
# Cleanup task for removing stale task locks
_cleanup_task: asyncio.Task | None = None
task_index: dict[str, weakref.ref[Task]] = {}


def get_task_lock(id: str) -> TaskLock:
    if id not in task_locks:
        raise ProgramException("Task not found")
    return task_locks[id]


def get_task_lock_if_exists(id: str) -> TaskLock | None:
    """Get task lock if it exists, otherwise return None"""
    return task_locks.get(id)


def create_task_lock(id: str) -> TaskLock:
    if id in task_locks:
        raise ProgramException("Task already exists")
    task_locks[id] = TaskLock(id=id, queue=asyncio.Queue(), human_input={})

    # Start cleanup task if not running
    # global _cleanup_task
    # if _cleanup_task is None or _cleanup_task.done():
    #     _cleanup_task = asyncio.create_task(_periodic_cleanup())

    return task_locks[id]


def get_or_create_task_lock(id: str) -> TaskLock:
    """Get existing task lock or create a new one if it doesn't exist"""
    if id in task_locks:
        return task_locks[id]
    return create_task_lock(id)


async def delete_task_lock(id: str):
    if id not in task_locks:
        raise ProgramException("Task not found")

    # Clean up background tasks before deletion
    task_lock = task_locks[id]
    await task_lock.cleanup()

    del task_locks[id]
    logger.debug(f"Deleted task lock {id}, remaining locks: {len(task_locks)}")


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
            stale_timeout = timedelta(hours=2)  # Consider tasks stale after 2 hours

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
