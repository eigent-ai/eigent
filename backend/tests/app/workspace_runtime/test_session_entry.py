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

"""C6 Session ownership and read projections through authenticated real ASGI."""

import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

import pytest
import pytest_asyncio

from app.permission_policy import PermissionProfileName
from app.run_journal import SCHEMA_VERSION, SQLiteRunJournal
from app.workspace_runtime.admission import AdmissionConflict
from app.workspace_runtime.entry_guard import (
    ManagedExecutionRequired,
    owns_managed_execution,
)
from app.workspace_runtime.routing import (
    claim_legacy_session,
    claim_managed_in_transaction,
)
from tests.app.workspace_runtime import test_registration

registered_deployment = test_registration.deployment


@pytest_asyncio.fixture
async def deployment(registered_deployment):
    d = registered_deployment
    d.registration.local_single_session_enabled = True
    d.project("single")
    d.projects["single"]["space_source_type"] = "folder"
    return d


async def claim(d, project="single"):
    response = await d.client.post(
        f"/projects/{project}/execution-configurations?claim_session=true",
        json={},
    )
    assert response.status_code == 201, response.text
    return response.json()["envelope"]


async def submit(d, request, envelope, *, kind="start"):
    body = {
        "request_id": request,
        "kind": kind,
        "envelope": {**envelope, "prompt": request}
        if kind == "start"
        else envelope,
    }
    if kind == "follow_up":
        body.update(
            source_follow_up_request_id=request, follow_up_content=request
        )
    response = await d.client.post("/projects/single/executions", json=body)
    assert response.status_code == 202, response.text
    return response.json()


@pytest.mark.asyncio
async def test_projection_does_not_register_claim_resolve_secrets_or_make_workspace(
    deployment,
):
    d = deployment
    before = set(d.root.rglob("*"))
    changes = d.journal._connection.total_changes
    response = await d.client.get("/projects/single/execution-route")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "has_requests": False,
        "request_cursor": 0,
        "project_id": "single",
        "route": "legacy",
        "entry_enabled": True,
        "eligible": True,
        "reason": None,
        "profile": "single-agent-workspace-files-v1",
        "configuration": None,
        "selection": {
            "modelType": "custom",
            "provider_id": 1,
            "model_platform": "openai",
            "model_type": "gpt-5",
        },
    }
    assert changes == d.journal._connection.total_changes
    assert set(d.root.rglob("*")) == before
    assert not any(path.endswith("credentials:resolve") for path in d.calls)


@pytest.mark.asyncio
async def test_claim_and_cancel_first_pending_intent_never_restore_legacy(
    deployment,
):
    d = deployment
    envelope = await claim(d)
    assert owns_managed_execution(d.journal, project_id="single")
    with pytest.raises(ManagedExecutionRequired):
        claim_legacy_session(d.journal, "single")
    await submit(d, "first", envelope)
    assert (await d.client.delete("/executions/first")).status_code == 200
    assert d.journal.get_run("first") is None
    route = (await d.client.get("/projects/single/execution-route")).json()
    assert route["route"] == "managed"
    assert route["configuration"]["envelope"] == envelope
    with pytest.raises(ManagedExecutionRequired):
        claim_legacy_session(d.journal, "single")
    d.registration.local_single_session_enabled = False
    route = (await d.client.get("/projects/single/execution-route")).json()
    assert route["route"] == "managed" and not route["eligible"]
    response = await d.client.post(
        "/projects/single/executions",
        json={
            "request_id": "second",
            "kind": "follow_up",
            "envelope": envelope,
            "source_follow_up_request_id": "second",
            "follow_up_content": "second",
        },
    )
    assert response.status_code == 503
    assert d.service.admission.get("second") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy_fact", ["route", "run", "queue"])
async def test_first_registration_rejects_existing_legacy_session(
    deployment, legacy_fact
):
    d = deployment
    if legacy_fact == "route":
        claim_legacy_session(d.journal, "single")
    elif legacy_fact == "run":
        d.journal.ensure_run(
            run_id="old", project_id="single", status="completed"
        )
    else:
        d.journal.put_follow_up_request(
            request_id="old", project_id="single", content="queued"
        )
    result = await d.client.get("/projects/single/execution-route")
    assert result.json()["reason"] == "new_session_required"
    result = await d.client.post(
        "/projects/single/execution-configurations?claim_session=true", json={}
    )
    assert result.status_code == 409
    assert not d.registration.store.all()


@pytest.mark.asyncio
async def test_first_owner_race_is_one_database_commit_boundary(deployment):
    d = deployment
    # Trusted C4 registration alone does not claim the C6 UI route.
    envelope = await d.register("single")
    config = d.registration.registered[
        envelope["configuration_revision"]
    ].configuration
    barrier = Barrier(2)

    def legacy():
        barrier.wait()
        try:
            claim_legacy_session(d.journal, "single")
            return "legacy"
        except ManagedExecutionRequired:
            return "rejected"

    def managed():
        barrier.wait()
        try:
            with d.journal._write_transaction() as connection:
                claim_managed_in_transaction(connection, config)
            return "managed_single"
        except AdmissionConflict:
            return "rejected"

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.submit(legacy), pool.submit(managed)
        results = [first.result(), second.result()]
    assert results.count("rejected") == 1
    row = d.journal._connection.execute(
        "SELECT route FROM project_execution_routes WHERE project_id='single'"
    ).fetchone()
    assert row[0] in results


@pytest.mark.asyncio
async def test_request_projection_pages_pending_without_run_and_preserves_frozen_config(
    deployment,
):
    d = deployment
    first = await claim(d)
    await submit(d, "first", first)
    d.projects["single"]["thinking_effort"] = "high"
    second = await claim(d)
    assert first["configuration_revision"] != second["configuration_revision"]
    await submit(d, "second", second, kind="follow_up")
    page = (await d.client.get("/projects/single/executions?limit=1")).json()
    assert page["next_cursor"] == 1
    record = page["items"][0]
    assert record["content"] == "first" and record["admitted_run_id"] is None
    assert record["configuration_revision"] == first["configuration_revision"]
    last = (
        await d.client.get("/projects/single/executions?after=1&limit=1")
    ).json()
    assert (
        last["next_cursor"] is None and last["items"][0]["content"] == "second"
    )
    assert (
        last["items"][0]["configuration_revision"]
        == second["configuration_revision"]
    )
    assert (
        d.journal._connection.execute(
            "SELECT content FROM follow_up_requests WHERE request_id='second'"
        ).fetchone()[0]
        == "second"
    )
    encoded = json.dumps([page, last])
    assert (
        "synthetic-model-secret" not in encoded
        and str(d.root) not in encoded
        and "credential_ref" not in encoded
    )
    d.identity["account_owner_id"] = "2"
    assert (
        await d.client.get("/projects/single/executions")
    ).status_code == 403
    assert (
        await d.client.get("/projects/single/execution-route")
    ).status_code == 403


@pytest.mark.asyncio
async def test_default_off_and_unsupported_mode_do_not_claim(deployment):
    d = deployment
    d.registration.local_single_session_enabled = False
    assert (await d.client.get("/projects/single/execution-route")).json()[
        "eligible"
    ] is False
    assert (
        await d.client.post(
            "/projects/single/execution-configurations?claim_session=true",
            json={},
        )
    ).status_code == 503
    d.registration.local_single_session_enabled = True
    d.projects["single"]["session_mode"] = "workforce"
    route = (await d.client.get("/projects/single/execution-route")).json()
    assert route["reason"] == "single_agent_required"
    assert not owns_managed_execution(d.journal, project_id="single")


@pytest.mark.asyncio
@pytest.mark.parametrize("source", [None, "legacy"])
async def test_c6_rejects_unverified_or_legacy_space_kind(deployment, source):
    d = deployment
    d.projects["single"]["space_source_type"] = source
    route = (await d.client.get("/projects/single/execution-route")).json()
    assert not route["eligible"]
    assert (
        await d.client.post(
            "/projects/single/execution-configurations?claim_session=true",
            json={},
        )
    ).status_code == 503
    assert not owns_managed_execution(d.journal, project_id="single")


@pytest.mark.asyncio
async def test_c6_does_not_upgrade_permissions_or_accept_attachments(
    deployment,
):
    d = deployment
    d.permission("one", PermissionProfileName.READ_ONLY)
    route = (await d.client.get("/projects/single/execution-route")).json()
    assert not route["eligible"]
    assert not owns_managed_execution(d.journal, project_id="single")
    d.permission("one", PermissionProfileName.FULL_ACCESS)
    envelope = await claim(d)
    response = await d.client.post(
        "/projects/single/executions",
        json={
            "request_id": "attachments",
            "kind": "start",
            "envelope": {
                **envelope,
                "prompt": "kept",
                "attachment_paths": ["/synthetic/file"],
            },
        },
    )
    assert response.status_code in (409, 422)
    assert d.service.admission.get("attachments") is None


@pytest.mark.asyncio
async def test_cancelled_start_still_requires_follow_up_and_retry_is_idempotent(
    deployment,
):
    d = deployment
    envelope = await claim(d)
    first = await submit(d, "first", envelope)
    assert await submit(d, "first", envelope) == first
    await d.client.delete("/executions/first")
    response = await d.client.post(
        "/projects/single/executions",
        json={
            "request_id": "new-start",
            "kind": "start",
            "envelope": {**envelope, "prompt": "wrong"},
        },
    )
    assert response.status_code == 409
    await submit(d, "second", envelope, kind="follow_up")


def test_v39_upgrade_preserves_existing_rows_and_adds_only_local_routing(
    tmp_path,
):
    path = tmp_path / "v39.sqlite"
    with patch("app.run_journal.store.MIGRATION_V40", ""):
        with SQLiteRunJournal(path) as old:
            assert old.schema_version == 39
            old.ensure_run(
                run_id="old", project_id="legacy", status="completed"
            )
            old.put_follow_up_request(
                request_id="message", project_id="legacy", content="retained"
            )
            before = {
                table: [
                    tuple(row)
                    for row in old._connection.execute(
                        f"SELECT * FROM {table}"
                    )
                ]
                for table in (
                    "runs",
                    "follow_up_requests",
                    "managed_execution_configurations",
                )
            }
    with SQLiteRunJournal(path) as current:
        assert current.schema_version == SCHEMA_VERSION == 40
        assert before == {
            table: [
                tuple(row)
                for row in current._connection.execute(
                    f"SELECT * FROM {table}"
                )
            ]
            for table in before
        }
        assert (
            current._connection.execute("PRAGMA foreign_key_check").fetchall()
            == []
        )
        assert (
            current._connection.execute(
                "SELECT * FROM project_execution_routes"
            ).fetchall()
            == []
        )
    with SQLiteRunJournal(path) as reopened:
        assert (
            reopened.schema_version == 40
            and reopened.get_run("old").status == "completed"
        )
