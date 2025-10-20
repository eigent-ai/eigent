import asyncio
from typing import Generator, List
from camel.agents import ChatAgent
from camel.societies.workforce.workforce import (
    Workforce as BaseWorkforce,
    WorkforceState,
    DEFAULT_WORKER_POOL_SIZE,
)
from camel.societies.workforce.task_channel import TaskChannel
from camel.societies.workforce.base import BaseNode
from camel.societies.workforce.utils import TaskAssignResult
from camel.tasks.task import Task, TaskState, validate_task_content
from app.component import code
from app.exception.exception import UserException
from app.utils.agent import ListenChatAgent
from app.service.task import (
    Action,
    ActionAssignTaskData,
    ActionEndData,
    ActionNewTaskStateData,
    ActionTaskStateData,
    get_camel_task,
    get_task_lock,
)
from app.utils.single_agent_worker import SingleAgentWorker
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("workforce")



class Workforce(BaseWorkforce):
    def __init__(
        self,
        api_task_id: str,
        description: str,
        children: List[BaseNode] | None = None,
        coordinator_agent: ChatAgent | None = None,
        task_agent: ChatAgent | None = None,
        new_worker_agent: ChatAgent | None = None,
        graceful_shutdown_timeout: float = 3,
        share_memory: bool = False,
        use_structured_output_handler: bool = True,
    ) -> None:
        self.api_task_id = api_task_id
        super().__init__(
            description=description,
            children=children,
            coordinator_agent=coordinator_agent,
            task_agent=task_agent,
            new_worker_agent=new_worker_agent,
            graceful_shutdown_timeout=graceful_shutdown_timeout,
            share_memory=share_memory,
            use_structured_output_handler=use_structured_output_handler,
        )

    def eigent_make_sub_tasks(self, task: Task, coordinator_context: str = ""):
        """
        Split process_task method to eigent_make_sub_tasks and eigent_start method.

        Args:
            task: The main task to decompose
            coordinator_context: Optional context ONLY for coordinator agent during decomposition.
                                This context will NOT be passed to subtasks or worker agents.
        """

        if not validate_task_content(task.content, task.id):
            task.state = TaskState.FAILED
            task.result = "Task failed: Invalid or empty content provided"
            logger.warning(
                f"Task {task.id} rejected: Invalid or empty content. Content preview: '{task.content[:50]}...'"
            )
            raise UserException(code.error, task.result)

        self.reset()
        self._task = task
        self.set_channel(TaskChannel())
        self._state = WorkforceState.RUNNING
        task.state = TaskState.OPEN

        if coordinator_context:
            original_content = task.content
            task_with_context = coordinator_context
            if coordinator_context:
                task_with_context += "\n=== CURRENT TASK ===\n"
            task_with_context += original_content
            task.content = task_with_context

            subtasks_result = self._decompose_task(task)

            task.content = original_content
        else:
            subtasks_result = self._decompose_task(task)

        # Handle both streaming and non-streaming results
        if isinstance(subtasks_result, Generator):
            # This is a generator (streaming mode)
            subtasks = []
            for new_tasks in subtasks_result:
                subtasks.extend(new_tasks)
        else:
            # This is a regular list (non-streaming mode)
            subtasks = subtasks_result

        return subtasks

    async def eigent_start(self, subtasks: list[Task]):
        """start the workforce"""
        logger.debug(f"start the workforce {subtasks=}")
        self._pending_tasks.extendleft(reversed(subtasks))
        # Save initial snapshot
        self.save_snapshot("Initial task decomposition")

        try:
            await self.start()
        except Exception as e:
            logger.error(f"Error in workforce execution: {e}")
            self._state = WorkforceState.STOPPED
            raise
        finally:
            if self._state != WorkforceState.STOPPED:
                self._state = WorkforceState.IDLE

    async def handle_decompose_append_task(
        self, task: Task, reset: bool = True, coordinator_context: str = ""
    ) -> List[Task]:
        """
        Override to support coordinator_context parameter.
        Handle task decomposition and validation, then append to pending tasks.

        Args:
            task: The task to be processed
            reset: Should trigger workforce reset (Workforce must not be running)
            coordinator_context: Optional context ONLY for coordinator during decomposition

        Returns:
            List[Task]: The decomposed subtasks or the original task
        """
        if not validate_task_content(task.content, task.id):
            task.state = TaskState.FAILED
            task.result = "Task failed: Invalid or empty content provided"
            logger.warning(
                f"Task {task.id} rejected: Invalid or empty content. "
                f"Content preview: '{task.content}'"
            )
            return [task]

        if reset and self._state != WorkforceState.RUNNING:
            self.reset()
            logger.info("Workforce reset before handling task.")

        self._task = task
        task.state = TaskState.FAILED

        if coordinator_context:
            original_content = task.content
            task_with_context = coordinator_context
            if coordinator_context:
                task_with_context += "\n=== CURRENT TASK ===\n"
            task_with_context += original_content
            task.content = task_with_context

            subtasks_result = self._decompose_task(task)

            task.content = original_content
        else:
            subtasks_result = self._decompose_task(task)

        if isinstance(subtasks_result, Generator):
            subtasks = []
            for new_tasks in subtasks_result:
                subtasks.extend(new_tasks)
        else:
            subtasks = subtasks_result

        if subtasks:
            self._pending_tasks.extendleft(reversed(subtasks))
            logger.info(f"Appended {len(subtasks)} subtasks to pending tasks")

        return subtasks if subtasks else [task]

    async def _find_assignee(self, tasks: List[Task]) -> TaskAssignResult:
        # Task assignment phase: send "waiting for execution" notification to the frontend, and send "start execution" notification when the task actually begins execution
        assigned = await super()._find_assignee(tasks)

        task_lock = get_task_lock(self.api_task_id)
        for item in assigned.assignments:
            # DEBUG ▶ Task has been assigned to which worker and its dependencies
            logger.debug(f"[WF] ASSIGN {item.task_id} -> {item.assignee_id} deps={item.dependencies}")
            # The main task itself does not need notification
            if self._task and item.task_id == self._task.id:
                continue
            # Find task content
            task_obj = get_camel_task(item.task_id, tasks)
            if task_obj is None:
                logger.warning(
                    f"[WF] WARN: Task {item.task_id} not found in tasks list during ASSIGN phase. This may indicate a task tree inconsistency."
                )
                content = ""
            else:
                content = task_obj.content
            # Asynchronously send waiting notification
            task = asyncio.create_task(
                task_lock.put_queue(
                    ActionAssignTaskData(
                        action=Action.assign_task,
                        data={
                            "assignee_id": item.assignee_id,
                            "task_id": item.task_id,
                            "content": content,
                            "state": "waiting",  # Mark as waiting state
                            "failure_count": 0,
                        },
                    )
                )
            )
            # Track the task for cleanup
            task_lock.add_background_task(task)
        return assigned

    async def _post_task(self, task: Task, assignee_id: str) -> None:
        # DEBUG ▶ Dependencies are met, the task really starts to execute
        logger.debug(f"[WF] POST  {task.id} -> {assignee_id}")
        """Override the _post_task method to notify the frontend when the task really starts to execute"""
        # When the dependency check is passed and the task is about to be published to the execution queue, send a notification to the frontend
        task_lock = get_task_lock(self.api_task_id)
        if self._task and task.id != self._task.id:  # Skip the main task itself
            await task_lock.put_queue(
                ActionAssignTaskData(
                    action=Action.assign_task,
                    data={
                        "assignee_id": assignee_id,
                        "task_id": task.id,
                        "content": task.content,
                        "state": "running",  # running state
                        "failure_count": task.failure_count,
                    },
                )
            )
        # Call the parent class method to continue the normal task publishing process
        await super()._post_task(task, assignee_id)

    def add_single_agent_worker(
        self,
        description: str,
        worker: ListenChatAgent,
        pool_max_size: int = DEFAULT_WORKER_POOL_SIZE,
        enable_workflow_memory: bool = False,
    ) -> BaseWorkforce:
        if self._state == WorkforceState.RUNNING:
            raise RuntimeError("Cannot add workers while workforce is running. Pause the workforce first.")

        # Validate worker agent compatibility
        self._validate_agent_compatibility(worker, "Worker agent")

        # Ensure the worker agent shares this workforce's pause control
        self._attach_pause_event_to_agent(worker)

        worker_node = SingleAgentWorker(
            description=description,
            worker=worker,
            pool_max_size=pool_max_size,
            use_structured_output_handler=self.use_structured_output_handler,
            context_utility=None, # Will be set during save/load operations
            enable_workflow_memory=enable_workflow_memory,
        )
        self._children.append(worker_node)

        # If we have a channel set up, set it for the new worker
        if hasattr(self, "_channel") and self._channel is not None:
            worker_node.set_channel(self._channel)

        # If workforce is paused, start the worker's listening task
        self._start_child_node_when_paused(worker_node.start())

        if self.metrics_logger:
            self.metrics_logger.log_worker_created(
                worker_id=worker_node.node_id,
                worker_type="SingleAgentWorker",
                role=worker_node.description,
            )
        return self

    async def _handle_completed_task(self, task: Task) -> None:
        # DEBUG ▶ Task completed
        logger.debug(f"[WF] DONE  {task.id}")
        task_lock = get_task_lock(self.api_task_id)

        # Log task completion with result details
        is_main_task = self._task and task.id == self._task.id
        task_type = "MAIN TASK" if is_main_task else "SUB-TASK"
        logger.info(f"[TASK-RESULT] {task_type} COMPLETED: {task.id}")
        logger.info(f"[TASK-RESULT] Content: {task.content[:200]}..." if len(task.content) > 200 else f"[TASK-RESULT] Content: {task.content}")
        logger.info(f"[TASK-RESULT] Result: {task.result[:500]}..." if task.result and len(str(task.result)) > 500 else f"[TASK-RESULT] Result: {task.result}")

        task_data = {
            "task_id": task.id,
            "content": task.content,
            "state": task.state,
            "result": task.result or "",
            "failure_count": task.failure_count,
        }
        
        if self._task_is_new(task_data):
            await task_lock.put_queue(
                ActionNewTaskStateData(
                    data=task_data
                )
            )
        else:
            await task_lock.put_queue(
                ActionTaskStateData(
                    data=task_data
                )
            )

        return await super()._handle_completed_task(task)

    async def _handle_failed_task(self, task: Task) -> bool:
        # DEBUG ▶ Task failed
        logger.debug(f"[WF] FAIL  {task.id} retry={task.failure_count}")

        result = await super()._handle_failed_task(task)

        error_message = ""
        if self.metrics_logger and hasattr(self.metrics_logger, "log_entries"):
            for entry in reversed(self.metrics_logger.log_entries):
                if entry.get("event_type") == "task_failed" and entry.get("task_id") == task.id:
                    error_message = entry.get("error_message")
                    break

        task_lock = get_task_lock(self.api_task_id)
        await task_lock.put_queue(
            ActionTaskStateData(
                data={
                    "task_id": task.id,
                    "content": task.content,
                    "state": task.state,
                    "failure_count": task.failure_count,
                    "result": str(error_message),
                }
            )
        )

        return result

    def _task_is_new(self, item:dict) -> bool:
        # Validate the task state data object first
        assert isinstance(item, dict)
        task_id = item.get("task_id", "")
        state = item.get("state", "")
        result = item.get("result", "")
        failure_count = item.get("failure_count", 0)
        
        # Validate required fields
        if not task_id:
            logger.error("Missing task_id in task_state data")
            return False
        elif not state:
            logger.error(f"Missing state in task_state data for task {task_id}")
            return False

        # Ensure failure_count is an integer
        try:
            failure_count = int(failure_count)
        except (ValueError, TypeError):
            logger.error(f"Invalid failure_count in task_state data for task {task_id}: {failure_count}")
            failure_count = 0  # Default to 0 if invalid
        
        should_send_new_task_state = (
            state == "FAILED" or 
            (failure_count == 0 and result.strip() == "")
        )
        
        return should_send_new_task_state

    def stop(self) -> None:
        super().stop()
        task_lock = get_task_lock(self.api_task_id)
        task = asyncio.create_task(task_lock.put_queue(ActionEndData()))
        task_lock.add_background_task(task)

    async def cleanup(self) -> None:
        r"""Clean up resources when workforce is done"""
        try:
            # Clean up the task lock
            from app.service.task import delete_task_lock

            await delete_task_lock(self.api_task_id)
        except Exception as e:
            logger.error(f"Error cleaning up workforce resources: {e}")
