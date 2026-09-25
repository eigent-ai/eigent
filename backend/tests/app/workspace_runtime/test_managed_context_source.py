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

"""Canonical context through real admissions and SDKs with mock transport only."""

import asyncio
import copy
import json

import pytest

from app.run_journal import (
    CommittedRunEvent,
    RunEventDraft,
    managed_context_projection as projection,
)
from app.workspace_runtime import runtime
from app.workspace_runtime.agent_adapter import SingleAgentExecutionAdapter
from tests.app.workspace_runtime import (
    test_registration as registration_fixtures,
)
from tests.app.workspace_runtime.test_agent_adapter import response
from tests.app.workspace_runtime.test_service import eventually
from tests.app.workspace_runtime.test_workforce_adapter import ModelScript

DESTINATION = "https://model.example.test/v1"
deployment = registration_fixtures.deployment


async def configure_test_provider(deployment, *, history_enabled=True):
    """Opt in only this synthetic deployment, preserving the real bootstrap."""
    await runtime.close_default_execution_service()
    for source in deployment.projects.values():
        source["provider"]["api_url"] = DESTINATION
        deployment.valid_refs[source["provider"]["provider_ref"]] = (
            copy.deepcopy(source["provider"])
        )
    manifest = json.loads(deployment.manifest.read_text())
    manifest["session_history_enabled"] = history_enabled
    deployment.manifest.write_text(json.dumps(manifest))
    deployment.initialize()


def observe_capture(monkeypatch, sources, errors, before=None):
    original = SingleAgentExecutionAdapter._run
    original_capture = projection.capture_managed_execution_context

    def observed_source(*args, **kwargs):
        value = original_capture(*args, **kwargs)
        assert value.run_id not in sources
        sources[value.run_id] = value
        return value

    monkeypatch.setattr(
        projection, "capture_managed_execution_context", observed_source
    )

    async def capture(adapter, request, environment, bound):
        try:
            if before:
                await before(adapter, request, bound)
            return await original(adapter, request, environment, bound)
        except Exception as error:
            errors.append(error)
            raise

    monkeypatch.setattr(SingleAgentExecutionAdapter, "_run", capture)


async def terminal(deployment, run_id, errors):
    await eventually(
        lambda: (run := deployment.journal.get_run(run_id)) is not None
        and run.status in {"completed", "failed", "cancelled", "interrupted"}
    )
    assert not errors, errors
    assert deployment.completed(run_id)


async def send(
    deployment, run_id, envelope, *, kind="start", project="a", content=None
):
    body = {"request_id": run_id, "kind": kind, "envelope": {**envelope}}
    if kind == "follow_up":
        body["follow_up_content"] = content or run_id
        body["source_follow_up_request_id"] = run_id
    else:
        body["envelope"]["prompt"] = content or run_id
    result = await deployment.client.post(
        f"/projects/{project}/executions", json=body
    )
    assert result.status_code == 202, result.text
    return result.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["single-agent", "workforce"])
@pytest.mark.parametrize("kind", ["start", "follow_up"])
async def test_actual_settled_run_reaches_sdk_once_with_current_question(
    deployment, monkeypatch, mode, kind
):
    d = deployment
    d.project("a", mode=mode)
    await configure_test_provider(d)
    envelope = await d.register("a")
    sources, errors = {}, []
    observe_capture(monkeypatch, sources, errors)
    script = ModelScript(monkeypatch)
    from openai.resources.chat.completions import AsyncCompletions

    from app.run_context import get_current_run_context
    from app.run_journal.managed_context_budget import HISTORY_TITLE
    from app.workspace_runtime.agent_context import HISTORY_RULES

    calls = []
    create = AsyncCompletions.create

    async def observe_sdk(client, **kwargs):
        calls.append((get_current_run_context().run_id, copy.deepcopy(kwargs)))
        assert str(client._client.base_url).rstrip("/") == DESTINATION
        return await create(client, **kwargs)

    monkeypatch.setattr(AsyncCompletions, "create", observe_sdk)
    await d.service.start()
    await send(d, "first", envelope, content="prior-instruction-sentinel")
    await terminal(d, "first", errors)
    await send(
        d, "second", envelope, kind=kind, content="current-question-sentinel"
    )
    await terminal(d, "second", errors)
    assert sources["first"].runs == ()
    source = sources["second"]
    assert source.question == "current-question-sentinel"
    assert len(source.runs) == 1
    retained = source.runs[0]
    assert "prior-instruction-sentinel" in retained.text
    assert "current-question-sentinel" not in retained.text
    run = json.loads(retained.text)
    assert run["outcome"] == "completed"
    records = run["records"]
    assert sum(record["kind"] == "user.message" for record in records) == 1
    assert sum(record["kind"] == "assistant.final" for record in records) == 1
    tools = [record for record in records if record["kind"] == "tool.fact"]
    assert len(tools) == (1 if mode == "single-agent" else 2)
    assert all(
        tool["status"] == "completed" and tool["request"] for tool in tools
    )
    actual = {event.event_id for event in d.journal.list_events("first")}
    assert set(retained.source_event_ids) <= actual
    assert "execution-input:first" in retained.source_event_ids
    assert source.destination == DESTINATION
    second_calls = [kwargs for run_id, kwargs in calls if run_id == "second"]
    assert len(second_calls) == (2 if mode == "single-agent" else 6)
    for kwargs in second_calls:
        messages = kwargs["messages"]
        assert messages[0]["role"] in {"system", "developer"}
        assert messages[0]["content"].endswith(HISTORY_RULES)
        assert messages[1]["role"] == "user"
        assert messages[1]["content"].startswith(HISTORY_TITLE)
        assert "prior-instruction-sentinel" in messages[1]["content"]
        assert "current-question-sentinel" not in messages[1]["content"]
        assert (
            sum(HISTORY_TITLE in (m.get("content") or "") for m in messages)
            == 1
        )
        assert (
            sum(
                "prior-instruction-sentinel" in (m.get("content") or "")
                for m in messages
            )
            == 1
        )
        assert kwargs["max_completion_tokens"] > 0
    if mode == "single-agent":
        assert (
            sum(
                "current-question-sentinel" in (m.get("content") or "")
                for m in second_calls[0]["messages"]
            )
            == 1
        )
    else:
        assert {
            role for run_id, role, _ in script.calls if run_id == "second"
        } == {"planner", "coordinator", "author", "editor"}
        assert (
            script.executions["second"].options.question
            == "current-question-sentinel"
        )
        assert (
            script.executions["second"].workforce._task.content
            == "current-question-sentinel"
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("cross_space", [False, True])
async def test_capture_after_queued_predecessor_settles_and_other_space_is_excluded(
    deployment, monkeypatch, cross_space
):
    d = deployment
    d.project("a")
    d.project("b", space="other" if cross_space else "one")
    await configure_test_provider(d)
    envelopes = {name: await d.register(name) for name in ("a", "b")}
    entered, release = asyncio.Event(), asyncio.Event()
    sources, errors = {}, []
    observe_capture(monkeypatch, sources, errors)

    async def reply(context, role, call, messages):
        if context.run_id == "first":
            entered.set()
            await release.wait()
        return response(content="result-for-" + context.run_id)

    ModelScript(monkeypatch, reply)
    await d.service.start()
    try:
        await send(d, "first", envelopes["a"])
        await asyncio.wait_for(entered.wait(), 5)
        await send(d, "other-space-secret", envelopes["b"], project="b")
        await terminal(d, "other-space-secret", errors)
        await send(d, "second", envelopes["a"])
        assert d.journal.get_run("second") is None
        release.set()
        await terminal(d, "second", errors)
        text = sources["second"].runs[0].text
        assert "result-for-first" in text
        assert "other-space-secret" not in text
    finally:
        release.set()


@pytest.mark.asyncio
async def test_history_opt_in_is_frozen_and_old_registration_stays_disabled(
    deployment,
):
    d = deployment
    d.project("a")
    old = await d.register("a")
    old_document = d.registration.store.all()[0]
    assert (
        "history_context"
        not in json.loads(old_document["document_json"])["binding"]
    )
    await configure_test_provider(d)
    new = await d.register("a")
    assert old["configuration_revision"] != new["configuration_revision"]
    documents = {
        row["configuration_revision"]: json.loads(row["document_json"])
        for row in d.registration.store.all()
    }
    assert (
        "history_context"
        not in documents[old["configuration_revision"]]["binding"]
    )
    assert (
        documents[new["configuration_revision"]]["binding"]["history_context"]
        == "journal-context-v1"
    )
    assert not d.registration.registered[
        old["configuration_revision"]
    ].adapter.history_enabled
    assert d.registration.registered[
        new["configuration_revision"]
    ].adapter.history_enabled
    assert (
        documents[new["configuration_revision"]]["configuration"]["api_url"]
        == DESTINATION
    )
    assert (
        documents[old["configuration_revision"]]["configuration"]["api_url"]
        != DESTINATION
    )


@pytest.mark.asyncio
async def test_c4_uses_another_configured_provider_without_history_allowlist(
    deployment,
):
    d = deployment
    d.project("a")
    await configure_test_provider(d)
    d.projects["a"]["provider"]["api_url"] = (
        "https://another-model.example.test/v1"
    )
    provider = d.projects["a"]["provider"]
    d.valid_refs[provider["provider_ref"]] = copy.deepcopy(provider)
    result = await d.client.post(
        "/projects/a/execution-configurations", json={}
    )
    assert result.status_code == 201, result.text
    document = json.loads(d.registration.store.all()[0]["document_json"])
    assert document["configuration"]["api_url"] == provider["api_url"]
    assert document["binding"]["history_context"] == "journal-context-v1"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "corruption",
    ["message", "envelope", "account", "attempt", "tool", "settlement"],
)
async def test_canonical_owner_or_message_corruption_rejects_capture(
    deployment, monkeypatch, corruption
):
    d = deployment
    d.project("a")
    await configure_test_provider(d)
    envelope = await d.register("a")
    sources, errors = {}, []

    async def corrupt(adapter, request, bound):
        if request.request_id != "second":
            return
        # Deliberate corruption of only this fixture's temporary SQLite DB.
        with d.journal._write_transaction() as connection:
            if corruption == "message":
                connection.execute(
                    "UPDATE follow_up_requests SET content='wrong-message' WHERE request_id='second'"
                )
            elif corruption == "envelope":
                connection.execute(
                    "UPDATE execution_requests SET envelope_digest=? WHERE request_id='first'",
                    ("0" * 64,),
                )
            elif corruption == "account":
                connection.execute(
                    "UPDATE managed_execution_configurations SET principal_ref='foreign-account'"
                )
            elif corruption == "attempt":
                connection.execute(
                    "UPDATE execution_requests SET admitted_attempt_id=? WHERE request_id='first'",
                    (bound.binding.attempt_id,),
                )
            elif corruption == "tool":
                rows = connection.execute(
                    "SELECT event_id,payload_json FROM run_events WHERE run_id='first' AND event_type LIKE 'tool.%'"
                ).fetchall()
                for row in rows:
                    payload = json.loads(row["payload_json"])
                    payload["attempt_id"] = bound.binding.attempt_id
                    connection.execute(
                        "UPDATE run_events SET payload_json=? WHERE event_id=?",
                        (json.dumps(payload), row["event_id"]),
                    )
            else:
                connection.execute(
                    "UPDATE run_workspace_finalizations SET writer_settlement_json=NULL WHERE run_id='first'"
                )

    observe_capture(monkeypatch, sources, errors, corrupt)
    script = ModelScript(monkeypatch)
    await d.service.start()
    await send(d, "first", envelope)
    await terminal(d, "first", errors)
    await send(d, "second", envelope, kind="follow_up")
    await eventually(lambda: bool(errors))
    assert len(errors) == 1
    assert isinstance(errors[0], projection.ContextSourceUnavailable)
    assert "second" not in sources
    assert not any(run_id == "second" for run_id, _, _ in script.calls)
    assert any(
        event.event_type == "context.projection.rejected"
        for event in d.journal.list_events("second")
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "missing", ["event_count", "event_bytes", "legacy_configuration"]
)
async def test_bounded_missing_history_is_explicit_and_not_partially_rendered(
    deployment, monkeypatch, missing
):
    d = deployment
    d.project("a")
    await configure_test_provider(d)
    first_envelope = await d.register("a")
    sources, errors = {}, []
    seen_reads = []
    actual_list = d.journal.list_events

    def list_events(run_id, *args, **kwargs):
        if run_id == "first":
            seen_reads.append(kwargs)
        return actual_list(run_id, *args, **kwargs)

    async def change_history(adapter, request, bound):
        if request.request_id != "second":
            return
        with d.journal._write_transaction() as connection:
            if missing == "legacy_configuration":
                connection.execute(
                    "DELETE FROM managed_execution_configurations WHERE configuration_revision=?",
                    (first_envelope["configuration_revision"],),
                )
            elif missing == "event_bytes":
                connection.execute(
                    "UPDATE run_events SET payload_json=? WHERE run_id='first' AND event_type='assistant.final'",
                    (
                        json.dumps(
                            {"content": "oversized" * projection.MAX_RUN_BYTES}
                        ),
                    ),
                )
        if missing == "event_count":
            for index in range(projection.MAX_EVENTS):
                d.journal.append_event(
                    "first",
                    RunEventDraft(
                        event_type="legacy.token",
                        payload={"content": "hidden"},
                        event_id=f"extra-{index}",
                    ),
                )
        seen_reads.clear()
        monkeypatch.setattr(d.journal, "list_events", list_events)

    observe_capture(monkeypatch, sources, errors, change_history)
    ModelScript(monkeypatch)
    await d.service.start()
    await send(d, "first", first_envelope)
    await terminal(d, "first", errors)
    # A new immutable revision keeps current registration present when the
    # deliberately unverifiable predecessor's configuration is removed.
    d.projects["a"]["provider"]["model_config_dict"][
        "max_completion_tokens"
    ] = 2048
    d.valid_refs[d.projects["a"]["provider"]["provider_ref"]] = copy.deepcopy(
        d.projects["a"]["provider"]
    )
    second_envelope = await d.register("a")
    await send(d, "second", second_envelope)
    await terminal(d, "second", errors)
    assert sources["second"].runs == ()
    assert sources["second"].omitted_runs == 1
    assert seen_reads == []


def fact(index, kind, payload, *, legacy_step=None):
    return CommittedRunEvent(
        f"event-{index}", "prior", index, kind, payload, legacy_step, 0, index
    )


@pytest.mark.parametrize(
    "outcome", ["completed", "failed", "cancelled", "interrupted"]
)
def test_semantic_records_preserve_outcomes_redact_and_deduplicate(outcome):
    events = [
        fact(
            1,
            "user.message",
            {
                "content": "use /Users/alice/private/input.txt; api_key=abcdefghijk-secret"
            },
        ),
        fact(2, "legacy.confirmed", {"question": "duplicate-user"}),
        fact(
            3,
            "tool.prepared",
            {
                "tool_call_id": "tool",
                "attempt_id": "attempt",
                "request": {
                    "arguments": {
                        "credential_path": "/tmp/credentials.json",
                        "authorization": "Bearer hidden-value",
                        "content": "safe-content",
                    }
                },
            },
        ),
        fact(
            4,
            "tool.outcome_unknown",
            {
                "tool_call_id": "tool",
                "attempt_id": "attempt",
                "tool_name": "write_to_file",
                "outcome": "no durable acknowledgement",
                "timeout_reason": "timeout",
            },
        ),
        fact(5, "assistant.reasoning", {"content": "hidden-reasoning"}),
        fact(6, "legacy.assistant_delta", {"content": "display-tokens"}),
        fact(
            7,
            "approval.decided",
            {
                "decision": "approved",
                "credential": "hidden",
                "reason": "historical-approval",
            },
        ),
        fact(8, "interaction.resolved", {"decision": "keep-existing"}),
        fact(9, "assistant.final", {"content": "result-sentinel"}),
        fact(
            10, "legacy.end", {"content": "duplicate-final"}, legacy_step="end"
        ),
        fact(11, "run." + outcome, {"reason": "terminal-reason"}),
    ]
    rendered = projection.render_managed_run(
        events, run_id="prior", attempt_id="attempt", outcome=outcome
    )
    text = rendered.text
    for value in (
        "alice",
        "abcdefghijk-secret",
        "credentials.json",
        "hidden-value",
        "duplicate-user",
        "duplicate-final",
        "hidden-reasoning",
        "display-tokens",
    ):
        assert value not in text
    assert "[REDACTED]" in text
    assert "<device-home>" in text
    records = json.loads(text)["records"]
    tool = next(record for record in records if record["kind"] == "tool.fact")
    assert tool["external_effect_may_have_occurred"] is True
    assert tool["outcome"] == "no durable acknowledgement"
    assert tool["request"]["arguments"]["content"] == "safe-content"
    approval = next(
        record for record in records if record["kind"] == "approval.decided"
    )
    assert approval["historical_only"] is True
    assert approval["decision"] == "approved"
    assert any(
        record["kind"]
        == (
            "assistant.final"
            if outcome == "completed"
            else "assistant.observation"
        )
        for record in records
    )
    assert rendered.source_event_ids == tuple(
        f"event-{index}" for index in (1, 3, 4, 7, 8, 9, 11)
    )


def test_no_terminal_fact_cannot_be_presented_as_completed():
    with pytest.raises(
        projection.ContextSourceUnavailable, match="terminal_evidence_missing"
    ):
        projection.render_managed_run(
            [fact(1, "assistant.final", {"content": "not-committed-final"})],
            run_id="prior",
            attempt_id="attempt",
            outcome="completed",
        )


@pytest.mark.asyncio
async def test_later_committed_event_and_source_defaults_do_not_change_captured_context(
    deployment, monkeypatch
):
    d = deployment
    d.project("a")
    await configure_test_provider(d)
    envelope = await d.register("a")
    sources, errors = {}, []
    observe_capture(monkeypatch, sources, errors)
    entered, release = asyncio.Event(), asyncio.Event()

    async def reply(context, role, call, messages):
        if context.run_id == "second":
            entered.set()
            await release.wait()
        return response(content="original-result")

    ModelScript(monkeypatch, reply)
    await d.service.start()
    try:
        await send(d, "first", envelope)
        await terminal(d, "first", errors)
        await send(d, "second", envelope)
        await asyncio.wait_for(entered.wait(), 5)
        captured = sources["second"]
        old_text = captured.runs[0].text
        old_ids = captured.runs[0].source_event_ids
        d.journal.append_event(
            "first",
            RunEventDraft(
                event_type="interaction.resolved",
                payload={"decision": "late-history-sentinel"},
                event_id="late-event",
            ),
        )
        d.projects["a"]["provider"]["model_config_dict"][
            "max_completion_tokens"
        ] = 3072
        release.set()
        await terminal(d, "second", errors)
        assert captured.runs[0].text == old_text
        assert captured.runs[0].source_event_ids == old_ids
        assert "late-history-sentinel" not in old_text
        await send(d, "third", envelope)
        await terminal(d, "third", errors)
        assert "late-history-sentinel" in sources["third"].runs[0].text
        assert "late-event" in sources["third"].runs[0].source_event_ids
    finally:
        release.set()
