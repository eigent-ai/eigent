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

"""LocalMemoryStore acceptance tests (§25 of design doc).

Exercises the M1 surface on a tmpdir root so no real ~/.eigent is touched.
"""

from __future__ import annotations

import json
import threading

import pytest

from app.memory import (
    ConversationEvent,
    LocalMemoryStore,
    MemoryArtifact,
    MemoryFact,
    ProjectMemory,
    RunMemory,
    RunStatus,
    SpaceMemory,
    SyncSettings,
    canonical_user_id,
)


@pytest.fixture
def store(tmp_path) -> LocalMemoryStore:
    return LocalMemoryStore(root=tmp_path)


@pytest.fixture
def ids() -> dict[str, str]:
    return {
        "user_key": "user_42",
        "space_id": "space_test",
        "project_id": "project_test",
        "run_id": "run_test_1",
    }


# ----- canonical_user_id -----


class TestCanonicalUserId:
    def test_prefers_user_id_with_user_prefix(self):
        assert canonical_user_id("42") == "user_42"

    def test_integer_user_id_supported(self):
        assert canonical_user_id(42) == "user_42"

    def test_falls_back_to_email_local_part(self):
        assert canonical_user_id(None, email="alice@example.com") == "alice"

    def test_sanitises_unsafe_characters(self):
        assert canonical_user_id(None, email="al ice@example.com") == "al_ice"

    def test_raises_when_neither_supplied(self):
        with pytest.raises(ValueError):
            canonical_user_id(None)

    def test_raises_when_user_id_blank_and_no_email(self):
        with pytest.raises(ValueError):
            canonical_user_id("   ")


# ----- Construction / lazy init -----


class TestLazyInit:
    def test_construct_does_not_touch_disk(self, tmp_path):
        # Using a fresh subdir that should not be created on construction.
        empty = tmp_path / "fresh"
        LocalMemoryStore(root=empty)
        assert not empty.exists()

    def test_root_defaults_to_home_eigent_memory(self):
        from pathlib import Path

        from app.memory import memory_root

        s = LocalMemoryStore()
        assert s.root == memory_root()
        assert s.root == Path.home() / ".eigent" / "memory"


# ----- Space-level -----


class TestSpaceRoundtrip:
    def test_read_missing_returns_none(self, store, ids):
        assert store.read_space(ids["user_key"], ids["space_id"]) is None

    def test_write_then_read_roundtrip(self, store, ids):
        payload = SpaceMemory(
            space_id=ids["space_id"],
            user_id="42",
            name="Test Space",
            source_type="blank",
            created_at="2026-05-27T10:00:00Z",
            updated_at="2026-05-27T10:00:00Z",
        )
        store.write_space(ids["user_key"], payload)
        loaded = store.read_space(ids["user_key"], ids["space_id"])
        assert loaded == payload
        # Sync defaults to local_only
        assert loaded.sync == SyncSettings()

    def test_write_creates_parent_dirs(self, store, ids):
        payload = SpaceMemory(
            space_id=ids["space_id"],
            user_id="42",
            name="x",
            source_type="blank",
            created_at="t",
            updated_at="t",
        )
        # Tree does not exist yet
        assert not store.space_path(ids["user_key"], ids["space_id"]).exists()
        store.write_space(ids["user_key"], payload)
        assert (
            store.space_path(ids["user_key"], ids["space_id"]) / "space.json"
        ).exists()


# ----- Project-level -----


class TestProjectRoundtrip:
    def test_write_read_project(self, store, ids):
        payload = ProjectMemory(
            project_id=ids["project_id"],
            space_id=ids["space_id"],
            name="P",
            created_at="t",
            updated_at="t",
            mode="single_agent",
            last_run_id=None,
        )
        store.write_project(ids["user_key"], payload)
        assert (
            store.read_project(
                ids["user_key"], ids["space_id"], ids["project_id"]
            )
            == payload
        )

    def test_unknown_fields_in_file_are_ignored(self, store, ids):
        # Simulate an older file with an extra unknown field.
        path = (
            store.project_path(
                ids["user_key"], ids["space_id"], ids["project_id"]
            )
            / "project.json"
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "project_id": ids["project_id"],
                    "space_id": ids["space_id"],
                    "name": "P",
                    "created_at": "t",
                    "updated_at": "t",
                    "mode": None,
                    "last_run_id": None,
                    "unknown_future_field": "ignore-me",
                    "schema_version": 1,
                }
            ),
            encoding="utf-8",
        )
        loaded = store.read_project(
            ids["user_key"], ids["space_id"], ids["project_id"]
        )
        assert loaded is not None
        assert loaded.name == "P"

    def test_malformed_json_treated_as_missing(self, store, ids):
        path = (
            store.project_path(
                ids["user_key"], ids["space_id"], ids["project_id"]
            )
            / "project.json"
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{ this is not json", encoding="utf-8")
        assert (
            store.read_project(
                ids["user_key"], ids["space_id"], ids["project_id"]
            )
            is None
        )


# ----- Conversation log -----


class TestConversationLog:
    def test_append_and_read_tail_preserves_order(self, store, ids):
        for i in range(5):
            store.append_conversation(
                ids["user_key"],
                ids["space_id"],
                ids["project_id"],
                ConversationEvent(
                    event_id=f"evt_{i}",
                    run_id=ids["run_id"],
                    timestamp=f"2026-05-27T10:00:0{i}Z",
                    role="user" if i % 2 == 0 else "assistant",
                    content=f"message {i}",
                    source="chat",
                    visibility="context",
                    hash=f"sha256:{i}",
                ),
            )

        tail = store.read_conversation_tail(
            ids["user_key"], ids["space_id"], ids["project_id"], limit=3
        )
        assert [e.event_id for e in tail] == ["evt_2", "evt_3", "evt_4"]

    def test_read_tail_when_empty(self, store, ids):
        assert (
            store.read_conversation_tail(
                ids["user_key"], ids["space_id"], ids["project_id"], limit=10
            )
            == []
        )

    def test_read_tail_zero_limit_returns_empty(self, store, ids):
        store.append_conversation(
            ids["user_key"],
            ids["space_id"],
            ids["project_id"],
            ConversationEvent(
                event_id="evt_1",
                run_id=ids["run_id"],
                timestamp="t",
                role="user",
                content="hi",
                source="chat",
                visibility="context",
                hash="sha256:1",
            ),
        )
        assert (
            store.read_conversation_tail(
                ids["user_key"], ids["space_id"], ids["project_id"], limit=0
            )
            == []
        )

    def test_concurrent_appends_do_not_interleave(self, store, ids):
        # Two threads each append 50 events; no line should be partial or lost.
        def writer(start: int) -> None:
            for i in range(50):
                store.append_conversation(
                    ids["user_key"],
                    ids["space_id"],
                    ids["project_id"],
                    ConversationEvent(
                        event_id=f"evt_{start + i}",
                        run_id=ids["run_id"],
                        timestamp="t",
                        role="user",
                        content=f"c {start + i}",
                        source="chat",
                        visibility="context",
                        hash="sha256:x",
                    ),
                )

        threads = [
            threading.Thread(target=writer, args=(0,)),
            threading.Thread(target=writer, args=(1000,)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        path = (
            store.project_path(
                ids["user_key"], ids["space_id"], ids["project_id"]
            )
            / "conversation.jsonl"
        )
        lines = path.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 100
        for line in lines:
            json.loads(line)  # would raise if any line was torn

    def test_malformed_line_is_skipped_not_fatal(self, store, ids):
        path = (
            store.project_path(
                ids["user_key"], ids["space_id"], ids["project_id"]
            )
            / "conversation.jsonl"
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "event_id": "ok",
                    "run_id": ids["run_id"],
                    "timestamp": "t",
                    "role": "user",
                    "content": "x",
                    "source": "chat",
                    "visibility": "context",
                    "hash": "sha256:1",
                }
            )
            + "\n"
            + "{ not json\n",
            encoding="utf-8",
        )
        tail = store.read_conversation_tail(
            ids["user_key"], ids["space_id"], ids["project_id"], limit=10
        )
        assert [e.event_id for e in tail] == ["ok"]


# ----- Facts / artifacts upsert -----


class TestFactsArtifacts:
    def _fact(self, fact_id: str, text: str) -> MemoryFact:
        return MemoryFact(
            fact_id=fact_id,
            text=text,
            scope="project",
            source_event_ids=[],
            confidence=0.9,
            created_at="t",
            updated_at="t",
        )

    def test_upsert_fact_dedupes_by_id(self, store, ids):
        store.upsert_fact(
            ids["user_key"],
            ids["space_id"],
            ids["project_id"],
            self._fact("f1", "v1"),
        )
        store.upsert_fact(
            ids["user_key"],
            ids["space_id"],
            ids["project_id"],
            self._fact("f1", "v2-updated"),
        )
        facts = store.read_facts(
            ids["user_key"], ids["space_id"], ids["project_id"]
        )
        assert [(f.fact_id, f.text) for f in facts] == [("f1", "v2-updated")]

    def test_artifact_upsert_dedupes_by_id(self, store, ids):
        a1 = MemoryArtifact(
            artifact_id="a1",
            run_id=ids["run_id"],
            path="task_run_test_1/report.html",
            kind="html_report",
            visible_to_user=True,
            eligible_for_context=True,
            hash="sha256:1",
            created_at="t",
        )
        a1_updated = MemoryArtifact(
            artifact_id="a1",
            run_id=ids["run_id"],
            path="task_run_test_1/report.html",
            kind="html_report",
            visible_to_user=True,
            eligible_for_context=False,
            hash="sha256:2",
            created_at="t",
        )
        store.upsert_artifact(
            ids["user_key"], ids["space_id"], ids["project_id"], a1
        )
        store.upsert_artifact(
            ids["user_key"], ids["space_id"], ids["project_id"], a1_updated
        )
        loaded = store.read_artifacts(
            ids["user_key"], ids["space_id"], ids["project_id"]
        )
        assert len(loaded) == 1
        assert loaded[0].eligible_for_context is False

    def test_concurrent_artifact_upserts_do_not_drop_rows(self, store, ids):
        def writer(start: int) -> None:
            for i in range(25):
                artifact_id = f"a{start + i}"
                store.upsert_artifact(
                    ids["user_key"],
                    ids["space_id"],
                    ids["project_id"],
                    MemoryArtifact(
                        artifact_id=artifact_id,
                        run_id=ids["run_id"],
                        path=f"task_{ids['run_id']}/{artifact_id}.txt",
                        kind="other",
                        visible_to_user=True,
                        eligible_for_context=True,
                        hash=f"sha256:{artifact_id}",
                        created_at="t",
                    ),
                )

        threads = [
            threading.Thread(target=writer, args=(0,)),
            threading.Thread(target=writer, args=(1000,)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        loaded = store.read_artifacts(
            ids["user_key"], ids["space_id"], ids["project_id"]
        )
        assert len(loaded) == 50


# ----- Run-level -----


class TestRunLevel:
    def test_run_status_roundtrip(self, store, ids):
        status = RunStatus(
            run_id=ids["run_id"],
            state="running",
            started_at="2026-05-27T10:00:00Z",
            ended_at=None,
            last_error=None,
        )
        store.write_run_status(
            ids["user_key"],
            ids["space_id"],
            ids["project_id"],
            ids["run_id"],
            status,
        )
        assert (
            store.read_run_status(
                ids["user_key"],
                ids["space_id"],
                ids["project_id"],
                ids["run_id"],
            )
            == status
        )

    def test_write_run_creates_subtree(self, store, ids):
        run = RunMemory(
            run_id=ids["run_id"],
            project_id=ids["project_id"],
            space_id=ids["space_id"],
            mode="single_agent",
            user_prompt="hello",
            started_at="t",
        )
        store.write_run(ids["user_key"], run)
        loaded = store.read_run(
            ids["user_key"],
            ids["space_id"],
            ids["project_id"],
            ids["run_id"],
        )
        assert loaded == run

    def test_run_summary_write_then_read(self, store, ids):
        store.write_run_summary(
            ids["user_key"],
            ids["space_id"],
            ids["project_id"],
            ids["run_id"],
            "Final: succeeded.",
        )
        path = (
            store.run_path(
                ids["user_key"],
                ids["space_id"],
                ids["project_id"],
                ids["run_id"],
            )
            / "summary.md"
        )
        assert path.read_text(encoding="utf-8") == "Final: succeeded."


# ----- Project summary plain text -----


class TestProjectSummary:
    def test_write_then_read(self, store, ids):
        store.write_project_summary(
            ids["user_key"], ids["space_id"], ids["project_id"], "summary line"
        )
        assert (
            store.read_project_summary(
                ids["user_key"], ids["space_id"], ids["project_id"]
            )
            == "summary line"
        )

    def test_missing_returns_empty_string(self, store, ids):
        assert (
            store.read_project_summary(
                ids["user_key"], ids["space_id"], ids["project_id"]
            )
            == ""
        )
