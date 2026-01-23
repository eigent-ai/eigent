import asyncio
from typing import Generator, List, Optional
from camel.agents import ChatAgent
from camel.societies.workforce.workforce import (
    Workforce as BaseWorkforce,
    WorkforceState,
    DEFAULT_WORKER_POOL_SIZE,
)
from camel.societies.workforce.utils import FailureHandlingConfig
from camel.societies.workforce.task_channel import TaskChannel
from camel.societies.workforce.base import BaseNode
from camel.societies.workforce.utils import TaskAssignResult
from camel.societies.workforce.workforce_metrics import WorkforceMetrics
from camel.societies.workforce.events import WorkerCreatedEvent
from camel.societies.workforce.prompts import TASK_DECOMPOSE_PROMPT
from camel.tasks.task import Task, TaskState, validate_task_content
from app.component import code
from app.exception.exception import UserException
from app.utils.agent import ListenChatAgent
from app.service.task import (
    Action,
    ActionAssignTaskData,
    ActionEndData,
    ActionTaskStateData,
    ActionTimeoutData,
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
        logger.info("=" * 80)
        logger.info("🏭 [WF-LIFECYCLE] Workforce.__init__ STARTED", extra={"api_task_id": api_task_id})
        logger.info(f"[WF-LIFECYCLE] Workforce id will be: {id(self)}")
        logger.info(f"[WF-LIFECYCLE] Init params: graceful_shutdown_timeout={graceful_shutdown_timeout}, share_memory={share_memory}")
        logger.info("=" * 80)
        super().__init__(
            description=description,
            children=children,
            coordinator_agent=coordinator_agent,
            task_agent=task_agent,
            new_worker_agent=new_worker_agent,
            graceful_shutdown_timeout=graceful_shutdown_timeout,
            share_memory=share_memory,
            use_structured_output_handler=use_structured_output_handler,
            task_timeout_seconds=3600,  # 60 minutes
            failure_handling_config=FailureHandlingConfig(
                enabled_strategies=["retry", "replan"],
            ),
        )
        self.task_agent.stream_accumulate = True
        self.task_agent._stream_accumulate_explicit = True
        logger.info(f"[WF-LIFECYCLE] ✅ Workforce.__init__ COMPLETED, id={id(self)}")

    def eigent_make_sub_tasks(
        self,
        task: Task,
        coordinator_context: str = "",
        on_stream_batch=None,
        on_stream_text=None,
    ):
        """
        Split process_task method to eigent_make_sub_tasks and eigent_start method.

        Args:
            task: The main task to decompose
            coordinator_context: Optional context ONLY for coordinator agent during decomposition.
                                This context will NOT be passed to subtasks or worker agents.
            on_stream_batch: Optional callback for streaming batches signature (List[Task], bool)
            on_stream_text: Optional callback for raw streaming text chunks
        """
        logger.debug("[DECOMPOSE] eigent_make_sub_tasks called", extra={
            "api_task_id": self.api_task_id,
            "task_id": task.id
        })

        if not validate_task_content(task.content, task.id):
            task.state = TaskState.FAILED
            task.result = "Task failed: Invalid or empty content provided"
            logger.warning("[DECOMPOSE] Task rejected: Invalid or empty content", extra={
                "task_id": task.id,
                "content_preview": task.content[:50] + "..." if len(task.content) > 50 else task.content
            })
            raise UserException(code.error, task.result)

        self.reset()
        self._task = task
        self.set_channel(TaskChannel())
        self._state = WorkforceState.RUNNING
        task.state = TaskState.OPEN

        subtasks = asyncio.run(
            self.handle_decompose_append_task(
                task,
                reset=False,
                coordinator_context=coordinator_context,
                on_stream_batch=on_stream_batch,
                on_stream_text=on_stream_text
            )
        )

        logger.info(f"[DECOMPOSE] Task decomposition completed", extra={
            "api_task_id": self.api_task_id,
            "task_id": task.id,
            "subtasks_count": len(subtasks)
        })
        return subtasks

    async def eigent_start(self, subtasks: list[Task]):
        """start the workforce"""
        logger.debug(f"[WF-LIFECYCLE] eigent_start called with {len(subtasks)} subtasks", extra={
            "api_task_id": self.api_task_id
        })
        # Clear existing pending tasks to use the user-edited task list
        # (tasks may have been added during decomposition before user edits)
        self._pending_tasks.clear()
        self._pending_tasks.extendleft(reversed(subtasks))
        self.save_snapshot("Initial task decomposition")

        try:
            await self.start()
        except Exception as e:
            logger.error(f"[WF-LIFECYCLE] Error in workforce execution: {e}", extra={
                "api_task_id": self.api_task_id,
                "error": str(e)
            }, exc_info=True)
            self._state = WorkforceState.STOPPED
            raise
        finally:
            if self._state != WorkforceState.STOPPED:
                self._state = WorkforceState.IDLE

    def _decompose_task(self, task: Task, stream_callback=None):
        """Decompose task with optional streaming text callback."""
        decompose_prompt = str(
            TASK_DECOMPOSE_PROMPT.format(
                content=task.content,
                child_nodes_info=self._get_child_nodes_info(),
                additional_info=task.additional_info,
            )
        )

        self.task_agent.reset()
        result = task.decompose(
            self.task_agent, decompose_prompt, stream_callback=stream_callback
        )

        if isinstance(result, Generator):
            def streaming_with_dependencies():
                all_subtasks = []
                for new_tasks in result:
                    all_subtasks.extend(new_tasks)
                    if new_tasks:
                        self._update_dependencies_for_decomposition(
                            task, all_subtasks
                        )
                    yield new_tasks
            return streaming_with_dependencies()
        else:
            subtasks = result
            if subtasks:
                self._update_dependencies_for_decomposition(task, subtasks)
            return subtasks

    async def handle_decompose_append_task(
        self,
        task: Task,
        reset: bool = True,
        coordinator_context: str = "",
        on_stream_batch=None,
        on_stream_text=None,
    ) -> List[Task]:
        """
        Override to support coordinator_context parameter.
        Handle task decomposition and validation, then append to pending tasks.

        Args:
            task: The task to be processed
            reset: Should trigger workforce reset (Workforce must not be running)
            coordinator_context: Optional context ONLY for coordinator during decomposition
            on_stream_batch: Optional callback for streaming batches signature (List[Task], bool)
            on_stream_text: Optional callback for raw streaming text chunks

        Returns:
            List[Task]: The decomposed subtasks or the original task
        """
        logger.debug(f"[DECOMPOSE] handle_decompose_append_task called, task_id={task.id}, reset={reset}")

        if not validate_task_content(task.content, task.id):
            task.state = TaskState.FAILED
            task.result = "Task failed: Invalid or empty content provided"
            logger.warning(
                f"[DECOMPOSE] Task {task.id} rejected: Invalid or empty content. "
                f"Content preview: '{task.content}'"
            )
            return [task]

        if reset and self._state != WorkforceState.RUNNING:
            self.reset()

        self._task = task
        task.state = TaskState.FAILED

        if coordinator_context:
            original_content = task.content
            task_with_context = coordinator_context + "\n=== CURRENT TASK ===\n" + original_content
            task.content = task_with_context
            subtasks_result = self._decompose_task(task, stream_callback=on_stream_text)
            task.content = original_content
        else:
            subtasks_result = self._decompose_task(task, stream_callback=on_stream_text)

        if isinstance(subtasks_result, Generator):
            subtasks = []
            for new_tasks in subtasks_result:
                subtasks.extend(new_tasks)
                if on_stream_batch:
                    try:
                        on_stream_batch(new_tasks, False)
                    except Exception as e:
                        logger.warning(f"Streaming callback failed: {e}")

            # After consuming the generator, check task.subtasks for final result as fallback
            if not subtasks and task.subtasks:
                subtasks = task.subtasks
        else:
            subtasks = subtasks_result

        if subtasks:
            self._pending_tasks.extendleft(reversed(subtasks))

        if not subtasks:
            logger.warning(f"[DECOMPOSE] No subtasks returned, creating fallback task")
            fallback_task = Task(
                content=task.content,
                id=f"{task.id}.1",
                parent=task,
            )
            task.subtasks = [fallback_task]
            subtasks = [fallback_task]

        if on_stream_batch:
            try:
                on_stream_batch(subtasks, True)
            except Exception as e:
                logger.warning(f"Final streaming callback failed: {e}")

        logger.debug(f"[DECOMPOSE] handle_decompose_append_task completed, returned {len(subtasks)} subtasks")
        return subtasks

    def _get_agent_id_from_node_id(self, node_id: str) -> str | None:
        """Map worker node_id to the actual agent_id for frontend communication.

        The CAMEL base class uses node_id for task assignment, but the frontend
        uses agent_id to identify agents. This method provides the mapping.
        """
        for child in self._children:
            if hasattr(child, 'node_id') and child.node_id == node_id:
                if hasattr(child, 'worker') and hasattr(child.worker, 'agent_id'):
                    return child.worker.agent_id
        return None

    async def _find_assignee(self, tasks: List[Task]) -> TaskAssignResult:
        # Task assignment phase: send "waiting for execution" notification
        # to the frontend, and send "start execution" notification when the
        # task actually begins execution
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

            # Skip sending notification if this is a retry/replan for an already assigned task
            # This prevents the frontend from showing "Reassigned" when a task is being retried
            # with the same or different worker due to failure recovery
            if task_obj and task_obj.assigned_worker_id:
                logger.debug(
                    f"[WF] ASSIGN Skip notification for task {item.task_id}: "
                    f"already has assigned_worker_id={task_obj.assigned_worker_id}, "
                    f"new assignee={item.assignee_id} (retry/replan scenario)"
                )
                continue

            # Map node_id to agent_id for frontend communication
            # The CAMEL base class returns node_id as assignee_id, but the frontend
            # uses agent_id to identify agents
            agent_id = self._get_agent_id_from_node_id(item.assignee_id)
            if agent_id is None:
                logger.error(
                    f"[WF] ERROR: Could not find agent_id for node_id={item.assignee_id}. "
                    f"Task {item.task_id} will not be properly tracked on frontend. "
                    f"Available workers: {[c.node_id for c in self._children if hasattr(c, 'node_id')]}"
                )
                continue  # Skip sending notification for unmapped worker

            # Asynchronously send waiting notification
            task = asyncio.create_task(
                task_lock.put_queue(
                    ActionAssignTaskData(
                        action=Action.assign_task,
                        data={
                            "assignee_id": agent_id,
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
            # Map node_id to agent_id for frontend communication
            agent_id = self._get_agent_id_from_node_id(assignee_id)
            if agent_id is None:
                logger.error(
                    f"[WF] ERROR: Could not find agent_id for node_id={assignee_id}. "
                    f"Task {task.id} will not be properly tracked on frontend. "
                    f"Available workers: {[c.node_id for c in self._children if hasattr(c, 'node_id')]}"
                )
            else:
                await task_lock.put_queue(
                    ActionAssignTaskData(
                        action=Action.assign_task,
                        data={
                            "assignee_id": agent_id,
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
            context_utility=None,
            enable_workflow_memory=enable_workflow_memory,
        )
        self._children.append(worker_node)

        # If we have a channel set up, set it for the new worker
        if hasattr(self, "_channel") and self._channel is not None:
            worker_node.set_channel(self._channel)

        # If workforce is paused, start the worker's listening task
        self._start_child_node_when_paused(worker_node.start())

        # Use proper CAMEL pattern for metrics logging
        metrics_callbacks = [cb for cb in self._callbacks if isinstance(cb, WorkforceMetrics)]
        if metrics_callbacks:
            event = WorkerCreatedEvent(
                worker_id=worker_node.node_id,
                worker_type="SingleAgentWorker",
                role=worker_node.description,
            )
            metrics_callbacks[0].log_worker_created(event)

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
        
        await task_lock.put_queue(
            ActionTaskStateData(
                data=task_data
            )
        )

        # Call parent implementation
        await super()._handle_completed_task(task)

        # IMPORTANT: Sync subtask results from _completed_tasks back to parent.subtasks
        # This fixes the issue where parent.subtasks[i].result is None because CAMEL's
        # _handle_completed_task stores results in _completed_tasks but doesn't sync
        # them back to the parent.subtasks list
        parent = task.parent
        if parent and parent.subtasks:
            for sub in parent.subtasks:
                completed_subtask = next(
                    (t for t in self._completed_tasks if t.id == sub.id),
                    None,
                )
                if completed_subtask:
                    # Sync result and state back to parent.subtasks
                    sub.result = completed_subtask.result
                    sub.state = completed_subtask.state
                    logger.debug(f"[SYNC] Synced subtask {sub.id} result to parent.subtasks")

    async def _handle_failed_task(self, task: Task) -> bool:
        # DEBUG ▶ Task failed
        logger.debug(f"[WF] FAIL  {task.id} retry={task.failure_count}")

        result = await super()._handle_failed_task(task)

        # Only send completion report to frontend when all retries are exhausted
        max_retries = self.failure_handling_config.max_retries
        if task.failure_count < max_retries:
            return result

        error_message = ""
        # Use proper CAMEL pattern for metrics logging
        metrics_callbacks = [cb for cb in self._callbacks if isinstance(cb, WorkforceMetrics)]
        if metrics_callbacks and hasattr(metrics_callbacks[0], "log_entries"):
            for entry in reversed(metrics_callbacks[0].log_entries):
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

    async def _get_returned_task(self) -> Optional[Task]:
        r"""Override to handle timeout and send notification to frontend.

        Get the task that's published by this node and just get returned
        from the assignee. Includes timeout handling to prevent indefinite
        waiting.

        Raises:
            asyncio.TimeoutError: If waiting for task exceeds timeout
        """
        try:
            return await asyncio.wait_for(
                self._channel.get_returned_task_by_publisher(self.node_id),
                timeout=self.task_timeout_seconds,
            )
        except asyncio.TimeoutError:
            # Send timeout notification to frontend before re-raising
            logger.warning(
                f"⏰ [WF-TIMEOUT] Task timeout in workforce {self.node_id}. "
                f"Timeout: {self.task_timeout_seconds}s, "
                f"Pending tasks: {len(self._pending_tasks)}, "
                f"In-flight tasks: {self._in_flight_tasks}"
            )

            # Try to notify frontend, but don't let notification failure mask the timeout
            try:
                task_lock = get_task_lock(self.api_task_id)
                timeout_minutes = self.task_timeout_seconds // 60
                await task_lock.put_queue(
                    ActionTimeoutData(
                        data={
                            "message": f"Task execution timeout: No response received for {timeout_minutes} minutes",
                            "in_flight_tasks": self._in_flight_tasks,
                            "pending_tasks": len(self._pending_tasks),
                            "timeout_seconds": self.task_timeout_seconds,
                        }
                    )
                )
            except Exception as notify_err:
                logger.error(f"Failed to send timeout notification: {notify_err}")
            raise
        except Exception as e:
            logger.error(
                f"Error getting returned task {e} in workforce {self.node_id}. "
                f"Current pending tasks: {len(self._pending_tasks)}, "
                f"In-flight tasks: {self._in_flight_tasks}"
            )
            raise

    def stop(self) -> None:
        logger.info("=" * 80)
        logger.info(f"⏹️  [WF-LIFECYCLE] stop() CALLED", extra={"api_task_id": self.api_task_id, "workforce_id": id(self)})
        logger.info(f"[WF-LIFECYCLE] Current state before stop: {self._state.name}, _running: {self._running}")
        logger.info("=" * 80)
        super().stop()
        logger.info(f"[WF-LIFECYCLE] super().stop() completed, new state: {self._state.name}")
        task_lock = get_task_lock(self.api_task_id)
        task = asyncio.create_task(task_lock.put_queue(ActionEndData()))
        task_lock.add_background_task(task)
        logger.info(f"[WF-LIFECYCLE] ✅ ActionEndData queued")

    def stop_gracefully(self) -> None:
        logger.info("=" * 80)
        logger.info(f"🛑 [WF-LIFECYCLE] stop_gracefully() CALLED", extra={"api_task_id": self.api_task_id, "workforce_id": id(self)})
        logger.info(f"[WF-LIFECYCLE] Current state before stop_gracefully: {self._state.name}, _running: {self._running}")
        logger.info("=" * 80)
        super().stop_gracefully()
        logger.info(f"[WF-LIFECYCLE] ✅ super().stop_gracefully() completed, new state: {self._state.name}, _running: {self._running}")

    def skip_gracefully(self) -> None:
        logger.info("=" * 80)
        logger.info(f"⏭️  [WF-LIFECYCLE] skip_gracefully() CALLED", extra={"api_task_id": self.api_task_id, "workforce_id": id(self)})
        logger.info(f"[WF-LIFECYCLE] Current state before skip_gracefully: {self._state.name}, _running: {self._running}")
        logger.info("=" * 80)
        super().skip_gracefully()
        logger.info(f"[WF-LIFECYCLE] ✅ super().skip_gracefully() completed, new state: {self._state.name}, _running: {self._running}")

    def pause(self) -> None:
        logger.info("=" * 80)
        logger.info(f"⏸️  [WF-LIFECYCLE] pause() CALLED", extra={"api_task_id": self.api_task_id, "workforce_id": id(self)})
        logger.info(f"[WF-LIFECYCLE] Current state before pause: {self._state.name}, _running: {self._running}")
        logger.info("=" * 80)
        super().pause()
        logger.info(f"[WF-LIFECYCLE] ✅ super().pause() completed, new state: {self._state.name}, _running: {self._running}")

    def resume(self) -> None:
        logger.info("=" * 80)
        logger.info(f"▶️  [WF-LIFECYCLE] resume() CALLED", extra={"api_task_id": self.api_task_id, "workforce_id": id(self)})
        logger.info(f"[WF-LIFECYCLE] Current state before resume: {self._state.name}, _running: {self._running}")
        logger.info("=" * 80)
        super().resume()
        logger.info(f"[WF-LIFECYCLE] ✅ super().resume() completed, new state: {self._state.name}, _running: {self._running}")

    async def cleanup(self) -> None:
        r"""Clean up resources when workforce is done"""
        try:
            # Clean up the task lock
            from app.service.task import delete_task_lock

            await delete_task_lock(self.api_task_id)
        except Exception as e:
            logger.error(f"Error cleaning up workforce resources: {e}")
