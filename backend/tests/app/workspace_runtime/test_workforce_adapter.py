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

"""Real Workforce/factories/CAMEL/SDK clients; replace only model and token I/O."""

import asyncio
import json
import os
import re
from pathlib import Path

import pytest

from app.run_runtime.step_coordinator import stable_step_id
from app.workspace_runtime.agent_configuration import (
    AgentConfigurationUnavailable,
)
from app.workspace_runtime.workforce_adapter import WorkforceExecutionAdapter
from tests.app.workspace_runtime import test_agent_adapter as agent_fixtures
from tests.app.workspace_runtime.test_agent_adapter import (
    configuration,
    model_boundary,
    register as register_single,
    response,
)
from tests.app.workspace_runtime.test_service import eventually

no_network = agent_fixtures.no_network
tokenizer = agent_fixtures.tokenizer
world = agent_fixtures.world


def register(
    world,
    tokenizer,
    project,
    *,
    space="space",
    git=False,
    config=None,
    authorize=None,
):
    old = world.register(project, lambda *_: None, space=space, git=git)
    world.registry.revoke(project)
    config = config or configuration(
        world, tokenizer, project, space, session_mode="workforce"
    )
    adapter = WorkforceExecutionAdapter(world.journal, config, tokenizer)
    original = adapter._run
    if not hasattr(world, "agent_errors"):
        world.agent_errors = []

    async def observed(*args):
        try:
            return await original(*args)
        except Exception as error:
            world.agent_errors.append(error)
            raise

    adapter._run = observed
    policy = adapter.policy(
        source_root=old.source_root,
        provider=old.provider,
        authorize=authorize or (lambda _origin: True),
    )
    world.registry.register(project, policy)
    world.policies[project] = policy
    return adapter, policy


class ModelScript:
    def __init__(
        self, monkeypatch, worker_reply=None, *, dependent=False, assign=None
    ):
        from app.agent.factory import managed_workforce

        self.executions = {}
        self.captures = []
        self.calls = []
        self.worker_reply = worker_reply
        self.dependent = dependent
        self.assign = assign
        construct = managed_workforce.construct_managed_workforce

        def observe(options, execution):
            self.executions[options.task_id] = execution
            return construct(options, execution)

        monkeypatch.setattr(
            managed_workforce, "construct_managed_workforce", observe
        )
        model_boundary(monkeypatch, self.respond, self.captures)

    async def respond(self, context, call, messages):
        system = messages[0]["content"]
        if system.startswith("Decompose the requested"):
            role = "planner"
        elif system.startswith("Coordinate only"):
            role = "coordinator"
        elif system.startswith("File author"):
            role = "author"
        elif system.startswith("File editor"):
            role = "editor"
        else:
            role = "single"
        self.calls.append((context.run_id, role, call))
        if role == "planner":
            return response(
                content="<task>Author the requested text file</task><task>Review the requested text file</task>"
            )
        if role == "coordinator":
            workforce = self.executions[context.run_id].workforce
            ids = re.findall(r"Task ID: ([^\n]+)", messages[-1]["content"])
            assert len(ids) == 2
            assignments = [
                {
                    "task_id": task_id,
                    "assignee_id": workforce._children[index].node_id,
                    "dependencies": [ids[0]]
                    if self.dependent and index == 1
                    else [],
                }
                for index, task_id in enumerate(ids)
            ]
            if self.assign:
                self.assign(assignments)
            return response(content=json.dumps({"assignments": assignments}))
        if self.worker_reply:
            return await self.worker_reply(context, role, call, messages)
        if call == 1:
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": context.run_id + "-" + role + ".txt",
                    "content": context.run_id + "-" + role,
                },
                # Deliberately identical across independent model conversations.
                call_id="file-call",
            )
        return response(
            content=json.dumps(
                {
                    "content": "Successfully wrote the requested private text file.",
                    "failed": False,
                }
            )
        )


def assert_drained(execution):
    from app.agent.listen_chat_agent import ListenChatAgent
    from app.utils.managed_workforce import ManagedWorkforce

    workforce = execution.workforce
    assert type(workforce) is ManagedWorkforce
    assert workforce.coordinator_agent is execution.agents[0]
    assert workforce.task_agent is execution.agents[1]
    assert len(execution.agents) == len(execution.resources) == 4
    assert all(type(agent) is ListenChatAgent for agent in execution.agents)
    assert all(
        resource.async_client.is_closed() and resource.sync_client.is_closed()
        for resource in execution.resources
    )
    assert all(task.done() for task in workforce._child_listening_tasks)
    assert all(
        task.done()
        for child in workforce._children
        for task in child.retained_tasks
    )
    assert all(child.agent_pool is None for child in workforce._children)
    assert not workforce._callbacks


@pytest.mark.asyncio
@pytest.mark.parametrize("git", [False, True])
@pytest.mark.parametrize("cross_space", [False, True])
@pytest.mark.parametrize("mixed", [False, True])
async def test_real_workforces_overlap_and_publish(
    world, tokenizer, monkeypatch, git, cross_space, mixed
):
    arrived = {}
    release = asyncio.Event()
    expected = 3 if mixed else 4
    env, cwd = dict(os.environ), Path.cwd()

    async def workers(context, role, call, messages):
        if call == 1:
            arrived[(context.run_id, role)] = context
            if len(arrived) == expected:
                release.set()
            await release.wait()
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": context.run_id + "-" + role + ".txt",
                    "content": context.project_id + "-" + role,
                },
            )
        return response(
            content=json.dumps(
                {
                    "content": "The private file was written and checked successfully.",
                    "failed": False,
                }
            )
        )

    script = ModelScript(monkeypatch, workers)
    _, a = register(world, tokenizer, "a", space="one", git=git)
    constructor = register_single if mixed else register
    _, b = constructor(
        world, tokenizer, "b", space="two" if cross_space else "one", git=git
    )
    await world.submit("a", "run-a")
    await world.submit("b", "run-b")
    await world.service.start()
    await eventually(
        lambda: (
            world.agent_errors
            or (world.completed("run-a") and world.completed("run-b"))
        ),
        timeout=15,
    )
    assert not world.agent_errors
    assert len(arrived) == expected
    for project, policy in (("a", a), ("b", b)):
        roles = (
            ["single"] if mixed and project == "b" else ["author", "editor"]
        )
        for role in roles:
            path = policy.source_root / (
                "run-" + project + "-" + role + ".txt"
            )
            await eventually(path.exists)
            assert path.read_text() == project + "-" + role
        calls = world.journal.list_tool_calls("run-" + project)
        assert len(calls) == len(roles)
        assert all(call.status == "completed" for call in calls)
        assert len({call.tool_call_id for call in calls}) == len(roles)
        if roles != ["single"]:
            run_id = "run-" + project
            assert {call.tool_call_id for call in calls} == {
                f"{run_id}:{stable_step_id(run_id, f'subtask:{run_id}.{index}')}:file-call"
                for index in (1, 2)
            }
    assert len(script.captures) == (5 if mixed else 8)
    for capture in script.captures:
        assert capture["model_config_dict"]["stream"] is False
        assert capture["model_config_dict"]["reasoning_effort"] == "medium"
        assert (
            capture["client"].project == capture["client"].organization == ""
        )
        assert capture["async_client"]._client._trust_env is False
    for execution in script.executions.values():
        assert_drained(execution)
        assert len(execution.workforce._completed_tasks) == 3
    assert (
        len({context.working_directory for context in arrived.values()}) == 2
    )
    assert dict(os.environ) == env and Path.cwd() == cwd


@pytest.mark.asyncio
@pytest.mark.parametrize("git", [False, True])
async def test_actual_task_dependencies_and_private_handoff(
    world, tokenizer, monkeypatch, git
):
    script = None
    seen_content = []

    async def workers(context, role, call, messages):
        if role == "author":
            if call == 1:
                return response(
                    tool="write_to_file",
                    arguments={
                        "file_path": "draft.txt",
                        "content": "private draft",
                    },
                )
        elif call == 1:
            workforce = script.executions[context.run_id].workforce
            assert workforce._completed_tasks[0].id.endswith(".1")
            return response(
                tool="read_file", arguments={"file_path": "draft.txt"}
            )
        elif call == 2:
            assert messages[-1]["content"] == "private draft"
            seen_content.append(messages[-1]["content"])
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": "checked.txt",
                    "content": "checked private draft",
                },
                call_id="second",
            )
        return response(
            content=json.dumps(
                {
                    "content": "The requested work is completed with the private file content.",
                    "failed": False,
                }
            )
        )

    script = ModelScript(monkeypatch, workers, dependent=True)
    _, policy = register(world, tokenizer, "p", git=git)
    await world.submit("p", "run")
    await world.service.start()
    await eventually(
        lambda: world.agent_errors or world.completed("run"), timeout=12
    )
    assert not world.agent_errors
    await eventually(lambda: (policy.source_root / "checked.txt").exists())
    assert seen_content == ["private draft"]
    execution = script.executions["run"]
    assert_drained(execution)
    tasks = execution.workforce._task.subtasks
    assert tasks[1].dependencies[0] is tasks[0]
    assert all(task.state == "DONE" for task in tasks)
    worker_steps = {
        stable_step_id("run", f"subtask:run.{index}") for index in (1, 2)
    }
    invocations = world.journal.list_model_invocations("run")
    assert worker_steps.issubset({item.step_id for item in invocations})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode", ["unknown_worker", "unknown_task", "cycle", "missing", "duplicate"]
)
async def test_unapproved_assignments_fail_before_worker_model_or_tools(
    world, tokenizer, monkeypatch, mode
):
    def invalid(items):
        if mode == "unknown_worker":
            items[0]["assignee_id"] = "browser"
        elif mode == "unknown_task":
            items[0]["dependencies"] = ["external"]
        elif mode == "cycle":
            items[0]["dependencies"] = [items[1]["task_id"]]
            items[1]["dependencies"] = [items[0]["task_id"]]
        elif mode == "missing":
            items.pop()
        else:
            items[1]["task_id"] = items[0]["task_id"]

    script = ModelScript(monkeypatch, assign=invalid)
    register(world, tokenizer, "p")
    await world.submit("p", "run")
    await world.service.start()
    await eventually(lambda: bool(world.agent_errors))
    await eventually(lambda: world.journal.get_run("run").status == "failed")
    assert not world.journal.list_tool_calls("run")
    assert [role for _, role, _ in script.calls] == ["planner", "coordinator"]
    assert_drained(script.executions["run"])


@pytest.mark.asyncio
async def test_adapters_require_their_exact_profile(world, tokenizer):
    from app.workspace_runtime.agent_adapter import SingleAgentExecutionAdapter

    workforce_config = configuration(
        world, tokenizer, "p", "space", session_mode="workforce"
    )
    single_config = configuration(world, tokenizer, "p", "space")
    with pytest.raises(
        AgentConfigurationUnavailable, match="agent_profile_mismatch"
    ):
        SingleAgentExecutionAdapter(world.journal, workforce_config, tokenizer)
    with pytest.raises(
        AgentConfigurationUnavailable, match="agent_profile_mismatch"
    ):
        WorkforceExecutionAdapter(world.journal, single_config, tokenizer)
    assert (
        workforce_config.configuration_revision
        != single_config.configuration_revision
    )


def assert_barrier_held(world, run_id, successor=None):
    with world.journal._lock:
        assert (
            world.journal._connection.execute(
                "SELECT state FROM run_workspace_finalizations WHERE run_id=?",
                (run_id,),
            ).fetchone()[0]
            != "settled"
        )
    if successor is not None:
        assert world.journal.get_run(successor) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("git", [False, True])
async def test_send_now_drains_both_workers_and_sdk_before_fifo_handoff(
    world, tokenizer, monkeypatch, git
):
    from openai import AsyncOpenAI

    partial = asyncio.Event()
    partial_workers = set()
    other_ready = set()
    other_release = asyncio.Event()
    ordinary_release = asyncio.Event()
    closing = asyncio.Event()
    close_release = asyncio.Event()
    entered = []
    owners = {}
    close = AsyncOpenAI.close
    script = None

    async def gated_close(client):
        execution = script.executions.get("active")
        if (
            execution is not None
            and client is execution.resources[0].async_client
        ):
            closing.set()
            await close_release.wait()
        await close(client)

    monkeypatch.setattr(AsyncOpenAI, "close", gated_close)

    async def workers(context, role, call, messages):
        if call == 1:
            if role == "author":
                entered.append(context.run_id)
            if context.run_id == "other":
                other_ready.add(role)
                await other_release.wait()
            if context.run_id == "ordinary":
                await ordinary_release.wait()
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": context.run_id + "-" + role + ".txt",
                    "content": "owned partial " + role,
                },
            )
        if context.run_id == "active":
            partial_workers.add(role)
            if len(partial_workers) == 2:
                partial.set()
            await asyncio.Event().wait()
        return response(
            content=json.dumps(
                {
                    "content": "The private file task was completed successfully.",
                    "failed": False,
                }
            )
        )

    script = ModelScript(monkeypatch, workers)
    adapter, policy = register(world, tokenizer, "p", git=git)
    register(world, tokenizer, "other", space="elsewhere", git=git)
    run = adapter._run

    async def retain_owner(*args):
        owners[args[0].request_id] = asyncio.current_task()
        return await run(*args)

    adapter._run = retain_owner
    await world.submit("p", "active")
    await world.submit("other", "other")
    await world.service.start()
    try:
        await asyncio.wait_for(partial.wait(), 8)
        await eventually(lambda: len(other_ready) == 2)
        await world.submit("p", "ordinary", followup=True)
        await world.submit("p", "urgent", followup=True)
        assert world.journal.get_run("ordinary") is None
        await world.service.set_delivery(
            "urgent",
            origin=world.origin,
            delivery_mode="send_now",
            operation_id="workforce-send-now",
        )
        await asyncio.wait_for(closing.wait(), 8)
        for _ in range(3):
            owners["active"].cancel()
            await asyncio.sleep(0)
            assert_barrier_held(world, "active", "urgent")
            assert not owners["active"].done()
        assert world.journal.get_run("other").cancel_request_id is None
        assert not any(
            task.done()
            for child in script.executions["other"].workforce._children
            for task in child.retained_tasks
        )
        close_release.set()
        await eventually(
            lambda: "ordinary" in entered or world.agent_errors, timeout=12
        )
        assert not world.agent_errors
        assert [value for value in entered if value != "other"] == [
            "active",
            "urgent",
            "ordinary",
        ]
        assert_drained(script.executions["active"])
        assert world.journal.get_run("active").status == "cancelled"
        artifacts = await world.service.artifacts(
            "active", origin=world.origin
        )
        artifact = next(
            item
            for item in artifacts["artifacts"]
            if item["relativePath"] == "active-author.txt"
        )
        assert (
            await world.service.read_artifact(
                "active", artifact["artifact_id"], origin=world.origin
            )
            == b"owned partial author"
        )
        assert not (policy.source_root / "active-author.txt").exists()
        ordinary_release.set()
        other_release.set()
        await eventually(
            lambda: world.completed("ordinary") and world.completed("other")
        )
        assert len(world.journal.list_run_attempts("urgent")) == 1
        assert len(world.journal.list_run_attempts("ordinary")) == 1
        assert not world.agent_errors
    finally:
        close_release.set()
        ordinary_release.set()
        other_release.set()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "revoke", ["permission", "credential", "key_rotation"]
)
async def test_revocation_does_not_change_another_workforce(
    world, tokenizer, monkeypatch, revoke
):
    from app.workspace_runtime.agent_configuration import ResolvedCredential

    allowed = {"a": True, "b": True}
    ready, stopped = set(), set()
    release = asyncio.Event()

    async def workers(context, role, call, messages):
        if call == 1:
            ready.add((context.project_id, role))
            try:
                await release.wait()
            except asyncio.CancelledError:
                stopped.add(context.project_id)
                raise
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": context.project_id + "-" + role + ".txt",
                    "content": "owned",
                },
            )
        return response(
            content=json.dumps(
                {
                    "content": "The requested file was written successfully.",
                    "failed": False,
                }
            )
        )

    script = ModelScript(monkeypatch, workers)
    for project in ("a", "b"):

        def credential(ref, principal, project=project):
            if not allowed[project] and revoke == "credential":
                raise LookupError("revoked synthetic credential")
            suffix = (
                "-rotated"
                if not allowed[project] and revoke == "key_rotation"
                else ""
            )
            return ResolvedCredential(
                ref, principal, "synthetic-" + project + suffix
            )

        config = configuration(
            world,
            tokenizer,
            project,
            "space",
            session_mode="workforce",
            credential_resolver=credential,
        )
        register(
            world,
            tokenizer,
            project,
            config=config,
            authorize=lambda _origin, project=project: (
                allowed[project] if revoke == "permission" else True
            ),
        )
        await world.submit(project, "run-" + project)
    await world.service.start()
    try:
        await eventually(lambda: len(ready) == 4)
        allowed["a"] = False
        if revoke == "key_rotation":
            # Rotation is detected at the real returned tool's dispatch guard.
            release.set()
        else:
            await eventually(lambda: "a" in stopped)
            assert "b" not in stopped
            release.set()
        await eventually(lambda: world.completed("run-b"))
        await eventually(
            lambda: (
                world.journal.get_run("run-a").status
                in {"failed", "cancelled"}
            )
        )
        assert not (world.policies["a"].source_root / "a-author.txt").exists()
        assert not (world.policies["a"].source_root / "a-editor.txt").exists()
        assert world.journal.get_run("run-b").cancel_request_id is None
        assert_drained(script.executions["run-a"])
        assert_drained(script.executions["run-b"])
    finally:
        release.set()


@pytest.mark.asyncio
@pytest.mark.parametrize("stop", ["cancel", "close"])
@pytest.mark.parametrize("phase", ["prepare", "finish", "subtask"])
async def test_real_checkpoint_writers_drain_through_workforce_cancellation(
    world, tokenizer, monkeypatch, stop, phase
):
    import threading

    from app.agent import listen_chat_agent

    entered, release = threading.Event(), threading.Event()
    draining = asyncio.Event()
    owners = {}
    waiter = None
    script = ModelScript(monkeypatch)
    adapter, policy = register(world, tokenizer, "p")
    run = adapter._run

    async def observe_owner(*args):
        owners[args[0].request_id] = asyncio.current_task()
        return await run(*args)

    adapter._run = observe_owner
    if phase == "subtask":
        target = world.journal
        name = "persist_workforce_subtask_step"
        original = getattr(target, name)

        def gated(**kwargs):
            if kwargs["phase"] == "running" and kwargs["task_id"].endswith(
                ".1"
            ):
                entered.set()
                assert release.wait(10)
            return original(**kwargs)
    else:
        target = listen_chat_agent
        name = (
            "prepare_tool_checkpoint"
            if phase == "prepare"
            else "finish_tool_checkpoint"
        )
        original = getattr(target, name)

        def gated(*args, **kwargs):
            if (
                kwargs.get("task_id")
                or getattr(args[0] if args else None, "task_id", "")
            ).endswith(".1"):
                entered.set()
                assert release.wait(10)
            return original(*args, **kwargs)

    monkeypatch.setattr(target, name, gated)
    from app.workspace_runtime.workforce_adapter import (
        ManagedWorkforceExecution,
    )

    original_close = ManagedWorkforceExecution.close

    async def observed_close(execution, *args):
        draining.set()
        return await original_close(execution, *args)

    monkeypatch.setattr(ManagedWorkforceExecution, "close", observed_close)
    await world.submit("p", "active")
    await world.service.start()
    try:
        await eventually(entered.is_set)
        await world.submit("p", "successor", followup=True)
        waiter = asyncio.create_task(
            world.service.close()
            if stop == "close"
            else world.service.cancel("active", origin=world.origin)
        )
        await asyncio.wait_for(draining.wait(), 5)
        waiter.cancel()
        await asyncio.gather(waiter, return_exceptions=True)
        for _ in range(3):
            owners["active"].cancel()
            await asyncio.sleep(0)
            assert_barrier_held(world, "active", "successor")
            assert not owners["active"].done()
        release.set()
        if stop == "close":
            await world.service.close()
        await eventually(lambda: "active" not in world.service._tasks)
        assert_drained(script.executions["active"])
        calls = world.journal.list_tool_calls("active")
        assert all(
            call.status not in {"prepared", "dispatched"} for call in calls
        )
        assert not (policy.source_root / "active-author.txt").exists()
        if phase == "finish":
            artifacts = await world.service.artifacts(
                "active", origin=world.origin
            )
            artifact = next(
                item
                for item in artifacts["artifacts"]
                if item["relativePath"] == "active-author.txt"
            )
            assert (
                await world.service.read_artifact(
                    "active", artifact["artifact_id"], origin=world.origin
                )
                == b"active-author"
            )
        if stop == "cancel":
            await eventually(lambda: world.completed("successor"))
    finally:
        release.set()
        if waiter is not None:
            await asyncio.gather(waiter, return_exceptions=True)


@pytest.mark.asyncio
async def test_partial_real_factory_construction_closes_every_created_sdk(
    world, tokenizer, monkeypatch
):
    from camel.models import ModelFactory

    script = ModelScript(monkeypatch)
    create = ModelFactory.create
    calls = 0

    def fail_third(**kwargs):
        nonlocal calls
        calls += 1
        if calls == 3:
            raise RuntimeError("synthetic model constructor failure")
        return create(**kwargs)

    monkeypatch.setattr(ModelFactory, "create", fail_third)
    register(world, tokenizer, "p")
    await world.submit("p", "run")
    await world.service.start()
    await eventually(lambda: bool(world.agent_errors))
    await eventually(lambda: world.journal.get_run("run").status == "failed")
    execution = script.executions["run"]
    assert execution.workforce is None
    assert len(execution.resources) == 3
    assert all(
        item.async_client.is_closed() and item.sync_client.is_closed()
        for item in execution.resources
    )
    assert not world.journal.list_model_invocations("run")
    assert not world.journal.list_tool_calls("run")


@pytest.mark.asyncio
async def test_every_workforce_agent_uses_frozen_configuration_and_permission(
    world, tokenizer, monkeypatch
):
    from app.permission_policy import PRESET_PROFILES, PermissionProfileName
    from app.workspace_config.capabilities import ModelCapabilityRegistry

    parameters = {"max_completion_tokens": 7000, "temperature": 0.5}
    config = configuration(
        world,
        tokenizer,
        "p",
        "space",
        session_mode="workforce",
        model_config_dict=parameters,
        api_url="https://model.invalid/owned/v1",
        permission_profile_revision=PRESET_PROFILES[
            PermissionProfileName.READ_ONLY
        ].revision,
    )
    reads = set()

    async def workers(context, role, call, messages):
        assert context.session_mode == "workforce"
        if call == 1:
            return response(
                tool="read_file", arguments={"file_path": "input.txt"}
            )
        if call == 2:
            assert messages[-1]["content"] == "original"
            reads.add(role)
            return response(
                tool="write_to_file",
                arguments={"file_path": "input.txt", "content": role},
                call_id="write",
            )
        assert "permission_denied" in messages[-1]["content"]
        return response(
            content=json.dumps(
                {
                    "content": "Read the original; the requested modification was denied by policy.",
                    "failed": False,
                }
            )
        )

    script = ModelScript(monkeypatch, workers)
    _, policy = register(world, tokenizer, "p", config=config)
    (policy.source_root / "input.txt").write_text("original")
    await world.submit("p", "run")
    parameters["max_completion_tokens"] = 9
    config.snapshot["workforce"]["workers"].append("browser")

    def no_latest(*_args, **_kwargs):
        raise AssertionError("no ambient/latest model capability")

    monkeypatch.setattr(ModelCapabilityRegistry, "resolve", no_latest)
    await world.service.start()
    await eventually(lambda: world.completed("run") or world.agent_errors)
    assert not world.agent_errors
    assert reads == {"author", "editor"}
    assert (policy.source_root / "input.txt").read_text() == "original"
    assert len(script.captures) == 4
    for capture in script.captures:
        assert capture["model_config_dict"]["max_completion_tokens"] == 7000
        assert capture["model_config_dict"]["temperature"] == 0.5
        assert capture["model_config_dict"]["reasoning_effort"] == "medium"
        assert capture["model_config_dict"]["stream"] is False
        assert (
            str(capture["async_client"].base_url)
            == "https://model.invalid/owned/v1/"
        )
        assert capture["async_client"].api_key == "synthetic-p"
    attempt = world.journal.list_run_attempts("run")[0]
    spec = world.journal.get_effective_environment_spec(
        attempt.environment_spec_id
    )
    manifest = spec.spec["semantic_spec"]["runtime_capability_manifest"]
    assert manifest["configuration_revision"] == config.configuration_revision
    assert (
        attempt.permission_profile_revision
        == config.snapshot["permission_profile_revision"]
    )
    assert "synthetic-p" not in json.dumps(spec.spec)
    calls = world.journal.list_tool_calls("run")
    assert len(calls) == 4
    assert sum(call.status == "completed" for call in calls) == 2
    assert not world.journal.list_approvals("run")
    execution = script.executions["run"]
    assert all(not agent.tool_dict for agent in execution.agents[:2])
    assert all(
        set(agent.tool_dict) == {"read_file", "write_to_file"}
        for agent in execution.agents[2:]
    )
    assert_drained(execution)


@pytest.mark.asyncio
async def test_workforce_queue_configuration_rebind_waits_for_exact_revision(
    world, tokenizer, monkeypatch
):
    script = ModelScript(monkeypatch)
    _, original = register(world, tokenizer, "p")
    await world.submit("p", "run")
    changed = configuration(
        world,
        tokenizer,
        "p",
        "space",
        session_mode="workforce",
        model_config_dict={"max_completion_tokens": 999},
    )
    adapter = WorkforceExecutionAdapter(world.journal, changed, tokenizer)
    world.registry.revoke("p")
    world.registry.register(
        "p",
        adapter.policy(
            source_root=original.source_root,
            provider=original.provider,
            authorize=lambda _origin: True,
        ),
    )
    await world.service.start()
    await eventually(lambda: world.service.admission.get("run").wait_reason)
    assert not script.captures and world.journal.get_run("run") is None
    world.registry.revoke("p")
    world.registry.register("p", original)
    await eventually(lambda: world.completed("run"))
    assert len(script.captures) == 4
    assert all(
        "max_completion_tokens" not in item["model_config_dict"]
        for item in script.captures
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["open", "complete"])
async def test_planner_model_capture_drains_before_workforce_finalizer(
    world, tokenizer, monkeypatch, phase
):
    import threading

    from app.run_journal import model_capture
    from app.workspace_runtime.workforce_adapter import (
        ManagedWorkforceExecution,
    )

    entered, release = threading.Event(), threading.Event()
    closing = asyncio.Event()
    target, name = (
        (model_capture, "_start_capture")
        if phase == "open"
        else (model_capture._CaptureSession, "complete")
    )
    original = getattr(target, name)

    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(10)
        return original(*args, **kwargs)

    monkeypatch.setattr(target, name, blocked)
    close = ManagedWorkforceExecution.close

    async def observed(execution, *args):
        closing.set()
        return await close(execution, *args)

    monkeypatch.setattr(ManagedWorkforceExecution, "close", observed)
    script = ModelScript(monkeypatch)
    register(world, tokenizer, "p")
    await world.submit("p", "run")
    await world.service.start()
    waiter = None
    try:
        await eventually(entered.is_set)
        waiter = asyncio.create_task(
            world.service.cancel("run", origin=world.origin)
        )
        await asyncio.wait_for(closing.wait(), 5)
        assert_barrier_held(world, "run")
        release.set()
        await waiter
        await eventually(lambda: "run" not in world.service._tasks)
        invocations = world.journal.list_model_invocations("run")
        assert len(invocations) == 1
        assert invocations[0].status == (
            "failed" if phase == "open" else "completed"
        )
        assert script.calls == (
            [] if phase == "open" else [("run", "planner", 1)]
        )
        assert_drained(script.executions["run"])
    finally:
        release.set()
        if waiter is not None:
            await asyncio.gather(waiter, return_exceptions=True)


@pytest.mark.asyncio
async def test_worker_failure_preserves_partial_without_publishing_or_retry(
    world, tokenizer, monkeypatch
):
    async def workers(context, role, call, messages):
        if role == "author" and call == 1:
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": "partial.txt",
                    "content": "preserved partial",
                },
            )
        if role == "editor":
            raise AssertionError(
                "dependent worker cannot execute after failure"
            )
        return response(
            content=json.dumps(
                {
                    "content": "The file is partial; the task could not be completed.",
                    "failed": True,
                }
            )
        )

    script = ModelScript(monkeypatch, workers, dependent=True)
    _, policy = register(world, tokenizer, "p")
    await world.submit("p", "run")
    await world.service.start()
    await eventually(
        lambda: (
            world.journal.get_run("run") is not None
            and world.journal.get_run("run").status == "failed"
        )
    )
    await eventually(lambda: "run" not in world.service._tasks)
    assert len(world.journal.list_tool_calls("run")) == 1
    assert [role for _, role, _ in script.calls] == [
        "planner",
        "coordinator",
        "author",
        "author",
    ]
    assert not (policy.source_root / "partial.txt").exists()
    artifacts = await world.service.artifacts("run", origin=world.origin)
    artifact = next(
        item
        for item in artifacts["artifacts"]
        if item["relativePath"] == "partial.txt"
    )
    assert (
        await world.service.read_artifact(
            "run", artifact["artifact_id"], origin=world.origin
        )
        == b"preserved partial"
    )
    assert_drained(script.executions["run"])


@pytest.mark.asyncio
async def test_workforce_instrumentation_gate_precedes_construction(
    world, tokenizer, monkeypatch
):
    script = ModelScript(monkeypatch)
    monkeypatch.setenv("TRACEROOT_ENABLED", "true")
    register(world, tokenizer, "p")
    await world.submit("p", "run")
    await world.service.start()
    await eventually(lambda: bool(world.agent_errors))
    assert str(world.agent_errors[0]) == "workforce_telemetry_unsupported"
    assert not script.executions and not script.captures


@pytest.mark.asyncio
@pytest.mark.parametrize("tool", ["browser", "terminal", "mcp", "delegation"])
async def test_unapproved_workforce_profiles_fail_before_admission(
    world, tokenizer, tool
):
    with pytest.raises(
        AgentConfigurationUnavailable, match="agent_profile_unsupported"
    ):
        configuration(
            world,
            tokenizer,
            "p",
            "space",
            session_mode="workforce",
            tool_authorizations=[tool],
        )
    assert world.journal.get_run("run") is None


@pytest.mark.asyncio
async def test_dispatched_worker_cancellation_keeps_unknown_partial_outcome(
    world, tokenizer, monkeypatch
):
    from app.run_runtime.tool_checkpoint import UnsafeToolOutcomeError
    from app.workspace_runtime.bound_runtime import BoundRuntime

    written = asyncio.Event()
    release = asyncio.Event()
    execute = BoundRuntime.execute_worker

    async def held_receipt(runtime, *args, **kwargs):
        result = await execute(runtime, *args, **kwargs)
        written.set()
        await release.wait()
        return result

    monkeypatch.setattr(BoundRuntime, "execute_worker", held_receipt)
    script = ModelScript(monkeypatch, dependent=True)
    _, policy = register(world, tokenizer, "p")
    await world.submit("p", "run")
    await world.service.start()
    try:
        await asyncio.wait_for(written.wait(), 8)
        await world.service.cancel("run", origin=world.origin)
        await eventually(lambda: "run" not in world.service._tasks)
        calls = world.journal.list_tool_calls("run")
        assert len(calls) == 1 and calls[0].status == "outcome_unknown"
        assert calls[0].dispatched_at is not None
        assert world.agent_errors and all(
            isinstance(error, UnsafeToolOutcomeError)
            for error in world.agent_errors
        )
        assert not (policy.source_root / "run-author.txt").exists()
        artifacts = await world.service.artifacts("run", origin=world.origin)
        artifact = next(
            item
            for item in artifacts["artifacts"]
            if item["relativePath"] == "run-author.txt"
        )
        assert (
            await world.service.read_artifact(
                "run", artifact["artifact_id"], origin=world.origin
            )
            == b"run-author"
        )
        assert_drained(script.executions["run"])
    finally:
        release.set()


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["unowned_graph", "sdk_close"])
async def test_missing_containment_or_close_proof_keeps_only_owner_barrier(
    world, tokenizer, monkeypatch, fault
):
    from openai import AsyncOpenAI

    from app.agent.factory import managed_workforce

    script = ModelScript(monkeypatch)
    if fault == "unowned_graph":
        construct = managed_workforce.construct_managed_workforce

        def unowned(options, execution):
            workforce = construct(options, execution)
            if options.task_id == "run":
                workforce._children.append(object())
            return workforce

        monkeypatch.setattr(
            managed_workforce, "construct_managed_workforce", unowned
        )
    else:
        close = AsyncOpenAI.close

        async def failed_close(client):
            await close(client)
            execution = script.executions.get("run")
            if (
                execution is not None
                and client is execution.resources[0].async_client
            ):
                raise OSError("synthetic SDK close proof unavailable")

        monkeypatch.setattr(AsyncOpenAI, "close", failed_close)
    register(world, tokenizer, "p")
    register(world, tokenizer, "other", space="other-space")
    await world.submit("p", "run")
    await world.submit("p", "successor", followup=True)
    await world.submit("other", "independent")
    await world.service.start()
    await eventually(
        lambda: world.completed("independent") and not world.service._tasks,
        timeout=12,
    )
    assert world.journal.get_run("successor") is None
    with world.journal._lock:
        row = world.journal._connection.execute(
            "SELECT state, writer_settlement_json, manifest_digest FROM run_workspace_finalizations WHERE run_id='run'"
        ).fetchone()
    assert tuple(row) == ("needs_attention", None, None)
    assert all(
        item.async_client.is_closed() and item.sync_client.is_closed()
        for item in script.executions["run"].resources
    )
    assert_drained(script.executions["independent"])


@pytest.mark.asyncio
async def test_failed_subtask_projection_error_stops_scheduler_and_drains(
    world, tokenizer, monkeypatch
):
    async def workers(*_args):
        return response(
            content=json.dumps(
                {
                    "content": "Unable to complete the requested private file task.",
                    "failed": True,
                }
            )
        )

    script = ModelScript(monkeypatch, workers, dependent=True)
    persist = world.journal.persist_workforce_subtask_step
    failed = False

    def fail_once(**kwargs):
        nonlocal failed
        if kwargs["phase"] == "failed" and not failed:
            failed = True
            raise OSError("synthetic subtask journal failure")
        return persist(**kwargs)

    monkeypatch.setattr(
        world.journal, "persist_workforce_subtask_step", fail_once
    )
    register(world, tokenizer, "p")
    await world.submit("p", "run")
    await world.service.start()
    await eventually(
        lambda: (
            world.journal.get_run("run") is not None
            and world.journal.get_run("run").status == "failed"
        )
    )
    await eventually(lambda: "run" not in world.service._tasks)
    assert failed
    assert any(
        "synthetic subtask journal failure" in str(error)
        for error in world.agent_errors
    )
    assert_drained(script.executions["run"])
