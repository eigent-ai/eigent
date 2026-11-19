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

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from app.controller.run_controller import get_run_events, list_run_agents
from app.run_journal import CommittedRunEvent, RunRecord
from app.run_journal.semantic_events import project_legacy_semantic_event
from app.run_journal.worker_view import (
    filter_events_for_agent,
    summarize_run_agents,
)


class _Log:
    """Builds a Run's committed events in order."""

    def __init__(self) -> None:
        self.events: list[CommittedRunEvent] = []

    def add(self, event_type: str, payload: dict[str, Any]) -> int:
        sequence = len(self.events) + 1
        self.events.append(
            CommittedRunEvent(
                event_id=f"event-{sequence}",
                run_id="run-1",
                sequence=sequence,
                event_type=event_type,
                payload=payload,
                legacy_step=None,
                created_at=float(sequence),
                run_version=sequence,
            )
        )
        return sequence

    def legacy(self, step: str, **data: Any) -> int:
        projection = project_legacy_semantic_event(
            step=step, data=data, run_id="run-1"
        )
        assert projection is not None, step
        return self.add(projection.event_type, projection.payload)

    def tool(
        self,
        status: str,
        *,
        tool_call_id: str,
        agent_name: str,
        task_id: str = "",
        step_id: str = "",
    ) -> int:
        # Mirrors the tool checkpoint payload: no agent_id, only the
        # worker's name and the task it was processing.
        return self.add(
            f"tool.{status}",
            {
                "tool_call_id": tool_call_id,
                "tool_name": "shell_exec",
                "status": status,
                "step_id": step_id,
                "agent_name": agent_name,
                "process_task_id": task_id,
                "semantic": {
                    "kind": "command_execution",
                    "actor": {"type": "agent", "name": agent_name},
                    "correlation": {"task_id": task_id, "step_id": step_id},
                },
            },
        )


def _workforce_run() -> tuple[_Log, dict[str, int]]:
    """A Workforce Run with three workers and one pending approval."""

    log = _Log()
    seq: dict[str, int] = {}
    seq["plan"] = log.legacy(
        "to_sub_tasks",
        task_id="root",
        sub_tasks=[{"id": "t1", "content": "Research"}],
    )
    for agent_id, name in (
        ("a-research", "Research Agent"),
        ("a-dev", "Developer Agent"),
        ("a-browser", "Browser Agent"),
    ):
        log.legacy("create_agent", agent_id=agent_id, agent_name=name)

    seq["assign_dev"] = log.legacy(
        "assign_task",
        task_id="t2",
        assignee_id="a-dev",
        content="Build the page",
        state="running",
    )
    seq["assign_research"] = log.legacy(
        "assign_task",
        task_id="t1",
        assignee_id="a-research",
        content="Research competitor pricing",
        state="running",
    )
    seq["dev_start"] = log.legacy(
        "activate_agent",
        agent_id="a-dev",
        agent_name="Developer Agent",
        process_task_id="t2",
        agent_turn_id="turn-dev",
        message="Build the page",
    )
    seq["dev_tool"] = log.tool(
        "dispatched",
        tool_call_id="call-dev-1",
        agent_name="Developer Agent",
        task_id="t2",
        step_id="step-dev-1",
    )
    seq["research_start"] = log.legacy(
        "activate_agent",
        agent_id="a-research",
        agent_name="Research Agent",
        process_task_id="t1",
        agent_turn_id="turn-research",
        message="Research competitor pricing",
    )
    seq["research_tool"] = log.tool(
        "completed",
        tool_call_id="call-research-1",
        agent_name="Research Agent",
        task_id="t1",
    )
    seq["research_done"] = log.legacy(
        "deactivate_agent",
        agent_id="a-research",
        agent_name="Research Agent",
        process_task_id="t1",
        agent_turn_id="turn-research",
        status="completed",
    )
    seq["research_returned"] = log.legacy(
        "task_state",
        task_id="t1",
        state="DONE",
        content="Research competitor pricing",
        result="Three competitors found",
    )
    seq["dev_approval"] = log.add(
        "approval.requested",
        {
            "approval_id": "approval-1",
            "version": 0,
            "prompt": "Run npm install?",
            "step_id": "step-dev-1",
        },
    )
    return log, seq


def test_summary_lists_workers_in_order_with_status_and_task():
    log, _ = _workforce_run()

    agents = summarize_run_agents(log.events)

    assert [agent["agent_id"] for agent in agents] == [
        "a-dev",
        "a-research",
        "a-browser",
    ]
    by_id = {agent["agent_id"]: agent for agent in agents}
    assert by_id["a-dev"]["name"] == "Developer Agent"
    assert by_id["a-dev"]["status"] == "waiting"
    assert by_id["a-dev"]["current_task"] == "Build the page"
    assert by_id["a-dev"]["counts"]["pending_requests"] == 1
    assert by_id["a-dev"]["counts"]["tool_calls"] == 1
    assert by_id["a-research"]["status"] == "completed"
    assert by_id["a-research"]["counts"]["tasks"] == 1
    # Registered but never given work: listed last, idle.
    assert by_id["a-browser"]["status"] == "idle"
    assert by_id["a-browser"]["first_sequence"] == 0


def test_filter_returns_worker_events_and_task_hand_offs():
    log, seq = _workforce_run()

    research = filter_events_for_agent(log.events, "a-research")

    assert [event.sequence for event in research] == [
        # create_agent for a-research is the event right after the plan.
        seq["plan"] + 1,
        seq["assign_research"],
        seq["research_start"],
        seq["research_tool"],
        seq["research_done"],
        seq["research_returned"],
    ]


def test_filter_links_tool_calls_and_approvals_without_agent_id():
    log, seq = _workforce_run()

    developer = [
        event.sequence
        for event in filter_events_for_agent(log.events, "a-dev")
    ]

    assert seq["dev_tool"] in developer
    assert seq["dev_approval"] in developer
    assert seq["research_tool"] not in developer
    assert seq["plan"] not in developer


def test_resolving_an_approval_clears_the_waiting_status():
    log, _ = _workforce_run()
    log.add(
        "approval.resolved",
        {"approval_id": "approval-1", "decision": {"approved": True}},
    )

    agents = {
        agent["agent_id"]: agent for agent in summarize_run_agents(log.events)
    }

    assert agents["a-dev"]["status"] == "running"
    assert agents["a-dev"]["counts"]["pending_requests"] == 0


def test_unknown_actor_returns_no_events():
    log, _ = _workforce_run()

    assert filter_events_for_agent(log.events, "nobody") == []


def test_single_agent_run_returns_one_agent():
    log = _Log()
    log.legacy(
        "activate_agent",
        agent_id="a-solo",
        agent_name="Eigent",
        process_task_id="root",
        agent_turn_id="turn-1",
        message="Plan a trip",
    )
    log.tool("completed", tool_call_id="call-1", agent_name="Eigent")

    agents = summarize_run_agents(log.events)

    assert [agent["agent_id"] for agent in agents] == ["a-solo"]
    assert agents[0]["counts"]["events"] == 2


def test_same_worker_name_twice_does_not_guess_tool_owner():
    log = _Log()
    for agent_id in ("a-1", "a-2"):
        log.legacy(
            "create_agent", agent_id=agent_id, agent_name="Developer Agent"
        )
    tool = log.tool(
        "completed", tool_call_id="c", agent_name="Developer Agent"
    )

    assert tool not in [
        event.sequence for event in filter_events_for_agent(log.events, "a-1")
    ]


def _journal(log: _Log) -> MagicMock:
    journal = MagicMock()
    journal.get_run.return_value = RunRecord(
        run_id="run-1",
        project_id="project-1",
        status="running",
        version=2,
        active_attempt_id=None,
        deadline_at=None,
        timeout_policy_version="v1",
        created_at=1.0,
        updated_at=2.0,
    )
    journal.list_events.return_value = log.events
    return journal


@pytest.mark.asyncio
async def test_agents_endpoint_returns_summary():
    log, _ = _workforce_run()
    with patch(
        "app.controller.run_controller.get_default_run_journal",
        return_value=_journal(log),
    ):
        result = await list_run_agents("run-1")

    assert result["run_id"] == "run-1"
    assert result["project_id"] == "project-1"
    assert len(result["agents"]) == 3


@pytest.mark.asyncio
async def test_events_endpoint_filters_and_pages_by_actor():
    log, seq = _workforce_run()
    journal = _journal(log)
    with patch(
        "app.controller.run_controller.get_default_run_journal",
        return_value=journal,
    ):
        first = await get_run_events(
            "run-1", after_sequence=0, limit=2, actor_id="a-research"
        )
        rest = await get_run_events(
            "run-1",
            after_sequence=first["next_sequence"],
            limit=50,
            actor_id="a-research",
        )

    assert first["has_more"] is True
    assert [event["sequence"] for event in first["events"]] == [
        seq["plan"] + 1,
        seq["assign_research"],
    ]
    assert rest["has_more"] is False
    assert [event["sequence"] for event in rest["events"]][-1] == (
        seq["research_returned"]
    )
    journal.list_events.assert_called_with("run-1")
