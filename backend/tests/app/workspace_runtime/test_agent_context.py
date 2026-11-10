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

"""Local projection budgeting with the real loaded counter; no SDK dispatch."""

import asyncio
import copy
import hashlib
import json
import threading

import pytest

from app.run_journal import SQLiteRunJournal
from app.run_journal.managed_context_budget import (
    HISTORY_TITLE,
    MAX_INPUT_BYTES,
    ManagedContextBudget,
    count_context_input_tokens,
)
from app.run_journal.managed_context_projection import (
    ContextRun,
    ContextSourceUnavailable,
    ManagedContextSource,
)
from app.run_runtime.owned_tasks import owned_tasks_scope, run_owned_thread
from tests.app.workspace_runtime import test_agent_adapter as agent_fixtures
from tests.app.workspace_runtime.test_service import eventually

tokenizer = agent_fixtures.tokenizer


def source(*runs, omitted=0):
    return ManagedContextSource(
        project_id="synthetic-project",
        run_id="current",
        attempt_id="current-attempt",
        question="current-question",
        project_state_version=7,
        runs=runs,
        omitted_runs=omitted,
        destination="https://model.example.test/v1",
    )


def run(run_id, content):
    return ContextRun(
        json.dumps(
            {
                "run_id": run_id,
                "outcome": "completed",
                "records": [
                    {"kind": "user.message", "content": content},
                    {
                        "kind": "tool.fact",
                        "request": {"content": "paired-request"},
                        "result": "paired-result",
                        "status": "completed",
                    },
                    {"kind": "assistant.final", "content": "final-" + run_id},
                ],
            }
        ),
        (
            run_id + "-user",
            run_id + "-request",
            run_id + "-result",
            run_id + "-final",
        ),
    )


def messages(content="current-question"):
    return [
        {"role": "system", "content": "current-system"},
        {"role": "user", "content": content},
    ]


def contents(projection):
    assert projection.text.startswith(HISTORY_TITLE + "\n")
    return json.loads(projection.text.split("\n", 1)[1])


def test_true_loaded_tokenizer_counts_multibyte_current_input(tokenizer):
    counter = tokenizer.for_model("gpt-5")
    ascii_messages = messages("a" * 600)
    cjk_messages = messages("中" * 600)
    value = ManagedContextBudget(source(), counter, 2400)
    assert (
        contents(value.project(ascii_messages, output_tokens=512))["runs"]
        == []
    )
    with pytest.raises(
        ContextSourceUnavailable, match="current_input_over_budget"
    ):
        value.project(cjk_messages, output_tokens=512)
    assert (
        count_context_input_tokens(counter, cjk_messages)
        - count_context_input_tokens(counter, ascii_messages)
        == 1200
    )


def test_complete_recent_runs_and_only_retained_source_ids(tokenizer):
    counter = tokenizer.for_model("gpt-5")
    capture = source(
        run("old", "older" * 900), run("new", "new-question"), omitted=2
    )
    value = ManagedContextBudget(capture, counter, 2400)
    base = messages()
    unchanged = copy.deepcopy(base)
    projected = value.project(base, output_tokens=512)
    retained = contents(projected)
    assert [item["run_id"] for item in retained["runs"]] == ["new"]
    assert retained["omitted_runs_at_least"] == 3
    assert projected.source_event_ids == capture.runs[-1].source_event_ids
    assert (
        "paired-request" in projected.text
        and "paired-result" in projected.text
    )
    assert "current-question" not in projected.text
    assert base == unchanged
    assert (
        projected.projection_digest
        == hashlib.sha256(projected.text.encode()).hexdigest()
    )
    assert projected.token_count == len(counter.encode(projected.text))


def test_oversized_newest_run_has_no_partial_success_or_source_claim(
    tokenizer,
):
    capture = source(run("old", "small"), run("oversized", "中" * 4000))
    value = ManagedContextBudget(capture, tokenizer.for_model("gpt-5"), 400000)
    projected = value.project(messages(), output_tokens=4096)
    assert contents(projected)["runs"] == []
    assert contents(projected)["omitted_runs_at_least"] == 2
    assert projected.source_event_ids == ()
    assert "paired-result" not in projected.text
    assert "final-oversized" not in projected.text


def test_tool_call_arguments_and_response_schema_count_towards_local_limit(
    tokenizer,
):
    counter = tokenizer.for_model("gpt-5")
    base = messages()
    with_arguments = [
        *base,
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call",
                    "type": "function",
                    "function": {
                        "name": "write_to_file",
                        "arguments": json.dumps(
                            {"content": "中" * 600}, ensure_ascii=False
                        ),
                    },
                },
            ],
        },
    ]
    assert (
        count_context_input_tokens(counter, with_arguments)
        > count_context_input_tokens(counter, base) + 1800
    )
    with pytest.raises(
        ContextSourceUnavailable, match="current_input_over_budget"
    ):
        ManagedContextBudget(source(), counter, 2400).project(
            with_arguments, output_tokens=512
        )
    for argument in (
        {
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "tool",
                        "description": "schema" * 500,
                    },
                }
            ]
        },
        {
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "result",
                    "schema": {"description": "schema" * 500},
                },
            }
        },
    ):
        with pytest.raises(
            ContextSourceUnavailable, match="current_input_over_budget"
        ):
            ManagedContextBudget(source(), counter, 2400).project(
                base, output_tokens=512, **argument
            )


def test_frozen_selection_is_not_silently_rebuilt_as_conversation_grows(
    tokenizer,
):
    counter = tokenizer.for_model("gpt-5")
    value = ManagedContextBudget(
        source(run("prior", "prior-question")), counter, 2400
    )
    first = value.project(messages(), output_tokens=512)
    assert (
        value.project(messages("a-new-current-question"), output_tokens=512)
        is first
    )
    larger = messages("growth" * 200)
    assert count_context_input_tokens(counter, larger) < 2400 - 512
    with pytest.raises(
        ContextSourceUnavailable, match="context_input_over_budget"
    ):
        value.project(larger, output_tokens=512)
    assert value.projection is first


@pytest.mark.parametrize("reserve", [None, False, 0, -1, 0.5, 2400, 5000])
def test_invalid_output_reserve_is_rejected(tokenizer, reserve):
    with pytest.raises(
        ContextSourceUnavailable, match="output_budget_invalid"
    ):
        ManagedContextBudget(
            source(), tokenizer.for_model("gpt-5"), 2400
        ).project(messages(), output_tokens=reserve)


@pytest.mark.parametrize(
    "malformed",
    [
        [],
        [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": "not-loaded"}}
                ],
            }
        ],
        [{"role": "user", "content": "x", "unexpected": "field"}],
        [{"role": "untrusted-role", "content": "x"}],
        [{"role": "user", "content": "x"}] * 513,
    ],
)
def test_unsupported_message_shapes_fail_closed(tokenizer, malformed):
    with pytest.raises(ContextSourceUnavailable, match="schema_unsupported"):
        ManagedContextBudget(
            source(), tokenizer.for_model("gpt-5"), 400000
        ).project(malformed, output_tokens=4096)


def test_bound_bytes_and_recursive_schema_before_tokenization(tokenizer):
    counter = tokenizer.for_model("gpt-5")
    value = ManagedContextBudget(source(), counter, 400000)
    with pytest.raises(ContextSourceUnavailable, match="input_too_large"):
        value.project(
            messages("a" * (MAX_INPUT_BYTES + 1)), output_tokens=4096
        )
    cycle = {}
    cycle["cycle"] = cycle
    with pytest.raises(ContextSourceUnavailable, match="input_too_large"):
        value.project(messages(), output_tokens=4096, response_format=cycle)
    assert value.projection is None


def test_unknown_fact_remains_unknown_in_a_retained_complete_run(tokenizer):
    unknown = ContextRun(
        json.dumps(
            {
                "run_id": "prior",
                "outcome": "cancelled",
                "records": [
                    {
                        "kind": "tool.fact",
                        "status": "outcome_unknown",
                        "request": {"operation": "write"},
                        "result": None,
                        "external_effect_may_have_occurred": True,
                    },
                    {
                        "kind": "approval.decided",
                        "decision": "approved",
                        "historical_only": True,
                    },
                ],
            }
        ),
        ("request", "unknown", "old-approval"),
    )
    result = ManagedContextBudget(
        source(unknown), tokenizer.for_model("gpt-5"), 400000
    ).project(messages(), output_tokens=4096)
    records = contents(result)["runs"][0]["records"]
    assert records[0]["status"] == "outcome_unknown"
    assert records[0]["external_effect_may_have_occurred"] is True
    assert records[0]["result"] is None
    assert records[1]["historical_only"] is True
    assert result.source_event_ids == ("request", "unknown", "old-approval")


def test_local_input_ceiling_still_applies_with_a_larger_model_window(
    tokenizer,
):
    value = ManagedContextBudget(
        source(), tokenizer.for_model("gpt-5"), 400000
    )
    with pytest.raises(
        ContextSourceUnavailable, match="current_input_over_budget"
    ):
        value.project(messages("a" * (65 * 1024)), output_tokens=4096)
    assert value.projection is None


def test_diagnostic_is_idempotent_and_contains_only_retained_metadata(
    tmp_path, tokenizer
):
    capture = source(
        run("old", "large" * 900), run("new", "synthetic-sensitive-history")
    )
    value = ManagedContextBudget(capture, tokenizer.for_model("gpt-5"), 2400)
    projected = value.project(messages(), output_tokens=512)
    journal = SQLiteRunJournal(tmp_path / "diagnostics.sqlite")
    try:
        journal.ensure_run(
            run_id=capture.run_id, project_id=capture.project_id
        )
        first = value.persist_diagnostic(journal)
        assert value.persist_diagnostic(journal) == first
        rows = journal.list_context_projection_diagnostics(
            run_id=capture.run_id
        )
        assert len(rows) == 1
        assert rows[0].source_event_ids == tuple(
            sorted(projected.source_event_ids)
        )
        assert rows[0].source_memory_ids == ()
        assert rows[0].projection_digest == projected.projection_digest
        assert rows[0].token_count == projected.token_count
        assert rows[0].project_state_version == capture.project_state_version
        with journal._lock:
            row = dict(
                journal._connection.execute(
                    "SELECT * FROM context_projection_diagnostics"
                ).fetchone()
            )
        assert "synthetic-sensitive-history" not in json.dumps(row)
        assert "current-question" not in json.dumps(row)
    finally:
        journal.close()


@pytest.mark.asyncio
async def test_owned_local_diagnostic_thread_drains_after_waiter_cancellation(
    tmp_path, monkeypatch, tokenizer
):
    capture = source()
    value = ManagedContextBudget(capture, tokenizer.for_model("gpt-5"), 400000)
    value.project(messages(), output_tokens=4096)
    journal = SQLiteRunJournal(tmp_path / "diagnostic-drain.sqlite")
    journal.ensure_run(run_id=capture.run_id, project_id=capture.project_id)
    entered, release = threading.Event(), threading.Event()
    original = journal.put_context_projection_diagnostic

    def persist(**kwargs):
        entered.set()
        if not release.wait(10):
            raise AssertionError("test did not release diagnostic writer")
        return original(**kwargs)

    monkeypatch.setattr(journal, "put_context_projection_diagnostic", persist)

    async def operation():
        async with owned_tasks_scope():
            await run_owned_thread(value.persist_diagnostic, journal)

    task = asyncio.create_task(operation())
    try:
        await eventually(entered.is_set)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        assert (
            journal.list_context_projection_diagnostics(run_id=capture.run_id)
            == []
        )
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert (
            len(
                journal.list_context_projection_diagnostics(
                    run_id=capture.run_id
                )
            )
            == 1
        )
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)
        journal.close()
