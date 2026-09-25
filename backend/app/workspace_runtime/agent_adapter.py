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

"""Registered Single Agent → existing factory/model loop → owned file tools.

This profile has no legacy solver, browser, terminal, MCP, delegation, warm
reuse or arbitrary Python tool. The model and checkpoint tasks are joined;
only BoundRuntime's code-owned leaf process mutates the private workspace.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path

from .agent_configuration import AgentConfigurationUnavailable
from .agent_model_resources import AgentModelResources
from .bound_runtime import RuntimeBindingError, WorkerOperation
from .service import ExecutionPolicy, RuntimeConfiguration


@dataclass
class _Assembly:
    tools: list = field(default_factory=list)
    tool_names: list = field(default_factory=lambda: ["Managed File Toolkit"])
    toolkits_to_register_agent: list = field(default_factory=list)
    cleanup_toolkits: list = field(default_factory=list)
    observable_todo_toolkit: object = None
    browser_toolkit: object = None


class ManagedAgentExecution:
    def __init__(self, runtime, model_resources, project_id):
        self.runtime = runtime
        self.model_resources = model_resources
        self.project_id = project_id
        self.working_directory = str(runtime.binding.workspace.local_root)

    def _path(self, value):
        from .content import relative_path

        path = Path(value)
        if path.is_absolute():
            try:
                value = path.relative_to(self.working_directory).as_posix()
            except ValueError:
                raise ValueError(
                    "path is outside this execution workspace"
                ) from None
        relative_path(value)
        return value

    async def read_file(self, file_path: str) -> str:
        """Read one UTF-8 file in this execution's private workspace.

        Args:
            file_path: Relative path or an absolute path under the private workspace.
        """
        await self.model_resources.authorize_action()
        return (await self.runtime.read_file(self._path(file_path))).decode(
            "utf-8"
        )

    async def write_to_file(self, file_path: str, content: str) -> str:
        """Replace one file in the private workspace; parent directories must exist.

        Args:
            file_path: Relative path or an absolute path under the private workspace.
            content: Complete UTF-8 file content, at most one MiB.
        """
        from app.run_runtime.tool_checkpoint import get_current_tool_checkpoint
        from app.tool_validation import ToolPreWriteValidationError

        from .content import InvalidWorkspacePath

        await self.model_resources.authorize_action()
        checkpoint = get_current_tool_checkpoint()
        binding = self.runtime.binding
        if checkpoint is None or (
            checkpoint.run_id,
            checkpoint.attempt_id,
        ) != (binding.run_id, binding.attempt_id):
            raise RuntimeError(
                "file write requires this Attempt's tool checkpoint"
            )
        try:
            operation = WorkerOperation(
                "write", self._path(file_path), content.encode("utf-8")
            )
        except (
            ValueError,
            TypeError,
            InvalidWorkspacePath,
            RuntimeBindingError,
        ) as error:
            # Only validation before worker dispatch carries a no-write proof.
            # A worker failure below can have an authorized partial write.
            raise ToolPreWriteValidationError(
                "Invalid private-workspace file write",
                error_code="invalid_workspace_write",
                field="file_path_or_content",
                recovery={
                    "action": "Use a private relative path and at most one MiB of UTF-8 text."
                },
            ) from error
        receipt = await self.runtime.execute_worker(
            [operation],
            mutation_id=checkpoint.tool_call_id,
        )
        return "File saved: " + receipt.receipt_id

    def assemble(self, options):
        from camel.toolkits import FunctionTool

        from app.run_policy import ToolSafetyClass
        from app.run_runtime.tool_checkpoint import declare_tool_safety

        self.runtime.require_dispatch()
        if (
            options.project_id != self.project_id
            or options.task_id != self.runtime.binding.run_id
        ):
            raise RuntimeError("agent factory owner mismatch")
        read = FunctionTool(self.read_file)
        write = FunctionTool(self.write_to_file)
        read._toolkit_name = write._toolkit_name = "Managed File Toolkit"
        declare_tool_safety(read, ToolSafetyClass.SAFE_READ)
        return _Assembly(tools=[read, write])


class SingleAgentExecutionAdapter:
    session_mode = "single-agent"

    def __init__(
        self, journal, configuration, tokenizer, *, history_enabled=False
    ):
        if configuration.snapshot["session_mode"] != self.session_mode:
            raise AgentConfigurationUnavailable("agent_profile_mismatch")
        if tokenizer.reference != configuration.snapshot["tokenizer_ref"]:
            raise AgentConfigurationUnavailable("tokenizer_binding_changed")
        tokenizer.for_model(configuration.snapshot["model_type"])
        self.journal = journal
        self.configuration = configuration
        self.tokenizer = tokenizer
        self.history_enabled = history_enabled

    def policy(self, *, source_root, provider, authorize):
        def authorized(origin):
            if authorize(origin) is not True:
                return False
            self.configuration.credential()
            return True

        return ExecutionPolicy(
            principal_ref=self.configuration.snapshot["principal_ref"],
            configuration=self.configuration.configuration,
            source_root=source_root,
            provider=provider,
            resolve_runtime=self.resolve_runtime,
            authorize=authorized,
        )

    def resolve_runtime(self, request, workspace):
        if (
            self.tokenizer.reference
            != self.configuration.snapshot["tokenizer_ref"]
        ):
            raise AgentConfigurationUnavailable("tokenizer_binding_changed")
        self.tokenizer.for_model(self.configuration.snapshot["model_type"])
        environment = self.configuration.persist_environment(
            self.journal, request, workspace
        )
        # Explicit process values contain paths/identity only, never credentials
        # or a copy of the host process environment.
        root = str(workspace.local_root)
        return RuntimeConfiguration(
            environment=environment,
            configuration_revision=self.configuration.configuration_revision,
            env={
                "HOME": root,
                "TMPDIR": root,
                "CAMEL_WORKDIR": root,
                "file_save_path": root,
                "EIGENT_RUN_ID": request.request_id,
            },
            handler=lambda runtime: self._run(request, environment, runtime),
        )

    async def _run(self, request, environment, runtime):
        from app.run_runtime.owned_tasks import owned_tasks_scope

        if not self.history_enabled:
            return await self._run_owned(request, environment, runtime)
        # Capture/tokenization/diagnostics belong to the same writer barrier
        # as Agent work, including cancellation before model construction.
        async with owned_tasks_scope():
            return await self._run_owned(request, environment, runtime)

    async def _run_owned(self, request, environment, runtime):
        from app.run_context import RunContext, run_context_scope
        from app.run_journal.recorder import EventRecorder
        from app.run_journal.runtime import run_journal_scope
        from app.run_runtime.owned_tasks import (
            owned_tasks_scope,
            run_owned_thread,
            task_lock_scope,
        )
        from app.service.task import TaskLock
        from app.workspace_config.models import EffectiveEnvironmentSpec

        snapshot = self.configuration.snapshot
        workspace = runtime.binding.workspace
        prompt = request.envelope.get("prompt", "")
        context_source = None
        if self.history_enabled:
            from app.run_journal.managed_context_projection import (
                ContextSourceUnavailable,
                capture_managed_execution_context,
            )

            from .agent_context import record_context_failure

            try:
                context_source = await run_owned_thread(
                    capture_managed_execution_context,
                    self.journal,
                    request=request,
                    binding=runtime.binding,
                    configuration=self.configuration,
                    destination=snapshot["api_url"],
                )
            except ContextSourceUnavailable as error:
                await run_owned_thread(
                    record_context_failure,
                    self.journal,
                    project_id=request.project_id,
                    run_id=runtime.binding.run_id,
                    attempt_id=runtime.binding.attempt_id,
                    reason=str(error),
                )
                raise
            prompt = context_source.question
        elif request.kind == "follow_up":
            with self.journal._lock:
                message = self.journal._connection.execute(
                    """SELECT content FROM follow_up_requests
                    WHERE request_id=? AND project_id=? AND status='admitted'
                      AND admitted_run_id=?""",
                    (
                        request.request_id,
                        request.project_id,
                        runtime.binding.run_id,
                    ),
                ).fetchone()
            if message is None:
                raise AgentConfigurationUnavailable(
                    "canonical_message_unavailable"
                )
            prompt = message["content"]
        options = self.configuration.resolve_options(
            request, workspace, prompt=prompt
        )
        context = RunContext(
            space_id=snapshot["space_id"],
            project_id=request.project_id,
            run_id=request.request_id,
            task_id=request.request_id,
            attempt_id=runtime.binding.attempt_id,
            email="managed@local.invalid",
            user_id=None,
            working_directory=workspace.local_root,
            task_output_root=workspace.local_root,
            camel_log_dir=workspace.local_root,
            binding_source="managed_execution",
            workdir_mode="copy",
            browser_port=0,
            session_mode=snapshot["session_mode"],
            model_platform=options.model_platform,
            model_type=options.model_type,
        )
        recorder = EventRecorder(self.journal)

        class Projection(TaskLock):
            def add_human_input_listen(self, agent):
                # The legacy interaction bridge addresses the global Project
                # map. It cannot target this private Run projection yet.
                from app.permission_policy.runtime import (
                    ToolPermissionRejectedError,
                )

                raise ToolPermissionRejectedError(
                    "interactive_approval_unsupported for managed file tools"
                )

            async def put_queue(self, data):
                # Preserve the existing Agent semantic projections in the
                # canonical Run, without a legacy consumer or an unbounded queue.
                await recorder.record_legacy_step(
                    project_id=request.project_id,
                    run_id=request.request_id,
                    step=data.action.value,
                    data=getattr(data, "data", {}) or {},
                )

        projection = Projection(request.project_id, asyncio.Queue(), {})
        projection.run_context = context
        projection.current_task_id = request.request_id
        projection.working_directory = str(workspace.local_root)
        projection.task_output_root = str(workspace.local_root)
        projection.environment_spec_id = environment.environment_spec_id
        projection.permission_profile_revision = (
            environment.permission_profile_revision
        )
        record = self.journal.get_effective_environment_spec(
            environment.environment_spec_id
        )
        spec = EffectiveEnvironmentSpec.model_validate(record.spec)
        projection.thinking_effort_requested = (
            spec.thinking_effort_requested.value
        )
        projection.thinking_effort_effective = (
            spec.thinking_effort_effective.value
        )
        projection.provider_effort_parameter_name = (
            spec.provider_parameter_name
        )
        projection.provider_effort_parameter_value = spec.provider_value
        projection.provider_capability_revision = (
            spec.provider_capability_revision
        )
        projection.provider_model_transport = snapshot["provider_capability"][
            "api_mode"
        ]

        def authorize_model():
            runtime.require_dispatch()
            if self.tokenizer.reference != snapshot["tokenizer_ref"]:
                raise AgentConfigurationUnavailable(
                    "tokenizer_binding_changed"
                )
            if self.configuration.credential().api_key != options.api_key:
                raise AgentConfigurationUnavailable(
                    "credential_binding_changed"
                )

        with (
            run_context_scope(context),
            run_journal_scope(self.journal),
            task_lock_scope(projection),
        ):
            # Keep the original Agent scopes alive throughout drain. The
            # outer C5 owner additionally retains pre-Agent capture work.
            async with owned_tasks_scope():
                return await self._execute(
                    options,
                    runtime,
                    authorize_model,
                    context_source=context_source,
                )

    async def _execute(
        self, options, runtime, authorize_model, *, context_source=None
    ):
        from app.service.single_agent_service import managed_single_agent_turn

        resources = AgentModelResources(
            options=options,
            tokenizer=self.tokenizer,
            provider_capability=self.configuration.provider_capability,
            authorize=authorize_model,
            refresh_authorization=runtime.refresh_authorization,
            context_source=context_source,
            journal=self.journal,
        )
        execution = ManagedAgentExecution(
            runtime, resources, options.project_id
        )
        turn = asyncio.create_task(
            managed_single_agent_turn(options, execution)
        )
        cancelled = asyncio.create_task(runtime.cancelled.wait())
        try:
            done, _ = await asyncio.wait(
                {turn, cancelled}, return_when=asyncio.FIRST_COMPLETED
            )
            if cancelled in done:
                # Only the async model/agent waiter is cancelled. Every
                # checkpoint thread and file worker remains owned and
                # must drain before BoundRuntime can certify settlement.
                turn.cancel()
                await asyncio.gather(turn, return_exceptions=True)
                raise asyncio.CancelledError
            return await turn
        finally:
            cancelled.cancel()
            await asyncio.gather(cancelled, return_exceptions=True)
            if not turn.done():
                turn.cancel()
            await asyncio.gather(turn, return_exceptions=True)
            await resources.close()
