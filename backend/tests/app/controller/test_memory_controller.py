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
from app.run_journal import SQLiteRunJournal


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
