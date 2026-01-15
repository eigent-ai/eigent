import asyncio
from typing import Generator, List
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
        logger.info("=" * 80)
        logger.info("🧩 [DECOMPOSE] eigent_make_sub_tasks CALLED", extra={
            "api_task_id": self.api_task_id,
            "workforce_id": id(self),
            "task_id": task.id
        })
        logger.info(f"[DECOMPOSE] Task content preview: '{task.content[:200]}...'")
        logger.info(f"[DECOMPOSE] Has coordinator context: {bool(coordinator_context)}")
        logger.info(f"[DECOMPOSE] Current workforce state: {self._state.name}, _running: {self._running}")
        logger.info("=" * 80)

        if not validate_task_content(task.content, task.id):
            task.state = TaskState.FAILED
            task.result = "Task failed: Invalid or empty content provided"
            logger.warning("❌ [DECOMPOSE] Task rejected: Invalid or empty content", extra={
                "task_id": task.id,
                "content_preview": task.content[:50] + "..." if len(task.content) > 50 else task.content
            })
            raise UserException(code.error, task.result)

        logger.info(f"[DECOMPOSE] Resetting workforce state")
        self.reset()
        self._task = task
        self.set_channel(TaskChannel())
        self._state = WorkforceState.RUNNING
        task.state = TaskState.OPEN
        logger.info(f"[DECOMPOSE] Workforce reset complete, state: {self._state.name}")

        logger.info(f"[DECOMPOSE] Calling handle_decompose_append_task")
        subtasks = asyncio.run(
            self.handle_decompose_append_task(
                task, 
                reset=False, 
                coordinator_context=coordinator_context,
                on_stream_batch=on_stream_batch, 
                on_stream_text=on_stream_text
            )
        )
        logger.info("=" * 80)
        logger.info(f"✅ [DECOMPOSE] Task decomposition COMPLETED", extra={
            "api_task_id": self.api_task_id,
            "task_id": task.id,
            "subtasks_count": len(subtasks)
        })
        logger.info("=" * 80)
        return subtasks

    async def eigent_start(self, subtasks: list[Task]):
        """start the workforce"""
        logger.info("=" * 80)
        logger.info("▶️  [WF-LIFECYCLE] eigent_start CALLED", extra={"api_task_id": self.api_task_id, "workforce_id": id(self)})
        logger.info(f"[WF-LIFECYCLE] Starting workforce execution with {len(subtasks)} subtasks")
        logger.info(f"[WF-LIFECYCLE] Current workforce state: {self._state.name}, _running: {self._running}")
        logger.info("=" * 80)
        self._pending_tasks.extendleft(reversed(subtasks))
        # Save initial snapshot
        self.save_snapshot("Initial task decomposition")

        try:
            logger.info(f"[WF-LIFECYCLE] Calling base class start() method")
            await self.start()
            logger.info(f"[WF-LIFECYCLE] ✅ Base class start() method completed")
        except Exception as e:
            logger.error(f"[WF-LIFECYCLE] ❌ Error in workforce execution: {e}", extra={
                "api_task_id": self.api_task_id,
                "error": str(e)
            }, exc_info=True)
            self._state = WorkforceState.STOPPED
            logger.info(f"[WF-LIFECYCLE] Workforce state set to STOPPED after error")
            raise
        finally:
            logger.info(f"[WF-LIFECYCLE] eigent_start finally block, current state: {self._state.name}")
            if self._state != WorkforceState.STOPPED:
                self._state = WorkforceState.IDLE
                logger.info(f"[WF-LIFECYCLE] Workforce state set to IDLE")

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
        logger.info(f"[DECOMPOSE] handle_decompose_append_task CALLED, task_id={task.id}, reset={reset}")

        if not validate_task_content(task.content, task.id):
            task.state = TaskState.FAILED
            task.result = "Task failed: Invalid or empty content provided"
            logger.warning(
                f"[DECOMPOSE] Task {task.id} rejected: Invalid or empty content. "
                f"Content preview: '{task.content}'"
            )
            return [task]

        if reset and self._state != WorkforceState.RUNNING:
            logger.info(f"[DECOMPOSE] Resetting workforce (reset={reset}, state={self._state.name})")
            self.reset()
            logger.info("[DECOMPOSE] Workforce reset complete")

        self._task = task
        task.state = TaskState.FAILED

        if coordinator_context:
            logger.info(f"[DECOMPOSE] Adding coordinator context to task")
            original_content = task.content
            task_with_context = coordinator_context
            if coordinator_context:
                task_with_context += "\n=== CURRENT TASK ===\n"
            task_with_context += original_content
            task.content = task_with_context

            logger.info(f"[DECOMPOSE] Calling _decompose_task with context")
            subtasks_result = self._decompose_task(task, stream_callback=on_stream_text)

            task.content = original_content
        else:
            logger.info(f"[DECOMPOSE] Calling _decompose_task without context")
            subtasks_result = self._decompose_task(task, stream_callback=on_stream_text)

        logger.info(f"[DECOMPOSE] _decompose_task returned, processing results")
        if isinstance(subtasks_result, Generator):
            subtasks = []
            for new_tasks in subtasks_result:
                subtasks.extend(new_tasks)
                if on_stream_batch:
                    try:
                        on_stream_batch(new_tasks, False)
                    except Exception as e:
                        logger.warning(f"Streaming callback failed: {e}")
            logger.info(f"[DECOMPOSE] Collected {len(subtasks)} subtasks from generator")

            # After consuming the generator, check task.subtasks for final result as fallback
            if not subtasks and task.subtasks:
                subtasks = task.subtasks
        else:
            subtasks = subtasks_result
            logger.info(f"[DECOMPOSE] Got {len(subtasks) if subtasks else 0} subtasks directly")

        if subtasks:
            self._pending_tasks.extendleft(reversed(subtasks))
            logger.info(f"[DECOMPOSE] ✅ Appended {len(subtasks)} subtasks to pending tasks")

        if not subtasks:
            logger.warning(f"[DECOMPOSE] No subtasks returned, creating fallback task")
            fallback_task = Task(
                content=task.content,
                id=f"{task.id}.1",
                parent=task,
            )
            task.subtasks = [fallback_task]
            subtasks = [fallback_task]
            logger.info(f"[DECOMPOSE] Created fallback task: {fallback_task.id}")

        if on_stream_batch:
            try:
                on_stream_batch(subtasks, True)
            except Exception as e:
                logger.warning(f"Final streaming callback failed: {e}")

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
            context_utility=None, # Will be set during save/load operations
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

        return await super()._handle_completed_task(task)

    async def _handle_failed_task(self, task: Task) -> bool:
        # DEBUG ▶ Task failed
        logger.debug(f"[WF] FAIL  {task.id} retry={task.failure_count}")

        result = await super()._handle_failed_task(task)

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

        # Cleanup all agents before stopping
        self._cleanup_all_agents()

        super().stop_gracefully()
        logger.info(f"[WF-LIFECYCLE] ✅ super().stop_gracefully() completed, new state: {self._state.name}, _running: {self._running}")

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
