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

"""Canonical execution adapter for real, restricted Workforce task flow."""

from __future__ import annotations

import asyncio
import os
import sys

from .agent_adapter import SingleAgentExecutionAdapter
from .agent_configuration import AgentConfigurationUnavailable
from .agent_model_resources import (
    AgentModelResources,
    require_supported_instrumentation,
)


class ManagedWorkforceExecution:
    def __init__(
        self, adapter, options, runtime, authorize, context_source=None
    ):
        self.adapter = adapter
        self.options = options
        self.runtime = runtime
        self.authorize = authorize
        self.context_source = context_source
        self.resources = []
        self.agents = []
        self.workforce = None

    def create_resources(self):
        resources = AgentModelResources(
            options=self.options,
            tokenizer=self.adapter.tokenizer,
            provider_capability=self.adapter.configuration.provider_capability,
            authorize=self.authorize,
            refresh_authorization=self.runtime.refresh_authorization,
            context_source=self.context_source,
            journal=self.adapter.journal,
        )
        # Register before the model or Agent constructor can fail.
        self.resources.append(resources)
        return resources

    async def run(self):
        require_supported_instrumentation()
        if (
            os.environ.get("TRACEROOT_ENABLED", "").lower() == "true"
            or "traceroot" in sys.modules
        ):
            raise AgentConfigurationUnavailable(
                "workforce_telemetry_unsupported"
            )
        from camel.tasks.task import Task, TaskState

        from app.agent.factory.managed_workforce import (
            construct_managed_workforce,
        )

        self.workforce = construct_managed_workforce(self.options, self)
        task = Task(content=self.options.question, id=self.options.task_id)
        subtasks = await self.workforce.prepare(task)
        await self.workforce.eigent_start(subtasks)
        if self.workforce._managed_failure is not None:
            raise self.workforce._managed_failure
        if task.state != TaskState.DONE:
            raise AgentConfigurationUnavailable("workforce_task_failed")
        return str(task.result or "")

    async def close(self, turn, cancelled):
        cancelled.cancel()
        if not turn.done():
            turn.cancel()
        await asyncio.gather(turn, cancelled, return_exceptions=True)
        errors = []
        if self.workforce is not None:
            try:
                await self.workforce.drain()
            except BaseException as error:
                errors.append(error)
        for resources in self.resources:
            try:
                await resources.close()
            except BaseException as error:
                errors.append(error)
        if errors:
            self.runtime.flag_unmanaged_writer()
            raise errors[0]


class WorkforceExecutionAdapter(SingleAgentExecutionAdapter):
    session_mode = "workforce"

    async def _execute(
        self, options, runtime, authorize_model, *, context_source=None
    ):
        from app.run_runtime.owned_tasks import current_owned_tasks

        execution = ManagedWorkforceExecution(
            self, options, runtime, authorize_model, context_source
        )
        turn = asyncio.create_task(execution.run())
        cancelled = asyncio.create_task(runtime.cancelled.wait())
        try:
            done, _ = await asyncio.wait(
                {turn, cancelled}, return_when=asyncio.FIRST_COMPLETED
            )
            if cancelled in done:
                raise asyncio.CancelledError
            return await turn
        finally:
            # The owned cleanup task survives cancellation of this handler
            # (including repeated cancellations). The inherited scope drains
            # it plus actual model/tool checkpoint/projection work before the
            # BoundRuntime handler can finish and finalization can proceed.
            cleanup = current_owned_tasks().create_task(
                execution.close(turn, cancelled)
            )
            await asyncio.shield(cleanup)
