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

"""Agent-proposed Memory rules stay inert until the user adopts them."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from camel.agents._types import ToolCallRequest

from app.agent import listen_chat_agent
from app.agent.listen_chat_agent import ListenChatAgent
from app.agent.toolkit import memory_toolkit
from app.agent.toolkit.memory_toolkit import MemoryToolkit
from app.lightweight_memory import (
    IncrementalMemoryMaintainer,
    LightweightMemoryService,
    service as memory_service,
)
from app.lightweight_memory.service import is_pending_rule_proposal
from app.memory.service import build_durable_context_projection_for_task_lock
from app.permission_policy import (
    PermissionPolicyService,
    PolicyEffect,
    build_tool_action_descriptor,
)
from app.run_context import RunContext, run_context_scope
from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.run_journal.memory_policy import assert_memory_entry_policy
from app.run_policy import ToolSafetyClass
from app.run_runtime import tool_checkpoint
from app.tool_validation import ToolPreWriteValidationError

RULE = "Create a branch for every task."
SCOPE_IDS = {"project": "project-1", "space": "space-1", "user": "user-1"}


@pytest.fixture
def memory(tmp_path, monkeypatch):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.bind_memory_project_scopes(
            project_id="project-1", space_id="space-1", user_id="user-1"
        )
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        journal.ensure_run(run_id="other-run", project_id="other-project")
        journal.ensure_run(run_id="unbound-run", project_id="unbound-project")
        for event_id, run_id, event_type, source in (
            ("user-1", "run-1", "user.message", "chat"),
            ("user-2", "run-1", "user.message", "chat"),
            ("trigger-1", "run-1", "user.message", "scheduled"),
            ("assistant-1", "run-1", "assistant.delta", None),
            ("tool-1", "run-1", "tool.completed", None),
            ("other-user", "other-run", "user.message", "chat"),
            ("unbound-user", "unbound-run", "user.message", "chat"),
        ):
            journal.append_event(
                run_id,
                RunEventDraft(
                    event_id=event_id,
                    event_type=event_type,
                    payload={
                        "content": f"From now on, {RULE.lower()}",
                        **({"source": source} if source else {}),
                    },
                ),
            )
        service = LightweightMemoryService(journal)
        monkeypatch.setattr(memory_service, "_token_encoding", lambda: None)
        apply = MagicMock(wraps=journal.apply_memory_mutation)
        monkeypatch.setattr(journal, "apply_memory_mutation", apply)
        yield SimpleNamespace(journal=journal, service=service, apply=apply)


def _propose(service, **overrides):
    return service.propose_rule(
        **{
            "project_id": "project-1",
            "scope_type": "project",
            "kind": "constraint",
            "content": RULE,
            "reason": "The user set this for all future work.",
            "source_refs": ("user-1",),
            "run_id": "run-1",
            "actor_id": "agent",
            **overrides,
        }
    )


def _all_entries(journal):
    return [
        entry
        for scope_type, scope_id in SCOPE_IDS.items()
        for entry in journal.list_memory_entries(
            scope_type, scope_id, include_deleted=True
        )
    ]


def _projection(service, monkeypatch):
    monkeypatch.setattr(
        "app.lightweight_memory.get_lightweight_memory_service",
        lambda: service,
    )
    return build_durable_context_projection_for_task_lock(
        SimpleNamespace(
            run_context=SimpleNamespace(
                run_id="run-1",
                project_id="project-1",
                space_id="space-1",
                user_id="user-1",
            )
        ),
        mode="single_agent",
        current_user_prompt="continue",
    )


def _confirm(service, entry):
    return service.transition_entry(
        memory_id=entry.memory_id,
        expected_version=entry.version,
        operation="confirm",
        actor_type="user",
        reason="Adopted on the Memory page",
        request_id=f"confirm:{entry.memory_id}",
    ).entry


@pytest.mark.parametrize("scope_type", ["project", "space", "user"])
def test_proposal_is_a_pending_entry_in_each_bound_scope(memory, scope_type):
    proposal = _propose(
        memory.service,
        scope_type=scope_type,
        kind="preference",
        source_refs=("user-2", "user-1"),
    )

    entry = proposal.entry
    assert proposal.status == "proposed"
    assert (entry.scope_type, entry.scope_id) == (
        scope_type,
        SCOPE_IDS[scope_type],
    )
    assert entry.kind == "preference"
    assert entry.content == RULE
    assert entry.created_by == "agent"
    assert entry.source_trust == "user_asserted"
    assert entry.confirmed_by_user is False
    assert entry.source_refs == ("user-1", "user-2")
    assert is_pending_rule_proposal(entry)
    assert _all_entries(memory.journal) == [entry]


def test_rule_of_exactly_the_length_limit_is_accepted(memory):
    content = "Use pnpm here. " * 19 + "Use pnpm here!!"
    assert len(content) == 300

    proposal = _propose(memory.service, content=content)

    assert proposal.status == "proposed"
    assert proposal.entry.content == content


@pytest.mark.parametrize(
    ("overrides", "error_code"),
    [
        ({"source_refs": ()}, "MEMORY_PROVENANCE_REJECTED"),
        ({"source_refs": ("missing",)}, "MEMORY_PROVENANCE_REJECTED"),
        ({"source_refs": ("assistant-1",)}, "MEMORY_PROVENANCE_REJECTED"),
        ({"source_refs": ("tool-1",)}, "MEMORY_PROVENANCE_REJECTED"),
        ({"source_refs": ("trigger-1",)}, "MEMORY_PROVENANCE_REJECTED"),
        (
            {"source_refs": ("user-1", "trigger-1")},
            "MEMORY_PROVENANCE_REJECTED",
        ),
        ({"source_refs": ("other-user",)}, "MEMORY_PROVENANCE_REJECTED"),
        (
            {"scope_type": "space", "source_refs": ("other-user",)},
            "MEMORY_PROVENANCE_REJECTED",
        ),
        ({"content": "x" * 301}, "MEMORY_CONTENT_REJECTED"),
        ({"content": "   "}, "MEMORY_CONTENT_REJECTED"),
        (
            {
                "content": "Deploy with API_KEY=sk-live-0123456789abcdefghijklmnop"
            },
            "MEMORY_CONTENT_REJECTED",
        ),
        (
            {"content": "Keep notes in /Users/alice/notes."},
            "MEMORY_CONTENT_REJECTED",
        ),
        ({"reason": " "}, "MEMORY_ARGUMENT_VALIDATION_FAILED"),
        (
            {
                "project_id": "unbound-project",
                "run_id": "unbound-run",
                "scope_type": "space",
                "source_refs": ("unbound-user",),
            },
            "MEMORY_SCOPE_REJECTED",
        ),
        (
            {
                "project_id": "unbound-project",
                "run_id": "unbound-run",
                "scope_type": "user",
                "source_refs": ("unbound-user",),
            },
            "MEMORY_SCOPE_REJECTED",
        ),
    ],
)
def test_rejected_proposal_is_a_known_failure_without_a_write(
    memory, overrides, error_code
):
    with pytest.raises(ToolPreWriteValidationError) as rejected:
        _propose(memory.service, **overrides)

    result = rejected.value.to_tool_result()
    assert result["error_code"] == error_code
    assert result["outcome_known"] is True
    assert result["write_performed"] is False
    memory.apply.assert_not_called()
    assert _all_entries(memory.journal) == []


def test_pending_rules_are_capped_per_scope(memory):
    for index in range(5):
        assert (
            _propose(memory.service, content=f"Rule number {index}.").status
            == "proposed"
        )

    capped = _propose(memory.service, content="One rule too many.")

    assert capped.status == "too_many_pending"
    assert capped.entry is None
    assert memory.apply.call_count == 5
    # The cap counts each scope's own suggestions.
    assert (
        _propose(
            memory.service, scope_type="space", content="One rule too many."
        ).status
        == "proposed"
    )
    # Adopting a suggestion frees a slot.
    first = memory.service.list_entries("project", "project-1")[0]
    _confirm(memory.service, first)
    assert (
        _propose(memory.service, content="One rule too many.").status
        == "proposed"
    )


def test_saved_rule_with_the_same_content_is_not_proposed_again(memory):
    saved = memory.service.create_entry(
        scope_type="project",
        scope_id="project-1",
        kind="preference",
        content=RULE,
        actor_type="user",
        reason="Added on the Memory page",
        source_trust="user_confirmed",
    ).entry
    memory.apply.reset_mock()

    # Compared after NFKC, whitespace folding and casefolding.
    proposal = _propose(
        memory.service, content="  Ｃreate a   BRANCH for every task. "
    )

    assert proposal.status == "already_saved"
    assert proposal.entry.memory_id == saved.memory_id
    memory.apply.assert_not_called()


def test_dismissed_rule_is_not_proposed_again(memory):
    proposed = _propose(memory.service).entry
    memory.service.transition_entry(
        memory_id=proposed.memory_id,
        expected_version=proposed.version,
        operation="remove",
        actor_type="user",
        reason="Dismissed on the Memory page",
        request_id="dismiss-1",
    )
    memory.apply.reset_mock()

    proposal = _propose(memory.service, source_refs=("user-2",))

    assert proposal.status == "previously_dismissed"
    assert proposal.entry.memory_id == proposed.memory_id
    memory.apply.assert_not_called()
    assert memory.service.list_entries("project", "project-1") == ()


def test_many_archived_entries_never_hide_a_saved_rule(memory):
    saved = memory.service.create_entry(
        scope_type="project",
        scope_id="project-1",
        kind="constraint",
        content=RULE,
        actor_type="user",
        reason="Added on the Memory page",
        source_trust="user_confirmed",
    ).entry
    # Archived after the rule was saved, so they are listed before it.
    for index in range(500):
        note = memory.service.create_entry(
            scope_type="project",
            scope_id="project-1",
            kind="fact",
            content=f"Old note {index}.",
            actor_type="user",
            reason="Added on the Memory page",
            source_trust="user_confirmed",
        ).entry
        memory.service.transition_entry(
            memory_id=note.memory_id,
            expected_version=note.version,
            operation="remove",
            actor_type="user",
            reason="Archived on the Memory page",
            request_id=f"archive-{index}",
        )
    memory.apply.reset_mock()

    proposal = _propose(memory.service)

    assert (proposal.status, proposal.entry.memory_id) == (
        "already_saved",
        saved.memory_id,
    )
    memory.apply.assert_not_called()


def test_retry_returns_the_same_suggestion(memory, monkeypatch):
    first = _propose(memory.service, source_refs=("user-1", "user-2"))

    retried = _propose(memory.service, source_refs=("user-2", "user-1"))
    assert (retried.status, retried.entry.memory_id) == (
        "proposed",
        first.entry.memory_id,
    )

    # Even when the duplicate check misses it (for example a concurrent
    # retry), the deterministic request id replays the original write.
    monkeypatch.setattr(
        memory.journal, "list_memory_entries", lambda *args, **kwargs: []
    )
    replayed = _propose(memory.service, source_refs=("user-2", "user-1"))

    assert replayed.entry.memory_id == first.entry.memory_id
    mutations = memory.journal.list_memory_mutations("project", "project-1")
    assert len(mutations) == 1
    assert mutations[0].idempotency_key.startswith("memory-propose:")


@pytest.mark.parametrize("scope_type", ["project", "space", "user"])
def test_pending_rule_reaches_the_prompt_only_after_confirmation(
    memory, monkeypatch, scope_type
):
    fact = memory.service.create_entry(
        scope_type="project",
        scope_id="project-1",
        kind="fact",
        content="The reporting timezone is UTC.",
        actor_type="agent",
        reason="stable project setting",
        source_trust="model_inferred",
    ).entry
    rule = _propose(memory.service, scope_type=scope_type).entry

    projection = _projection(memory.service, monkeypatch)
    assert projection.source_memory_ids == (fact.memory_id,)
    assert RULE not in projection.text
    scopes = {
        "project_id": "project-1",
        "space_id": "space-1",
        "user_id": "user-1",
    }
    assert [
        entry.memory_id for entry in memory.service.search_memory(**scopes)
    ] == [fact.memory_id]
    assert rule.memory_id in {
        entry.memory_id
        for entry in memory.service.search_memory(
            **scopes, include_pending=True
        )
    }

    confirmed = _confirm(memory.service, rule)

    assert not is_pending_rule_proposal(confirmed)
    # Confirming does not upgrade the source trust.
    assert confirmed.source_trust == "user_asserted"
    projection = _projection(memory.service, monkeypatch)
    assert rule.memory_id in projection.source_memory_ids
    assert RULE in projection.text


def test_pending_rule_never_stops_an_explicit_remember_request(memory):
    rule = _propose(memory.service, content="Releases ship on Fridays.").entry
    memory.journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="remember-1",
            event_type="user.message",
            payload={
                "content": "Remember that releases ship on Fridays.",
                "source": "chat",
            },
        ),
    )

    IncrementalMemoryMaintainer(memory.service).process_project("project-1")

    # The explicit request takes effect at once, as it did before.
    assert {
        (entry.created_by, entry.content, is_pending_rule_proposal(entry))
        for entry in memory.service.list_entries("project", "project-1")
    } == {
        ("agent", rule.content, True),
        ("extractor", "releases ship on Fridays.", False),
    }


def test_editing_a_pending_rule_adopts_it_as_user_memory(memory, monkeypatch):
    rule = _propose(memory.service).entry

    edited = memory.service.update_entry(
        memory_id=rule.memory_id,
        expected_version=rule.version,
        content="Create one branch per task.",
        kind=rule.kind,
        actor_type="user",
        reason="Edited on the Memory page",
        request_id="edit-1",
        source_trust="user_confirmed",
    ).entry

    assert (edited.created_by, edited.source_trust) == (
        "user",
        "user_confirmed",
    )
    assert edited.confirmed_by_user is True
    assert "Create one branch per task." in (
        _projection(memory.service, monkeypatch).text
    )


@pytest.mark.parametrize("kind", ["preference", "constraint"])
@pytest.mark.parametrize(
    ("source_trust", "source_refs"),
    [
        ("user_asserted", ()),
        ("tool_observed", ("user-1",)),
        ("external_untrusted", ("user-1",)),
        ("model_inferred", ("user-1",)),
        ("system_verified", ("user-1",)),
        ("legacy_unverified", ("user-1",)),
    ],
)
def test_policy_requires_an_agent_rule_to_cite_the_user(
    kind, source_trust, source_refs
):
    with pytest.raises(PermissionError):
        assert_memory_entry_policy(
            kind=kind,
            content=RULE,
            created_by="agent",
            source_trust=source_trust,
            confirmed_by_user=False,
            source_refs=source_refs,
        )


def test_policy_accepts_a_cited_agent_rule():
    assert_memory_entry_policy(
        kind="constraint",
        content=RULE,
        created_by="agent",
        source_trust="user_asserted",
        confirmed_by_user=False,
        source_refs=("user-1",),
    )


def test_service_rejects_an_agent_constraint_without_citations(memory):
    with pytest.raises(PermissionError):
        memory.service.create_entry(
            scope_type="project",
            scope_id="project-1",
            kind="constraint",
            content=RULE,
            actor_type="agent",
            reason="No citation",
            source_trust="user_asserted",
        )
    memory.apply.assert_not_called()


@pytest.mark.parametrize(
    ("scope_id", "run_id", "kind", "error_code"),
    [
        # A rule suggestion may only target the scope its Run's Project feeds.
        ("space-other", "run-1", "constraint", "MEMORY_PROVENANCE_REJECTED"),
        ("space-1", None, "constraint", "MEMORY_PROVENANCE_REJECTED"),
        # Every other Agent Space write still needs a review.
        ("space-1", "run-1", "fact", "MEMORY_SCOPE_REJECTED"),
    ],
)
def test_agent_space_write_is_limited_to_bound_rule_suggestions(
    memory, scope_id, run_id, kind, error_code
):
    with pytest.raises(ToolPreWriteValidationError) as rejected:
        memory.service.create_entry(
            scope_type="space",
            scope_id=scope_id,
            kind=kind,
            content=RULE,
            actor_type="agent",
            reason="Direct write",
            source_trust="user_asserted",
            source_refs=("user-1",),
            run_id=run_id,
        )
    assert rejected.value.error_code == error_code
    memory.apply.assert_not_called()


@pytest.fixture
def toolkit(memory, tmp_path, monkeypatch):
    context = RunContext(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="run-1",
        email="test@example.com",
        user_id="user-1",
        working_directory=tmp_path,
        task_output_root=tmp_path,
        camel_log_dir=tmp_path,
        binding_source="test",
        workdir_mode="direct-write",
        browser_port=9222,
    )
    task_lock = SimpleNamespace(run_context=context, put_queue=AsyncMock())
    for module in (memory_toolkit, listen_chat_agent):
        monkeypatch.setattr(module, "get_task_lock", lambda _: task_lock)
    monkeypatch.setattr(
        memory_toolkit,
        "get_lightweight_memory_service",
        lambda: memory.service,
    )
    monkeypatch.setattr(
        tool_checkpoint, "get_default_run_journal", lambda: memory.journal
    )
    monkeypatch.setattr(tool_checkpoint, "_notify_cloud_sync", lambda: None)
    monkeypatch.setattr(
        listen_chat_agent, "authorize_tool_checkpoint", AsyncMock()
    )
    monkeypatch.setattr(
        listen_chat_agent, "_schedule_async_task", lambda coro: coro.close()
    )
    tools = {
        tool.get_function_name(): tool
        for tool in MemoryToolkit("run-1").get_tools()
    }
    agent = object.__new__(ListenChatAgent)
    agent._internal_tools = tools
    agent.api_task_id = "run-1"
    agent.agent_name = "agent"
    agent.process_task_id = "process-1"
    agent.mask_tool_output = False
    agent._secure_result_store = {}
    agent._record_tool_calling = MagicMock(
        side_effect=lambda name, args, result, call_id, **kwargs: result
    )

    def call(tool_name, call_id, **arguments):
        return agent._execute_tool(
            ToolCallRequest(
                tool_name=tool_name, tool_call_id=call_id, args=arguments
            )
        )

    with run_context_scope(context):
        yield SimpleNamespace(tools=tools, call=call)


def _tool_arguments(**overrides):
    return {
        "kind": "constraint",
        "scope": "space",
        "content": RULE,
        "reason": "The user set this for all future work.",
        "source_event_ids": ["user-1"],
        **overrides,
    }


def test_tool_schema_offers_only_rule_kinds_and_scopes(toolkit):
    parameters = toolkit.tools["propose_memory_rule"].openai_tool_schema[
        "function"
    ]["parameters"]

    assert set(parameters["properties"]["kind"]["enum"]) == {
        "preference",
        "constraint",
    }
    assert set(parameters["properties"]["scope"]["enum"]) == {
        "project",
        "space",
        "user",
    }
    assert set(parameters["required"]) == {
        "kind",
        "scope",
        "content",
        "reason",
        "source_event_ids",
    }


def test_tool_rejection_is_known_and_the_agent_can_correct_it(memory, toolkit):
    rejected = toolkit.call(
        "propose_memory_rule",
        "trigger-call",
        **_tool_arguments(source_event_ids=["trigger-1"]),
    )
    assert rejected["error_code"] == "MEMORY_PROVENANCE_REJECTED"
    assert rejected["write_performed"] is False
    # An unstated rule must not be saved another way, as an inferred note.
    instruction = rejected["recovery"]["instruction"]
    assert "do not propose or save it" in instruction
    assert "model_inferred for" not in instruction

    proposed = toolkit.call(
        "propose_memory_rule", "proposal-call", **_tool_arguments()
    )
    entry = memory.service.list_entries("space", "space-1")[0]
    assert proposed == {"status": "proposed", "memory_id": entry.memory_id}

    retried = toolkit.call(
        "propose_memory_rule", "retry-call", **_tool_arguments()
    )
    assert retried == proposed
    records = memory.journal.list_tool_calls("run-1")
    assert [record.status for record in records] == [
        "failed",
        "completed",
        "completed",
    ]
    assert {record.safety_class for record in records} == {
        ToolSafetyClass.SAFE_READ.value
    }
    assert not any(
        event.event_type in {"tool.outcome_unknown", "run.failed"}
        for event in memory.journal.list_events("run-1")
    )


@pytest.mark.parametrize(
    ("tool_name", "effect"),
    [
        # An inert suggestion never blocks the Run on an approval prompt.
        ("propose_memory_rule", PolicyEffect.ALLOW),
        # A direct write that reaches the prompt keeps its approval.
        ("remember_project_memory", PolicyEffect.PROMPT),
    ],
)
def test_rule_proposal_needs_no_permission_prompt(
    memory, toolkit, tool_name, effect
):
    arguments = _tool_arguments()
    safety_class, idempotency_key = tool_checkpoint.declared_tool_safety(
        toolkit.tools[tool_name], tool_name, arguments
    )
    descriptor = build_tool_action_descriptor(
        action_id="call-1",
        tool_name=tool_name,
        toolkit_name=MemoryToolkit.toolkit_name(),
        safety_class=safety_class,
        arguments=arguments,
        run_id="run-1",
        attempt_id="attempt-1",
        environment_spec_digest="legacy-unbound:run-1",
        idempotency_key=idempotency_key,
    )

    # A Space without a profile uses the default, request_approval.
    decision = PermissionPolicyService(memory.journal).evaluate(
        descriptor, space_id="space-1"
    )

    assert decision.effect is effect


def test_tool_reports_too_many_pending_without_a_write(memory, toolkit):
    for index in range(5):
        _propose(memory.service, scope_type="space", content=f"Rule {index}.")
    memory.apply.reset_mock()

    result = toolkit.call(
        "propose_memory_rule", "capped-call", **_tool_arguments()
    )

    assert result["status"] == "too_many_pending"
    assert result["memory_id"] is None
    assert "Memory page" in result["instruction"]
    memory.apply.assert_not_called()


def test_agent_search_marks_pending_rules(memory, toolkit):
    rule = _propose(memory.service).entry
    memory.service.create_entry(
        scope_type="project",
        scope_id="project-1",
        kind="fact",
        content="The reporting timezone is UTC.",
        actor_type="agent",
        reason="stable project setting",
        source_trust="model_inferred",
    )

    items = toolkit.tools["search_memory"]()["items"]

    pending = {item["content"]: item["pending"] for item in items}
    assert pending == {RULE: True, "The reporting timezone is UTC.": False}
    _confirm(memory.service, rule)
    items = toolkit.tools["search_memory"]()["items"]
    assert all(item["pending"] is False for item in items)
