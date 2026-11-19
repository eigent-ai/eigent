from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.workspace_bundle import (
    WorkspaceSecretBroker,
    WorkspaceSecretBrokerError,
    WorkspaceSecretIdentity,
    WorkspaceSecretResolution,
)
from app.workspace_bundle.secrets import _capture_broker_environment


def _serve_once(
    response: dict, *, status_code: int = 200
) -> tuple[str, list[dict], threading.Thread]:
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length))
            requests.append(
                {
                    "path": self.path,
                    "authorization": self.headers.get("Authorization"),
                    "content_type": self.headers.get("Content-Type"),
                    "body": body,
                }
            )
            encoded = json.dumps(response).encode()
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, format, *args):
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_port

    def serve() -> None:
        try:
            server.handle_request()
        finally:
            server.server_close()

    thread = threading.Thread(target=serve)
    thread.start()
    return f"http://127.0.0.1:{port}", requests, thread


def _identity() -> WorkspaceSecretIdentity:
    return WorkspaceSecretIdentity(
        secret_ref="wsvault_example-reference",
        account_scope_digest="a" * 64,
        space_id="space-1",
        revision_id="bundle-1@1",
        slot_id="environment:API_TOKEN",
    )


def test_secret_broker_binds_capability_and_full_identity():
    identity = _identity()
    endpoint, requests, thread = _serve_once(
        {
            "statuses": [
                {
                    **identity.__dict__,
                    "state": "available",
                }
            ]
        }
    )
    broker = WorkspaceSecretBroker(
        endpoint=endpoint,
        capability="x" * 43,
    )

    broker.verify(identity)
    thread.join(timeout=2)

    assert requests == [
        {
            "path": "/v1/workspace-secrets/verify-batch",
            "authorization": "Bearer " + "x" * 43,
            "content_type": "application/json",
            "body": {
                "bindings": [
                    {
                        "secret_ref": "wsvault_example-reference",
                        "account_scope_digest": "a" * 64,
                        "space_id": "space-1",
                        "revision_id": "bundle-1@1",
                        "slot_id": "environment:API_TOKEN",
                    }
                ]
            },
        }
    ]


def test_secret_broker_fails_closed_without_returning_error_payload():
    sentinel = "must-not-appear-in-error"
    endpoint, _, thread = _serve_once(
        {"error_code": "scope_mismatch", "value": sentinel},
        status_code=403,
    )
    broker = WorkspaceSecretBroker(
        endpoint=endpoint,
        capability="x" * 43,
    )

    with pytest.raises(WorkspaceSecretBrokerError) as caught:
        broker.verify(_identity())
    thread.join(timeout=2)

    assert sentinel not in str(caught.value)
    assert not hasattr(broker, "resolve")


def test_secret_broker_resolves_exact_identity_without_repr_leak():
    identity = _identity()
    sentinel = "runtime-only-secret"
    endpoint, requests, thread = _serve_once(
        {
            "resolutions": [
                {
                    **identity.__dict__,
                    "value": sentinel,
                }
            ]
        }
    )
    broker = WorkspaceSecretBroker(endpoint=endpoint, capability="x" * 43)

    resolutions = broker.resolve_many((identity,))
    thread.join(timeout=2)

    assert resolutions == (
        WorkspaceSecretResolution(identity=identity, value=sentinel),
    )
    assert resolutions[0].value == sentinel
    assert sentinel not in repr(resolutions)
    assert requests == [
        {
            "path": "/v1/workspace-secrets/resolve-batch",
            "authorization": "Bearer " + "x" * 43,
            "content_type": "application/json",
            "body": {"bindings": [identity.__dict__]},
        }
    ]


def test_secret_broker_rejects_mismatched_resolution_without_value_leak():
    identity = _identity()
    sentinel = "must-not-appear-in-resolution-error"
    endpoint, _, thread = _serve_once(
        {
            "resolutions": [
                {
                    **identity.__dict__,
                    "revision_id": "bundle-1@2",
                    "value": sentinel,
                }
            ]
        }
    )
    broker = WorkspaceSecretBroker(endpoint=endpoint, capability="x" * 43)

    with pytest.raises(WorkspaceSecretBrokerError) as caught:
        broker.resolve_many((identity,))
    thread.join(timeout=2)

    assert "invalid resolution" in str(caught.value)
    assert sentinel not in str(caught.value)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://0.0.0.0:1234",
        "https://127.0.0.1:1234",
        "http://localhost:1234",
        "http://127.0.0.1:not-a-port",
        "http://127.0.0.1:1234/path",
        "http://[invalid",
    ],
)
def test_secret_broker_rejects_non_loopback_or_invalid_endpoints(endpoint):
    with pytest.raises(WorkspaceSecretBrokerError):
        WorkspaceSecretBroker(
            endpoint=endpoint,
            capability="x" * 43,
        )


def test_secret_broker_rejects_mismatched_verification_identity():
    endpoint, _, thread = _serve_once(
        {
            "statuses": [
                {
                    **_identity().__dict__,
                    "space_id": "different-space",
                    "state": "available",
                }
            ]
        }
    )
    broker = WorkspaceSecretBroker(endpoint=endpoint, capability="x" * 43)

    with pytest.raises(WorkspaceSecretBrokerError) as caught:
        broker.verify(_identity())
    thread.join(timeout=2)

    assert "invalid verification" in str(caught.value)


def test_secret_broker_batch_preserves_partial_states_without_values():
    identities = tuple(
        WorkspaceSecretIdentity(
            **{
                **_identity().__dict__,
                "secret_ref": f"wsvault_{index:032d}",
                "slot_id": f"environment:SLOT_{index}",
            }
        )
        for index in range(3)
    )
    endpoint, requests, thread = _serve_once(
        {
            "statuses": [
                {**identities[0].__dict__, "state": "available"},
                {**identities[1].__dict__, "state": "missing"},
                {**identities[2].__dict__, "state": "needs_rebind"},
            ]
        }
    )
    broker = WorkspaceSecretBroker(endpoint=endpoint, capability="x" * 43)

    verifications = broker.verify_many(identities)
    thread.join(timeout=2)

    assert [item.state for item in verifications] == [
        "available",
        "missing",
        "needs_rebind",
    ]
    assert len(requests) == 1
    assert requests[0]["path"] == "/v1/workspace-secrets/verify-batch"
    assert "value" not in repr(verifications)


def test_secret_broker_rejects_value_bearing_batch_response():
    sentinel = "must-never-cross-broker"
    identity = _identity()
    endpoint, _, thread = _serve_once(
        {
            "statuses": [
                {
                    **identity.__dict__,
                    "state": "available",
                    "value": sentinel,
                }
            ]
        }
    )
    broker = WorkspaceSecretBroker(endpoint=endpoint, capability="x" * 43)

    with pytest.raises(WorkspaceSecretBrokerError) as caught:
        broker.verify_many((identity,))
    thread.join(timeout=2)

    assert sentinel not in str(caught.value)


def test_secret_broker_rejects_more_than_100_without_network_io():
    broker = WorkspaceSecretBroker(
        endpoint="http://127.0.0.1:1",
        capability="x" * 43,
    )

    with pytest.raises(WorkspaceSecretBrokerError, match="batch is too large"):
        broker.verify_many(tuple(_identity() for _ in range(101)))


def test_secret_broker_authority_is_removed_from_child_environment():
    environment = {
        "PATH": "/usr/bin",
        "EIGENT_WORKSPACE_SECRET_BROKER_ENDPOINT": "http://127.0.0.1:1234",
        "EIGENT_WORKSPACE_SECRET_BROKER_CAPABILITY": "x" * 43,
        "EIGENT_OBSOLETE_SECRET_BROKER_ENDPOINT": "obsolete-endpoint",
        "EIGENT_OBSOLETE_SECRET_BROKER_CAPABILITY": "obsolete-capability",
    }

    captured = _capture_broker_environment(environment)

    assert captured == ("http://127.0.0.1:1234", "x" * 43)
    assert environment == {"PATH": "/usr/bin"}
