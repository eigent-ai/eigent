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

"""ProjectContextBuilder unit tests."""

from __future__ import annotations

import pytest

from app.memory import (
    ConversationEvent,
    LocalMemoryStore,
    MemoryArtifact,
    MemoryFact,
    ProjectContextBuilder,
    ProjectMemory,
    SpaceMemory,
)


@pytest.fixture
def store(tmp_path) -> LocalMemoryStore:
    return LocalMemoryStore(root=tmp_path)


@pytest.fixture
def ids() -> dict[str, str]:
    return {
        "user_key": "user_42",
        "space_id": "space_x",
        "project_id": "project_x",
        "run_id": "run_current",
    }


@pytest.fixture
def seeded_store(store, ids) -> LocalMemoryStore:
    store.write_space(
        ids["user_key"],
        SpaceMemory(
            space_id=ids["space_id"],
            user_id="42",
            name="Workspace X",
            source_type="blank",
            created_at="2026-05-27T09:00:00Z",
            updated_at="2026-05-27T09:00:00Z",
        ),
    )
    store.write_project(
        ids["user_key"],
        ProjectMemory(
            project_id=ids["project_id"],
            space_id=ids["space_id"],
            name="Q2 retro",
            created_at="2026-05-27T09:30:00Z",
            updated_at="2026-05-27T09:30:00Z",
            mode="single_agent",
        ),
    )
    store.write_project_summary(
        ids["user_key"],
        ids["space_id"],
        ids["project_id"],
        "Investigating why Q2 retention dropped after pricing change.",
    )

    # Past run: a brief user/assistant turn pair.
    store.append_conversation(
        ids["user_key"],
        ids["space_id"],
        ids["project_id"],
        ConversationEvent(
            event_id="evt_user_1",
            run_id="run_past_1",
            timestamp="2026-05-27T09:31:00Z",
            role="user",
            content="What dashboards do we have for Q2 retention?",
            source="chat",
            visibility="context",
            hash="sha256:1",
        ),
    )
    store.append_conversation(
        ids["user_key"],
        ids["space_id"],
        ids["project_id"],
        ConversationEvent(
            event_id="evt_assist_1",
            run_id="run_past_1",
            timestamp="2026-05-27T09:31:10Z",
            role="assistant",
            content="Three Looker dashboards: cohort, churn, pricing-impact.",
            source="chat",
            visibility="context",
            hash="sha256:2",
        ),
    )
    # In-flight run: must be excluded from recent_conversation.
    store.append_conversation(
        ids["user_key"],
        ids["space_id"],
        ids["project_id"],
        ConversationEvent(
            event_id="evt_user_current",
            run_id=ids["run_id"],
            timestamp="2026-05-27T10:00:00Z",
            role="user",
            content="Now pull the pricing-impact dashboard.",
            source="chat",
            visibility="context",
            hash="sha256:3",
        ),
    )
    # debug_only must never make it into context.
    store.append_conversation(
        ids["user_key"],
        ids["space_id"],
        ids["project_id"],
        ConversationEvent(
            event_id="evt_debug",
            run_id="run_past_1",
            timestamp="2026-05-27T09:31:05Z",
            role="system",
            content="raw tool dump: ...",
            source="imported",
            visibility="debug_only",
            hash="sha256:4",
        ),
    )

    store.upsert_fact(
        ids["user_key"],
        ids["space_id"],
        ids["project_id"],
        MemoryFact(
            fact_id="fact_pricing",
            text="Pricing change shipped 2026-04-15.",
            scope="project",
            source_event_ids=["evt_assist_1"],
            confidence=0.95,
            created_at="2026-05-27T09:32:00Z",
            updated_at="2026-05-27T09:32:00Z",
        ),
    )
    # Lower-confidence fact, should rank below.
    store.upsert_fact(
        ids["user_key"],
        ids["space_id"],
        ids["project_id"],
        MemoryFact(
            fact_id="fact_weak",
            text="Maybe one dashboard is owned by marketing.",
            scope="project",
            source_event_ids=[],
            confidence=0.3,
            created_at="2026-05-27T09:32:00Z",
            updated_at="2026-05-27T09:32:00Z",
        ),
    )

    # Visible artifact (eligible) and a runtime log (excluded).
    store.upsert_artifact(
        ids["user_key"],
        ids["space_id"],
        ids["project_id"],
        MemoryArtifact(
            artifact_id="art_report",
            run_id="run_past_1",
            path="task_run_past_1/q2-report.html",
            kind="html_report",
            visible_to_user=True,
            eligible_for_context=True,
            hash="sha256:r",
            created_at="2026-05-27T09:35:00Z",
        ),
    )
    store.upsert_artifact(
        ids["user_key"],
        ids["space_id"],
        ids["project_id"],
        MemoryArtifact(
            artifact_id="art_log",
            run_id="run_past_1",
            path="task_run_past_1/camel_logs/",
            kind="runtime_log",
            visible_to_user=False,
            eligible_for_context=False,
            hash="",
            created_at="2026-05-27T09:35:01Z",
        ),
    )
    return store


# ----- Empty store -----


class TestEmptyStore:
    def test_build_on_empty_returns_empty_bundle(self, store, ids):
        bundle = ProjectContextBuilder(store).build(
            user_key=ids["user_key"],
            space_id=ids["space_id"],
            project_id=ids["project_id"],
            run_id=ids["run_id"],
            mode="single_agent",
            token_budget=4000,
            current_user_prompt="hi",
        )
        assert bundle.is_empty()
        assert bundle.current_run_instruction == "hi"
        # Names fall back to ids when no Space/Project memory exists.
        assert bundle.space_name == ids["space_id"]
        assert bundle.project_name == ids["project_id"]


# ----- Seeded store -----


class TestSeededBuild:
    def test_picks_up_summary_and_recent_pair(self, seeded_store, ids):
        bundle = ProjectContextBuilder(seeded_store).build(
            user_key=ids["user_key"],
            space_id=ids["space_id"],
            project_id=ids["project_id"],
            run_id=ids["run_id"],
            mode="single_agent",
            token_budget=4000,
            current_user_prompt="Now pull the pricing-impact dashboard.",
        )
        assert not bundle.is_empty()
        assert bundle.project_name == "Q2 retro"
        assert "Q2 retention" in bundle.project_summary
        # Past run pair survives; current-run prompt is excluded.
        ids_present = [e.event_id for e in bundle.recent_conversation]
        assert "evt_user_1" in ids_present
        assert "evt_assist_1" in ids_present
        assert "evt_user_current" not in ids_present

    def test_excludes_debug_only_events(self, seeded_store, ids):
        bundle = ProjectContextBuilder(seeded_store).build(
            user_key=ids["user_key"],
            space_id=ids["space_id"],
            project_id=ids["project_id"],
            run_id=ids["run_id"],
            mode="single_agent",
            token_budget=4000,
            current_user_prompt="x",
        )
        assert all(
            e.event_id != "evt_debug" for e in bundle.recent_conversation
        )

    def test_excludes_runtime_log_artifacts(self, seeded_store, ids):
        bundle = ProjectContextBuilder(seeded_store).build(
            user_key=ids["user_key"],
            space_id=ids["space_id"],
            project_id=ids["project_id"],
            run_id=ids["run_id"],
            mode="single_agent",
            token_budget=4000,
            current_user_prompt="x",
        )
        ids_present = [a.artifact_id for a in bundle.relevant_artifacts]
        assert "art_report" in ids_present
        assert "art_log" not in ids_present

    def test_facts_ranked_by_confidence(self, seeded_store, ids):
        bundle = ProjectContextBuilder(seeded_store).build(
            user_key=ids["user_key"],
            space_id=ids["space_id"],
            project_id=ids["project_id"],
            run_id=ids["run_id"],
            mode="single_agent",
            token_budget=4000,
            current_user_prompt="x",
        )
        ranked_ids = [f.fact_id for f in bundle.relevant_facts]
        # High-confidence first
        assert ranked_ids.index("fact_pricing") < ranked_ids.index("fact_weak")

    def test_to_prompt_single_agent_contains_key_sections(
        self, seeded_store, ids
    ):
        bundle = ProjectContextBuilder(seeded_store).build(
            user_key=ids["user_key"],
            space_id=ids["space_id"],
            project_id=ids["project_id"],
            run_id=ids["run_id"],
            mode="single_agent",
            token_budget=4000,
            current_user_prompt="Now pull the pricing-impact dashboard.",
        )
        rendered = bundle.to_prompt("single_agent")
        assert "=== Persisted Project Context ===" in rendered
        assert "Project: Q2 retro" in rendered
        assert "Q2 retention" in rendered
        assert "Pricing change shipped 2026-04-15." in rendered
        assert "User: What dashboards" in rendered
        assert "Assistant: Three Looker dashboards" in rendered
        assert "Now pull the pricing-impact dashboard." in rendered
        assert "=== End Persisted Project Context ===" in rendered


# ----- Token budget -----


class TestBudget:
    def test_tiny_budget_keeps_at_least_one_recent_event(
        self, seeded_store, ids
    ):
        # Even a stingy budget should let one tail event through so callers
        # always have *some* continuity signal.
        bundle = ProjectContextBuilder(seeded_store).build(
            user_key=ids["user_key"],
            space_id=ids["space_id"],
            project_id=ids["project_id"],
            run_id=ids["run_id"],
            mode="single_agent",
            token_budget=64,
            current_user_prompt="x",
        )
        assert len(bundle.recent_conversation) >= 1

    def test_huge_budget_includes_everything_eligible(self, seeded_store, ids):
        bundle = ProjectContextBuilder(seeded_store).build(
            user_key=ids["user_key"],
            space_id=ids["space_id"],
            project_id=ids["project_id"],
            run_id=ids["run_id"],
            mode="single_agent",
            token_budget=100_000,
            current_user_prompt="x",
        )
        # Past pair, both facts, the one eligible artifact.
        assert len(bundle.recent_conversation) == 2
        assert len(bundle.relevant_facts) == 2
        assert len(bundle.relevant_artifacts) == 1

    def test_oversized_single_event_is_truncated_not_injected_whole(
        self, store, ids
    ):
        # One assistant turn whose content alone vastly exceeds the section
        # budget. Previously the loop's `and kept` guard let the newest event
        # through even when it dwarfed the budget, so a 1MB HTML report would
        # be injected verbatim into the next prompt. After R26-3, we keep
        # the event but truncate its content to fit.
        store.write_space(
            ids["user_key"],
            SpaceMemory(
                space_id=ids["space_id"],
                user_id="42",
                name="W",
                source_type="blank",
                created_at="2026-05-27T09:00:00Z",
                updated_at="2026-05-27T09:00:00Z",
            ),
        )
        store.write_project(
            ids["user_key"],
            ProjectMemory(
                project_id=ids["project_id"],
                space_id=ids["space_id"],
                name="P",
                created_at="2026-05-27T09:30:00Z",
                updated_at="2026-05-27T09:30:00Z",
                mode="single_agent",
            ),
        )
        # Bind to a *prior* run id so the in-flight-run filter doesn't drop it.
        store.append_conversation(
            ids["user_key"],
            ids["space_id"],
            ids["project_id"],
            ConversationEvent(
                event_id="ev_huge",
                run_id="run_prior",
                timestamp="2026-05-27T11:00:00Z",
                role="assistant",
                content="X" * 200_000,
                source="chat",
                visibility="context",
                hash="sha256:deadbeef",
            ),
        )
        bundle = ProjectContextBuilder(store).build(
            user_key=ids["user_key"],
            space_id=ids["space_id"],
            project_id=ids["project_id"],
            run_id=ids["run_id"],
            mode="single_agent",
            token_budget=2000,  # ~ small section budget
            current_user_prompt="x",
        )
        assert len(bundle.recent_conversation) == 1
        content = bundle.recent_conversation[0].content
        assert "truncated to fit context budget" in content
        # Truncated content must be smaller than the original 200K payload.
        assert len(content) < 20_000


# ----- Mode-specific render -----


class TestRender:
    def test_worker_mode_omits_recent_conversation(self, seeded_store, ids):
        bundle = ProjectContextBuilder(seeded_store).build(
            user_key=ids["user_key"],
            space_id=ids["space_id"],
            project_id=ids["project_id"],
            run_id=ids["run_id"],
            mode="workforce_worker",
            token_budget=4000,
            current_user_prompt="fetch the dashboard",
        )
        rendered = bundle.to_prompt("workforce_worker")
        assert "=== Worker Assignment ===" in rendered
        assert "fetch the dashboard" in rendered
        # Workers must not see full conversation.
        assert "Recent conversation:" not in rendered
