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

"""MemoryService end-to-end lifecycle tests (M2 + M4 + M5).

Verifies:
- on_run_start writes the full Space/Project/Run tree + the user prompt
- on_run_end persists the assistant final response + status=done
- runtime-log artifact (camel_logs) registered and marked not-eligible
- a *fresh* MemoryService instance reading the same root sees the prior
  Project's summary and recent conversation -- simulating an app restart
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.memory import (
    LocalMemoryStore,
    MemoryService,
    ProjectContextBuilder,
    finalize_task_lock_run_memory,
)
from app.run_context import RunContext


def _make_run_context(tmp_path: Path) -> RunContext:
    return RunContext(
        space_id="space_lifecycle",
        project_id="project_lifecycle",
        run_id="run_lifecycle_1",
        task_id="task_lifecycle_1",
        email="alice@example.com",
        user_id="42",
        working_directory=tmp_path / "work",
        task_output_root=tmp_path / "out",
        camel_log_dir=tmp_path / "logs",
        binding_source="default",
        workdir_mode="artifact-only",
        browser_port=9222,
    )


@pytest.fixture
def store(tmp_path) -> LocalMemoryStore:
    return LocalMemoryStore(root=tmp_path / "memory")


@pytest.fixture
def service(store) -> MemoryService:
    return MemoryService(store=store)


@pytest.fixture
def run_context(tmp_path) -> RunContext:
    return _make_run_context(tmp_path)


class TestRunStart:
    def test_on_run_start_creates_full_tree(self, service, run_context):
        service.on_run_start(
            run_context=run_context,
            space_name="My Workspace",
            project_name="Memory Trial",
            space_source_type="blank",
            mode="single_agent",
            user_prompt="Investigate Q2 dip",
        )
        store = service.store
        space = store.read_space("user_42", run_context.space_id)
        assert space is not None
        assert space.name == "My Workspace"
        project = store.read_project(
            "user_42", run_context.space_id, run_context.project_id
        )
        assert project is not None
        assert project.name == "Memory Trial"
        assert project.last_run_id == run_context.run_id
        run = store.read_run(
            "user_42",
            run_context.space_id,
            run_context.project_id,
            run_context.run_id,
        )
        assert run is not None
        assert run.user_prompt == "Investigate Q2 dip"
        status = store.read_run_status(
            "user_42",
            run_context.space_id,
            run_context.project_id,
            run_context.run_id,
        )
        assert status is not None
        assert status.state == "running"
        # First conversation event is the user prompt.
        tail = store.read_conversation_tail(
            "user_42", run_context.space_id, run_context.project_id, limit=10
        )
        assert len(tail) == 1
        assert tail[0].role == "user"
        assert tail[0].content == "Investigate Q2 dip"
        assert tail[0].run_id == run_context.run_id

    def test_on_run_start_with_no_identity_is_noop(self, service, tmp_path):
        ctx_no_id = RunContext(
            space_id="s",
            project_id="p",
            run_id="r",
            task_id="t",
            email="",
            user_id=None,
            working_directory=tmp_path / "work",
            task_output_root=tmp_path / "out",
            camel_log_dir=tmp_path / "logs",
            binding_source="default",
            workdir_mode=None,
            browser_port=9222,
        )
        result = service.on_run_start(
            run_context=ctx_no_id,
            space_name=None,
            project_name=None,
            mode="single_agent",
            user_prompt="hi",
        )
        assert result is None
        # Nothing written -- memory root has no users/ subtree
        assert not (service.store.root / "users").exists()

    def test_followup_run_inherits_mode_from_project(
        self, service, run_context
    ):
        # First turn declares workforce mode.
        service.on_run_start(
            run_context=run_context,
            space_name="W",
            project_name="P",
            mode="workforce",
            user_prompt="kick off",
        )
        first_run = service.store.read_run(
            "user_42",
            run_context.space_id,
            run_context.project_id,
            run_context.run_id,
        )
        assert first_run is not None and first_run.mode == "workforce"

        # Follow-up turn (improve path) passes mode=None to avoid clobbering
        # project.json -- run.json should still record the inherited mode.
        from dataclasses import replace

        followup_ctx = replace(run_context, run_id="run_lifecycle_2")
        service.on_run_start(
            run_context=followup_ctx,
            space_name=None,
            project_name=None,
            mode=None,  # caller defers to project.json
            user_prompt="follow-up",
        )
        followup_run = service.store.read_run(
            "user_42",
            followup_ctx.space_id,
            followup_ctx.project_id,
            followup_ctx.run_id,
        )
        assert followup_run is not None
        # Must NOT be None -- otherwise ContextBuilder picks the wrong profile.
        assert followup_run.mode == "workforce"

    def test_legacy_space_id_forces_source_type_legacy(
        self, service, tmp_path
    ):
        ctx = _make_run_context(tmp_path)
        # Override with a legacy-prefixed space id.
        from dataclasses import replace

        ctx = replace(ctx, space_id="legacy_42")
        service.on_run_start(
            run_context=ctx,
            space_name=None,
            project_name=None,
            space_source_type="blank",  # caller said blank but...
            mode="single_agent",
            user_prompt="x",
        )
        space = service.store.read_space("user_42", "legacy_42")
        assert space is not None
        # ...legacy id wins.
        assert space.source_type == "legacy"


class TestRunEnd:
    def test_on_run_end_done_appends_assistant_and_status(
        self, service, run_context
    ):
        service.on_run_start(
            run_context=run_context,
            space_name="W",
            project_name="P",
            mode="single_agent",
            user_prompt="user q",
        )
        service.on_run_end(
            run_context=run_context,
            state="done",
            final_result="assistant answer",
        )
        tail = service.store.read_conversation_tail(
            "user_42", run_context.space_id, run_context.project_id, limit=10
        )
        # user prompt + assistant final
        assert [e.role for e in tail] == ["user", "assistant"]
        assert tail[-1].content == "assistant answer"
        status = service.store.read_run_status(
            "user_42",
            run_context.space_id,
            run_context.project_id,
            run_context.run_id,
        )
        assert status is not None
        assert status.state == "done"
        assert status.ended_at is not None

    def test_on_run_end_failed_records_error(self, service, run_context):
        service.on_run_start(
            run_context=run_context,
            space_name="W",
            project_name="P",
            mode="single_agent",
            user_prompt="q",
        )
        service.on_run_end(
            run_context=run_context,
            state="failed",
            error="boom",
        )
        status = service.store.read_run_status(
            "user_42",
            run_context.space_id,
            run_context.project_id,
            run_context.run_id,
        )
        assert status is not None
        assert status.state == "failed"
        assert status.last_error == "boom"


class TestCamelLogsArtifact:
    def test_register_runtime_log_marks_not_eligible(
        self, service, run_context
    ):
        service.on_run_start(
            run_context=run_context,
            space_name="W",
            project_name="P",
            mode="single_agent",
            user_prompt="q",
        )
        service.register_runtime_log_artifact(
            run_context=run_context,
            relative_path=f"task_{run_context.run_id}/camel_logs",
        )
        arts = service.store.read_artifacts(
            "user_42", run_context.space_id, run_context.project_id
        )
        assert len(arts) == 1
        assert arts[0].kind == "runtime_log"
        assert arts[0].visible_to_user is False
        assert arts[0].eligible_for_context is False
        assert arts[0].path.endswith("camel_logs")


class TestTaskLockFinalizer:
    def test_finalize_task_lock_run_memory_writes_done_once(
        self, service, run_context
    ):
        class DummyTaskLock:
            pass

        task_lock = DummyTaskLock()
        task_lock.memory_service = service
        task_lock.run_context = run_context
        task_lock._memory_finalized_runs = set()

        service.on_run_start(
            run_context=run_context,
            space_name="W",
            project_name="P",
            mode="single_agent",
            user_prompt="q",
        )

        assert finalize_task_lock_run_memory(
            task_lock,
            state="done",
            final_result="answer",
        )
        assert not finalize_task_lock_run_memory(
            task_lock,
            state="cancelled",
            final_result="late cancel",
        )

        status = service.store.read_run_status(
            "user_42",
            run_context.space_id,
            run_context.project_id,
            run_context.run_id,
        )
        assert status is not None
        assert status.state == "done"
        tail = service.store.read_conversation_tail(
            "user_42", run_context.space_id, run_context.project_id, limit=10
        )
        assert [event.content for event in tail] == ["q", "answer"]


class TestCrossRestartRecovery:
    def test_fresh_service_recovers_durable_context(
        self, tmp_path, run_context
    ):
        """Simulate app restart: original service writes, a new service
        instance bound to the same root reads + ContextBuilder assembles a
        non-empty bundle."""

        root = tmp_path / "memory"

        # --- Original "run" ---
        first_store = LocalMemoryStore(root=root)
        first_service = MemoryService(store=first_store)
        first_service.on_run_start(
            run_context=run_context,
            space_name="W",
            project_name="P",
            mode="single_agent",
            user_prompt="investigate Q2 drop",
        )
        first_service.on_run_end(
            run_context=run_context,
            state="done",
            final_result="Checked dashboards; pricing change is the cause.",
        )
        first_service.store.write_project_summary(
            "user_42",
            run_context.space_id,
            run_context.project_id,
            "Pricing change shipped 2026-04-15 caused Q2 retention drop.",
        )

        # --- Simulated restart: brand-new service + new run_id ---
        from dataclasses import replace

        second_store = LocalMemoryStore(root=root)
        builder = ProjectContextBuilder(second_store)
        new_run_context = replace(run_context, run_id="run_lifecycle_2")
        bundle = builder.build(
            user_key="user_42",
            space_id=new_run_context.space_id,
            project_id=new_run_context.project_id,
            run_id=new_run_context.run_id,
            mode="single_agent",
            token_budget=4000,
            current_user_prompt="What was the cause again?",
        )
        assert not bundle.is_empty()
        assert "Pricing change" in bundle.project_summary
        # The first run's user + assistant turns survived; they belong to a
        # different run_id so the in-flight exclusion does not drop them.
        roles = [e.role for e in bundle.recent_conversation]
        assert roles == ["user", "assistant"]
        rendered = bundle.to_prompt("single_agent")
        assert "Pricing change" in rendered
        assert "What was the cause again?" in rendered
