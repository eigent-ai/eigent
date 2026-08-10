"""Capability-authenticated client for the Electron local secret broker."""

from __future__ import annotations

import json
import os
import re
from collections.abc import MutableMapping, Sequence
from dataclasses import dataclass
from http.client import HTTPConnection, HTTPException
from typing import Literal
from urllib.parse import urlsplit


def _capture_broker_environment(
    environment: MutableMapping[str, str],
) -> tuple[str, str]:
    """Take broker authority out of the environment inherited by agents."""

    endpoint = environment.pop("EIGENT_WORKSPACE_SECRET_BROKER_ENDPOINT", "")
    capability = environment.pop(
        "EIGENT_WORKSPACE_SECRET_BROKER_CAPABILITY", ""
    )
    legacy_endpoint = environment.pop(
        "EIGENT_WORKFORCE_SECRET_BROKER_ENDPOINT", ""
    )
    legacy_capability = environment.pop(
        "EIGENT_WORKFORCE_SECRET_BROKER_CAPABILITY", ""
    )
    if endpoint or capability:
        return endpoint, capability
    return legacy_endpoint, legacy_capability


_BROKER_ENDPOINT, _BROKER_CAPABILITY = _capture_broker_environment(os.environ)


class WorkspaceSecretBrokerError(RuntimeError):
    """Raised when a local-only Bundle binding cannot be verified."""


@dataclass(frozen=True)
class WorkspaceSecretIdentity:
    secret_ref: str
    account_scope_digest: str
    space_id: str
    revision_id: str
    slot_id: str


@dataclass(frozen=True)
class WorkspaceSecretVerification:
    identity: WorkspaceSecretIdentity
    state: Literal["available", "missing", "needs_rebind"]


class WorkspaceSecretBroker:
    """Verify opaque bindings through Electron without receiving secret values."""

    MAX_BATCH_BINDINGS = 100
    MAX_REQUEST_BYTES = 16 * 1024
    MAX_RESPONSE_BYTES = 64 * 1024

    def __init__(
        self,
        *,
        endpoint: str,
        capability: str,
        timeout_seconds: float = 3.0,
    ) -> None:
        try:
            parsed = urlsplit(endpoint)
        except ValueError as exc:
            raise WorkspaceSecretBrokerError(
                "Workspace secret broker endpoint is invalid"
            ) from exc
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise WorkspaceSecretBrokerError(
                "Workspace secret broker must use a loopback endpoint"
            )
        try:
            port = parsed.port
        except ValueError as exc:
            raise WorkspaceSecretBrokerError(
                "Workspace secret broker endpoint is invalid"
            ) from exc
        if (
            port is None
            or not 1 <= port <= 65535
            or re.fullmatch(r"[A-Za-z0-9_-]{32,256}", capability) is None
            or not 0 < timeout_seconds <= 30
        ):
            raise WorkspaceSecretBrokerError(
                "Workspace secret broker configuration is invalid"
            )
        self._port = port
        self._capability = capability
        self._timeout_seconds = timeout_seconds

    @classmethod
    def from_environment(cls) -> WorkspaceSecretBroker:
        if not _BROKER_ENDPOINT or not _BROKER_CAPABILITY:
            raise WorkspaceSecretBrokerError(
                "Workspace secret broker is unavailable"
            )
        return cls(
            endpoint=_BROKER_ENDPOINT,
            capability=_BROKER_CAPABILITY,
        )

    def verify(self, identity: WorkspaceSecretIdentity) -> None:
        verification = self.verify_many((identity,))[0]
        if verification.state != "available":
            raise WorkspaceSecretBrokerError("Workspace secret is unavailable")

    def verify_many(
        self,
        identities: Sequence[WorkspaceSecretIdentity],
    ) -> tuple[WorkspaceSecretVerification, ...]:
        requested = tuple(identities)
        if not requested:
            return ()
        if len(requested) > self.MAX_BATCH_BINDINGS:
            raise WorkspaceSecretBrokerError(
                "Workspace secret verification batch is too large"
            )
        response = self._request(
            "/v1/workspace-secrets/verify-batch",
            {
                "bindings": [
                    self._identity_payload(identity) for identity in requested
                ]
            },
        )
        if set(response) != {"statuses"}:
            raise WorkspaceSecretBrokerError(
                "Workspace secret broker returned an invalid verification"
            )
        statuses = response.get("statuses")
        if not isinstance(statuses, list) or len(statuses) != len(requested):
            raise WorkspaceSecretBrokerError(
                "Workspace secret broker returned an invalid verification"
            )
        allowed_status_keys = {
            "secret_ref",
            "account_scope_digest",
            "space_id",
            "revision_id",
            "slot_id",
            "state",
            "created_at",
            "updated_at",
        }
        result: list[WorkspaceSecretVerification] = []
        for identity, status in zip(requested, statuses, strict=True):
            expected = self._identity_payload(identity)
            if (
                not isinstance(status, dict)
                or not set(status).issubset(allowed_status_keys)
                or any(
                    status.get(key) != value for key, value in expected.items()
                )
                or status.get("state")
                not in {"available", "missing", "needs_rebind"}
            ):
                raise WorkspaceSecretBrokerError(
                    "Workspace secret broker returned an invalid verification"
                )
            result.append(
                WorkspaceSecretVerification(
                    identity=identity,
                    state=status["state"],
                )
            )
        return tuple(result)

    @staticmethod
    def _identity_payload(identity: WorkspaceSecretIdentity) -> dict[str, str]:
        return {
            "secret_ref": identity.secret_ref,
            "account_scope_digest": identity.account_scope_digest,
            "space_id": identity.space_id,
            "revision_id": identity.revision_id,
            "slot_id": identity.slot_id,
        }

    def _request(self, path: str, request: dict) -> dict:
        encoded = json.dumps(
            request, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        if len(encoded) > self.MAX_REQUEST_BYTES:
            raise WorkspaceSecretBrokerError(
                "Workspace secret broker request is too large"
            )
        connection = HTTPConnection(
            "127.0.0.1",
            self._port,
            timeout=self._timeout_seconds,
        )
        try:
            connection.request(
                "POST",
                path,
                body=encoded,
                headers={
                    "Authorization": f"Bearer {self._capability}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
            )
            http_response = connection.getresponse()
            content_length = http_response.getheader("Content-Length")
            if content_length is not None:
                try:
                    declared_length = int(content_length)
                except ValueError as exc:
                    raise WorkspaceSecretBrokerError(
                        "Workspace secret broker returned invalid metadata"
                    ) from exc
                if declared_length > self.MAX_RESPONSE_BYTES:
                    raise WorkspaceSecretBrokerError(
                        "Workspace secret broker response is too large"
                    )
            raw = http_response.read(self.MAX_RESPONSE_BYTES + 1)
            if len(raw) > self.MAX_RESPONSE_BYTES:
                raise WorkspaceSecretBrokerError(
                    "Workspace secret broker response is too large"
                )
            if http_response.status != 200:
                raise WorkspaceSecretBrokerError(
                    "Workspace secret is unavailable "
                    f"(broker_status_{http_response.status})"
                )
        except (OSError, TimeoutError, HTTPException) as exc:
            raise WorkspaceSecretBrokerError(
                "Workspace secret broker is unavailable"
            ) from exc
        finally:
            connection.close()
        try:
            response = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise WorkspaceSecretBrokerError(
                "Workspace secret broker returned an invalid response"
            ) from exc
        if not isinstance(response, dict):
            raise WorkspaceSecretBrokerError(
                "Workspace secret broker returned an invalid response"
            )
        return response
