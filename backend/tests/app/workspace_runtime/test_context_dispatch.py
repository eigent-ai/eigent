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

"""Default-off context, dispatch fences and owned work; all I/O is synthetic."""

import asyncio
import copy
import hashlib
import json
import threading

import pytest

from app.run_context import get_current_run_context
from app.run_journal import RunEventDraft, managed_context_projection
from app.run_journal.managed_context_budget import HISTORY_TITLE
from app.run_journal.managed_context_projection import ContextSourceUnavailable
from app.workspace_runtime import agent_context, runtime
from tests.app.workspace_runtime import test_registration as fixtures
from tests.app.workspace_runtime.test_agent_adapter import response
from tests.app.workspace_runtime.test_managed_context_source import (
    DESTINATION,
    configure_test_provider,
    observe_capture,
    send,
    terminal,
)
from tests.app.workspace_runtime.test_service import eventually
from tests.app.workspace_runtime.test_workforce_adapter import ModelScript

deployment = fixtures.deployment


def observe_sdk(monkeypatch):
    from openai.resources.chat.completions import AsyncCompletions

    original = AsyncCompletions.create
    calls = []

    async def observed(client, **kwargs):
        calls.append(
            (
                get_current_run_context().run_id,
                str(client._client.base_url),
                copy.deepcopy(kwargs),
            )
        )
        return await original(client, **kwargs)

    monkeypatch.setattr(AsyncCompletions, "create", observed)
    return calls


async def settled(d, run_id, outcome):
    await eventually(
        lambda: (r := d.journal.get_run(run_id)) is not None
        and r.status == outcome
    )
    await eventually(lambda: run_id not in d.service._tasks)
    row = d.journal._connection.execute(
        "SELECT state,writer_settlement_json FROM run_workspace_finalizations WHERE run_id=?",
        (run_id,),
    ).fetchone()
    assert row["state"] == "settled" and row["writer_settlement_json"]


@pytest.mark.asyncio
async def test_absent_switch_never_reads_or_sends_history(
    deployment, monkeypatch
):
    d = deployment
    d.project("a")
    envelope = await d.register("a")

    def forbidden(*args, **kwargs):
        raise AssertionError("default-off must not capture history")

    monkeypatch.setattr(
        managed_context_projection,
        "capture_managed_execution_context",
        forbidden,
    )
    ModelScript(monkeypatch)
    calls = observe_sdk(monkeypatch)
    await d.service.start()
    for run_id in ("first", "second"):
        await send(d, run_id, envelope)
        await terminal(d, run_id, [])
    assert calls
    assert all(
        HISTORY_TITLE not in json.dumps(kwargs["messages"])
        for _, _, kwargs in calls
    )
    assert d.journal.list_context_projection_diagnostics(run_id="second") == []


@pytest.mark.asyncio
async def test_restore_does_not_downgrade_opted_in_queue_intent(
    deployment, monkeypatch
):
    d = deployment
    d.project("a")
    await configure_test_provider(d)
    envelope = await d.register("a")
    await send(d, "waiting", envelope)
    await configure_test_provider(d, history_enabled=False)
    assert envelope["configuration_revision"] not in d.registration.registered
    ModelScript(monkeypatch)
    calls = observe_sdk(monkeypatch)
    await d.service.start()
    await eventually(
        lambda: d.service.admission.get("waiting").wait_reason is not None
    )
    assert d.journal.get_run("waiting") is None
    assert not calls
    await configure_test_provider(d)
    assert d.registration.registered[
        envelope["configuration_revision"]
    ].adapter.history_enabled
    await d.service.start()
    await terminal(d, "waiting", [])
    assert len(d.journal.list_run_attempts("waiting")) == 1
    assert HISTORY_TITLE in calls[0][2]["messages"][1]["content"]


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["true", 1, None])
async def test_history_switch_requires_boolean(deployment, value):
    d = deployment
    await runtime.close_default_execution_service()
    manifest = json.loads(d.manifest.read_text())
    manifest["session_history_enabled"] = value
    d.manifest.write_text(json.dumps(manifest))
    runtime.initialize_execution_service(d.manifest, journal=d.journal)
    assert runtime.get_default_execution_service() is None
    assert runtime.execution_initialization_state() == "configuration_required"


@pytest.mark.asyncio
async def test_redacted_facts_and_metadata_only_diagnostics_at_actual_sdk(
    deployment, monkeypatch
):
    d = deployment
    d.project("a")
    await configure_test_provider(d)
    envelope = await d.register("a")

    async def reply(context, role, call, messages):
        if context.run_id == "first" and call == 1:
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": "prior.txt",
                    "content": "api_key=hidden-tool-secret",
                },
            )
        return response(
            content="prior-result api_key=hidden-result-secret at /Users/alice/private/result.txt"
        )

    ModelScript(monkeypatch, reply)
    calls = observe_sdk(monkeypatch)
    await d.service.start()
    await send(
        d, "first", envelope, content="prior-user api_key=hidden-user-secret"
    )
    await terminal(d, "first", [])
    for kind, payload in (
        (
            "interaction.resolved",
            {
                "decision": {
                    "text": "historical-response",
                    "api_key": "hidden-interaction-secret",
                }
            },
        ),
        (
            "approval.decided",
            {"decision": "approved", "reason": "historical-approval"},
        ),
        ("assistant.reasoning", {"content": "hidden-reasoning"}),
        ("legacy.assistant_delta", {"content": "hidden-display"}),
    ):
        d.journal.append_event(
            "first", RunEventDraft(event_type=kind, payload=payload)
        )
    await send(d, "second", envelope, content="current-once")
    await terminal(d, "second", [])
    request = next(kwargs for run_id, _, kwargs in calls if run_id == "second")
    history = request["messages"][1]["content"]
    assert all(
        value in history
        for value in (
            "prior-user",
            "prior-result",
            "historical-response",
            "historical-approval",
            '"historical_only":true',
            "[REDACTED]",
        )
    )
    assert all(
        value not in history for value in ("hidden-", "alice", "current-once")
    )
    rows = [
        row
        for row in d.journal.list_context_projection_diagnostics(
            run_id="second"
        )
        if row.run_id == "second"
    ]
    assert len(rows) == 1
    assert (
        rows[0].projection_digest
        == hashlib.sha256(history.encode()).hexdigest()
    )
    counter = d.registration.tokenizers["gpt-5"].for_model("gpt-5")
    assert rows[0].token_count == len(counter.encode(history))
    assert set(rows[0].source_event_ids) <= {
        e.event_id for e in d.journal.list_events("first")
    }
    with d.journal._lock:
        persisted = d.journal._connection.execute(
            "SELECT * FROM context_projection_diagnostics WHERE run_id='second'"
        ).fetchall()
        invocations = d.journal._connection.execute(
            "SELECT request_json FROM model_invocations WHERE run_id='second'"
        ).fetchall()
    assert "prior-user" not in str([tuple(row) for row in persisted])
    assert HISTORY_TITLE not in str([tuple(row) for row in invocations])


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["failed", "cancelled"])
async def test_actual_terminal_outcomes_are_not_success_history(
    deployment, monkeypatch, outcome
):
    d = deployment
    d.project("a")
    await configure_test_provider(d)
    envelope = await d.register("a")
    entered, release = asyncio.Event(), asyncio.Event()

    async def reply(context, role, call, messages):
        if context.run_id == "first":
            if outcome == "failed":
                raise RuntimeError("synthetic model failure")
            entered.set()
            await release.wait()
        return response(content="second-final")

    ModelScript(monkeypatch, reply)
    calls = observe_sdk(monkeypatch)
    await d.service.start()
    try:
        await send(d, "first", envelope)
        if outcome == "cancelled":
            await asyncio.wait_for(entered.wait(), 5)
            result = await d.client.delete("/executions/first")
            assert result.status_code == 200
        await settled(d, "first", outcome)
        await send(d, "second", envelope, kind="follow_up")
        await terminal(d, "second", [])
        history = next(
            kwargs for run_id, _, kwargs in calls if run_id == "second"
        )["messages"][1]["content"]
        records = json.loads(history.split("\n", 1)[1])["runs"]
        assert records[0]["outcome"] == outcome
        assert any(
            record["kind"] == "run." + outcome
            for record in records[0]["records"]
        )
        assert not any(
            record["kind"] == "assistant.final"
            for record in records[0]["records"]
        )
    finally:
        release.set()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["capture", "diagnostic"])
@pytest.mark.parametrize("stop", ["cancel", "close"])
@pytest.mark.parametrize("mode", ["single-agent", "workforce"])
async def test_owned_context_threads_hold_settlement_until_done(
    deployment, monkeypatch, stage, stop, mode
):
    d = deployment
    d.project("a", mode=mode)
    await configure_test_provider(d)
    d.service.stop_timeout = 5
    envelope = await d.register("a")
    entered, release, finished = (
        threading.Event(),
        threading.Event(),
        threading.Event(),
    )
    if stage == "capture":
        target, name = (
            managed_context_projection,
            "capture_managed_execution_context",
        )
    else:
        target, name = d.journal, "put_context_projection_diagnostic"
    original = getattr(target, name)

    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(10), "test must release owned context thread"
        try:
            return original(*args, **kwargs)
        finally:
            finished.set()

    monkeypatch.setattr(target, name, blocked)
    script = ModelScript(monkeypatch)
    await d.service.start()
    stopping = None
    try:
        await send(d, "owner", envelope)
        await eventually(entered.is_set)
        execution = d.service._executions["owner"]
        stopping = asyncio.create_task(
            d.client.delete("/executions/owner")
            if stop == "cancel"
            else d.service.close()
        )
        await eventually(lambda: execution.runtime.cancelled.is_set())
        assert not finished.is_set()
        row = d.journal._connection.execute(
            "SELECT state,writer_settlement_json FROM run_workspace_finalizations WHERE run_id='owner'"
        ).fetchone()
        assert (
            row["state"] != "settled" and row["writer_settlement_json"] is None
        )
        assert d.service.admission.get_claim("a").state != "released"
        stopping.cancel()
        await asyncio.gather(stopping, return_exceptions=True)
        release.set()
        if stop == "close":
            await d.service.close()
        await settled(d, "owner", "cancelled")
        assert finished.is_set()
        assert not script.calls
        assert all(task.done() for task in execution.runtime._tasks)
    finally:
        release.set()
        if stopping and not stopping.done():
            await asyncio.gather(stopping, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change", ["destination", "credential", "oversized_input"]
)
async def test_dispatch_rechecks_frozen_binding_and_actual_budget(
    deployment, monkeypatch, change
):
    d = deployment
    d.project("a")
    await configure_test_provider(d)
    envelope = await d.register("a")
    sources, errors = {}, []
    observe_capture(monkeypatch, sources, errors)
    script = ModelScript(monkeypatch)
    original = agent_context.AgentContext._prepare

    def prepare(context, kwargs):
        if change == "oversized_input":
            kwargs = {**kwargs, "messages": copy.deepcopy(kwargs["messages"])}
            kwargs["messages"][-1]["content"] = "中" * 23000
        result = original(context, kwargs)
        if change == "destination":
            script.captures[-1][
                "async_client"
            ].base_url = "https://redirect.example.test/v1"
        elif change == "credential":
            d.valid_refs.clear()
        return result

    monkeypatch.setattr(agent_context.AgentContext, "_prepare", prepare)
    await d.service.start()
    await send(d, "owner", envelope)
    await eventually(
        lambda: bool(errors)
        or (
            (run := d.journal.get_run("owner")) is not None
            and run.status in {"failed", "cancelled"}
        )
    )
    assert not script.calls
    if change != "credential":
        assert any(
            isinstance(error, ContextSourceUnavailable) for error in errors
        )
        assert any(
            e.event_type == "context.projection.rejected"
            for e in d.journal.list_events("owner")
        )
    assert sources["owner"].destination == DESTINATION


@pytest.mark.asyncio
@pytest.mark.parametrize("oversized", [False, True])
async def test_actual_parse_request_uses_context_and_counts_response_schema(
    deployment, monkeypatch, oversized
):
    from camel.models import ModelFactory
    from openai.resources.chat.completions import AsyncCompletions
    from pydantic import BaseModel, Field

    class Reply(BaseModel):
        content: str = Field(
            description="中" * 23000 if oversized else "plain reply"
        )

    d = deployment
    d.project("a")
    await configure_test_provider(d)
    envelope = await d.register("a")
    sources, errors = {}, []
    observe_capture(monkeypatch, sources, errors)
    # Only inject the actual model's structured-output schema; factory,
    # model.arun, CAMEL and the SDK parse boundary all remain on the real path.
    factory = ModelFactory.create

    def create(**kwargs):
        model = factory(**kwargs)
        model.model_config_dict["response_format"] = Reply
        return model

    calls = []

    async def parse(client, **kwargs):
        calls.append(kwargs)
        assert kwargs["response_format"] is Reply
        return response(content='{"content":"structured result"}')

    monkeypatch.setattr(ModelFactory, "create", create)
    monkeypatch.setattr(AsyncCompletions, "parse", parse)
    await d.service.start()
    await send(d, "structured", envelope)
    if oversized:
        await settled(d, "structured", "failed")
        assert not calls
        assert any(isinstance(e, ContextSourceUnavailable) for e in errors)
    else:
        await terminal(d, "structured", errors)
        assert len(calls) == 1
        assert calls[0]["messages"][1]["content"].startswith(HISTORY_TITLE)
        assert calls[0]["max_completion_tokens"] > 0


@pytest.mark.asyncio
@pytest.mark.parametrize("cross_space", [False, True])
async def test_concurrent_contexts_follow_each_runs_configured_provider(
    deployment, monkeypatch, cross_space
):
    d = deployment
    d.project("a")
    d.project("b", space="two" if cross_space else "one", mode="workforce")
    await configure_test_provider(d)
    second_provider = d.projects["b"]["provider"]
    second_provider["provider_ref"] = "provider:1:" + "b" * 32
    second_provider["api_url"] = "https://second-model.example.test/v1"
    d.valid_refs[second_provider["provider_ref"]] = copy.deepcopy(
        second_provider
    )
    envelopes = {name: await d.register(name) for name in ("a", "b")}
    arrivals, release = set(), asyncio.Event()

    async def reply(context, role, call, messages):
        if context.run_id.endswith("second"):
            arrivals.add(context.project_id)
            if arrivals == {"a", "b"}:
                release.set()
            await release.wait()
        return response(
            content=json.dumps(
                {
                    "content": "result for " + context.project_id,
                    "failed": False,
                }
            )
        )

    ModelScript(monkeypatch, reply)
    calls = observe_sdk(monkeypatch)
    await d.service.start()
    try:
        for name in ("a", "b"):
            await send(
                d,
                name + "-first",
                envelopes[name],
                project=name,
                content=name + "-private-sentinel",
            )
            await terminal(d, name + "-first", [])
        for name in ("a", "b"):
            await send(d, name + "-second", envelopes[name], project=name)
        await asyncio.wait_for(release.wait(), 10)
        for name in ("a", "b"):
            await terminal(d, name + "-second", [])
        for run_id, url, kwargs in calls:
            name = run_id[0]
            assert url.rstrip("/") == (
                DESTINATION if name == "a" else second_provider["api_url"]
            )
            if run_id.endswith("second"):
                text = kwargs["messages"][1]["content"]
                assert name + "-private-sentinel" in text
                assert (
                    "b" if name == "a" else "a"
                ) + "-private-sentinel" not in text
    finally:
        release.set()


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [None, "no_input_window"])
async def test_actual_request_enforces_output_reserve_and_model_window(
    deployment, monkeypatch, limit
):
    from camel.types import UnifiedModelType

    d = deployment
    d.project("a")
    await configure_test_provider(d)
    provider = d.projects["a"]["provider"]
    provider["model_config_dict"] = (
        {}
        if limit is None
        else {
            "max_completion_tokens": UnifiedModelType("gpt-5").token_limit - 1
        }
    )
    d.valid_refs[provider["provider_ref"]] = copy.deepcopy(provider)
    envelope = await d.register("a")
    script = ModelScript(monkeypatch)
    calls = observe_sdk(monkeypatch)
    await d.service.start()
    await send(d, "owner", envelope)
    if limit is None:
        await terminal(d, "owner", [])
        assert all(
            kwargs["max_completion_tokens"]
            == agent_context.DEFAULT_OUTPUT_TOKENS
            for _, _, kwargs in calls
        )
    else:
        await settled(d, "owner", "failed")
        assert not script.calls
        reasons = [
            event.payload["reason"]
            for event in d.journal.list_events("owner")
            if event.event_type == "context.projection.rejected"
        ]
        assert reasons == ["context_current_input_over_budget"]


@pytest.mark.asyncio
async def test_capture_frozen_before_first_sdk_and_outgoing_schemas_are_copied(
    deployment, monkeypatch
):
    d = deployment
    d.project("a")
    await configure_test_provider(d)
    envelope = await d.register("a")
    ModelScript(monkeypatch)
    calls = observe_sdk(monkeypatch)
    entered, release = threading.Event(), threading.Event()
    original = agent_context.AgentContext._prepare

    def prepare(context, kwargs):
        result = original(context, kwargs)
        if context.source.run_id == "second" and not entered.is_set():
            # Changing the caller-owned schema after preparation cannot change
            # the budgeted request, even across the authorization await.
            assert result["tools"] == kwargs["tools"]
            assert result["tools"] is not kwargs["tools"]
            kwargs["tools"].append({"unbudgeted": "mutation-sentinel"})
            entered.set()
            assert release.wait(10)
        return result

    monkeypatch.setattr(agent_context.AgentContext, "_prepare", prepare)
    await d.service.start()
    try:
        await send(d, "first", envelope)
        await terminal(d, "first", [])
        await send(d, "second", envelope)
        await eventually(entered.is_set)
        assert not any(run_id == "second" for run_id, _, _ in calls)
        d.journal.append_event(
            "first",
            RunEventDraft(
                event_type="interaction.resolved",
                payload={"decision": "late-committed-sentinel"},
            ),
        )
        release.set()
        await terminal(d, "second", [])
        for run_id, _, kwargs in calls:
            if run_id == "second":
                assert (
                    "late-committed-sentinel"
                    not in kwargs["messages"][1]["content"]
                )
                assert "mutation-sentinel" not in json.dumps(kwargs["tools"])
        await send(d, "third", envelope)
        await terminal(d, "third", [])
        third = next(
            kwargs for run_id, _, kwargs in calls if run_id == "third"
        )
        assert "late-committed-sentinel" in third["messages"][1]["content"]
    finally:
        release.set()


@pytest.mark.asyncio
async def test_send_now_history_uses_execution_order_not_queue_insertion(
    deployment, monkeypatch
):
    d = deployment
    d.project("a")
    await configure_test_provider(d)
    envelope = await d.register("a")
    sources, errors = {}, []
    observe_capture(monkeypatch, sources, errors)
    ModelScript(monkeypatch)
    # Both intents are pending before dispatch. The newer urgent intent runs
    # first; the older queued intent must see its committed outcome.
    await send(d, "older-intent", envelope)
    await send(d, "urgent", envelope, kind="follow_up")
    result = await d.client.post(
        "/executions/urgent/delivery",
        json={"delivery_mode": "send_now", "operation_id": "c5-priority"},
    )
    assert result.status_code == 200, result.text
    await d.service.start()
    await terminal(d, "older-intent", errors)
    assert d.completed("urgent")
    assert sources["urgent"].runs == ()
    assert [
        json.loads(run.text)["run_id"] for run in sources["older-intent"].runs
    ] == ["urgent"]
    await send(d, "third", envelope)
    await terminal(d, "third", errors)
    assert [
        json.loads(run.text)["run_id"] for run in sources["third"].runs
    ] == ["urgent", "older-intent"]
