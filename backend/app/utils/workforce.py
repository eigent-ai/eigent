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
from typing import Generator, List, Optional

from app.component import code
from app.exception.exception import UserException
from app.service.task import (Action, ActionAssignTaskData, ActionEndData,
                              ActionTaskStateData, ActionTimeoutData,
                              get_camel_task, get_task_lock)
from app.utils.agent import ListenChatAgent
from app.utils.single_agent_worker import SingleAgentWorker
from app.utils.telemetry.workforce_metrics import WorkforceMetricsCallback
from camel.agents import ChatAgent
from camel.societies.workforce.base import BaseNode
from camel.societies.workforce.events import (TaskAssignedEvent,
                                              TaskCompletedEvent,
                                              TaskCreatedEvent,
                                              TaskFailedEvent,
                                              WorkerCreatedEvent)
from camel.societies.workforce.prompts import TASK_DECOMPOSE_PROMPT
from camel.societies.workforce.task_channel import TaskChannel
from camel.societies.workforce.utils import (FailureHandlingConfig,
                                             TaskAssignResult)
from camel.societies.workforce.workforce import DEFAULT_WORKER_POOL_SIZE
from camel.societies.workforce.workforce import Workforce as BaseWorkforce
from camel.societies.workforce.workforce import WorkforceState
from camel.societies.workforce.workforce_metrics import WorkforceMetrics
from camel.tasks.task import Task, TaskState, validate_task_content

logger = logging.getLogger("workforce")


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
        logger.info("🏭 [WF-LIFECYCLE] Workforce.__init__ STARTED",
                    extra={"api_task_id": api_task_id})
        logger.info(f"[WF-LIFECYCLE] Workforce id will be: {id(self)}")
        logger.info(
            f"[WF-LIFECYCLE] Init params: graceful_shutdown_timeout="
            f"{graceful_shutdown_timeout}, share_memory={share_memory}")
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
                enabled_strategies=["retry", "replan"], ),
        )
        self.task_agent.stream_accumulate = True
        self.task_agent._stream_accumulate_explicit = True
        logger.info(
            f"[WF-LIFECYCLE] ✅ Workforce.__init__ COMPLETED, id={id(self)}")

    def eigent_make_sub_tasks(
        self,
        task: Task,
        coordinator_context: str = "",
        on_stream_batch=None,
        on_stream_text=None,
    ):
        """Split process_task method to eigent_make_sub_tasks
        and eigent_start method.

        Args:
            task: The main task to decompose
            coordinator_context: Optional context ONLY for coordinator
                agent during decomposition. This context will NOT
                be passed to subtasks or worker agents.
            on_stream_batch: Optional callback for streaming
                batches signature (List[Task], bool)
            on_stream_text: Optional callback for raw
                streaming text chunks
        """
        logger.debug("[DECOMPOSE] eigent_make_sub_tasks called",
                     extra={
                         "api_task_id": self.api_task_id,
                         "task_id": task.id
                     })

        if not validate_task_content(task.content, task.id):
            task.state = TaskState.FAILED
            task.result = "Task failed: Invalid or empty content provided"
            logger.warning(
                "[DECOMPOSE] Task rejected: Invalid or empty content",
                extra={
                    "task_id":
                    task.id,
                    "content_preview":
                    task.content[:50] +
                    "..." if len(task.content) > 50 else task.content
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
                on_stream_text=on_stream_text))

        logger.info("[DECOMPOSE] Task decomposition completed",
                    extra={
                        "api_task_id": self.api_task_id,
                        "task_id": task.id,
                        "subtasks_count": len(subtasks)
                    })
        return subtasks

    async def eigent_start(self, subtasks: list[Task]):
        """start the workforce"""
        logger.debug((f"[WF-LIFECYCLE] eigent_start called with "
                      f"{len(subtasks)} subtasks"),
                     extra={"api_task_id": self.api_task_id})
        # Clear existing pending tasks to use the user-edited task list
        # (tasks may have been added during decomposition before user edits)
        self._pending_tasks.clear()

        self._pending_tasks.extendleft(reversed(subtasks))
        self.save_snapshot("Initial task decomposition")

        try:
            await self.start()
        except Exception as e:
            logger.error(f"[WF-LIFECYCLE] Error in workforce execution: {e}",
                         extra={
                             "api_task_id": self.api_task_id,
                             "error": str(e)
                         },
                         exc_info=True)
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
            ))

        self.task_agent.reset()
        result = task.decompose(self.task_agent,
                                decompose_prompt,
                                stream_callback=stream_callback)

        if isinstance(result, Generator):

            def streaming_with_dependencies():
                all_subtasks = []
                for new_tasks in result:
                    all_subtasks.extend(new_tasks)
                    if new_tasks:
                        self._update_dependencies_for_decomposition(
                            task, all_subtasks)
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
        """Override to support coordinator_context parameter.
        Handle task decomposition and validation,
        then append to pending tasks.

        Args:
            task: The task to be processed
            reset: Should trigger workforce reset
                (Workforce must not be running)
            coordinator_context: Optional context ONLY for
                coordinator during decomposition
            on_stream_batch: Optional callback for streaming
                batches signature (List[Task], bool)
            on_stream_text: Optional callback for raw streaming text chunks

        Returns:
            List[Task]: The decomposed subtasks or the original task
        """
        logger.debug(f"[DECOMPOSE] handle_decompose_append_task called, "
                     f"task_id={task.id}, reset={reset}")

        if not validate_task_content(task.content, task.id):
            task.state = TaskState.FAILED
            task.result = "Task failed: Invalid or empty content provided"
            logger.warning(f"[DECOMPOSE] Task {task.id} rejected: "
                           f"Invalid or empty content. "
                           f"Content preview: '{task.content}'")
            return [task]

        if reset and self._state != WorkforceState.RUNNING:
            self.reset()

        self._task = task
        task.state = TaskState.FAILED

        if coordinator_context:
            original_content = task.content
            task_with_context = (coordinator_context +
                                 "\n=== CURRENT TASK ===\n" + original_content)
            task.content = task_with_context
            subtasks_result = self._decompose_task(
                task, stream_callback=on_stream_text)
            task.content = original_content
        else:
            subtasks_result = self._decompose_task(
                task, stream_callback=on_stream_text)

        if isinstance(subtasks_result, Generator):
            subtasks = []
            for new_tasks in subtasks_result:
                subtasks.extend(new_tasks)
                if on_stream_batch:
                    try:
                        on_stream_batch(new_tasks, False)
                    except Exception as e:
                        logger.warning(f"Streaming callback failed: {e}")

            # After consuming the generator, check task.subtasks
            # for final result as fallback
            if not subtasks and task.subtasks:
                subtasks = task.subtasks
        else:
            subtasks = subtasks_result

        if subtasks:
            self._pending_tasks.extendleft(reversed(subtasks))
            # Log task created events
            metrics_callbacks = [
                cb for cb in self._callbacks
                if isinstance(cb, WorkforceMetrics)
            ]
            if metrics_callbacks:
                for subtask in subtasks:
                    event = TaskCreatedEvent(
                        task_id=subtask.id,
                        description=subtask.content,
                        parent_task_id=task.id if task else None,
                        task_type=None,
                    )
                    metrics_callbacks[0].log_task_created(event)

        if not subtasks:
            logger.warning(
                "[DECOMPOSE] No subtasks returned, creating fallback task")
            fallback_task = Task(
                content=task.content,
                id=f"{task.id}.1",
                parent=task,
            )
            task.subtasks = [fallback_task]
            subtasks = [fallback_task]

            # Log fallback task created event
            metrics_callbacks = [
                cb for cb in self._callbacks
                if isinstance(cb, WorkforceMetrics)
            ]
            if metrics_callbacks:
                event = TaskCreatedEvent(
                    task_id=fallback_task.id,
                    description=fallback_task.content,
                    parent_task_id=task.id if task else None,
                    task_type=None,
                )
                metrics_callbacks[0].log_task_created(event)

        if on_stream_batch:
            try:
                on_stream_batch(subtasks, True)
            except Exception as e:
                logger.warning(f"Final streaming callback failed: {e}")

        logger.debug(f"[DECOMPOSE] handle_decompose_append_task completed, "
                     f"returned {len(subtasks)} subtasks")
        return subtasks

    def _get_agent_id_from_node_id(self, node_id: str) -> str | None:
        """Map worker node_id to the actual agent_id for
        frontend communication.

        The CAMEL base class uses node_id for task assignment,
        but the frontend uses agent_id to identify agents.
        This method provides the mapping.
        """
        for child in self._children:
            if hasattr(child, 'node_id') and child.node_id == node_id:
                if hasattr(child, 'worker') and hasattr(
                        child.worker, 'agent_id'):
                    return child.worker.agent_id
        return None

    def _extract_model_type(self, agent: ChatAgent) -> Optional[str]:
        """Extract model type from agent's model_backend.

        Handles both ModelManager (multiple models) and single model cases.

        Args:
            agent: The chat agent to extract model type from

        Returns:
            Model type as string, or None if not found
        """
        if not hasattr(agent, 'model_backend') or not agent.model_backend:
            return None

        model_obj = agent.model_backend

        # Handle ModelManager case (multiple models)
        if hasattr(model_obj, 'models') and model_obj.models:
            first_model = model_obj.models[0] if model_obj.models else None
            if first_model:
                mt = getattr(first_model, 'model_type', None)
                return str(
                    mt.value if hasattr(mt, 'value') else mt) if mt else None

        # Handle single model case
        mt = getattr(model_obj, 'model_type', None)
        return str(mt.value if hasattr(mt, 'value') else mt) if mt else None

    async def _find_assignee(self, tasks: List[Task]) -> TaskAssignResult:
        # Task assignment phase: send "waiting for execution" notification
        # to the frontend, and send "start execution" notification when the
        # task actually begins execution
        assigned = await super()._find_assignee(tasks)

        task_lock = get_task_lock(self.api_task_id)
        for item in assigned.assignments:
            # DEBUG ▶ Task has been assigned to which worker
            # and its dependencies
            logger.debug(f"[WF] ASSIGN {item.task_id} -> {item.assignee_id} "
                         f"deps={item.dependencies}")
            # The main task itself does not need notification
            if self._task and item.task_id == self._task.id:
                continue
            # Find task content
            task_obj = get_camel_task(item.task_id, tasks)
            if task_obj is None:
                logger.warning(
                    f"[WF] WARN: Task {item.task_id} not found in "
                    f"tasks list during ASSIGN phase. This may indicate "
                    f"a task tree inconsistency.")
                content = ""
            else:
                content = task_obj.content

            # Skip sending notification if this is a retry/replan for
            # an already assigned task
            # This prevents the frontend from showing "Reassigned"
            # when a task is being retried with the same or different
            # worker due to failure recovery
            if task_obj and task_obj.assigned_worker_id:
                logger.debug(
                    f"[WF] ASSIGN Skip notification for task {item.task_id}: "
                    f"already has assigned_worker_id="
                    f"{task_obj.assigned_worker_id}, "
                    f"new assignee={item.assignee_id} (retry/replan scenario)")
                continue

            # Map node_id to agent_id for frontend communication
            # The CAMEL base class returns node_id as assignee_id,
            # but the frontend uses agent_id to identify agents
            agent_id = self._get_agent_id_from_node_id(item.assignee_id)
            if agent_id is None:
                workers = [
                    c.node_id for c in self._children if hasattr(c, 'node_id')
                ]
                logger.error(
                    f"[WF] ERROR: Could not find agent_id for "
                    f"node_id={item.assignee_id}. Task {item.task_id} "
                    f"will not be properly tracked on frontend. "
                    f"Available workers: {workers}")
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
                    )))
            # Track the task for cleanup
            task_lock.add_background_task(task)

            metrics_callbacks = [
                cb for cb in self._callbacks
                if isinstance(cb, WorkforceMetrics)
            ]
            if metrics_callbacks:
                event = TaskAssignedEvent(
                    task_id=item.task_id,
                    worker_id=agent_id,
                    dependencies=item.dependencies,
                )
                metrics_callbacks[0].log_task_assigned(event)
        return assigned

    async def _post_task(self, task: Task, assignee_id: str) -> None:
        # DEBUG ▶ Dependencies are met, the task really starts to execute
        logger.debug(f"[WF] POST  {task.id} -> {assignee_id}")
        """Override the _post_task method to notify the frontend
        when the task really starts to execute
        """
        # When the dependency check is passed and the task is
        # about to be published to the execution queue, send a
        # notification to the frontend
        task_lock = get_task_lock(self.api_task_id)
        if self._task and task.id != self._task.id:
            # Skip the main task itself
            # Map node_id to agent_id for frontend communication
            agent_id = self._get_agent_id_from_node_id(assignee_id)
            workers = [
                c.node_id for c in self._children if hasattr(c, 'node_id')
            ]
            if agent_id is None:
                logger.error(f"[WF] ERROR: Could not find agent_id "
                             f"for node_id={assignee_id}. "
                             f"Task {task.id} will not be properly "
                             f"tracked on frontend. "
                             f"Available workers: "
                             f"{workers}")
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
                    ))
        # Call the parent class method to continue the
        # normal task publishing process
        await super()._post_task(task, assignee_id)

    def add_single_agent_worker(
        self,
        description: str,
        worker: ListenChatAgent,
        pool_max_size: int = DEFAULT_WORKER_POOL_SIZE,
        enable_workflow_memory: bool = False,
    ) -> BaseWorkforce:
        if self._state == WorkforceState.RUNNING:
            raise RuntimeError(
                "Cannot add workers while workforce is running. "
                "Pause the workforce first.")

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
        metrics_callbacks = [
            cb for cb in self._callbacks if isinstance(cb, WorkforceMetrics)
        ]
        if metrics_callbacks:
            # Collect agent metadata for telemetry
            agent_class_name = getattr(worker, 'agent_name',
                                       worker.__class__.__name__)
            model_type = self._extract_model_type(worker)

            # Log worker created event
            event = WorkerCreatedEvent(
                worker_id=worker_node.node_id,
                worker_type="SingleAgentWorker",
                role=worker_node.description,
            )

            # Call log_worker_created for all callbacks
            for cb in self._callbacks:
                if isinstance(cb, WorkforceMetricsCallback):
                    cb.log_worker_created(
                        event,
                        agent_class=agent_class_name,
                        model_type=model_type,
                    )
                else:
                    cb.log_worker_created(event)

        return self

    async def _handle_completed_task(self, task: Task) -> None:
        # DEBUG ▶ Task completed
        logger.debug(f"[WF] DONE  {task.id}")
        task_lock = get_task_lock(self.api_task_id)

        # Log task completion with result details
        is_main_task = self._task and task.id == self._task.id
        task_type = "MAIN TASK" if is_main_task else "SUB-TASK"
        logger.info(f"[TASK-RESULT] {task_type} COMPLETED: {task.id}")
        logger.info(f"[TASK-RESULT] Content: {task.content[:200]}..." if len(
            task.content) > 200 else f"[TASK-RESULT] Content: {task.content}")
        logger.info(f"[TASK-RESULT] Result: {task.result[:500]}..."
                    if task.result and len(str(task.result)) > 500 else
                    f"[TASK-RESULT] Result: {task.result}")

        task_data = {
            "task_id": task.id,
            "content": task.content,
            "state": task.state,
            "result": task.result or "",
            "failure_count": task.failure_count,
        }

        await task_lock.put_queue(ActionTaskStateData(data=task_data))

        # Log task completion to metrics
        metrics_callbacks = [
            cb for cb in self._callbacks if isinstance(cb, WorkforceMetrics)
        ]
        if metrics_callbacks:
            # worker_id is required and cannot be None
            worker_id = getattr(task, 'assigned_worker_id', None) or 'unknown'
            event = TaskCompletedEvent(
                task_id=task.id,
                worker_id=worker_id,
            )
            metrics_callbacks[0].log_task_completed(event)

        # IMPORTANT: Sync this subtask's result back to parent.subtasks BEFORE calling super()
        # This fixes the issue where parent.subtasks[i].result is None because CAMEL's
        # _handle_completed_task stores results in _completed_tasks but doesn't sync
        # them back to the parent.subtasks list.
        # We only sync the current task (not all subtasks) for efficiency - O(n) vs O(n²).
        parent = task.parent
        if parent and parent.subtasks:
            for sub in parent.subtasks:
                if sub.id == task.id:
                    sub.result = task.result
                    sub.state = task.state
                    logger.debug(f"[SYNC] Synced subtask {task.id} result to parent.subtasks")
                    break

        # Call parent implementation
        await super()._handle_completed_task(task)

    async def _handle_failed_task(self, task: Task) -> bool:
        # DEBUG ▶ Task failed
        logger.debug(f"[WF] FAIL  {task.id} retry={task.failure_count}")

        result = await super()._handle_failed_task(task)

        # Only send completion report to frontend when all
        # retries are exhausted
        max_retries = self.failure_handling_config.max_retries
        if task.failure_count < max_retries:
            return result

        error_message = ""
        # Use proper CAMEL pattern for metrics logging
        metrics_callbacks = [
            cb for cb in self._callbacks if isinstance(cb, WorkforceMetrics)
        ]
        if metrics_callbacks and hasattr(metrics_callbacks[0], "log_entries"):
            for entry in reversed(metrics_callbacks[0].log_entries):
                if entry.get("event_type") == "task_failed" and entry.get(
                        "task_id") == task.id:
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
                }))

        if metrics_callbacks:
            error_msg = error_message or str(task.result or "Unknown error")
            event = TaskFailedEvent(
                task_id=task.id,
                error_message=error_msg,
            )
            # Add failure details if available
            if hasattr(task, 'assigned_worker_id'):
                event.worker_id = task.assigned_worker_id
            event.failure_count = task.failure_count
            metrics_callbacks[0].log_task_failed(event)

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
                f"In-flight tasks: {self._in_flight_tasks}")

            # Try to notify frontend, but don't let
            # notification failure mask the timeout
            try:
                task_lock = get_task_lock(self.api_task_id)
                timeout_minutes = self.task_timeout_seconds // 60
                await task_lock.put_queue(
                    ActionTimeoutData(
                        data={
                            "message":
                            (f"Task execution timeout: No response received "
                             f"for {timeout_minutes} minutes"),
                            "in_flight_tasks":
                            self._in_flight_tasks,
                            "pending_tasks":
                            len(self._pending_tasks),
                            "timeout_seconds":
                            self.task_timeout_seconds,
                        }))
            except Exception as notify_err:
                logger.error(
                    f"Failed to send timeout notification: {notify_err}")
            raise
        except Exception as e:
            logger.error(f"Error getting returned task {e} in "
                         f"workforce {self.node_id}. "
                         f"Current pending tasks: {len(self._pending_tasks)}, "
                         f"In-flight tasks: {self._in_flight_tasks}")
            raise

    def stop(self) -> None:
        logger.info("=" * 80)
        logger.info("⏹️  [WF-LIFECYCLE] stop() CALLED",
                    extra={
                        "api_task_id": self.api_task_id,
                        "workforce_id": id(self)
                    })
        logger.info(f"[WF-LIFECYCLE] Current state before stop: "
                    f"{self._state.name}, _running: {self._running}")
        logger.info("=" * 80)
        super().stop()
        logger.info(f"[WF-LIFECYCLE] super().stop() completed, "
                    f"new state: {self._state.name}")
        task_lock = get_task_lock(self.api_task_id)
        task = asyncio.create_task(task_lock.put_queue(ActionEndData()))
        task_lock.add_background_task(task)
        logger.info("[WF-LIFECYCLE] ✅ ActionEndData queued")

    def stop_gracefully(self) -> None:
        logger.info("=" * 80)
        logger.info("🛑 [WF-LIFECYCLE] stop_gracefully() CALLED",
                    extra={
                        "api_task_id": self.api_task_id,
                        "workforce_id": id(self)
                    })
        logger.info(f"[WF-LIFECYCLE] Current state before stop_gracefully: "
                    f"{self._state.name}, _running: {self._running}")
        logger.info("=" * 80)

        # Cleanup all agents before stopping
        self._cleanup_all_agents()

        super().stop_gracefully()
        logger.info(
            f"[WF-LIFECYCLE] ✅ super().stop_gracefully() completed, "
            f"new state: {self._state.name}, _running: {self._running}")

    def _cleanup_all_agents(self) -> None:
        """Call cleanup callbacks for all agents to release resources (e.g., CDP browsers)."""
        logger.info(f"[WF-CLEANUP] Starting cleanup for all agents in workforce {id(self)}")

        # ========== DEBUG INFO START ==========
        logger.info(f"[WF-CLEANUP-DEBUG] hasattr(self, 'children'): {hasattr(self, 'children')}")
        logger.info(f"[WF-CLEANUP-DEBUG] hasattr(self, '_children'): {hasattr(self, '_children')}")

        if hasattr(self, 'children'):
            try:
                logger.info(f"[WF-CLEANUP-DEBUG] self.children = {self.children}")
                logger.info(f"[WF-CLEANUP-DEBUG] bool(self.children) = {bool(self.children)}")
            except AttributeError as e:
                logger.info(f"[WF-CLEANUP-DEBUG] AttributeError accessing self.children: {e}")

        if hasattr(self, '_children'):
            logger.info(f"[WF-CLEANUP-DEBUG] self._children exists: {self._children is not None}")
            if self._children is not None:
                logger.info(f"[WF-CLEANUP-DEBUG] len(self._children) = {len(self._children)}")
                for i, child in enumerate(self._children):
                    logger.info(f"[WF-CLEANUP-DEBUG] _children[{i}]: type={type(child).__name__}, "
                               f"has_worker_agent={hasattr(child, 'worker_agent')}, "
                               f"has_agent_pool={hasattr(child, 'agent_pool')}")

        logger.info(f"[WF-CLEANUP-DEBUG] hasattr(self, 'coordinator_agent'): {hasattr(self, 'coordinator_agent')}")
        if hasattr(self, 'coordinator_agent'):
            logger.info(f"[WF-CLEANUP-DEBUG] self.coordinator_agent is None: {self.coordinator_agent is None}")
            if self.coordinator_agent is not None:
                logger.info(f"[WF-CLEANUP-DEBUG] coordinator has _cleanup_callback: {hasattr(self.coordinator_agent, '_cleanup_callback')}")
        # ========== DEBUG INFO END ==========

        cleanup_count = 0

        # Cleanup all child workers - use _children instead of children
        if hasattr(self, '_children') and self._children:
            logger.info(f"[WF-CLEANUP] Processing {len(self._children)} children")
            for child in self._children:
                # Cleanup base agent
                if hasattr(child, 'worker_agent'):
                    agent = child.worker_agent
                    if hasattr(agent, '_cleanup_callback') and callable(agent._cleanup_callback):
                        try:
                            agent._cleanup_callback()
                            cleanup_count += 1
                            logger.info(f"[WF-CLEANUP] Called cleanup for base agent: {getattr(agent, 'agent_name', 'unknown')}")
                        except Exception as e:
                            logger.error(f"[WF-CLEANUP] Error in cleanup callback for base agent: {e}", exc_info=True)

                # Cleanup agents in AgentPool (cloned agents that actually hold CDP resources)
                if hasattr(child, 'agent_pool') and child.agent_pool:
                    pool = child.agent_pool
                    logger.info(f"[WF-CLEANUP] Found AgentPool for worker: {getattr(child, 'description', 'unknown')}, "
                               f"available={len(pool._available_agents)}, in_use={len(pool._in_use_agents)}")

                    # Cleanup available agents
                    for agent in list(pool._available_agents):
                        if hasattr(agent, '_cleanup_callback') and callable(agent._cleanup_callback):
                            try:
                                agent._cleanup_callback()
                                cleanup_count += 1
                                logger.info(f"[WF-CLEANUP] Called cleanup for pooled agent (available): {getattr(agent, 'agent_id', 'unknown')}")
                            except Exception as e:
                                logger.error(f"[WF-CLEANUP] Error in cleanup callback for pooled agent: {e}", exc_info=True)

                    # Cleanup in-use agents - they are not directly accessible from AgentPool
                    # AgentPool only stores agent IDs in _in_use_agents set, not the agent objects
                    if hasattr(pool, '_in_use_agents') and pool._in_use_agents:
                        logger.info(f"[WF-CLEANUP] Warning: {len(pool._in_use_agents)} agents still in use")
                        logger.info(f"[WF-CLEANUP] These agents cannot be directly accessed from pool, but their CDP resources will be force-released")

        # Cleanup coordinator agent
        if hasattr(self, 'coordinator_agent') and self.coordinator_agent:
            if hasattr(self.coordinator_agent, '_cleanup_callback') and callable(self.coordinator_agent._cleanup_callback):
                try:
                    self.coordinator_agent._cleanup_callback()
                    cleanup_count += 1
                    logger.info(f"[WF-CLEANUP] Called cleanup for coordinator agent")
                except Exception as e:
                    logger.error(f"[WF-CLEANUP] Error in cleanup callback for coordinator: {e}", exc_info=True)

        logger.info(f"[WF-CLEANUP] ✅ Cleanup completed, {cleanup_count} agent(s) cleaned up")

        # Force release all CDP browser resources for this task
        # This handles the case where agents are still in-use and cannot be accessed from pool
        try:
            from app.utils.agent import _cdp_pool_manager
            logger.info(f"[WF-CLEANUP] Force releasing all CDP resources for task {self.api_task_id}")

            # Get all occupied ports before cleanup
            occupied_before = _cdp_pool_manager.get_occupied_ports().copy()
            logger.info(f"[WF-CLEANUP] CDP ports occupied before force release: {occupied_before}")

            # Force release all ports (clear the entire pool)
            # This is safe because the task is ending, no agents should be using them anymore
            released_count = len(occupied_before)
            _cdp_pool_manager._occupied_ports.clear()

            logger.info(f"[WF-CLEANUP] ✅ Force released {released_count} CDP browser(s)")
            logger.info(f"[WF-CLEANUP] CDP ports after force release: {_cdp_pool_manager.get_occupied_ports()}")
        except Exception as e:
            logger.error(f"[WF-CLEANUP] Error during force CDP release: {e}", exc_info=True)

    def skip_gracefully(self) -> None:
        logger.info("=" * 80)
        logger.info("⏭️  [WF-LIFECYCLE] skip_gracefully() CALLED",
                    extra={
                        "api_task_id": self.api_task_id,
                        "workforce_id": id(self)
                    })
        logger.info(f"[WF-LIFECYCLE] Current state before skip_gracefully: "
                    f"{self._state.name}, _running: {self._running}")
        logger.info("=" * 80)
        super().skip_gracefully()
        logger.info(
            f"[WF-LIFECYCLE] ✅ super().skip_gracefully() completed, "
            f"new state: {self._state.name}, _running: {self._running}")

    def pause(self) -> None:
        logger.info("=" * 80)
        logger.info("⏸️  [WF-LIFECYCLE] pause() CALLED",
                    extra={
                        "api_task_id": self.api_task_id,
                        "workforce_id": id(self)
                    })
        logger.info(f"[WF-LIFECYCLE] Current state before pause: "
                    f"{self._state.name}, _running: {self._running}")
        logger.info("=" * 80)
        super().pause()
        logger.info(
            f"[WF-LIFECYCLE] ✅ super().pause() completed, "
            f"new state: {self._state.name}, _running: {self._running}")

    def resume(self) -> None:
        logger.info("=" * 80)
        logger.info("▶️  [WF-LIFECYCLE] resume() CALLED",
                    extra={
                        "api_task_id": self.api_task_id,
                        "workforce_id": id(self)
                    })
        logger.info(f"[WF-LIFECYCLE] Current state before resume: "
                    f"{self._state.name}, _running: {self._running}")
        logger.info("=" * 80)
        super().resume()
        logger.info(
            f"[WF-LIFECYCLE] ✅ super().resume() completed, "
            f"new state: {self._state.name}, _running: {self._running}")

    async def cleanup(self) -> None:
        r"""Clean up resources when workforce is done"""
        try:
            # Clean up the task lock
            from app.service.task import delete_task_lock

            await delete_task_lock(self.api_task_id)
        except Exception as e:
            logger.error(f"Error cleaning up workforce resources: {e}")
