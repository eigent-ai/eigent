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

"""Closed async Workforce profile on Eigent/CAMEL's actual task scheduler.

Only explicit file workers are accepted. CAMEL's synchronous model entry
points, cloning/pooling, runtime worker creation and legacy cleanup are not
part of this profile. Retained tasks, not stop flags, prove local quiescence.
"""

from __future__ import annotations

import asyncio
from graphlib import TopologicalSorter

from camel.societies.workforce.prompts import (
    ASSIGN_TASK_PROMPT,
    TASK_DECOMPOSE_PROMPT,
)
from camel.societies.workforce.task_channel import TaskChannel
from camel.societies.workforce.utils import (
    FailureHandlingConfig,
    TaskAssignResult,
)
from camel.societies.workforce.workforce import WorkforceState
from camel.tasks.task import TaskState, parse_response, validate_task_content

from app.run_runtime.step_coordinator import (
    RunStepCoordinator,
    stable_step_id,
    step_scope,
)
from app.utils.single_agent_worker import SingleAgentWorker
from app.utils.workforce import Workforce, _persist_workforce_subtask_step
from app.workspace_runtime.agent_configuration import (
    AgentConfigurationUnavailable,
)


class ManagedFileWorker(SingleAgentWorker):
    def __init__(self, description, worker, execution):
        super().__init__(
            description,
            worker,
            use_agent_pool=False,
            use_structured_output_handler=True,
            enable_workflow_memory=False,
        )
        self.execution = execution
        self.retained_tasks = set()
        self._agent_lock = asyncio.Lock()
        self._stopping = False

    async def _get_worker_agent(self):
        await self._agent_lock.acquire()
        try:
            if self._stopping:
                raise AgentConfigurationUnavailable("workforce_stopping")
            self.execution.authorize()
            self.worker.reset()
            return self.worker
        except BaseException:
            self._agent_lock.release()
            raise

    async def _return_worker_agent(self, agent):
        if agent is not self.worker:
            self.execution.runtime.flag_unmanaged_writer()
            raise AgentConfigurationUnavailable("unowned_workforce_agent")
        self._agent_lock.release()

    async def _process_single_task(self, task):
        # CAMEL starts and tracks this actual worker coroutine. Retain its
        # handle even after CAMEL removes completed tasks from its live set.
        self.retained_tasks.add(asyncio.current_task())
        with step_scope(
            stable_step_id(
                self.execution.runtime.binding.run_id, f"subtask:{task.id}"
            )
        ):
            return await super()._process_single_task(task)

    def _record_memory_snapshot(self, worker_agent, task, response_content):
        # No legacy historical/workflow memory publication in this profile.
        pass

    def stop(self):
        if self._stopping:
            return
        self._stopping = True
        self._running = False
        self.retained_tasks.update(self._running_tasks)
        for task in self.retained_tasks:
            if not task.done():
                task.cancel()
        # Do not call CAMEL stop: it clears handles without joining them.

    async def drain(self):
        self.stop()
        await asyncio.gather(*self.retained_tasks, return_exceptions=True)
        if self._cleanup_task is not None or self.agent_pool is not None:
            self.execution.runtime.flag_unmanaged_writer()
            raise AgentConfigurationUnavailable("unowned_workforce_pool")


class ManagedWorkforce(Workforce):
    def __init__(self, options, execution, coordinator, planner, workers):
        self.execution = execution
        self._managed_failure = None
        self._managed_stopping = False
        self._closed_workers = tuple(workers)
        super().__init__(
            options.project_id,
            "Private file Workforce",
            coordinator_agent=coordinator,
            task_agent=planner,
            graceful_shutdown_timeout=0,
            share_memory=False,
            use_structured_output_handler=True,
            task_timeout_seconds=0,
            stall_timeout_seconds=0,
        )
        # CAMEL constructs temporary ChatAgents around the supplied models
        # and memories. Keep its appended management prompts, but restore the
        # actual factory-created ListenChatAgents before any model invocation.
        # No default backend, cloned tools, or hidden SDK clients are used.
        for name, agent in (
            ("coordinator_agent", coordinator),
            ("task_agent", planner),
        ):
            agent._system_message = getattr(self, name).system_message
            agent.init_messages()
            setattr(self, name, agent)
            self._attach_pause_event_to_agent(agent)
        self.new_worker_agent = None
        self.failure_handling_config = FailureHandlingConfig(
            enabled_strategies=[],
            max_retries=1,
        )
        self._children.extend(workers)
        for worker in workers:
            self._attach_pause_event_to_agent(worker.worker)
        self.set_channel(TaskChannel())

    def _initialize_callbacks(self, callbacks):
        # No default WorkforceLogger, filesystem dump, cloud metrics or
        # unverified telemetry callback is constructed, even transiently.
        if callbacks:
            raise AgentConfigurationUnavailable(
                "workforce_telemetry_unsupported"
            )
        self._callbacks = []

    def require_graph(self):
        if (
            tuple(self._children) != self._closed_workers
            or any(
                type(child) is not ManagedFileWorker
                for child in self._children
            )
            or self._callbacks
            or self.share_memory
            or self.new_worker_agent is not None
        ):
            self.execution.runtime.flag_unmanaged_writer()
            raise AgentConfigurationUnavailable("unowned_workforce_graph")
        self.execution.authorize()

    async def prepare(self, task):
        self.require_graph()
        if not validate_task_content(task.content, task.id):
            raise AgentConfigurationUnavailable("workforce_task_invalid")
        self._task = task
        task.state = TaskState.OPEN
        prompt = TASK_DECOMPOSE_PROMPT.format(
            content=task.content,
            child_nodes_info=self._get_child_nodes_info(),
            additional_info=task.additional_info,
        )
        result = await self.task_agent.astep(prompt)
        if result is None or result.terminated or result.msg is None:
            raise AgentConfigurationUnavailable(
                "workforce_decomposition_failed"
            )
        # Use CAMEL's real Task parser, parent links and dependency updater;
        # only its synchronous model call is replaced by the actual astep.
        subtasks = task._decompose_non_streaming(result, parse_response)
        if not 1 <= len(subtasks) <= 16:
            raise AgentConfigurationUnavailable(
                "workforce_decomposition_invalid"
            )
        self._update_dependencies_for_decomposition(task, subtasks)
        return subtasks

    async def _assign_tasks(self, tasks):
        self.require_graph()
        self.coordinator_agent.reset()
        tasks_info = "\n".join(
            f"Task ID: {task.id}\nContent: {task.content}" for task in tasks
        )
        prompt = ASSIGN_TASK_PROMPT.format(
            tasks_info=tasks_info,
            child_nodes_info=self._get_child_nodes_info(),
        )
        prompt = self.structured_handler.generate_structured_prompt(
            base_prompt=prompt,
            schema=TaskAssignResult,
            additional_instructions="Assign every task exactly once to an existing worker. Do not create workers.",
        )
        response = await self.coordinator_agent.astep(prompt)
        if response is None or response.terminated or response.msg is None:
            raise AgentConfigurationUnavailable("workforce_assignment_failed")
        # Strict parsing: no default worker, reassignment or dynamic fallback.
        result = TaskAssignResult.model_validate_json(response.msg.content)
        task_ids = {task.id for task in tasks}
        assigned_ids = [item.task_id for item in result.assignments]
        known = task_ids | {task.id for task in self._completed_tasks}
        if len(assigned_ids) != len(task_ids) or set(assigned_ids) != task_ids:
            raise AgentConfigurationUnavailable("workforce_assignment_invalid")
        graph = {}
        for item in result.assignments:
            if (
                item.assignee_id not in self._get_valid_worker_ids()
                or set(item.dependencies) - known
                or item.task_id in item.dependencies
            ):
                raise AgentConfigurationUnavailable(
                    "workforce_assignment_invalid"
                )
            graph[item.task_id] = item.dependencies
        tuple(TopologicalSorter(graph).static_order())
        self._update_task_dependencies_from_assignments(
            result.assignments, tasks
        )
        return result

    async def _post_task(self, task, assignee_id):
        try:
            self.require_graph()
            return await super()._post_task(task, assignee_id)
        except BaseException as error:
            self._managed_failure = error
            self.stop()
            raise

    async def _handle_completed_task(self, task):
        try:
            return await super()._handle_completed_task(task)
        except BaseException as error:
            self._managed_failure = error
            self.stop()
            raise

    async def _get_returned_task(self):
        # Local channel only; no detached task or ambient timeout policy.
        return await self._channel.get_returned_task_by_publisher(self.node_id)

    async def _handle_failed_task(self, task):
        try:
            return await super()._handle_failed_task(task)
        except BaseException as error:
            self._managed_failure = error
            self.stop()
            raise

    async def start(self):
        self.require_graph()
        # The inherited implementation is CAMEL start -> worker listeners ->
        # _listen_to_channel -> _post_ready_tasks -> TaskChannel ->
        # SingleAgentWorker._process_task -> completion/dependency propagation.
        await super().start()

    def stop(self):
        if self._managed_stopping:
            return
        self._managed_stopping = True
        self._stop_requested = True
        self._running = False
        self._state = WorkforceState.STOPPED
        self._pause_event.set()
        for worker in self._closed_workers:
            worker.stop()
        for listener in self._child_listening_tasks:
            if not listener.done():
                listener.cancel()

    async def drain(self):
        self.stop()
        # Joining listeners closes their wait_for-owned channel getter before
        # collecting final child handles. No timeout is a settlement proof.
        await asyncio.gather(
            *self._child_listening_tasks, return_exceptions=True
        )
        for worker in self._closed_workers:
            await worker.drain()
        # Close authored pending/running Steps only after their actual worker
        # tasks have stopped. These are Run-owned projections, not a stop proof.
        run_id = self.execution.runtime.binding.run_id
        steps = RunStepCoordinator(self.execution.adapter.journal).replay(
            run_id
        )
        from app.run_runtime.owned_tasks import get_task_lock

        projection = get_task_lock(self.api_task_id)
        for task in self._task.subtasks if self._task is not None else []:
            step = steps.get(stable_step_id(run_id, f"subtask:{task.id}"))
            if step is not None and step.status not in {
                "completed",
                "failed",
                "cancelled",
            }:
                await _persist_workforce_subtask_step(
                    projection,
                    task_id=task.id,
                    title=task.content,
                    agent_id=step.agent_id,
                    phase="cancelled"
                    if self.execution.runtime.cancelled.is_set()
                    else "failed",
                )
        if (
            tuple(self._children) != self._closed_workers
            or self._cleanup_task is not None
        ):
            self.execution.runtime.flag_unmanaged_writer()
            raise AgentConfigurationUnavailable("unowned_workforce_descendant")

    async def cleanup(self):
        await self.drain()

    def stop_gracefully(self):
        self.stop()

    def _analyze_task(self, *args, **kwargs):
        raise AgentConfigurationUnavailable("workforce_replanning_unsupported")

    async def _create_worker_node_for_task(self, *args, **kwargs):
        raise AgentConfigurationUnavailable(
            "dynamic_workforce_worker_unsupported"
        )

    async def _create_new_agent(self, *args, **kwargs):
        raise AgentConfigurationUnavailable(
            "dynamic_workforce_agent_unsupported"
        )

    def add_single_agent_worker(self, *args, **kwargs):
        raise AgentConfigurationUnavailable(
            "dynamic_workforce_worker_unsupported"
        )

    def add_role_playing_worker(self, *args, **kwargs):
        raise AgentConfigurationUnavailable("workforce_delegation_unsupported")

    def add_workforce(self, *args, **kwargs):
        raise AgentConfigurationUnavailable("workforce_delegation_unsupported")

    def clone(self, *args, **kwargs):
        raise AgentConfigurationUnavailable("workforce_warm_reuse_unsupported")
