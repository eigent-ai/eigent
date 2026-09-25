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

"""Actual service/factory/CAMEL loop; replace only tokenizer/model external I/O."""

import asyncio
import json
import os
import threading
from pathlib import Path

import pytest
import pytest_asyncio

from app.permission_policy import PRESET_PROFILES, PermissionProfileName
from app.run_context import get_current_run_context
from app.workspace_config import (
    ProviderModelCapability,
    ThinkingEffort,
    parse_workspace_manifest,
)
from app.workspace_runtime.agent_adapter import SingleAgentExecutionAdapter
from app.workspace_runtime.agent_configuration import (
    AgentConfigurationUnavailable,
    FrozenAgentConfiguration,
    ResolvedCredential,
)
from app.workspace_runtime.agent_model_resources import LoadedOpenAITokenizer
from tests.app.workspace_runtime.test_service import World, eventually


@pytest_asyncio.fixture
async def world(tmp_path):
    value = World(tmp_path)
    value.service.stop_timeout = 1
    yield value
    await value.service.close()
    await value.coordinator.close()
    value.journal.close()


@pytest.fixture
def tokenizer(monkeypatch):
    from camel.types import UnifiedModelType
    from camel.utils import token_counting
    from tiktoken import Encoding

    # The asset-loading boundary alone is replaced. Counting/encoding is still
    # the actual CAMEL counter and tiktoken implementation, entirely in memory.
    encoding = Encoding(
        "synthetic-bytes",
        pat_str=r"(?s).",
        mergeable_ranks={bytes([i]): i for i in range(256)},
        special_tokens={},
    )
    monkeypatch.setattr(
        token_counting, "get_model_encoding", lambda _model: encoding
    )
    prepared = LoadedOpenAITokenizer(
        token_counting.OpenAITokenCounter(UnifiedModelType("gpt-5"))
    )

    def forbidden_lookup(*_args):
        raise AssertionError("tokenizer must already be loaded")

    monkeypatch.setattr(token_counting, "get_model_encoding", forbidden_lookup)
    return prepared


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    import httpx
    import requests

    def forbidden(*_args, **_kwargs):
        raise AssertionError("real network is forbidden in this suite")

    async def forbidden_async(*_args, **_kwargs):
        raise AssertionError("real network is forbidden in this suite")

    monkeypatch.setattr(httpx.Client, "send", forbidden)
    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden_async)
    monkeypatch.setattr(requests.Session, "request", forbidden)


def configuration(world, tokenizer, project, space, **changes):
    manifest = parse_workspace_manifest("""
apiVersion: eigent.ai/v1alpha1
kind: WorkspaceBundle
metadata: {id: bundle_managed_test, name: Managed test, revision: 1}
spec:
  permissions: {profile: full_access}
  models:
    default: {modelRef: 'provider://managed', thinkingEffort: medium}
""")
    values = dict(
        manifest=manifest,
        provider_capability=ProviderModelCapability(
            supported_efforts=(ThinkingEffort.MEDIUM,),
            default_effort=ThinkingEffort.MEDIUM,
            provider_mapping={ThinkingEffort.MEDIUM: "medium"},
            capability_revision="synthetic:v1",
            provider_parameter_name="reasoning_effort",
        ),
        space_id=space,
        project_id=project,
        principal_ref=world.origin.principal_ref,
        permission_profile_revision=PRESET_PROFILES[
            PermissionProfileName.FULL_ACCESS
        ].revision,
        credential_ref="credential:" + project,
        model_platform="openai",
        model_type="gpt-5",
        api_url="https://api.openai.com/v1",
        thinking_effort="medium",
        tokenizer_ref=tokenizer.reference,
        credential_resolver=lambda ref, principal: ResolvedCredential(
            ref, principal, "synthetic-" + project
        ),
    )
    values.update(changes)
    return FrozenAgentConfiguration(**values)


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
    config = config or configuration(world, tokenizer, project, space)
    adapter = SingleAgentExecutionAdapter(world.journal, config, tokenizer)
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


def response(
    *, tool=None, arguments=None, content="done", call_id="file-call"
):
    from openai.types.chat import ChatCompletion

    message = {"role": "assistant", "content": content}
    if tool:
        message = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": tool,
                        "arguments": json.dumps(arguments),
                    },
                }
            ],
        }
    return ChatCompletion.model_validate(
        {
            "id": "synthetic-response",
            "model": "gpt-5",
            "object": "chat.completion",
            "created": 0,
            "choices": [
                {
                    "index": 0,
                    "message": message,
                    "finish_reason": "tool_calls" if tool else "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 10,
                "total_tokens": 20,
            },
        }
    )


def model_boundary(monkeypatch, respond, captures):
    from camel.models import ModelFactory
    from openai.resources.chat.completions import AsyncCompletions

    original = ModelFactory.create

    def create(**kwargs):
        captures.append(kwargs)
        return original(**kwargs)

    counts = {}

    async def completion(self, *args, **kwargs):
        counts[self] = counts.get(self, 0) + 1
        return await respond(
            get_current_run_context(), counts[self], kwargs["messages"]
        )

    monkeypatch.setattr(ModelFactory, "create", create)
    monkeypatch.setattr(AsyncCompletions, "create", completion)


@pytest.mark.asyncio
@pytest.mark.parametrize("git", [False, True])
@pytest.mark.parametrize("cross_space", [False, True])
async def test_real_single_factories_overlap_and_publish(
    world, tokenizer, monkeypatch, git, cross_space
):
    captures = []
    arrived = {}
    release = asyncio.Event()
    env = dict(os.environ)
    cwd = Path.cwd()
    processes = []
    spawn = asyncio.create_subprocess_exec

    async def observed_spawn(*args, **kwargs):
        processes.append(kwargs.copy())
        return await spawn(*args, **kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", observed_spawn)

    async def respond(context, call, messages):
        if call == 1:
            arrived[context.project_id] = context
            if len(arrived) == 2:
                release.set()
            await release.wait()
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": "result-" + context.project_id + ".txt",
                    "content": context.project_id,
                },
            )
        assert "File saved:" in messages[-1]["content"]
        return response(content="done-" + context.project_id)

    model_boundary(monkeypatch, respond, captures)
    _, a = register(world, tokenizer, "a", space="one", git=git)
    _, b = register(
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
    await eventually(
        lambda: (
            (a.source_root / "result-a.txt").exists()
            and (b.source_root / "result-b.txt").exists()
        )
    )
    assert len(captures) == 2
    for capture in captures:
        assert (
            capture["client"].organization == capture["client"].project == ""
        )
        assert (
            capture["async_client"].organization
            == capture["async_client"].project
            == ""
        )
        assert capture["client"]._client._trust_env is False
        assert capture["async_client"]._client._trust_env is False
    assert arrived["a"].working_directory != arrived["b"].working_directory
    for project, policy in (("a", a), ("b", b)):
        assert (
            policy.source_root / ("result-" + project + ".txt")
        ).read_text() == project
        context = arrived[project]
        assert context.working_directory == context.task_output_root
        assert context.working_directory != policy.source_root
        worker = next(
            item
            for item in processes
            if item["env"]["EIGENT_RUN_ID"] == context.run_id
        )
        assert worker["cwd"] == context.working_directory
        assert (
            worker["env"]["HOME"]
            == worker["env"]["TMPDIR"]
            == str(context.working_directory)
        )
        assert "OPENAI_API_KEY" not in worker["env"]
        calls = world.journal.list_tool_calls("run-" + project)
        assert len(calls) == 1 and calls[0].status == "completed"
    assert Path.cwd() == cwd and dict(os.environ) == env


@pytest.mark.asyncio
@pytest.mark.parametrize("git", [False, True])
async def test_real_agent_send_now_keeps_partial_and_fifo(
    world, tokenizer, monkeypatch, git
):
    captures = []
    entered = []
    partial = asyncio.Event()
    release = asyncio.Event()
    active_stopped = asyncio.Event()
    ordinary_entered = asyncio.Event()

    async def respond(context, call, messages):
        run = context.run_id
        if call == 1:
            entered.append(run)
            return response(
                tool="write_to_file",
                arguments={"file_path": run + ".txt", "content": run},
            )
        if run == "active":
            partial.set()
            try:
                await release.wait()
                return response(
                    tool="write_to_file",
                    arguments={"file_path": "late.txt", "content": "late"},
                    call_id="late",
                )
            finally:
                active_stopped.set()
        if run == "ordinary":
            ordinary_entered.set()
            await release.wait()
        return response(content=run)

    model_boundary(monkeypatch, respond, captures)
    _, policy = register(world, tokenizer, "p", git=git)
    await world.submit("p", "active")
    await world.service.start()
    await asyncio.wait_for(partial.wait(), 10)
    await world.submit("p", "ordinary", followup=True)
    await world.submit("p", "urgent", followup=True)
    await world.service.set_delivery(
        "urgent",
        origin=world.origin,
        delivery_mode="send_now",
        operation_id="click-1",
    )
    await eventually(
        lambda: ordinary_entered.is_set() or world.agent_errors, timeout=10
    )
    assert not world.agent_errors
    assert active_stopped.is_set()
    assert entered == ["active", "urgent", "ordinary"]
    assert world.journal.get_run("active").status == "cancelled"
    # An old operation retried while a later Run owns the Session is inert.
    await world.service.set_delivery(
        "urgent",
        origin=world.origin,
        delivery_mode="send_now",
        operation_id="click-1",
    )
    assert world.journal.get_run("ordinary").cancel_request_id is None
    manifest = await world.service.artifacts("active", origin=world.origin)
    item = next(
        item
        for item in manifest["artifacts"]
        if item["relativePath"] == "active.txt"
    )
    assert (
        await world.service.read_artifact(
            "active", item["artifact_id"], origin=world.origin
        )
        == b"active"
    )
    assert not (policy.source_root / "active.txt").exists()
    assert not (policy.source_root / "late.txt").exists()
    release.set()
    await eventually(lambda: world.completed("ordinary"))
    await eventually(
        lambda: (
            (policy.source_root / "urgent.txt").exists()
            and (policy.source_root / "ordinary.txt").exists()
        )
    )
    assert entered == ["active", "urgent", "ordinary"]
    assert len(world.journal.list_run_attempts("urgent")) == 1
    assert not world.agent_errors


@pytest.mark.asyncio
@pytest.mark.parametrize("revoke", ["permission", "credential"])
async def test_revocation_stops_only_the_matching_real_agent(
    world, tokenizer, monkeypatch, revoke
):
    captures = []
    arrived = set()
    release = asyncio.Event()
    stopped = set()
    allowed = {"a": True, "b": True}

    async def respond(context, call, messages):
        if call == 1:
            arrived.add(context.project_id)
            try:
                await release.wait()
            except asyncio.CancelledError:
                stopped.add(context.project_id)
                raise
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": context.project_id + ".txt",
                    "content": "ok",
                },
            )
        return response()

    model_boundary(monkeypatch, respond, captures)
    for project in ("a", "b"):

        def credential(ref, principal, project=project):
            if revoke == "credential" and not allowed[project]:
                raise LookupError("synthetic credential revoked")
            return ResolvedCredential(ref, principal, "synthetic-" + project)

        config = configuration(
            world, tokenizer, project, "space", credential_resolver=credential
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
    await eventually(lambda: len(arrived) == 2)
    allowed["a"] = False
    await eventually(lambda: "a" in stopped)
    assert "b" not in stopped
    assert world.journal.get_run("run-b").cancel_request_id is None
    release.set()
    await eventually(lambda: world.completed("run-b"))
    assert not (world.policies["a"].source_root / "a.txt").exists()
    assert not world.agent_errors


@pytest.mark.asyncio
async def test_exact_config_frozen_after_queue_and_persisted_without_key(
    world, tokenizer, monkeypatch
):
    captures = []

    async def respond(context, call, messages):
        return response()

    model_boundary(monkeypatch, respond, captures)
    parameters = {"max_completion_tokens": 1000}
    config = configuration(
        world, tokenizer, "p", "space", model_config_dict=parameters
    )
    _, policy = register(world, tokenizer, "p", config=config)
    await world.submit("p", "r")
    parameters["max_completion_tokens"] = 7
    snapshot = config.snapshot
    snapshot["model_config_dict"]["max_completion_tokens"] = 8
    from app.workspace_config.capabilities import ModelCapabilityRegistry

    def no_latest(*_args, **_kwargs):
        raise AssertionError("queued model capability must not resolve latest")

    monkeypatch.setattr(ModelCapabilityRegistry, "resolve", no_latest)
    # Caller-owned parameter dictionaries cannot retarget a queued request.
    await world.service.start()
    await eventually(lambda: world.completed("r") or world.agent_errors)
    assert not world.agent_errors
    assert captures[0]["model_config_dict"]["max_completion_tokens"] == 1000
    assert captures[0]["model_config_dict"]["reasoning_effort"] == "medium"
    attempt = world.journal.list_run_attempts("r")[0]
    spec = world.journal.get_effective_environment_spec(
        attempt.environment_spec_id
    )
    assert (
        spec.spec["semantic_spec"]["runtime_capability_manifest"][
            "configuration_revision"
        ]
        == config.configuration_revision
    )
    assert config.configuration_revision != attempt.bundle_revision_id
    assert "synthetic-p" not in json.dumps(spec.spec)
    assert "synthetic-p" not in repr(config)
    assert "synthetic-p" not in repr(config.credential())
    with world.journal._lock:
        assert "synthetic-p" not in "\n".join(
            world.journal._connection.iterdump()
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    [
        {"session_mode": "unknown"},
        {"tool_authorizations": ["terminal"]},
        {"model_config_dict": {"stream": True}},
        {"extra_params": {"api_mode": "responses"}},
        {"api_url": "https://secret@example.invalid/v1"},
        {"extra_params": {"api_key": "secret"}},
    ],
)
async def test_unsupported_profiles_fail_before_any_runtime(
    world, tokenizer, change
):
    with pytest.raises(AgentConfigurationUnavailable):
        configuration(world, tokenizer, "p", "space", **change)
    assert world.journal.get_run("r") is None


@pytest.mark.asyncio
async def test_permission_revision_missing_waits_without_factory(
    world, tokenizer, monkeypatch
):
    captures = []

    async def respond(*_args):
        raise AssertionError("model must not run")

    model_boundary(monkeypatch, respond, captures)
    config = configuration(
        world,
        tokenizer,
        "p",
        "space",
        permission_profile_revision="missing:revision",
    )
    register(world, tokenizer, "p", config=config)
    await world.submit("p", "r")
    await world.service.start()
    await eventually(
        lambda: (
            world.service.admission.get("r").wait_reason
            == "agent_configuration_unavailable"
        )
    )
    assert not captures and world.journal.get_run("r") is None


@pytest.mark.asyncio
async def test_queued_configuration_rebind_waits_then_uses_original(
    world, tokenizer, monkeypatch
):
    captures = []

    async def respond(*_args):
        return response()

    model_boundary(monkeypatch, respond, captures)
    _, original = register(world, tokenizer, "p")
    await world.submit("p", "r")
    changed = configuration(
        world, tokenizer, "p", "space", model_config_dict={"max_tokens": 123}
    )
    adapter = SingleAgentExecutionAdapter(world.journal, changed, tokenizer)
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
    await eventually(lambda: world.service.admission.get("r").wait_reason)
    assert not captures and world.journal.get_run("r") is None
    world.registry.revoke("p")
    world.registry.register("p", original)
    await eventually(lambda: world.completed("r"))
    assert "max_tokens" not in captures[0]["model_config_dict"]


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", ["bundle_permission", "tokenizer_changed"])
async def test_unsupported_bindings_wait_before_model_factory(
    world, tokenizer, monkeypatch, invalid
):
    captures = []

    async def respond(*_args):
        raise AssertionError("unsupported binding must not dispatch")

    model_boundary(monkeypatch, respond, captures)
    changes = {}
    if invalid == "bundle_permission":
        changes["manifest"] = parse_workspace_manifest("""
apiVersion: eigent.ai/v1alpha1
kind: WorkspaceBundle
metadata: {id: bundle_restrictive, name: Restrictive test, revision: 1}
spec:
  permissions: {profile: request_approval}
  models:
    default: {modelRef: 'provider://managed', thinkingEffort: medium}
""")
    config = configuration(world, tokenizer, "p", "space", **changes)
    register(world, tokenizer, "p", config=config)
    await world.submit("p", "r")
    if invalid == "tokenizer_changed":
        tokenizer.reference = "changed-after-enqueue"
    await world.service.start()
    await eventually(
        lambda: (
            world.service.admission.get("r").wait_reason
            == "agent_configuration_unavailable"
        )
    )
    assert not captures and world.journal.get_run("r") is None


@pytest.mark.asyncio
async def test_read_only_real_agent_reads_and_denies_write(
    world, tokenizer, monkeypatch
):
    captures = []

    async def respond(context, call, messages):
        if call == 1:
            return response(
                tool="read_file", arguments={"file_path": "input.txt"}
            )
        if call == 2:
            assert messages[-1]["content"] == "original"
            return response(
                tool="write_to_file",
                call_id="write",
                arguments={"file_path": "input.txt", "content": "denied"},
            )
        assert "permission_denied" in messages[-1]["content"]
        return response()

    model_boundary(monkeypatch, respond, captures)
    config = configuration(
        world,
        tokenizer,
        "p",
        "space",
        permission_profile_revision=PRESET_PROFILES[
            PermissionProfileName.READ_ONLY
        ].revision,
    )
    _, policy = register(world, tokenizer, "p", config=config)
    (policy.source_root / "input.txt").write_text("original")
    await world.submit("p", "r")
    await world.service.start()
    await eventually(lambda: world.completed("r") or world.agent_errors)
    assert not world.agent_errors
    assert (policy.source_root / "input.txt").read_text() == "original"
    calls = world.journal.list_tool_calls("r")
    assert len(calls) == 2
    assert calls[0].status == "completed"
    assert calls[1].status != "completed"
    assert not world.journal.list_approvals("r")


@pytest.mark.asyncio
@pytest.mark.parametrize("tool", ["read_file", "write_to_file"])
@pytest.mark.parametrize("escape", ["absolute", "symlink"])
async def test_real_tool_loop_cannot_read_or_write_outside_private_root(
    world, tokenizer, monkeypatch, tool, escape
):
    captures = []
    outside = world.root / "outside.txt"
    outside.write_text("outside-sentinel")

    async def respond(context, call, messages):
        if call == 1:
            path = str(outside)
            if escape == "symlink":
                link = context.working_directory / "link"
                link.symlink_to(outside)
                path = "link"
            arguments = {"file_path": path}
            if tool == "write_to_file":
                arguments["content"] = "escaped"
            return response(tool=tool, arguments=arguments)
        assert "outside-sentinel" not in messages[-1]["content"]
        assert "error" in messages[-1]["content"].lower()
        if escape == "symlink":
            (context.working_directory / "link").unlink()
        return response()

    model_boundary(monkeypatch, respond, captures)
    register(world, tokenizer, "p")
    await world.submit("p", "r")
    await world.service.start()
    await eventually(lambda: world.completed("r") or world.agent_errors)
    if escape == "symlink" and tool == "write_to_file":
        from app.run_runtime.tool_checkpoint import UnsafeToolOutcomeError

        assert len(world.agent_errors) == 1
        assert isinstance(world.agent_errors[0], UnsafeToolOutcomeError)
        # A spawned writer error remains conservative, even if this fixture
        # knows the exact failure. Never relabel it a pre-dispatch rejection.
    else:
        assert not world.agent_errors
    assert outside.read_text() == "outside-sentinel"
    assert world.journal.list_tool_calls("r")[0].status != "completed"


@pytest.mark.asyncio
@pytest.mark.parametrize("stop", ["send_now", "close"])
async def test_actual_checkpoint_thread_drains_before_agent_finalization(
    world, tokenizer, monkeypatch, stop
):
    from app.agent import listen_chat_agent

    captures = []
    entered, release = threading.Event(), threading.Event()
    contexts = {}
    original_finish = listen_chat_agent.finish_tool_checkpoint

    def blocked_finish(checkpoint, *args, **kwargs):
        if checkpoint.run_id == "active":
            entered.set()
            assert release.wait(8)
        return original_finish(checkpoint, *args, **kwargs)

    monkeypatch.setattr(
        listen_chat_agent, "finish_tool_checkpoint", blocked_finish
    )

    async def respond(context, call, messages):
        contexts[context.run_id] = context
        if context.run_id == "active":
            assert call == 1
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": "partial.txt",
                    "content": "partial",
                },
            )
        return response()

    model_boundary(monkeypatch, respond, captures)
    _, policy = register(world, tokenizer, "p")
    await world.submit("p", "active")
    await world.service.start()
    stop_waiter = None
    try:
        await eventually(entered.is_set)
        if stop == "send_now":
            await world.submit("p", "urgent", followup=True)
            await world.service.set_delivery(
                "urgent",
                origin=world.origin,
                delivery_mode="send_now",
                operation_id="checkpoint-stop",
            )
        else:
            stop_waiter = asyncio.create_task(world.service.close())
        await eventually(
            lambda: world.journal.get_run("active").cancel_request_id
        )
        await asyncio.sleep(0.05)
        with world.journal._lock:
            assert (
                world.journal._connection.execute(
                    "SELECT state FROM run_workspace_finalizations WHERE run_id='active'"
                ).fetchone()[0]
                != "settled"
            )
        assert world.journal.get_run("urgent") is None
        assert not (policy.source_root / "partial.txt").exists()
        if stop_waiter:
            assert not stop_waiter.done()
            stop_waiter.cancel()
            with pytest.raises(asyncio.CancelledError):
                await stop_waiter
        release.set()
        if stop == "close":
            await world.service.close()
        else:
            await eventually(lambda: world.completed("urgent"))
        artifacts = await world.service.artifacts(
            "active", origin=world.origin
        )
        item = next(
            item
            for item in artifacts["artifacts"]
            if item["relativePath"] == "partial.txt"
        )
        (contexts["active"].working_directory / "partial.txt").write_text(
            "later"
        )
        (policy.source_root / "partial.txt").write_text("source-later")
        assert (
            await world.service.read_artifact(
                "active", item["artifact_id"], origin=world.origin
            )
            == b"partial"
        )
        assert all(
            capture["client"].is_closed()
            and capture["async_client"].is_closed()
            for capture in captures
        )
    finally:
        release.set()
        if stop_waiter and not stop_waiter.done():
            await stop_waiter


@pytest.mark.asyncio
@pytest.mark.parametrize("stop", ["send_now", "cancel", "close"])
@pytest.mark.parametrize("repeat_cancel", [False, True])
async def test_prepared_tool_is_closed_before_cancelled_owner_releases_lane(
    world, tokenizer, monkeypatch, stop, repeat_cancel
):
    from app.run_runtime.owned_tasks import OwnedTasks
    from app.workspace_runtime.service import ExecutionService

    prepared_entered, prepare_release = threading.Event(), threading.Event()
    finish_entered, finish_release = threading.Event(), threading.Event()
    checkpoint = world.journal.checkpoint_tool_call
    owners, contexts, entered, handoffs, handoff_errors = {}, {}, [], [], []
    drain_entered = asyncio.Event()
    original_drain = OwnedTasks.drain
    service = world.service
    stop_waiter = None

    async def observe_drain(owner):
        if get_current_run_context().run_id == "active":
            drain_entered.set()
        return await original_drain(owner)

    monkeypatch.setattr(OwnedTasks, "drain", observe_drain)

    def gated_checkpoint(**kwargs):
        if kwargs["run_id"] == "active":
            if kwargs["status"] == "prepared":
                prepared_entered.set()
                assert prepare_release.wait(10)
            elif kwargs["status"] == "failed":
                finish_entered.set()
                assert finish_release.wait(10)
        return checkpoint(**kwargs)

    monkeypatch.setattr(
        world.journal, "checkpoint_tool_call", gated_checkpoint
    )

    async def respond(context, call, messages):
        assert call == 1
        entered.append(context.run_id)
        contexts[context.run_id] = context
        if context.run_id == "active":
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": "must-not-write.txt",
                    "content": "not dispatched",
                },
            )
        return response()

    model_boundary(monkeypatch, respond, [])
    adapter, policy = register(world, tokenizer, "p")
    run = adapter._run

    async def observe_owner(request, *args):
        owners[request.request_id] = asyncio.current_task()
        return await run(request, *args)

    adapter._run = observe_owner

    def observe_handoff(target_service):
        handoff = target_service.admission.handoff

        def observed(claim, **kwargs):
            if claim.request_id == "urgent":
                handoffs.append(claim.request_id)
            try:
                return handoff(claim, **kwargs)
            except Exception as error:
                handoff_errors.append(str(error))
                raise

        monkeypatch.setattr(target_service.admission, "handoff", observed)

    def assert_lane_held():
        with world.journal._lock:
            assert (
                world.journal._connection.execute(
                    "SELECT state FROM run_workspace_finalizations WHERE run_id='active'"
                ).fetchone()[0]
                != "settled"
            )
        assert world.journal.get_run("urgent") is None
        assert not owners["active"].done()
        assert handoffs == []

    observe_handoff(service)
    await world.submit("p", "active")
    await service.start()
    try:
        await eventually(prepared_entered.is_set)
        await world.submit("p", "urgent", followup=True)
        if stop == "send_now":
            await service.set_delivery(
                "urgent",
                origin=world.origin,
                delivery_mode="send_now",
                operation_id="prepared-race",
            )
        elif stop == "cancel":
            stop_waiter = asyncio.create_task(
                service.cancel("active", origin=world.origin)
            )
        else:
            stop_waiter = asyncio.create_task(service.close())
        await eventually(
            lambda: world.journal.get_run("active").cancel_request_id
        )
        # Wait for cancellation to reach the real Agent/model waiter; its
        # runtime owner must still wait for preparation and checkpoint closure.
        await asyncio.wait_for(drain_entered.wait(), 5)
        assert_lane_held()
        prepare_release.set()
        await eventually(finish_entered.is_set)
        calls = world.journal.list_tool_calls("active")
        assert len(calls) == 1 and calls[0].status == "prepared"
        assert calls[0].dispatched_at is calls[0].completed_at is None
        assert_lane_held()
        if repeat_cancel:
            # Exercise cancellation during the registered cleanup itself,
            # including cancelling the API/shutdown subscriber when present.
            if stop_waiter is not None:
                stop_waiter.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await stop_waiter
            for _ in range(3):
                owners["active"].cancel()
                await asyncio.sleep(0)
                assert_lane_held()
        finish_release.set()
        if stop_waiter is not None and not stop_waiter.cancelled():
            await stop_waiter
        await eventually(lambda: "active" not in service._tasks)
        calls = world.journal.list_tool_calls("active")
        assert len(calls) == 1 and calls[0].status == "failed"
        assert calls[0].dispatched_at is None
        assert calls[0].completed_at is not None
        assert calls[0].result == {"error": "tool cancelled before dispatch"}
        assert world.journal.get_run("active").status == "cancelled"
        assert not (
            contexts["active"].working_directory / "must-not-write.txt"
        ).exists()
        assert not (policy.source_root / "must-not-write.txt").exists()
        if stop == "close":
            await service.close()
            # A normal fresh service observes the settled predecessor and
            # admits its durable successor; no journal row is rewritten.
            world.service = ExecutionService(
                world.journal,
                world.coordinator,
                world.registry,
                scan_interval=0.02,
                stop_timeout=1,
            )
            observe_handoff(world.service)
            await world.service.start()
        await eventually(lambda: world.completed("urgent") or handoff_errors)
        await eventually(lambda: not world.service._tasks)
        assert handoff_errors == [] and handoffs == ["urgent"]
        assert entered == ["active", "urgent"]
        assert len(world.journal.list_run_attempts("urgent")) == 1
        assert world.service.admission.get("urgent").wait_reason is None
        assert not world.agent_errors
    finally:
        prepare_release.set()
        finish_release.set()
        if stop_waiter is not None:
            await asyncio.gather(stop_waiter, return_exceptions=True)
        await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["open", "complete"])
async def test_model_capture_thread_cannot_outlive_finalization(
    world, tokenizer, monkeypatch, phase
):
    from app.run_journal import model_capture

    entered, release = threading.Event(), threading.Event()
    captures, requests = [], []
    target, name = (
        (model_capture, "_start_capture")
        if phase == "open"
        else (model_capture._CaptureSession, "complete")
    )
    original = getattr(target, name)

    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(8)
        return original(*args, **kwargs)

    monkeypatch.setattr(target, name, blocked)

    async def respond(*args):
        requests.append(args)
        return response()

    model_boundary(monkeypatch, respond, captures)
    register(world, tokenizer, "p")
    await world.submit("p", "r")
    await world.service.start()
    cancellation = None
    try:
        await eventually(entered.is_set)
        cancellation = asyncio.create_task(
            world.service.cancel("r", origin=world.origin)
        )
        await eventually(lambda: world.journal.get_run("r").cancel_request_id)
        await asyncio.sleep(0.05)
        with world.journal._lock:
            assert (
                world.journal._connection.execute(
                    "SELECT state FROM run_workspace_finalizations WHERE run_id='r'"
                ).fetchone()[0]
                != "settled"
            )
        release.set()
        await cancellation
        await eventually(lambda: "r" not in world.service._tasks)
        invocations = world.journal.list_model_invocations("r")
        assert len(invocations) == 1
        assert invocations[0].status == (
            "failed" if phase == "open" else "completed"
        )
        assert len(requests) == (0 if phase == "open" else 1)
        assert world.journal.get_run("r").status == "cancelled"
    finally:
        release.set()
        if cancellation:
            await cancellation


@pytest.mark.asyncio
async def test_unmigrated_human_approval_fails_closed_without_global_waiter(
    world, tokenizer, monkeypatch
):
    captures = []

    async def respond(context, call, messages):
        assert call == 1
        return response(
            tool="write_to_file",
            arguments={
                "file_path": "result.txt",
                "content": "must not write",
            },
        )

    model_boundary(monkeypatch, respond, captures)
    config = configuration(
        world,
        tokenizer,
        "p",
        "space",
        permission_profile_revision=PRESET_PROFILES[
            PermissionProfileName.REQUEST_APPROVAL
        ].revision,
    )
    _, policy = register(world, tokenizer, "p", config=config)
    await world.submit("p", "r")
    await world.service.start()
    await eventually(lambda: bool(world.agent_errors))
    await eventually(lambda: "r" not in world.service._tasks)
    assert world.journal.get_run("r").status == "failed"
    assert not (policy.source_root / "result.txt").exists()
    call = world.journal.list_tool_calls("r")[0]
    assert call.status == "failed"
    assert "interactive_approval_unsupported" in json.dumps(call.result)
    approvals = world.journal.list_approvals("r")
    assert len(approvals) == 1 and approvals[0].status == "rejected"


@pytest.mark.asyncio
async def test_credential_material_change_cannot_dispatch_returned_tool(
    world, tokenizer, monkeypatch
):
    key = ["synthetic-original"]
    captures = []

    async def respond(context, call, messages):
        assert call == 1
        key[0] = "synthetic-changed"
        return response(
            tool="write_to_file",
            arguments={
                "file_path": "result.txt",
                "content": "stale result",
            },
        )

    config = configuration(
        world,
        tokenizer,
        "p",
        "space",
        credential_resolver=lambda ref, principal: ResolvedCredential(
            ref, principal, key[0]
        ),
    )
    model_boundary(monkeypatch, respond, captures)
    _, policy = register(world, tokenizer, "p", config=config)
    await world.submit("p", "r")
    await world.service.start()
    await eventually(lambda: bool(world.agent_errors))
    assert not (policy.source_root / "result.txt").exists()
    assert world.journal.list_tool_calls("r")[0].status != "completed"
