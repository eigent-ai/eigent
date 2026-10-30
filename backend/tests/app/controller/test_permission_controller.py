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

from unittest.mock import patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth import require_local_control_principal
from app.controller.permission_controller import (
    PermissionProfileBody,
    get_permission_profile,
    put_permission_profile,
)
from app.permission_policy import PermissionProfileName
from app.router import register_routers
from app.run_journal import SQLiteRunJournal


def test_permission_profile_registered_route_returns_http_default(
    tmp_path, monkeypatch
):
    """Exercise the production default-prefix route, not a mocked fetch URL."""

    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        monkeypatch.setattr(
            "app.controller.permission_controller.get_default_run_journal",
            lambda: journal,
        )
        app = FastAPI()
        register_routers(app)
        app.dependency_overrides[require_local_control_principal] = (
            lambda: None
        )

        registered = {
            (method, route.path)
            for route in app.routes
            for method in getattr(route, "methods", set())
        }
        critical_local_routes = {
            ("GET", "/spaces/{space_id}/permission-profile"),
            ("PUT", "/spaces/{space_id}/permission-profile"),
            ("GET", "/spaces/{space_id}/git/status"),
            ("POST", "/spaces/{space_id}/git/operations:preview"),
            (
                "POST",
                "/runs/{run_id}/interactions/{interaction_id}/decisions",
            ),
            ("GET", "/spaces/{space_id}/workspace-configuration"),
            ("POST", "/workspace-bundles/agent-plugins:inspect"),
            ("POST", "/workspace-bundles/install-proposals"),
        }
        assert critical_local_routes <= registered
        assert not any(
            path == "/api/v1/spaces/{space_id}/permission-profile"
            for _, path in registered
        )

        with TestClient(app) as client:
            response = client.get("/spaces/space-1/permission-profile")

        assert response.status_code == 200
        assert response.json()["profile_name"] == "request_approval"
        assert response.json()["revision"] == 0


@pytest.mark.asyncio
async def test_permission_profile_defaults_and_optimistic_update(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        with patch(
            "app.controller.permission_controller.get_default_run_journal",
            return_value=journal,
        ):
            default = await get_permission_profile("space-1")
            updated = await put_permission_profile(
                "space-1",
                PermissionProfileBody(
                    profile_name=PermissionProfileName.AUTO_REVIEWER,
                    request_id="request-1",
                    updated_by="user-1",
                    expected_revision=0,
                ),
            )
            replay = await put_permission_profile(
                "space-1",
                PermissionProfileBody(
                    profile_name=PermissionProfileName.AUTO_REVIEWER,
                    request_id="request-1",
                    updated_by="user-1",
                    expected_revision=0,
                ),
            )

        assert default["profile_name"] == "request_approval"
        assert default["revision"] == 0
        assert updated["profile_name"] == "auto_reviewer"
        assert updated["revision"] == 1
        assert replay == updated
        revision = journal.get_space_permission_profile_revision(
            "space:space-1:1"
        )
        assert revision is not None
        assert revision.profile_name == "auto_reviewer"
        with journal._lock:
            audits = journal._connection.execute(
                "SELECT * FROM security_audit_events"
            ).fetchall()
        assert len(audits) == 1
        assert audits[0]["event_type"] == "permission.profile.modified"


@pytest.mark.asyncio
async def test_permission_profile_rejects_stale_revision(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.put_space_permission_profile(
            space_id="space-1",
            profile_name="request_approval",
            sandbox_mode="workspace-write",
            approval_mode="on-request",
            reviewer_mode="user",
            updated_by="user-1",
            now=1,
        )
        with patch(
            "app.controller.permission_controller.get_default_run_journal",
            return_value=journal,
        ):
            with pytest.raises(HTTPException) as error:
                await put_permission_profile(
                    "space-1",
                    PermissionProfileBody(
                        profile_name=PermissionProfileName.FULL_ACCESS,
                        request_id="request-2",
                        updated_by="user-1",
                        expected_revision=0,
                    ),
                )
        assert error.value.status_code == 409
