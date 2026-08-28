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

"""Durable per-Run FIFO replication from SQLite to the Cloud API."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import mimetypes
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

import httpx

from app.run_journal import (
    ArtifactUploadSyncItem,
    CloudRunEventReplica,
    CloudRunReplica,
    MemoryMutationSyncBatch,
    OutboxLeaseLostError,
    RunEventSyncBatch,
    SQLiteRunJournal,
)
from app.run_journal.cloud_projection import (
    cloud_event_payload,
    cloud_resource_label,
)

logger = logging.getLogger("run_sync")


class _AsyncMultipartFileStream(httpx.AsyncByteStream):
    """Read a multipart file in bounded worker-thread chunks."""

    def __init__(self, prefix: bytes, path: Path, suffix: bytes) -> None:
        self._prefix = prefix
        self._path = path
        self._suffix = suffix

    async def __aiter__(self):
        yield self._prefix
        file_handle = await asyncio.to_thread(self._path.open, "rb")
        try:
            while True:
                chunk = await asyncio.to_thread(file_handle.read, 1024 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            await asyncio.to_thread(file_handle.close)
        yield self._suffix


def _cloud_resource_label(value: Any) -> str:
    return cloud_resource_label(value)


def _cloud_event_payload(
    event_type: str, payload: dict[str, Any]
) -> dict[str, Any]:
    """Project a local canonical event into its Cloud-safe representation."""

    return cloud_event_payload(event_type, payload)


@dataclass(frozen=True)
class CloudSyncConfiguration:
    endpoint_url: str
    authorization: str = field(repr=False)
    desktop_instance_id: str


class RunEventSyncHttpError(RuntimeError):
    def __init__(self, status_code: int, detail: Any) -> None:
        self.status_code = status_code
        self.detail = detail
        self.application_code = _sync_error_code(detail)
        if 200 <= status_code < 300 and self.application_code is not None:
            message = _sync_error_message(detail)
            super().__init__(
                "Run sync endpoint returned application error "
                f"{self.application_code} over HTTP {status_code}"
                + (f": {message}" if message else "")
            )
        else:
            super().__init__(
                f"Run sync request returned HTTP {status_code}: {detail}"
            )


class RunEventSyncProtocolError(RuntimeError):
    pass


class RunSyncInfrastructureError(RuntimeError):
    """A device/route control-plane failure, never a poison Run event."""

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


_AUTHENTICATION_ERROR_CODES = frozenset({"11", "12", "13", "14"})


def _sync_error_code(detail: Any) -> str | None:
    """Return an Eigent application error code from either error envelope."""

    body = detail.get("detail", detail) if isinstance(detail, dict) else None
    if not isinstance(body, dict):
        return None
    code = body.get("code")
    if isinstance(code, bool) or code is None:
        return None
    if isinstance(code, (int, str)):
        normalized = str(code).strip()
        return normalized or None
    return None


def _sync_error_message(detail: Any) -> str:
    body = detail.get("detail", detail) if isinstance(detail, dict) else detail
    if isinstance(body, str):
        return body[:500]
    if not isinstance(body, dict):
        return ""
    for key in ("text", "message", "description"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:500]
    return ""


def _raise_for_application_error(
    payload: dict[str, Any], *, status_code: int
) -> None:
    """Reject the legacy HTTP-200 error envelope used by Eigent APIs."""

    code = _sync_error_code(payload)
    if code is not None and code != "0":
        raise RunEventSyncHttpError(status_code, payload)


def _is_authentication_sync_error(exc: BaseException) -> bool:
    """Recognize auth failures even after a control-plane wrapper is added."""

    current: BaseException | None = exc
    visited: set[int] = set()
    while current is not None and id(current) not in visited:
        visited.add(id(current))
        code = getattr(current, "code", None)
        if code is None:
            code = getattr(current, "application_code", None)
        if code is None and isinstance(current, RunEventSyncHttpError):
            code = _sync_error_code(current.detail)
        if str(code or "") in _AUTHENTICATION_ERROR_CODES:
            return True
        current = current.__cause__ or current.__context__
    return False


class RunEventSyncTransport(Protocol):
    async def ingest(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
    ) -> dict[str, Any]: ...

    async def list_projects(
        self,
        configuration: CloudSyncConfiguration,
    ) -> dict[str, Any]: ...

    async def project_snapshot(
        self,
        configuration: CloudSyncConfiguration,
        project_id: str,
    ) -> dict[str, Any]: ...

    async def list_project_events(
        self,
        configuration: CloudSyncConfiguration,
        project_id: str,
        *,
        after_cursor: int,
        limit: int,
    ) -> dict[str, Any]: ...

    async def ingest_memory_mutations(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
    ) -> dict[str, Any]: ...

    async def put_memory_snapshot(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
    ) -> dict[str, Any]: ...

    async def heartbeat_memory_scopes(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
    ) -> dict[str, Any]: ...

    async def claim_memory_writer(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
    ) -> dict[str, Any]: ...

    async def account_owner_id(
        self,
        configuration: CloudSyncConfiguration,
    ) -> str: ...

    async def authorize_memory_scopes(
        self,
        configuration: CloudSyncConfiguration,
        scopes: list[tuple[str, str]],
    ) -> dict[str, Any]: ...

    async def upload_artifact(
        self,
        configuration: CloudSyncConfiguration,
        item: ArtifactUploadSyncItem,
    ) -> dict[str, Any]: ...

    async def close(self) -> None: ...


class HttpRunEventSyncTransport:
    def __init__(
        self,
        *,
        timeout_seconds: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        timeout = (
            httpx.Timeout(
                connect=10.0,
                read=30.0,
                write=60.0,
                pool=5.0,
            )
            if timeout_seconds is None
            else httpx.Timeout(timeout_seconds)
        )
        self._client = httpx.AsyncClient(
            timeout=timeout,
            limits=httpx.Limits(
                max_connections=20,
                max_keepalive_connections=10,
                keepalive_expiry=90.0,
            ),
            transport=transport,
        )
        self._registered_devices: dict[tuple[str, str, str], str] = {}
        self._claimed_routes: set[tuple[str, str, str, str]] = set()
        self._registration_lock = asyncio.Lock()

    @staticmethod
    def _headers(
        configuration: CloudSyncConfiguration,
    ) -> dict[str, str]:
        return {
            "Authorization": configuration.authorization,
            "X-Desktop-Instance-ID": configuration.desktop_instance_id,
        }

    @staticmethod
    def _sync_base(configuration: CloudSyncConfiguration) -> str:
        return configuration.endpoint_url.rsplit("/", 1)[0]

    @classmethod
    def _device_key(
        cls, configuration: CloudSyncConfiguration
    ) -> tuple[str, str, str]:
        authorization_digest = hashlib.sha256(
            configuration.authorization.encode("utf-8")
        ).hexdigest()
        return (
            cls._sync_base(configuration),
            configuration.desktop_instance_id,
            authorization_digest,
        )

    async def _json_request(
        self,
        method: str,
        url: str,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = await self._client.request(
            method,
            url,
            json=payload,
            headers=self._headers(configuration),
        )
        if response.is_error:
            try:
                detail: Any = response.json()
            except ValueError:
                detail = response.text[:2000]
            raise RunEventSyncHttpError(response.status_code, detail)
        try:
            result = response.json()
        except ValueError as exc:
            raise RunEventSyncProtocolError(
                "Run sync endpoint returned non-JSON success response"
            ) from exc
        if not isinstance(result, dict):
            raise RunEventSyncProtocolError(
                "Run sync response must be a JSON object"
            )
        _raise_for_application_error(result, status_code=response.status_code)
        return result

    async def _ensure_device(
        self,
        configuration: CloudSyncConfiguration,
    ) -> None:
        base = self._sync_base(configuration)
        device_key = self._device_key(configuration)
        if device_key in self._registered_devices:
            return
        async with self._registration_lock:
            if device_key in self._registered_devices:
                return
            try:
                response = await self._json_request(
                    "POST",
                    f"{base}/devices/register",
                    configuration,
                    {
                        "capabilities": {
                            "run_event_sync": 1,
                            "run_history_restore": 1,
                            "command_sync": 1,
                        }
                    },
                )
            except RunEventSyncHttpError as exc:
                raise RunSyncInfrastructureError(
                    str(exc), code=exc.application_code
                ) from exc
            account_owner_id = str(
                response.get("account_owner_id") or ""
            ).strip()
            if not account_owner_id:
                raise RunEventSyncProtocolError(
                    "Device registration omitted authenticated account owner"
                )
            self._registered_devices[device_key] = account_owner_id

    async def account_owner_id(
        self,
        configuration: CloudSyncConfiguration,
    ) -> str:
        await self._ensure_device(configuration)
        key = self._device_key(configuration)
        owner = self._registered_devices.get(key)
        if not owner:
            raise RunEventSyncProtocolError(
                "Authenticated Memory account owner is unavailable"
            )
        return owner

    async def authorize_memory_scopes(
        self,
        configuration: CloudSyncConfiguration,
        scopes: list[tuple[str, str]],
    ) -> dict[str, Any]:
        await self._ensure_device(configuration)
        return await self._json_request(
            "POST",
            f"{self._sync_base(configuration)}/memory/scopes:authorize",
            configuration,
            {
                "scopes": [
                    {"scope_type": scope_type, "scope_id": scope_id}
                    for scope_type, scope_id in scopes
                ]
            },
        )

    async def _ensure_device_and_route(
        self,
        configuration: CloudSyncConfiguration,
        project_id: str,
    ) -> None:
        base = self._sync_base(configuration)
        device_key = self._device_key(configuration)
        route_key = (*device_key, project_id)
        if route_key in self._claimed_routes:
            return
        await self._ensure_device(configuration)
        async with self._registration_lock:
            if route_key not in self._claimed_routes:
                try:
                    await self._json_request(
                        "PUT",
                        f"{base}/projects/{project_id}/execution-route",
                        configuration,
                        {},
                    )
                except RunEventSyncHttpError as exc:
                    raise RunSyncInfrastructureError(
                        str(exc), code=exc.application_code
                    ) from exc
                self._claimed_routes.add(route_key)

    async def ingest(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        await self._ensure_device_and_route(
            configuration,
            str(payload["project_id"]),
        )
        return await self._json_request(
            "POST",
            configuration.endpoint_url,
            configuration,
            payload,
        )

    async def list_projects(
        self,
        configuration: CloudSyncConfiguration,
    ) -> dict[str, Any]:
        await self._ensure_device(configuration)
        return await self._json_request(
            "GET",
            f"{self._sync_base(configuration)}/projects",
            configuration,
        )

    async def project_snapshot(
        self,
        configuration: CloudSyncConfiguration,
        project_id: str,
    ) -> dict[str, Any]:
        await self._ensure_device(configuration)
        encoded_project_id = quote(project_id, safe="")
        return await self._json_request(
            "GET",
            f"{self._sync_base(configuration)}/projects/{encoded_project_id}/snapshot"
            "?event_limit=1&include_artifacts=false",
            configuration,
        )

    async def list_project_events(
        self,
        configuration: CloudSyncConfiguration,
        project_id: str,
        *,
        after_cursor: int,
        limit: int,
    ) -> dict[str, Any]:
        await self._ensure_device(configuration)
        encoded_project_id = quote(project_id, safe="")
        return await self._json_request(
            "GET",
            f"{self._sync_base(configuration)}/projects/{encoded_project_id}/events"
            f"?after_cursor={after_cursor}&limit={limit}",
            configuration,
        )

    async def ingest_memory_mutations(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        if str(payload.get("scope_type")) == "project":
            await self._ensure_device_and_route(
                configuration, str(payload["scope_id"])
            )
        else:
            await self._ensure_device(configuration)
        return await self._json_request(
            "POST",
            f"{self._sync_base(configuration)}/memory/mutations:ingest",
            configuration,
            payload,
        )

    async def put_memory_snapshot(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        if str(payload.get("scope_type")) == "project":
            await self._ensure_device_and_route(
                configuration, str(payload["scope_id"])
            )
        else:
            await self._ensure_device(configuration)
        return await self._json_request(
            "PUT",
            f"{self._sync_base(configuration)}/memory/snapshot",
            configuration,
            payload,
        )

    async def heartbeat_memory_scopes(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        await self._ensure_device(configuration)
        items = payload.get("items")
        if not isinstance(items, list):
            raise RunEventSyncProtocolError(
                "Memory heartbeat payload must contain an items array"
            )
        acknowledged: list[dict[str, Any]] = []
        verified_at: str | None = None
        for offset in range(0, len(items), 100):
            response = await self._json_request(
                "POST",
                f"{self._sync_base(configuration)}/memory/heartbeats",
                configuration,
                {"items": items[offset : offset + 100]},
            )
            response_items = response.get("items")
            if not isinstance(response_items, list):
                raise RunEventSyncProtocolError(
                    "Memory heartbeat response omitted acknowledged items"
                )
            acknowledged.extend(response_items)
            if isinstance(response.get("verified_at"), str):
                verified_at = response["verified_at"]
        return {"items": acknowledged, "verified_at": verified_at}

    async def claim_memory_writer(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        if str(payload.get("scope_type")) == "project":
            await self._ensure_device_and_route(
                configuration, str(payload["scope_id"])
            )
        else:
            await self._ensure_device(configuration)
        return await self._json_request(
            "POST",
            f"{self._sync_base(configuration)}/memory/writer:claim",
            configuration,
            payload,
        )

    async def upload_artifact(
        self,
        configuration: CloudSyncConfiguration,
        item: ArtifactUploadSyncItem,
    ) -> dict[str, Any]:
        path = Path(item.local_path)
        content_type = (
            mimetypes.guess_type(item.filename)[0]
            or "application/octet-stream"
        )
        api_base = self._sync_base(configuration).rsplit("/sync", 1)[0]
        boundary = (
            "eigent-" + re.sub(r"[^A-Za-z0-9]", "", item.artifact_id)[:48]
        )
        upload_basename = item.filename.replace("\\", "/").rsplit("/", 1)[-1]
        safe_filename = re.sub(r"[\r\n\"\\]", "_", upload_basename)
        safe_logical_path = item.relative_path.replace("\\", "/")
        prefix = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="task_id"\r\n\r\n'
            f"{item.run_id}\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="client_request_id"\r\n\r\n'
            f"{item.artifact_id}\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="source"\r\n\r\n'
            "project_output\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="logical_path"\r\n\r\n'
            f"{safe_logical_path}\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="file"; '
            f'filename="{safe_filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
        suffix = f"\r\n--{boundary}--\r\n".encode()
        size = await asyncio.to_thread(lambda: path.stat().st_size)
        headers = {
            **self._headers(configuration),
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(prefix) + size + len(suffix)),
        }
        response = await self._client.post(
            f"{api_base}/chat/files/upload",
            headers=headers,
            content=_AsyncMultipartFileStream(prefix, path, suffix),
        )
        if response.is_error:
            try:
                detail: Any = response.json()
            except ValueError:
                detail = response.text
            raise RunEventSyncHttpError(response.status_code, detail)
        try:
            payload = response.json()
        except ValueError as exc:
            raise RunEventSyncProtocolError(
                "Artifact upload returned invalid JSON"
            ) from exc
        if not isinstance(payload, dict):
            raise RunEventSyncProtocolError(
                "Artifact upload returned an invalid payload"
            )
        _raise_for_application_error(payload, status_code=response.status_code)
        return payload

    async def close(self) -> None:
        await self._client.aclose()


class CloudSyncWorker:
    def __init__(
        self,
        journal: SQLiteRunJournal,
        transport: RunEventSyncTransport,
        *,
        max_parallel_runs: int = 4,
        batch_size: int = 100,
        lease_seconds: float = 30.0,
        poll_interval_seconds: float = 1.0,
        max_retry_seconds: float = 300.0,
    ) -> None:
        if max_parallel_runs < 1 or batch_size < 1:
            raise ValueError(
                "sync concurrency and batch size must be positive"
            )
        self._journal = journal
        self._transport = transport
        self._max_parallel_runs = max_parallel_runs
        self._batch_size = batch_size
        self._lease_seconds = lease_seconds
        self._poll_interval_seconds = poll_interval_seconds
        self._max_retry_seconds = max_retry_seconds
        self._configuration: CloudSyncConfiguration | None = None
        self._wake = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._closed = False
        self._bootstrap_pending = False
        self._bootstrap_lock = asyncio.Lock()
        self._bootstrap_attempt_count = 0
        self._bootstrap_next_attempt_at = 0.0
        self._auth_paused_configuration: CloudSyncConfiguration | None = None
        self._auth_pause_code: str | None = None
        self._auth_retry_at = 0.0
        self._memory_snapshot_revisions: dict[tuple[str, str], int] = {}
        self._memory_snapshot_verified_at: dict[tuple[str, str], float] = {}
        self._memory_snapshot_failure_counts: dict[tuple[str, str], int] = {}
        self._memory_snapshot_failed_revisions: dict[tuple[str, str], int] = {}
        self._memory_snapshot_retry_after: dict[tuple[str, str], float] = {}
        self._memory_snapshot_repair_revisions: dict[tuple[str, str], int] = {}
        self._memory_writer_epochs: dict[tuple[str, str], int] = {}
        self._memory_heartbeat_next_at = 0.0
        self._memory_heartbeat_failure_count = 0
        self._memory_heartbeat_disabled = False
        self._artifact_tasks: set[asyncio.Task[int]] = set()

    @property
    def bootstrap_pending(self) -> bool:
        """Whether the local Cloud history replica still needs repair."""

        return self._bootstrap_pending

    def configure(self, configuration: CloudSyncConfiguration) -> None:
        if configuration != self._configuration:
            self._bootstrap_pending = True
            self._bootstrap_attempt_count = 0
            self._bootstrap_next_attempt_at = 0.0
            self._auth_paused_configuration = None
            self._auth_pause_code = None
            self._auth_retry_at = 0.0
            self._memory_snapshot_revisions.clear()
            self._memory_snapshot_verified_at.clear()
            self._memory_snapshot_failure_counts.clear()
            self._memory_snapshot_failed_revisions.clear()
            self._memory_snapshot_retry_after.clear()
            self._memory_snapshot_repair_revisions.clear()
            self._memory_writer_epochs.clear()
            self._memory_heartbeat_next_at = 0.0
            self._memory_heartbeat_failure_count = 0
            self._memory_heartbeat_disabled = False
        self._configuration = configuration
        self.notify()

    def start(self) -> None:
        if self._closed:
            raise RuntimeError("CloudSyncWorker is closed")
        if self._task is None:
            self._task = asyncio.create_task(
                self._run(),
                name="run-event-cloud-sync",
            )
        self.notify()

    def notify(self) -> None:
        if not self._closed:
            self._wake.set()

    async def authenticated_account_owner_id(self) -> str:
        """Return the owner proven by the active device-auth session."""

        configuration = self._configuration
        if (
            configuration == self._auth_paused_configuration
            and time.monotonic() < self._auth_retry_at
        ):
            raise RunSyncInfrastructureError(
                "Cloud sync authentication is paused until credentials refresh",
                code=self._auth_pause_code,
            )
        resolver = getattr(self._transport, "account_owner_id", None)
        if configuration is None or not callable(resolver):
            raise RunSyncInfrastructureError(
                "Cloud Memory account authentication is unavailable"
            )
        owner = str(await resolver(configuration)).strip()
        if not owner:
            raise RunEventSyncProtocolError(
                "Cloud Memory account authentication omitted its owner"
            )
        self._resume_after_authentication_success(configuration)
        return owner

    async def drain_once(self) -> int:
        configuration = self._configuration
        if configuration is None:
            return 0
        if (
            configuration == self._auth_paused_configuration
            and time.monotonic() < self._auth_retry_at
        ):
            return 0
        if (
            self._bootstrap_pending
            and time.monotonic() >= self._bootstrap_next_attempt_at
        ):
            try:
                await self.bootstrap_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # Restore freshness must not block the durable outbound lane.
                # Keep the flag set so the normal poll loop retries.
                if self._pause_for_authentication_failure(configuration, exc):
                    return 0
                logger.exception("Cloud Run history bootstrap failed")
        memory_count = 0
        memory_snapshot_ready: set[tuple[str, str]] = set()
        if not self._bootstrap_pending:
            try:
                memory_snapshot_ready = (
                    await self._sync_memory_snapshots_if_changed(configuration)
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if self._pause_for_authentication_failure(configuration, exc):
                    return 0
                raise
        if memory_snapshot_ready:
            memory_batches = await asyncio.to_thread(
                self._journal.claim_ready_memory_mutation_batches,
                max_scopes=self._max_parallel_runs,
                batch_size=self._batch_size,
                lease_seconds=self._lease_seconds,
                eligible_scopes=memory_snapshot_ready,
            )
            if memory_batches:
                memory_results = await asyncio.gather(
                    *(
                        self._sync_memory_batch(batch, configuration)
                        for batch in memory_batches
                    )
                )
                memory_count = sum(memory_results)
        artifact_capacity = max(
            0, self._max_parallel_runs - len(self._artifact_tasks)
        )
        artifact_uploads = (
            await asyncio.to_thread(
                self._journal.claim_ready_artifact_uploads,
                limit=artifact_capacity,
                lease_seconds=max(self._lease_seconds, 60.0),
            )
            if artifact_capacity
            else []
        )
        batches = await asyncio.to_thread(
            self._journal.claim_ready_outbox_batches,
            max_runs=self._max_parallel_runs,
            batch_size=self._batch_size,
            lease_seconds=self._lease_seconds,
        )
        for item in artifact_uploads:
            task = asyncio.create_task(
                self._sync_artifact_upload(item, configuration),
                name=f"artifact-upload-{item.artifact_id}",
            )
            self._artifact_tasks.add(task)
            task.add_done_callback(self._artifact_upload_finished)
        if not batches:
            return memory_count
        results = await asyncio.gather(
            *(self._sync_batch(batch, configuration) for batch in batches)
        )
        # Drain another slice without waiting when more Runs or events are ready.
        self.notify()
        return memory_count + sum(results)

    def _pause_for_authentication_failure(
        self,
        configuration: CloudSyncConfiguration,
        exc: BaseException,
    ) -> bool:
        """Pause every Cloud lane until middleware supplies new credentials."""

        if not _is_authentication_sync_error(exc):
            return False
        if configuration != self._configuration:
            # An in-flight request from an obsolete credential set must not
            # pause a newer configuration.
            return True
        if self._auth_paused_configuration != configuration:
            code = getattr(exc, "code", None) or getattr(
                exc, "application_code", None
            )
            if code is None and isinstance(exc, RunEventSyncHttpError):
                code = _sync_error_code(exc.detail)
            self._auth_paused_configuration = configuration
            self._auth_pause_code = str(code or "") or None
            logger.warning(
                "Cloud sync paused because authentication was rejected; "
                "local history and pending outboxes remain available and "
                "sync will resume after credentials refresh",
                extra={"error_code": self._auth_pause_code},
            )
        self._auth_retry_at = time.monotonic() + max(
            60.0, min(self._max_retry_seconds, 300.0)
        )
        return True

    def _resume_after_authentication_success(
        self, configuration: CloudSyncConfiguration
    ) -> None:
        if configuration != self._auth_paused_configuration:
            return
        self._auth_paused_configuration = None
        self._auth_pause_code = None
        self._auth_retry_at = 0.0
        logger.debug("Cloud sync resumed after authentication recovered")

    def _artifact_upload_finished(self, task: asyncio.Task[int]) -> None:
        self._artifact_tasks.discard(task)
        if task.cancelled():
            return
        try:
            task.result()
        except Exception:
            # _sync_artifact_upload normally converts failures into durable
            # retry/dead-letter state. Keep a final guard so a background task
            # can never become an unobserved exception.
            logger.exception("Unexpected Artifact upload task failure")
        self.notify()

    async def _sync_artifact_upload(
        self,
        item: ArtifactUploadSyncItem,
        configuration: CloudSyncConfiguration,
    ) -> int:
        upload = getattr(self._transport, "upload_artifact", None)
        if not callable(upload):
            await self._retry_artifact_upload(
                item, "Artifact upload transport is unavailable"
            )
            return 0
        try:
            response = await upload(configuration, item)
            self._resume_after_authentication_success(configuration)
            required = {
                "id",
                "filename",
                "file_size",
                "file_type",
                "s3_bucket",
                "s3_key",
            }
            if not required.issubset(response):
                raise RunEventSyncProtocolError(
                    "Artifact upload response is missing asset identity"
                )
            await asyncio.to_thread(
                self._journal.complete_artifact_upload,
                item,
                chat_file_id=int(response["id"]),
                s3_bucket=str(response["s3_bucket"]),
                s3_key=str(response["s3_key"]),
                filename=str(response["filename"]),
                file_size=int(response["file_size"]),
                file_type=str(response["file_type"]),
            )
        except asyncio.CancelledError:
            raise
        except FileNotFoundError as exc:
            await asyncio.to_thread(
                self._journal.retry_artifact_upload,
                item,
                error=str(exc),
                next_attempt_at=time.time(),
                dead_letter=True,
            )
            return 0
        except RunEventSyncHttpError as exc:
            if self._pause_for_authentication_failure(configuration, exc):
                await self._retry_artifact_upload(item, str(exc))
                return 0
            if exc.status_code in {400, 409, 413, 422}:
                await asyncio.to_thread(
                    self._journal.retry_artifact_upload,
                    item,
                    error=str(exc),
                    next_attempt_at=time.time(),
                    dead_letter=True,
                )
            else:
                await self._retry_artifact_upload(item, str(exc))
            return 0
        except Exception as exc:
            self._pause_for_authentication_failure(configuration, exc)
            await self._retry_artifact_upload(item, str(exc))
            return 0
        self.notify()
        return 1

    async def _retry_artifact_upload(
        self,
        item: ArtifactUploadSyncItem,
        error: str,
    ) -> None:
        next_attempt = item.attempt_count + 1
        delay = min(
            2 ** min(next_attempt, 8),
            self._max_retry_seconds,
        )
        await asyncio.to_thread(
            self._journal.retry_artifact_upload,
            item,
            error=error,
            next_attempt_at=time.time() + delay,
            dead_letter=next_attempt >= 8,
        )

    async def bootstrap_once(self) -> None:
        """Synchronously repair the local read replica once per credential set."""

        configuration = self._configuration
        if (
            configuration is None
            or not self._bootstrap_pending
            or time.monotonic() < self._bootstrap_next_attempt_at
        ):
            return
        async with self._bootstrap_lock:
            configuration = self._configuration
            if (
                configuration is None
                or not self._bootstrap_pending
                or time.monotonic() < self._bootstrap_next_attempt_at
            ):
                return
            try:
                await self._bootstrap_history(configuration)
            except Exception:
                self._bootstrap_attempt_count += 1
                self._bootstrap_next_attempt_at = time.monotonic() + min(
                    2 ** min(self._bootstrap_attempt_count, 8),
                    self._max_retry_seconds,
                )
                raise

    async def _bootstrap_history(
        self,
        configuration: CloudSyncConfiguration,
    ) -> None:
        list_projects = getattr(self._transport, "list_projects", None)
        project_snapshot = getattr(self._transport, "project_snapshot", None)
        list_events = getattr(self._transport, "list_project_events", None)
        if (
            not callable(list_projects)
            or not callable(project_snapshot)
            or not callable(list_events)
        ):
            # Compatibility for custom transports written before bootstrap was
            # introduced. Production HTTP transport always implements it.
            self._bootstrap_pending = False
            self._bootstrap_attempt_count = 0
            self._bootstrap_next_attempt_at = 0.0
            return
        projects_response = await list_projects(configuration)
        project_items = projects_response.get("items")
        if not isinstance(project_items, list):
            raise RunEventSyncProtocolError(
                "Run sync project list must contain an items array"
            )
        for item in project_items:
            if (
                not isinstance(item, dict)
                or not str(item.get("project_id") or "").strip()
            ):
                raise RunEventSyncProtocolError(
                    "invalid Run sync project descriptor"
                )
            project_id = str(item["project_id"])
            # Snapshot and event paging may race a new ingest. Repeat until the
            # snapshot watermark matches the locally imported cursor.
            for _ in range(3):
                snapshot = await project_snapshot(configuration, project_id)
                if snapshot.get("project_id") != project_id:
                    raise RunEventSyncProtocolError(
                        "Run sync snapshot scope does not match request"
                    )
                target_cursor = int(snapshot.get("current_cursor", 0))
                cursor = await asyncio.to_thread(
                    self._journal.get_cloud_project_cursor, project_id
                )
                if cursor > target_cursor:
                    # The local replica may have observed a newer page watermark
                    # than this concurrently generated snapshot; refresh it.
                    continue
                while cursor < target_cursor:
                    page = await list_events(
                        configuration,
                        project_id,
                        after_cursor=cursor,
                        limit=self._batch_size,
                    )
                    if page.get("project_id") != project_id:
                        raise RunEventSyncProtocolError(
                            "Run sync event page scope does not match request"
                        )
                    raw_items = page.get("items")
                    if not isinstance(raw_items, list):
                        raise RunEventSyncProtocolError(
                            "Run sync event page must contain an items array"
                        )
                    replicas = [
                        self._cloud_event_from_payload(project_id, raw)
                        for raw in raw_items
                    ]
                    next_cursor = int(page.get("next_cursor", cursor))
                    if next_cursor <= cursor:
                        raise RunEventSyncProtocolError(
                            "Run sync event page did not advance its cursor"
                        )
                    await asyncio.to_thread(
                        self._journal.import_cloud_project_page,
                        project_id=project_id,
                        after_cursor=cursor,
                        next_cursor=next_cursor,
                        events=replicas,
                    )
                    cursor = next_cursor
                    target_cursor = max(
                        target_cursor, int(page.get("current_cursor", cursor))
                    )
                if target_cursor != int(snapshot.get("current_cursor", 0)):
                    continue
                raw_runs = snapshot.get("runs")
                if not isinstance(raw_runs, list):
                    raise RunEventSyncProtocolError(
                        "Run sync snapshot must contain a runs array"
                    )
                runs = [self._cloud_run_from_payload(raw) for raw in raw_runs]
                try:
                    await asyncio.to_thread(
                        self._journal.reconcile_cloud_project_runs,
                        project_id=project_id,
                        current_cursor=target_cursor,
                        runs=runs,
                    )
                except Exception:
                    if target_cursor != int(snapshot.get("current_cursor", 0)):
                        continue
                    raise
                break
            else:
                raise RunEventSyncProtocolError(
                    f"Run sync snapshot for {project_id!r} did not stabilize"
                )
        await self._sync_memory_snapshots_if_changed(configuration)
        if self._configuration == configuration:
            self._bootstrap_pending = False
            self._bootstrap_attempt_count = 0
            self._bootstrap_next_attempt_at = 0.0
            self._resume_after_authentication_success(configuration)

    async def _sync_memory_snapshots_if_changed(
        self,
        configuration: CloudSyncConfiguration,
    ) -> set[tuple[str, str]]:
        put_snapshot = getattr(self._transport, "put_memory_snapshot", None)
        resolve_owner = getattr(self._transport, "account_owner_id", None)
        authorize_scopes = getattr(
            self._transport, "authorize_memory_scopes", None
        )
        if not all(
            callable(item)
            for item in (put_snapshot, resolve_owner, authorize_scopes)
        ):
            return set()
        account_owner_id = str(await resolve_owner(configuration)).strip()
        if not account_owner_id:
            raise RunEventSyncProtocolError(
                "Memory sync requires an authenticated account owner"
            )
        self._resume_after_authentication_success(configuration)
        candidates = await asyncio.to_thread(
            self._journal.list_memory_scope_owner_candidates,
            account_owner_id,
        )
        if candidates:
            authorization = await authorize_scopes(configuration, candidates)
            if (
                str(authorization.get("account_owner_id") or "")
                != account_owner_id
            ):
                raise RunEventSyncProtocolError(
                    "Memory scope authorization owner does not match device"
                )
            raw_scopes = authorization.get("authorized_scopes")
            if not isinstance(raw_scopes, list):
                raise RunEventSyncProtocolError(
                    "Memory scope authorization omitted authorized_scopes"
                )
            approved = [
                (str(item["scope_type"]), str(item["scope_id"]))
                for item in raw_scopes
                if isinstance(item, dict)
                and item.get("scope_type") in {"project", "space", "user"}
                and isinstance(item.get("scope_id"), str)
            ]
            await asyncio.to_thread(
                self._journal.confirm_memory_scope_owner_candidates,
                account_owner_id,
                approved,
            )
        snapshots = await asyncio.to_thread(
            self._journal.list_memory_sync_snapshots,
            account_owner_id,
        )
        ready: set[tuple[str, str]] = set()
        heartbeat_items: list[dict[str, Any]] = []
        now = time.monotonic()
        active_keys = {
            (str(snapshot["scope_type"]), str(snapshot["scope_id"]))
            for snapshot in snapshots
        }
        for cache in (
            self._memory_snapshot_revisions,
            self._memory_snapshot_verified_at,
            self._memory_writer_epochs,
        ):
            for stale_key in set(cache) - active_keys:
                cache.pop(stale_key, None)
        for snapshot in snapshots:
            key = (str(snapshot["scope_type"]), str(snapshot["scope_id"]))
            revision = int(snapshot["revision"])
            failed_revision = self._memory_snapshot_failed_revisions.get(key)
            if failed_revision != revision:
                self._clear_memory_snapshot_failure(key)
            elif now < self._memory_snapshot_retry_after.get(key, 0.0):
                continue
            if self._memory_snapshot_revisions.get(key) == revision:
                ready.add(key)
                writer_epoch = self._memory_writer_epochs.get(key)
                if writer_epoch is not None:
                    heartbeat_items.append(
                        {
                            "scope_type": key[0],
                            "scope_id": key[1],
                            "source_revision": revision,
                            "writer_epoch": writer_epoch,
                        }
                    )
                continue
            payload = {
                "scope_type": key[0],
                "scope_id": key[1],
                "scope": snapshot["scope"],
                "source_revision": revision,
                "entries": snapshot["entries"],
            }
            try:
                response = await put_snapshot(configuration, payload)
            except RunEventSyncHttpError as exc:
                if self._pause_for_authentication_failure(configuration, exc):
                    return set()
                detail = (
                    exc.detail.get("detail", exc.detail)
                    if isinstance(exc.detail, dict)
                    else {}
                )
                if (
                    exc.status_code == 409
                    and isinstance(detail, dict)
                    and detail.get("code")
                    == "memory_snapshot_same_revision_conflict"
                ):
                    if (
                        self._memory_snapshot_repair_revisions.get(key)
                        == revision
                    ):
                        delay = self._defer_memory_snapshot_retry(
                            key, revision
                        )
                        logger.warning(
                            "Cloud still rejects repaired Memory projection "
                            "%s/%s at revision %d; retrying in %.1fs",
                            key[0],
                            key[1],
                            revision,
                            delay,
                        )
                        continue
                    try:
                        repair_revision = self._journal.advance_memory_snapshot_revision_after_cloud_conflict
                        repaired = await asyncio.to_thread(
                            repair_revision,
                            key[0],
                            key[1],
                            expected_revision=revision,
                        )
                    except Exception:
                        delay = self._defer_memory_snapshot_retry(
                            key, revision
                        )
                        logger.exception(
                            "Cloud Memory revision repair failed for %s/%s; "
                            "retrying in %.1fs",
                            key[0],
                            key[1],
                            delay,
                        )
                    else:
                        self._clear_memory_snapshot_failure(key)
                        if repaired:
                            self._memory_snapshot_repair_revisions[key] = (
                                revision + 1
                            )
                            logger.warning(
                                "Advanced local Memory revision after Cloud "
                                "rejected stale projection %s/%s at revision "
                                "%d",
                                key[0],
                                key[1],
                                revision,
                            )
                        self.notify()
                    continue
                claim_writer = getattr(
                    self._transport, "claim_memory_writer", None
                )
                if (
                    exc.status_code == 409
                    and isinstance(detail, dict)
                    and detail.get("code") == "memory_scope_writer_conflict"
                    and isinstance(detail.get("current_writer_epoch"), int)
                    and callable(claim_writer)
                ):
                    try:
                        claim = await claim_writer(
                            configuration,
                            {
                                "scope_type": key[0],
                                "scope_id": key[1],
                                "expected_writer_epoch": detail[
                                    "current_writer_epoch"
                                ],
                            },
                        )
                        baseline_scope = claim.get("baseline_scope")
                        baseline_entries = claim.get("baseline_entries")
                        if claim.get("rebase_required"):
                            if not isinstance(
                                baseline_scope, dict
                            ) or not isinstance(baseline_entries, list):
                                raise RunEventSyncProtocolError(
                                    "Memory writer transfer omitted its "
                                    "Cloud baseline"
                                )
                            reconciliation_count = await asyncio.to_thread(
                                self._journal.merge_cloud_memory_baseline,
                                scope_type=key[0],
                                scope_id=key[1],
                                account_owner_id=account_owner_id,
                                scope=baseline_scope,
                                entries=baseline_entries,
                            )
                            if reconciliation_count:
                                logger.warning(
                                    "Cloud Memory takeover for %s/%s needs "
                                    "%d user reconciliation decision(s)",
                                    key[0],
                                    key[1],
                                    reconciliation_count,
                                )
                                continue
                            refreshed = next(
                                (
                                    item
                                    for item in await asyncio.to_thread(
                                        self._journal.list_memory_sync_snapshots,
                                        account_owner_id,
                                    )
                                    if (item["scope_type"], item["scope_id"])
                                    == key
                                ),
                                None,
                            )
                            if refreshed is None:
                                raise RunEventSyncProtocolError(
                                    "Merged Memory baseline is not readable"
                                )
                            revision = int(refreshed["revision"])
                            payload = {
                                "scope_type": key[0],
                                "scope_id": key[1],
                                "scope": refreshed["scope"],
                                "source_revision": revision,
                                "entries": refreshed["entries"],
                            }
                        response = await put_snapshot(configuration, payload)
                    except Exception as transfer_error:
                        if self._pause_for_authentication_failure(
                            configuration, transfer_error
                        ):
                            return set()
                        delay = self._defer_memory_snapshot_retry(
                            key, revision
                        )
                        self._log_memory_snapshot_failure(
                            key,
                            transfer_error,
                            delay,
                            operation="writer transfer",
                        )
                        continue
                else:
                    delay = self._defer_memory_snapshot_retry(key, revision)
                    logger.exception(
                        "Cloud Memory snapshot sync failed for %s/%s; "
                        "retrying in %.1fs",
                        key[0],
                        key[1],
                        delay,
                    )
                    continue
            except asyncio.CancelledError:
                raise
            except Exception as snapshot_error:
                if self._pause_for_authentication_failure(
                    configuration, snapshot_error
                ):
                    return set()
                delay = self._defer_memory_snapshot_retry(key, revision)
                self._log_memory_snapshot_failure(
                    key,
                    snapshot_error,
                    delay,
                )
                continue
            try:
                if (
                    response.get("scope_type") != key[0]
                    or response.get("scope_id") != key[1]
                    or not isinstance(response.get("source_revision"), int)
                    or int(response["source_revision"]) < revision
                ):
                    raise RunEventSyncProtocolError(
                        "Memory snapshot response does not acknowledge the "
                        "source revision"
                    )
                writer_epoch = response.get("writer_epoch")
                if writer_epoch is not None and (
                    isinstance(writer_epoch, bool)
                    or not isinstance(writer_epoch, int)
                    or writer_epoch < 1
                ):
                    raise RunEventSyncProtocolError(
                        "Memory snapshot response contains an invalid writer epoch"
                    )
            except asyncio.CancelledError:
                raise
            except Exception:
                # Scope isolation is deliberate: one malformed or stale scope
                # must not stop unrelated Memory outboxes from draining.
                delay = self._defer_memory_snapshot_retry(key, revision)
                logger.exception(
                    "Cloud Memory snapshot sync failed for %s/%s; retrying "
                    "in %.1fs",
                    key[0],
                    key[1],
                    delay,
                )
                continue
            self._clear_memory_snapshot_failure(key)
            self._memory_snapshot_repair_revisions.pop(key, None)
            self._memory_snapshot_revisions[key] = revision
            self._memory_snapshot_verified_at[key] = now
            if writer_epoch is None:
                # Additive compatibility with a pre-heartbeat Cloud.  The
                # snapshot remains authoritative, but this Desktop cannot
                # renew its writer lease until a newer Server returns an epoch.
                self._memory_writer_epochs.pop(key, None)
            else:
                self._memory_writer_epochs[key] = writer_epoch
            ready.add(key)
        await self._heartbeat_memory_scopes_if_due(
            configuration,
            heartbeat_items,
            ready,
            now=now,
        )
        return ready

    async def _heartbeat_memory_scopes_if_due(
        self,
        configuration: CloudSyncConfiguration,
        items: list[dict[str, Any]],
        ready: set[tuple[str, str]],
        *,
        now: float,
    ) -> None:
        """Renew unchanged Memory scopes without re-uploading their contents."""

        if self._memory_heartbeat_disabled:
            return
        if self._memory_heartbeat_next_at <= 0.0:
            self._memory_heartbeat_next_at = (
                now + self._memory_heartbeat_interval(configuration)
            )
            return
        if now < self._memory_heartbeat_next_at:
            return
        heartbeat = getattr(self._transport, "heartbeat_memory_scopes", None)
        if not callable(heartbeat):
            self._memory_heartbeat_disabled = True
            logger.warning(
                "Cloud Memory heartbeat transport is unavailable; unchanged "
                "snapshots will not be re-uploaded"
            )
            return
        if not items:
            self._memory_heartbeat_next_at = (
                now + self._memory_heartbeat_interval(configuration)
            )
            return

        expected = {
            (str(item["scope_type"]), str(item["scope_id"])): (
                int(item["source_revision"]),
                int(item["writer_epoch"]),
            )
            for item in items
        }
        try:
            response = await heartbeat(configuration, {"items": items})
            self._resume_after_authentication_success(configuration)
            raw_acknowledged = response.get("items")
            if not isinstance(raw_acknowledged, list):
                raise RunEventSyncProtocolError(
                    "Memory heartbeat response omitted acknowledged items"
                )
            acknowledged: set[tuple[str, str]] = set()
            for item in raw_acknowledged:
                if not isinstance(item, dict):
                    raise RunEventSyncProtocolError(
                        "Memory heartbeat acknowledgement is invalid"
                    )
                key = (str(item.get("scope_type")), str(item.get("scope_id")))
                expected_identity = expected.get(key)
                if (
                    expected_identity is None
                    or item.get("source_revision") != expected_identity[0]
                    or item.get("writer_epoch") != expected_identity[1]
                    or key in acknowledged
                ):
                    raise RunEventSyncProtocolError(
                        "Memory heartbeat acknowledgement does not match its request"
                    )
                acknowledged.add(key)
        except RunEventSyncHttpError as exc:
            if self._pause_for_authentication_failure(configuration, exc):
                return
            if exc.status_code in {404, 405}:
                self._memory_heartbeat_disabled = True
                logger.warning(
                    "Cloud does not support lightweight Memory heartbeats yet; "
                    "unchanged snapshots will not be re-uploaded"
                )
                return
            delay = self._defer_memory_heartbeat_retry(configuration, now)
            self._log_memory_heartbeat_failure(exc, delay)
            return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if self._pause_for_authentication_failure(configuration, exc):
                return
            delay = self._defer_memory_heartbeat_retry(configuration, now)
            self._log_memory_heartbeat_failure(exc, delay)
            return

        self._memory_heartbeat_failure_count = 0
        self._memory_heartbeat_next_at = now + self._memory_heartbeat_interval(
            configuration
        )
        for key in acknowledged:
            self._memory_snapshot_verified_at[key] = now
        missing = set(expected) - acknowledged
        for key in missing:
            # A missing CAS acknowledgement means the Cloud writer epoch,
            # route, or revision moved.  Invalidate only that scope so the
            # next drain repairs it with one full anti-entropy snapshot.
            self._memory_snapshot_revisions.pop(key, None)
            self._memory_snapshot_verified_at.pop(key, None)
            self._memory_writer_epochs.pop(key, None)
            ready.discard(key)
        if missing:
            logger.debug(
                "Cloud Memory heartbeat requested full repair for %d scope(s)",
                len(missing),
            )
            self.notify()

    @staticmethod
    def _memory_heartbeat_interval(
        configuration: CloudSyncConfiguration,
    ) -> float:
        digest = hashlib.sha256(
            configuration.desktop_instance_id.encode("utf-8")
        ).digest()
        return 25.0 + float(digest[0] % 11)

    def _defer_memory_heartbeat_retry(
        self,
        configuration: CloudSyncConfiguration,
        now: float,
    ) -> float:
        self._memory_heartbeat_failure_count += 1
        delay = min(
            5.0 * (2 ** min(self._memory_heartbeat_failure_count - 1, 6)),
            self._max_retry_seconds,
        )
        digest = hashlib.sha256(
            configuration.desktop_instance_id.encode("utf-8")
        ).digest()
        jitter = (float(digest[1]) / 255.0) * min(5.0, delay * 0.2)
        delay += jitter
        self._memory_heartbeat_next_at = now + delay
        return delay

    def _log_memory_heartbeat_failure(
        self,
        exc: Exception,
        delay: float,
    ) -> None:
        if self._memory_heartbeat_failure_count <= 2:
            logger.warning(
                "Cloud Memory heartbeat failed (%s); retrying in %.1fs",
                type(exc).__name__,
                delay,
            )
            return
        logger.exception(
            "Cloud Memory heartbeat repeatedly failed; retrying in %.1fs",
            delay,
            exc_info=exc,
        )

    def _log_memory_snapshot_failure(
        self,
        key: tuple[str, str],
        exc: Exception,
        delay: float,
        *,
        operation: str = "snapshot sync",
    ) -> None:
        attempts = self._memory_snapshot_failure_counts.get(key, 0)
        if isinstance(exc, httpx.ConnectTimeout) and attempts <= 2:
            logger.warning(
                "Cloud Memory %s timed out for %s/%s; retrying in %.1fs",
                operation,
                key[0],
                key[1],
                delay,
            )
            return
        logger.exception(
            "Cloud Memory %s failed for %s/%s; retrying in %.1fs",
            operation,
            key[0],
            key[1],
            delay,
            exc_info=exc,
        )

    def _defer_memory_snapshot_retry(
        self,
        key: tuple[str, str],
        revision: int,
    ) -> float:
        attempts = self._memory_snapshot_failure_counts.get(key, 0) + 1
        delay = min(2 ** min(attempts, 8), self._max_retry_seconds)
        self._memory_snapshot_failure_counts[key] = attempts
        self._memory_snapshot_failed_revisions[key] = revision
        self._memory_snapshot_retry_after[key] = time.monotonic() + delay
        return delay

    def _clear_memory_snapshot_failure(
        self,
        key: tuple[str, str],
    ) -> None:
        self._memory_snapshot_failure_counts.pop(key, None)
        self._memory_snapshot_failed_revisions.pop(key, None)
        self._memory_snapshot_retry_after.pop(key, None)

    @staticmethod
    def _timestamp(value: Any) -> float:
        if isinstance(value, (int, float)):
            return float(value)
        if not isinstance(value, str):
            raise RunEventSyncProtocolError("Run sync timestamp is invalid")
        try:
            return datetime.fromisoformat(
                value.replace("Z", "+00:00")
            ).timestamp()
        except ValueError as exc:
            raise RunEventSyncProtocolError(
                "Run sync timestamp is invalid"
            ) from exc

    @classmethod
    def _cloud_event_from_payload(
        cls,
        project_id: str,
        raw: Any,
    ) -> CloudRunEventReplica:
        if not isinstance(raw, dict) or not isinstance(
            raw.get("payload"), dict
        ):
            raise RunEventSyncProtocolError("invalid canonical Run event")
        try:
            return CloudRunEventReplica(
                event_id=str(raw["event_id"]),
                project_id=str(raw.get("project_id") or project_id),
                run_id=str(raw["run_id"]),
                run_sequence=int(raw["run_sequence"]),
                run_version=int(raw["run_version"]),
                cloud_cursor=int(raw["cloud_cursor"]),
                event_type=str(raw["event_type"]),
                payload=dict(raw["payload"]),
                legacy_step=(
                    str(raw["legacy_step"])
                    if raw.get("legacy_step") is not None
                    else None
                ),
                created_at=cls._timestamp(raw["created_at"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise RunEventSyncProtocolError(
                "invalid canonical Run event"
            ) from exc

    @classmethod
    def _cloud_run_from_payload(cls, raw: Any) -> CloudRunReplica:
        if not isinstance(raw, dict):
            raise RunEventSyncProtocolError("invalid canonical Run")
        try:
            return CloudRunReplica(
                run_id=str(raw["run_id"]),
                status=str(raw["status"]),
                expected_next_run_sequence=int(
                    raw["expected_next_run_sequence"]
                ),
                updated_at=cls._timestamp(raw["updated_at"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise RunEventSyncProtocolError("invalid canonical Run") from exc

    async def _run(self) -> None:
        while not self._closed:
            self._wake.clear()
            try:
                await self.drain_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Unexpected CloudSyncWorker drain failure")
            try:
                await asyncio.wait_for(
                    self._wake.wait(),
                    timeout=self._poll_interval_seconds,
                )
            except TimeoutError:
                pass

    async def _sync_memory_batch(
        self,
        batch: MemoryMutationSyncBatch,
        configuration: CloudSyncConfiguration,
    ) -> int:
        ingest_memory = getattr(
            self._transport, "ingest_memory_mutations", None
        )
        if not callable(ingest_memory):
            await self._retry_memory_batch(
                batch, "Memory sync transport is unavailable"
            )
            return 0
        payload = {
            "scope_type": batch.scope_type,
            "scope_id": batch.scope_id,
            "scope": batch.scope,
            "source_revision": batch.source_revision,
            "mutations": [item.payload for item in batch.items],
        }
        try:
            response = await ingest_memory(configuration, payload)
            self._resume_after_authentication_success(configuration)
            if (
                response.get("scope_type") != batch.scope_type
                or response.get("scope_id") != batch.scope_id
            ):
                raise RunEventSyncProtocolError(
                    "Memory mutation response scope does not match request"
                )
            items = response.get("items")
            if not isinstance(items, list) or len(items) != len(batch.items):
                raise RunEventSyncProtocolError(
                    "Memory mutation response item count does not match request"
                )
            for expected, item in zip(batch.items, items, strict=True):
                if (
                    not isinstance(item, dict)
                    or item.get("mutation_id") != expected.mutation_id
                    or not isinstance(item.get("inserted"), bool)
                    or item.get("scope_revision")
                    != expected.payload.get("scope_revision")
                ):
                    raise RunEventSyncProtocolError(
                        f"Invalid Memory acknowledgement for {expected.mutation_id}"
                    )
            await asyncio.to_thread(
                self._journal.mark_memory_mutation_batch_sent, batch
            )
            return len(batch.items)
        except RunEventSyncHttpError as exc:
            if self._pause_for_authentication_failure(configuration, exc):
                await self._retry_memory_batch(batch, str(exc))
                return 0
            if self._is_permanent_event_error(exc.status_code):
                await self._block_memory_batch(
                    batch,
                    self._failed_memory_mutation_id(exc.detail, batch),
                    str(exc),
                )
            else:
                await self._retry_memory_batch(batch, str(exc))
        except OutboxLeaseLostError:
            logger.debug(
                "Ignoring stale Memory sync result after lease handoff",
                extra={
                    "scope_type": batch.scope_type,
                    "scope_id": batch.scope_id,
                },
            )
        except (
            httpx.HTTPError,
            RunEventSyncProtocolError,
            RunSyncInfrastructureError,
        ) as exc:
            self._pause_for_authentication_failure(configuration, exc)
            await self._retry_memory_batch(batch, str(exc))
        except Exception as exc:
            self._pause_for_authentication_failure(configuration, exc)
            await self._retry_memory_batch(
                batch, f"{type(exc).__name__}: {exc}"
            )
        return 0

    async def _retry_memory_batch(
        self,
        batch: MemoryMutationSyncBatch,
        error: str,
    ) -> None:
        delay = min(
            2 ** min(batch.attempt_count + 1, 8),
            self._max_retry_seconds,
        )
        try:
            await asyncio.to_thread(
                self._journal.retry_memory_mutation_batch,
                batch,
                error=error,
                next_attempt_at=time.time() + delay,
            )
        except OutboxLeaseLostError:
            logger.debug("Retry result lost its Memory sync lease")

    async def _block_memory_batch(
        self,
        batch: MemoryMutationSyncBatch,
        failed_mutation_id: str,
        error: str,
    ) -> None:
        try:
            await asyncio.to_thread(
                self._journal.block_memory_mutation_batch,
                batch,
                failed_mutation_id=failed_mutation_id,
                error=error,
            )
        except OutboxLeaseLostError:
            logger.debug("Permanent error lost its Memory sync lease")
            return
        logger.error(
            "Memory sync scope blocked by permanent mutation error",
            extra={
                "scope_type": batch.scope_type,
                "scope_id": batch.scope_id,
                "mutation_id": failed_mutation_id,
                "error": error,
            },
        )

    @staticmethod
    def _failed_memory_mutation_id(
        detail: Any,
        batch: MemoryMutationSyncBatch,
    ) -> str:
        body = detail.get("detail", detail) if isinstance(detail, dict) else {}
        candidate = body.get("mutation_id") if isinstance(body, dict) else None
        mutation_ids = {item.mutation_id for item in batch.items}
        if candidate in mutation_ids:
            return str(candidate)
        if isinstance(body, list):
            for validation_error in body:
                location = (
                    validation_error.get("loc")
                    if isinstance(validation_error, dict)
                    else None
                )
                if not isinstance(location, (list, tuple)):
                    continue
                try:
                    marker = location.index("mutations")
                    index = location[marker + 1]
                except (ValueError, IndexError):
                    continue
                if isinstance(index, int) and 0 <= index < len(batch.items):
                    return batch.items[index].mutation_id
        return batch.items[0].mutation_id

    async def _sync_batch(
        self,
        batch: RunEventSyncBatch,
        configuration: CloudSyncConfiguration,
    ) -> int:
        payload = {
            "project_id": batch.project_id,
            "run_id": batch.run_id,
            "events": [
                {
                    "event_id": event.event_id,
                    "run_sequence": event.sequence,
                    "run_version": event.run_version,
                    "event_type": event.event_type,
                    "payload": _cloud_event_payload(
                        event.event_type, event.payload
                    ),
                    "legacy_step": event.legacy_step,
                    "created_at": datetime.fromtimestamp(
                        event.created_at,
                        tz=UTC,
                    ).isoformat(),
                }
                for event in batch.events
            ],
        }
        try:
            response = await self._transport.ingest(configuration, payload)
            self._resume_after_authentication_success(configuration)
            self._validate_response(batch, response)
            await asyncio.to_thread(
                self._journal.mark_outbox_batch_sent,
                batch,
            )
            return len(batch.events)
        except RunEventSyncHttpError as exc:
            if self._pause_for_authentication_failure(configuration, exc):
                await self._mark_retry(batch, str(exc))
                return 0
            if self._is_permanent_event_error(exc.status_code):
                failed_event_id = self._failed_event_id(exc.detail, batch)
                await self._mark_blocked(batch, failed_event_id, str(exc))
            else:
                await self._mark_retry(batch, str(exc))
        except OutboxLeaseLostError:
            logger.debug(
                "Ignoring stale Run sync result after lease handoff",
                extra={"run_id": batch.run_id},
            )
        except (
            httpx.HTTPError,
            RunEventSyncProtocolError,
            RunSyncInfrastructureError,
        ) as exc:
            self._pause_for_authentication_failure(configuration, exc)
            await self._mark_retry(batch, str(exc))
        except Exception as exc:
            # Transport implementations may expose library-specific network
            # exceptions. Unknown failures remain retryable; only explicit HTTP
            # domain validation can poison a Run lane.
            self._pause_for_authentication_failure(configuration, exc)
            await self._mark_retry(batch, f"{type(exc).__name__}: {exc}")
        return 0

    async def _mark_retry(
        self,
        batch: RunEventSyncBatch,
        error: str,
    ) -> None:
        delay = min(
            2 ** min(batch.attempt_count + 1, 8),
            self._max_retry_seconds,
        )
        try:
            await asyncio.to_thread(
                self._journal.retry_outbox_batch,
                batch,
                error=error,
                next_attempt_at=time.time() + delay,
            )
        except OutboxLeaseLostError:
            logger.debug(
                "Retry result lost its Run sync lease",
                extra={"run_id": batch.run_id},
            )

    async def _mark_blocked(
        self,
        batch: RunEventSyncBatch,
        failed_event_id: str,
        error: str,
    ) -> None:
        try:
            await asyncio.to_thread(
                self._journal.block_outbox_batch,
                batch,
                failed_event_id=failed_event_id,
                error=error,
            )
        except OutboxLeaseLostError:
            logger.debug(
                "Permanent error lost its Run sync lease",
                extra={"run_id": batch.run_id},
            )
            return
        logger.error(
            "Run event sync blocked by permanent event error",
            extra={
                "run_id": batch.run_id,
                "event_id": failed_event_id,
                "error": error,
            },
        )

    @staticmethod
    def _is_permanent_event_error(status_code: int) -> bool:
        return status_code in {400, 409, 413, 422}

    @staticmethod
    def _failed_event_id(
        detail: Any,
        batch: RunEventSyncBatch,
    ) -> str:
        body = detail.get("detail", detail) if isinstance(detail, dict) else {}
        candidate = (
            body.get("first_failed_event_id")
            if isinstance(body, dict)
            else None
        )
        event_ids = {event.event_id for event in batch.events}
        if candidate in event_ids:
            return candidate
        # FastAPI/Pydantic request validation reports the batch item as
        # loc=["body", "events", index, ...]. Preserve that precise poison
        # boundary instead of incorrectly dead-lettering the FIFO head.
        if isinstance(body, list):
            for validation_error in body:
                if not isinstance(validation_error, dict):
                    continue
                location = validation_error.get("loc")
                if not isinstance(location, (list, tuple)):
                    continue
                try:
                    marker = location.index("events")
                    index = location[marker + 1]
                except (ValueError, IndexError):
                    continue
                if isinstance(index, int) and 0 <= index < len(batch.events):
                    return batch.events[index].event_id
        return batch.events[0].event_id

    @staticmethod
    def _validate_response(
        batch: RunEventSyncBatch,
        response: dict[str, Any],
    ) -> None:
        if (
            response.get("project_id") != batch.project_id
            or response.get("run_id") != batch.run_id
        ):
            raise RunEventSyncProtocolError(
                "Run event ingest response scope does not match request"
            )
        items = response.get("items")
        if not isinstance(items, list) or len(items) != len(batch.events):
            raise RunEventSyncProtocolError(
                "Run event ingest response item count does not match request"
            )
        expected_next = response.get("expected_next_run_sequence")
        if (
            not isinstance(expected_next, int)
            or expected_next <= batch.events[-1].sequence
        ):
            raise RunEventSyncProtocolError(
                "Run event ingest response has an invalid next sequence"
            )
        for event, item in zip(batch.events, items, strict=True):
            if (
                not isinstance(item, dict)
                or item.get("event_id") != event.event_id
                or item.get("run_sequence") != event.sequence
                or item.get("run_version") != event.run_version
                or not isinstance(item.get("cloud_cursor"), int)
                or item["cloud_cursor"] < 1
                or not isinstance(item.get("inserted"), bool)
            ):
                raise RunEventSyncProtocolError(
                    f"Invalid ingest acknowledgement for {event.event_id}"
                )

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._wake.set()
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        artifact_tasks = tuple(self._artifact_tasks)
        self._artifact_tasks.clear()
        for artifact_task in artifact_tasks:
            artifact_task.cancel()
        if artifact_tasks:
            await asyncio.gather(*artifact_tasks, return_exceptions=True)
        await self._transport.close()
