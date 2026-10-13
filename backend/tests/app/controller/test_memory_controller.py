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
# Licensed under the Apache License, Version 2.0 (the "License");

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import require_local_control_principal
from app.lightweight_memory import LightweightMemoryService
from app.router import register_routers
from app.run_journal import RunEventDraft, SQLiteRunJournal


def test_memory_routes_are_local_authenticated_and_support_user_crud(
    tmp_path, monkeypatch
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        service = LightweightMemoryService(journal)
        monkeypatch.setattr(
            "app.controller.memory_controller.get_lightweight_memory_service",
            lambda: service,
        )
        app = FastAPI()
        register_routers(app)
        app.dependency_overrides[require_local_control_principal] = (
            lambda: None
        )
        routes = {
            (method, route.path)
            for route in app.routes
            for method in getattr(route, "methods", set())
        }
        assert ("GET", "/memory/entries") in routes
        assert ("POST", "/memory/entries") in routes
        assert ("POST", "/memory/scopes/summaries") in routes
        assert not any(path.startswith("/api/v1/memory") for _, path in routes)

        with TestClient(app) as client:
            created = client.post(
                "/memory/entries",
                params={"scope_type": "project", "scope_id": "project-1"},
                json={
                    "request_id": "request-1",
                    "content": "Use ISO dates.",
                    "kind": "preference",
                    "reason": "user preference",
                },
            )
            listed = client.get(
                "/memory/entries",
                params={"scope_type": "project", "scope_id": "project-1"},
            )
            summaries = client.post(
                "/memory/scopes/summaries",
                json={
                    "scopes": [
                        {
                            "scope_type": "project",
                            "scope_id": "project-1",
                        },
                        {
                            "scope_type": "space",
                            "scope_id": "space-1",
                        },
                        {
                            "scope_type": "project",
                            "scope_id": "project-1",
                        },
                    ]
                },
            )

        assert created.status_code == 200
        assert created.json()["entry"]["source_trust"] == "user_confirmed"
        assert listed.status_code == 200
        assert [item["content"] for item in listed.json()["items"]] == [
            "Use ISO dates."
        ]
        assert summaries.status_code == 200
        assert [
            (item["scope_type"], item["scope_id"], item["entry_count"])
            for item in summaries.json()["items"]
        ] == [
            ("project", "project-1", 1),
            ("space", "space-1", 0),
        ]


def test_pending_rule_lists_the_users_words_until_adopted(
    tmp_path, monkeypatch
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.bind_memory_project_scopes(
            project_id="project-1", space_id="space-1", user_id="user-1"
        )
        journal.ensure_run(run_id="run-1", project_id="project-1")
        long_message = "From now on, create a branch for every task. " * 6
        for event_id, content in (
            ("user-1", long_message),
            ("user-2", "Also open a draft pull request early."),
        ):
            journal.append_event(
                "run-1",
                RunEventDraft(
                    event_id=event_id,
                    event_type="user.message",
                    payload={"content": content, "source": "chat"},
                ),
            )
        service = LightweightMemoryService(journal)
        rule = service.propose_rule(
            project_id="project-1",
            scope_type="space",
            kind="constraint",
            content="Create a branch for every task.",
            reason="The user set this for future work.",
            source_refs=("user-1", "user-2"),
            run_id="run-1",
        ).entry
        service.create_entry(
            scope_type="space",
            scope_id="space-1",
            kind="fact",
            content="Releases ship on Fridays.",
            actor_type="user",
            reason="Added on the Memory page",
            source_trust="user_confirmed",
        )
        monkeypatch.setattr(
            "app.controller.memory_controller.get_lightweight_memory_service",
            lambda: service,
        )
        app = FastAPI()
        register_routers(app)
        app.dependency_overrides[require_local_control_principal] = (
            lambda: None
        )

        with TestClient(app) as client:

            def listed():
                response = client.get(
                    "/memory/entries",
                    params={"scope_type": "space", "scope_id": "space-1"},
                )
                assert response.status_code == 200
                return {
                    item["content"]: item["source_excerpts"]
                    for item in response.json()["items"]
                }

            before = listed()
            confirmed = client.post(
                f"/memory/entries/{rule.memory_id}/confirm",
                json={
                    "request_id": "confirm-1",
                    "expected_version": rule.version,
                    "reason": "Adopted on the Memory page",
                },
            )
            after = listed()

        excerpts = before["Create a branch for every task."]
        assert len(excerpts[0]) == 200
        assert excerpts[0].endswith("…")
        assert long_message.startswith(excerpts[0][:-1])
        assert excerpts[1] == "Also open a draft pull request early."
        assert before["Releases ship on Fridays."] == []
        assert confirmed.status_code == 200
        assert confirmed.json()["entry"]["confirmed_by_user"] is True
        assert confirmed.json()["entry"]["source_trust"] == "user_asserted"
        assert after["Create a branch for every task."] == []
