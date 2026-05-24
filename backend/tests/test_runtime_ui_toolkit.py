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

import asyncio

import pytest
from pydantic import ValidationError

from app.agent.factory.toolkit_assembler import (
    RUNTIME_UI_TOOLKIT_CONFIG,
    _enabled,
)
from app.agent.toolkit.runtime_ui_toolkit import RuntimeUIToolkit
from app.model.runtime_ui import RuntimeUiAction, build_runtime_ui_artifact
from app.service.chat_service import _is_runtime_ui_intent
from app.service.task import TaskLock, task_locks


def test_builds_dashboard_artifact():
    payload = build_runtime_ui_artifact(
        artifact_type="dashboard",
        title="Release Dashboard",
        prompt="Show release progress.",
        data={
            "metrics": {"merged_prs": 12, "open_blockers": 2},
            "prs": [{"id": "1", "title": "Fix auth", "status": "merged"}],
        },
        actions=[
            {
                "id": "summarize",
                "label": "Summarize",
                "type": "agent_action",
            }
        ],
    )

    assert payload.artifact.type == "dashboard"
    assert payload.artifact.title == "Release Dashboard"
    assert [section.type for section in payload.artifact.sections] == [
        "markdown",
        "kpi_row",
        "table",
        "action_row",
    ]
    assert payload.data["metrics"]["merged_prs"] == 12
    assert payload.state["selectedRows"] == []


def test_builds_approval_artifact_with_default_actions():
    payload = build_runtime_ui_artifact(
        artifact_type="approval",
        title="Approve Slack Update",
        prompt="Approve sending the release summary.",
        data={"summary": "Ready to send"},
        interaction_mode="approval_required",
    )

    approval = payload.artifact.sections[-1]
    assert approval.type == "approval_panel"
    assert [action.id for action in approval.actions] == [
        "approve",
        "reject",
        "request_edit",
    ]


def test_builds_selection_artifact():
    payload = build_runtime_ui_artifact(
        artifact_type="selection",
        title="Pick a strategy",
        prompt="Choose one of the following release strategies.",
        data={
            "options": [
                {"id": "ship_today", "label": "Ship today"},
                {"id": "ship_next_week", "label": "Ship next week"},
                {"id": "hotfix_only", "label": "Hotfix only"},
            ]
        },
    )

    assert payload.artifact.type == "selection"
    sections = payload.artifact.sections
    assert sections[0].type == "markdown"
    assert sections[1].type == "selection_list"
    assert len(sections[1].options) == 3
    assert sections[1].options[0]["id"] == "ship_today"
    assert any(a.id == "submit" for a in payload.artifact.actions)


def test_builds_dashboard_with_chart():
    payload = build_runtime_ui_artifact(
        artifact_type="dashboard",
        title="Velocity Chart",
        prompt="Show weekly velocity.",
        data={
            "chart": {
                "points": [
                    {"week": "W1", "prs": 5},
                    {"week": "W2", "prs": 8},
                ],
                "type": "bar",
                "x_field": "week",
                "y_fields": ["prs"],
            }
        },
    )

    types = [s.type for s in payload.artifact.sections]
    assert "bar_chart" in types
    chart_section = next(
        s for s in payload.artifact.sections if s.type == "bar_chart"
    )
    assert chart_section.x_field == "week"
    assert chart_section.y_fields == ["prs"]


def test_builds_dashboard_with_line_chart():
    payload = build_runtime_ui_artifact(
        artifact_type="dashboard",
        title="Trend",
        prompt="Show trend.",
        data={
            "chart": {
                "points": [{"date": "Jan", "count": 10}],
                "type": "line",
                "x_field": "date",
                "y_fields": ["count"],
            }
        },
    )

    types = [s.type for s in payload.artifact.sections]
    assert "line_chart" in types


def test_rejects_unknown_action_fields():
    with pytest.raises(ValidationError):
        RuntimeUiAction.model_validate(
            {
                "id": "bad",
                "label": "Bad",
                "type": "agent_action",
                "component": "MadeUpComponent",
            }
        )


def test_builds_trigger_card_section():
    payload = build_runtime_ui_artifact(
        artifact_type="dashboard",
        title="Deployment Summary",
        prompt="Deploy v2.1.",
        data={"metrics": {"prs": 5}},
        include_trigger_card=True,
        trigger_card_title="Automate this?",
        trigger_card_subtitle="Run it on a schedule",
    )

    types = [s.type for s in payload.artifact.sections]
    assert "trigger_card" in types
    tc = next(s for s in payload.artifact.sections if s.type == "trigger_card")
    assert tc.title == "Automate this?"
    assert tc.content == "Run it on a schedule"
    # trigger_card should be last
    assert payload.artifact.sections[-1].type == "trigger_card"


def test_trigger_card_not_added_by_default():
    payload = build_runtime_ui_artifact(
        artifact_type="dashboard",
        title="Summary",
        prompt="Show summary.",
        data={},
    )
    types = [s.type for s in payload.artifact.sections]
    assert "trigger_card" not in types


def test_rejects_unsafe_generated_code_fields():
    with pytest.raises(ValueError, match="Unsafe generated UI/code field"):
        build_runtime_ui_artifact(
            artifact_type="dashboard",
            title="Unsafe",
            prompt="Unsafe",
            data={"raw_html": "<script>alert(1)</script>"},
        )


def test_runtime_toolkit_emits_ui_artifact_event():
    queue: asyncio.Queue = asyncio.Queue()
    task_locks["runtime-ui-test"] = TaskLock("runtime-ui-test", queue, {})
    try:
        toolkit = RuntimeUIToolkit(
            "runtime-ui-test", agent_name="coordinator_agent"
        )

        async def _run():
            return await toolkit.render_ui_artifact(
                artifact_type="dashboard",
                title="Release Dashboard",
                prompt="Show release progress.",
                data={"metrics": {"merged_prs": 12}},
            )

        result = asyncio.run(_run())

        emitted = None
        while not queue.empty():
            item = queue.get_nowait()
            if item.action == "ui_artifact":
                emitted = item
                break
        assert emitted is not None
        assert emitted.action == "ui_artifact"
        assert emitted.data["artifact"]["title"] == "Release Dashboard"
        assert "Rendered Eigent UI artifact" in result
    finally:
        task_locks.pop("runtime-ui-test", None)


def test_runtime_toolkit_blocking_hitl():
    """Interactive artifact awaits human input and returns the reply."""
    queue: asyncio.Queue = asyncio.Queue()
    task_locks["runtime-ui-hitl"] = TaskLock("runtime-ui-hitl", queue, {})
    try:
        toolkit = RuntimeUIToolkit(
            "runtime-ui-hitl", agent_name="single_agent"
        )

        async def _run():
            task_lock = task_locks["runtime-ui-hitl"]
            # Pre-seed the human input so the await resolves immediately
            await task_lock.put_human_input("single_agent", "approved")
            return await toolkit.render_ui_artifact(
                artifact_type="approval",
                title="Approve release",
                prompt="Approve?",
                data={"summary": "Release notes"},
                interaction_mode="approval_required",
            )

        result = asyncio.run(_run())
        assert result == "approved"
    finally:
        task_locks.pop("runtime-ui-hitl", None)


# --- Intent gate tests ---


def test_is_runtime_ui_intent_true_cases():
    true_cases = [
        "Show me a release dashboard with merged PRs",
        "Show me a report panel for the sprint",
        "Show a decision UI for the migration",
        "I need a workflow panel",
        "Display an approval surface before sending",
        "Use the Runtime UI Toolkit to show a summary",
        "Make a selection panel with three options",
        "Ask the user to pick one of these options",
        "Show an approve before sending card",
        "Call render_ui_artifact for this",
        "Show a status dashboard for the sprint",
    ]
    for question in true_cases:
        assert _is_runtime_ui_intent(question), (
            f"Expected True for: {question!r}"
        )


def test_is_runtime_ui_intent_false_cases():
    false_cases = [
        "Implement a React dashboard component",
        "Summarize this pull request",
        "Run the test suite",
        "Fix the login bug",
        "Write a Python script to parse logs",
    ]
    for question in false_cases:
        assert not _is_runtime_ui_intent(question), (
            f"Expected False for: {question!r}"
        )


def test_is_runtime_ui_intent_expanded_phrases():
    """New phrases added in Phase 4 should route to Runtime UI."""
    new_true_cases = [
        "Show me analytics for last week",
        "Give me a summary of the sprint",
        "Give me a dashboard for this project",
        "Compare the three deploy strategies",
        "Show the velocity report for Q2",
        "Generate a weekly report for the team",
        "Show a status report for the release",
    ]
    for question in new_true_cases:
        assert _is_runtime_ui_intent(question), (
            f"Expected True for: {question!r}"
        )


def test_is_runtime_ui_intent_code_gen_veto():
    """Code-gen signals override phrase matches — must stay False."""
    veto_cases = [
        "Build a velocity report component in React",
        "Implement a weekly report dashboard",
    ]
    for question in veto_cases:
        assert not _is_runtime_ui_intent(question), (
            f"Expected False for: {question!r}"
        )


def test_builds_status_tile_section():
    payload = build_runtime_ui_artifact(
        artifact_type="dashboard",
        title="Build Health",
        prompt="Show build health.",
        data={
            "status": {
                "title": "CI Pipeline",
                "value": "Passing",
                "tone": "success",
                "icon": "check",
                "caption": "3 jobs completed",
            }
        },
    )
    types = [s.type for s in payload.artifact.sections]
    assert "status_tile" in types
    tile = next(
        s for s in payload.artifact.sections if s.type == "status_tile"
    )
    assert tile.value == "Passing"
    assert tile.tone == "success"
    assert tile.caption == "3 jobs completed"


def test_builds_timeline_section():
    payload = build_runtime_ui_artifact(
        artifact_type="dashboard",
        title="Deploy Log",
        prompt="Show deploy timeline.",
        data={
            "timeline": [
                {"id": "e1", "label": "Deploy started", "tone": "information"},
                {"id": "e2", "label": "Tests passed", "tone": "success"},
            ]
        },
    )
    types = [s.type for s in payload.artifact.sections]
    assert "timeline" in types
    # Data is preserved in payload
    assert len(payload.data["timeline"]) == 2


def test_builds_compare_card_section():
    payload = build_runtime_ui_artifact(
        artifact_type="dashboard",
        title="Strategy Comparison",
        prompt="Compare options.",
        data={
            "compare": [
                {"id": "a", "title": "Option A", "features": []},
                {"id": "b", "title": "Option B", "features": []},
            ]
        },
    )
    types = [s.type for s in payload.artifact.sections]
    assert "compare_card" in types


def test_builds_area_chart_section():
    payload = build_runtime_ui_artifact(
        artifact_type="dashboard",
        title="Cumulative PRs",
        prompt="Show cumulative PR trend.",
        data={
            "chart": {
                "points": [
                    {"week": "W1", "prs": 5},
                    {"week": "W2", "prs": 13},
                ],
                "type": "area",
                "x_field": "week",
                "y_fields": ["prs"],
            }
        },
    )
    types = [s.type for s in payload.artifact.sections]
    assert "area_chart" in types


def test_builds_pie_chart_section():
    payload = build_runtime_ui_artifact(
        artifact_type="dashboard",
        title="PR Distribution",
        prompt="Show PR distribution.",
        data={
            "chart": {
                "points": [
                    {"status": "merged", "count": 10},
                    {"status": "open", "count": 3},
                ],
                "type": "pie",
                "x_field": "status",
                "y_fields": ["count"],
            }
        },
    )
    types = [s.type for s in payload.artifact.sections]
    assert "pie_chart" in types


def test_chart_display_options_propagated():
    payload = build_runtime_ui_artifact(
        artifact_type="dashboard",
        title="Stacked Bar",
        prompt="Show stacked data.",
        data={
            "chart": {
                "points": [{"week": "W1", "a": 5, "b": 3}],
                "type": "bar",
                "x_field": "week",
                "y_fields": ["a", "b"],
                "stacked": True,
                "show_legend": True,
            }
        },
    )
    chart_section = next(
        s for s in payload.artifact.sections if s.type == "bar_chart"
    )
    assert chart_section.stacked is True
    assert chart_section.show_legend is True


# --- Restricted profile tests ---


def test_restricted_profile_disables_skill_toolkit():
    merged = {**RUNTIME_UI_TOOLKIT_CONFIG}
    assert not _enabled(merged, "skill")
    assert not _enabled(merged, "web_deploy")
    assert not _enabled(merged, "screenshot")
    assert not _enabled(merged, "terminal")
    assert not _enabled(merged, "mcp")
    assert not _enabled(merged, "agent")


def test_restricted_profile_keeps_human_and_runtime_ui():
    merged = {**RUNTIME_UI_TOOLKIT_CONFIG}
    # human and runtime_ui are not in the restricted config, so they use the
    # default True from _enabled
    assert _enabled(merged, "human")
    assert _enabled(merged, "runtime_ui")
    assert _enabled(merged, "search")
    assert _enabled(merged, "file")
