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

"""Exercise only the admission router; no app startup or model runtime."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth import LocalControlPrincipal, require_local_control_principal
from app.controller import execution_controller as controller
from app.workspace_runtime.admission import AdmissionConflict
from app.workspace_runtime.service import (
    ExecutionForbidden,
    ExecutionUnavailable,
)
from app.workspace_runtime.store import WorkspaceStateError


@pytest.fixture
def api(monkeypatch):
    record = SimpleNamespace(
        request_id="request-1",
        project_id="project-1",
        kind="start",
        source="local",
        delivery_mode="wait",
        status="pending",
        wait_reason=None,
        admitted_run_id=None,
        admitted_attempt_id=None,
        created_at=1,
        updated_at=1,
        envelope={"credential_ref": "private-credential-reference"},
    )
    service = SimpleNamespace(
        capabilities=Mock(
            return_value={
                "execution_admission": True,
                "supports_legacy_chat": False,
                "controlled_worker": True,
            }
        ),
        submit=AsyncMock(return_value=record),
        get=AsyncMock(return_value=record),
        cancel=AsyncMock(return_value=record),
        set_delivery=AsyncMock(return_value=record),
        artifacts=AsyncMock(
            return_value={
                "run_id": "run-1",
                "checkpoint_revision": "revision-1",
                "root_path": "/private/synthetic",
                "environment": {"synthetic_secret": "never-return"},
                "artifacts": [
                    {
                        "artifact_id": "artifact-1",
                        "filename": "report.bin",
                        "relativePath": "reports/report.bin",
                        "size": 3,
                        "absolute_path": "/private/synthetic/reports/report.bin",
                    }
                ],
            }
        ),
        read_artifact=AsyncMock(return_value=b"\x00\x01\xff"),
    )
    monkeypatch.setattr(
        controller, "get_default_execution_service", lambda: service
    )
    app = FastAPI()
    app.include_router(controller.router)
    app.dependency_overrides[require_local_control_principal] = lambda: (
        LocalControlPrincipal(kind="desktop_renderer", user_id="local")
    )
    with TestClient(app) as client:
        yield client, service, app


def _submission(**changes):
    return {
        "request_id": "request-1",
        "kind": "start",
        "envelope": {"prompt": "synthetic"},
        **changes,
    }


def test_opt_in_capability_never_claims_legacy_chat_migration(api):
    client, _, _ = api
    assert client.get("/executions/capabilities").json() == {
        "execution_admission": True,
        "supports_legacy_chat": False,
        "controlled_worker": True,
    }


def test_disabled_service_reports_capability_and_refuses_submission(
    api, monkeypatch
):
    client, service, _ = api
    monkeypatch.setattr(
        controller, "get_default_execution_service", lambda: None
    )
    assert (
        client.get("/executions/capabilities").json()["execution_admission"]
        is False
    )
    response = client.post(
        "/projects/project-1/executions", json=_submission()
    )
    assert response.status_code == 503
    service.submit.assert_not_awaited()


def test_submission_derives_origin_from_authenticated_principal(api):
    client, service, _ = api
    response = client.post(
        "/projects/project-1/executions", json=_submission()
    )
    assert response.status_code == 202
    args = service.submit.await_args.kwargs
    assert args["origin"].principal_ref == "desktop_renderer:local"
    assert args["origin"].source == "local"
    assert args["origin"].source_command_id is None
    assert args["origin"].hands_capability_ref is None
    assert args["envelope"] == {
        "prompt": "synthetic",
        "project_id": "project-1",
    }
    assert "envelope" not in response.json()
    assert "private-credential-reference" not in response.text


@pytest.mark.parametrize(
    "extra",
    [
        "origin",
        "source",
        "source_command_id",
        "principal_ref",
        "hands_capability_ref",
        "api_key",
    ],
)
def test_request_body_cannot_supply_control_authority(api, extra):
    client, service, _ = api
    response = client.post(
        "/projects/project-1/executions",
        json=_submission(**{extra: "untrusted"}),
    )
    assert response.status_code == 422
    service.submit.assert_not_awaited()


@pytest.mark.parametrize(
    "field,value",
    [
        ("api_key", "sensitive-synthetic-value"),
        ("credential_ref", "/private/credential"),
        ("attachment_ids", ["/private/input"]),
    ],
)
def test_envelope_rejects_secret_fields_and_path_references(api, field, value):
    client, service, _ = api
    response = client.post(
        "/projects/project-1/executions",
        json=_submission(envelope={"prompt": "synthetic", field: value}),
    )
    assert response.status_code == 422
    assert "sensitive-synthetic-value" not in response.text
    service.submit.assert_not_awaited()


def test_follow_up_and_resume_preserve_distinct_request_contracts(api):
    client, service, _ = api
    response = client.post(
        "/projects/project-1/executions",
        json=_submission(
            kind="follow_up",
            envelope={},
            source_follow_up_request_id="request-1",
            follow_up_content="follow-up",
        ),
    )
    assert response.status_code == 202
    assert service.submit.await_args.kwargs["follow_up_content"] == "follow-up"
    assert (
        service.submit.await_args.kwargs["source_follow_up_request_id"]
        == "request-1"
    )
    response = client.post(
        "/projects/project-1/executions",
        json=_submission(
            kind="resume", envelope={}, target_run_id="existing-run"
        ),
    )
    assert response.status_code == 202
    assert service.submit.await_args.kwargs["target_run_id"] == "existing-run"
    assert service.submit.await_args.kwargs["kind"] == "resume"


def test_read_cancel_and_delivery_reuse_verified_origin(api):
    client, service, _ = api
    assert client.get("/executions/request-1").status_code == 200
    assert client.delete("/executions/request-1").status_code == 200
    assert (
        client.post(
            "/executions/request-1/delivery",
            json={
                "delivery_mode": "send_now",
                "operation_id": "user-action-1",
            },
        ).status_code
        == 200
    )
    for method in (service.get, service.cancel, service.set_delivery):
        assert method.await_args.args == ("request-1",)
        assert (
            method.await_args.kwargs["origin"].principal_ref
            == "desktop_renderer:local"
        )
    assert (
        service.set_delivery.await_args.kwargs["delivery_mode"] == "send_now"
    )
    assert (
        service.set_delivery.await_args.kwargs["operation_id"]
        == "user-action-1"
    )
    service.get.return_value = None
    assert client.get("/executions/missing").status_code == 404


@pytest.mark.parametrize(
    "error,status",
    [
        (ExecutionUnavailable, 503),
        (ExecutionForbidden, 403),
        (AdmissionConflict, 409),
        (ValueError, 422),
    ],
)
def test_service_failures_use_safe_typed_http_errors(api, error, status):
    client, service, _ = api
    service.submit.side_effect = error("sensitive internal context")
    response = client.post(
        "/projects/project-1/executions", json=_submission()
    )
    assert response.status_code == status
    assert "sensitive internal context" not in response.text


def test_artifact_metadata_never_returns_private_runtime_fields(api):
    client, service, _ = api
    response = client.get("/executions/request-1/artifacts")
    assert response.status_code == 200
    assert response.json() == {
        "run_id": "run-1",
        "checkpoint_revision": "revision-1",
        "artifact_count": 1,
        "artifacts": [
            {
                "artifact_id": "artifact-1",
                "filename": "report.bin",
                "relativePath": "reports/report.bin",
                "size": 3,
            }
        ],
    }
    assert (
        service.artifacts.await_args.kwargs["origin"].principal_ref
        == "desktop_renderer:local"
    )
    assert "/private" not in response.text
    assert "never-return" not in response.text


def test_artifact_content_is_fixed_attachment_with_bounded_range(api):
    client, service, _ = api
    path = "/executions/request-1/artifacts/artifact-1/content"
    response = client.get(path)
    assert response.content == b"\x00\x01\xff"
    assert response.headers["content-type"] == "application/octet-stream"
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="artifact.bin"'
    )
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"
    call = service.read_artifact.await_args
    assert call.args == ("request-1", "artifact-1")
    assert call.kwargs["offset"] == 0
    assert call.kwargs["length"] == 1024 * 1024
    response = client.get(
        path, params={"offset": 2, "length": 8 * 1024 * 1024}
    )
    assert response.status_code == 200
    assert service.read_artifact.await_args.kwargs["offset"] == 2
    assert service.read_artifact.await_args.kwargs["length"] == 8 * 1024 * 1024


@pytest.mark.parametrize(
    "params", [{"offset": -1}, {"length": 0}, {"length": 8 * 1024 * 1024 + 1}]
)
def test_artifact_invalid_range_is_rejected_before_service(api, params):
    client, service, _ = api
    response = client.get(
        "/executions/request-1/artifacts/artifact-1/content", params=params
    )
    assert response.status_code == 422
    service.read_artifact.assert_not_awaited()


@pytest.mark.parametrize(
    "endpoint,method",
    [
        ("/artifacts", "artifacts"),
        ("/artifacts/artifact-1/content", "read_artifact"),
    ],
)
def test_artifact_missing_or_unsettled_is_typed(api, endpoint, method):
    client, service, _ = api
    handler = getattr(service, method)
    handler.return_value = None
    assert client.get("/executions/request-1" + endpoint).status_code == 404
    handler.side_effect = FileNotFoundError("private-path")
    response = client.get("/executions/request-1" + endpoint)
    assert response.status_code == 404
    assert "private-path" not in response.text
    handler.side_effect = WorkspaceStateError("private-path")
    response = client.get("/executions/request-1" + endpoint)
    assert response.status_code == 409
    assert "private-path" not in response.text


@pytest.mark.parametrize(
    "method,path,payload",
    [
        ("GET", "/executions/capabilities", None),
        ("POST", "/projects/project-1/executions", _submission()),
        ("GET", "/executions/request-1", None),
        ("GET", "/executions/request-1/artifacts", None),
        ("GET", "/executions/request-1/artifacts/artifact-1/content", None),
        ("DELETE", "/executions/request-1", None),
        (
            "POST",
            "/executions/request-1/delivery",
            {"delivery_mode": "send_now"},
        ),
    ],
)
def test_all_routes_require_control_authentication(api, method, path, payload):
    client, service, app = api

    def reject():
        raise HTTPException(status_code=401, detail="authentication required")

    app.dependency_overrides[require_local_control_principal] = reject
    assert client.request(method, path, json=payload).status_code == 401
    service.submit.assert_not_awaited()
    service.get.assert_not_awaited()
    service.cancel.assert_not_awaited()
    service.set_delivery.assert_not_awaited()
    service.capabilities.assert_not_called()
    service.artifacts.assert_not_awaited()
    service.read_artifact.assert_not_awaited()
