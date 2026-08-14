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
import copy
import logging
import mimetypes
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path, PurePath
from typing import Any, Protocol
from urllib.parse import quote, urlsplit

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

logger = logging.getLogger("run_sync")


def _cloud_resource_label(value: Any) -> str:
    resource = str(value)
    parsed = urlsplit(resource)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    if resource.startswith(("/", "~", "\\\\")) or re.match(
        r"^[A-Za-z]:[\\\\/]", resource
    ):
        normalized_path = resource.replace("\\", "/")
        return f"[local]/{PurePath(normalized_path).name}"
    return resource


def _cloud_event_payload(
    event_type: str, payload: dict[str, Any]
) -> dict[str, Any]:
    """Project a local canonical event into its Cloud-safe representation."""

    projected = copy.deepcopy(payload)
    if event_type.startswith("artifact."):
        projected.pop("path", None)
        projected["localPathAvailable"] = False
        artifacts = projected.get("artifacts")
        if isinstance(artifacts, list):
            for artifact in artifacts:
                if isinstance(artifact, dict):
                    artifact.pop("path", None)
                    artifact["localPathAvailable"] = False
        return projected
    if event_type != "approval.requested":
        return projected
    prompt = projected.get("prompt")
    if not isinstance(prompt, dict):
        return projected
    resources = prompt.get("target_resources")
    if isinstance(resources, list):
        prompt["target_resources"] = [
            _cloud_resource_label(item) for item in resources
        ]
    action = prompt.get("action")
    if isinstance(action, dict):
        # The digest is computed and persisted from the full trusted local
        # descriptor. Remote display never needs raw tool arguments, file
        # contents, query strings, or absolute paths.
        action.pop("normalized_arguments", None)
        action_resources = action.get("target_resources")
        if isinstance(action_resources, list):
            action["target_resources"] = [
                _cloud_resource_label(item) for item in action_resources
            ]
    matcher = prompt.get("rule_matcher")
    if isinstance(matcher, dict) and isinstance(
        matcher.get("resource_pattern"), str
    ):
        matcher["resource_pattern"] = _cloud_resource_label(
            matcher["resource_pattern"]
        )
    return projected


@dataclass(frozen=True)
class CloudSyncConfiguration:
    endpoint_url: str
    authorization: str = field(repr=False)
    desktop_instance_id: str


class RunEventSyncHttpError(RuntimeError):
    def __init__(self, status_code: int, detail: Any) -> None:
        super().__init__(
            f"Run event ingest returned HTTP {status_code}: {detail}"
        )
        self.status_code = status_code
        self.detail = detail


class RunEventSyncProtocolError(RuntimeError):
    pass


class RunSyncInfrastructureError(RuntimeError):
    """A device/route control-plane failure, never a poison Run event."""


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

    async def claim_memory_writer(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
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
        timeout_seconds: float = 15.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            timeout=timeout_seconds,
            transport=transport,
        )
        self._registered_devices: set[tuple[str, str]] = set()
        self._claimed_routes: set[tuple[str, str, str]] = set()
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
        return result

    async def _ensure_device(
        self,
        configuration: CloudSyncConfiguration,
    ) -> None:
        base = self._sync_base(configuration)
        device_key = (base, configuration.desktop_instance_id)
        if device_key in self._registered_devices:
            return
        async with self._registration_lock:
            if device_key in self._registered_devices:
                return
            try:
                await self._json_request(
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
                raise RunSyncInfrastructureError(str(exc)) from exc
            self._registered_devices.add(device_key)

    async def _ensure_device_and_route(
        self,
        configuration: CloudSyncConfiguration,
        project_id: str,
    ) -> None:
        base = self._sync_base(configuration)
        device_key = (base, configuration.desktop_instance_id)
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
                    raise RunSyncInfrastructureError(str(exc)) from exc
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
        with path.open("rb") as file_handle:
            response = await self._client.post(
                f"{api_base}/chat/files/upload",
                headers=self._headers(configuration),
                data={
                    "task_id": item.run_id,
                    "client_request_id": item.artifact_id,
                },
                files={
                    "file": (item.filename, file_handle, content_type),
                },
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
        self._memory_snapshot_revisions: dict[tuple[str, str], int] = {}
        self._memory_snapshot_verified_at: dict[tuple[str, str], float] = {}

    def configure(self, configuration: CloudSyncConfiguration) -> None:
        if configuration != self._configuration:
            self._bootstrap_pending = True
            self._bootstrap_attempt_count = 0
            self._bootstrap_next_attempt_at = 0.0
            self._memory_snapshot_revisions.clear()
            self._memory_snapshot_verified_at.clear()
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

    async def drain_once(self) -> int:
        configuration = self._configuration
        if configuration is None:
            return 0
        if (
            self._bootstrap_pending
            and time.monotonic() >= self._bootstrap_next_attempt_at
        ):
            try:
                await self.bootstrap_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                # Restore freshness must not block the durable outbound lane.
                # Keep the flag set so the normal poll loop retries.
                logger.exception("Cloud Run history bootstrap failed")
        memory_count = 0
        memory_snapshot_ready: set[tuple[str, str]] = set()
        if not self._bootstrap_pending:
            memory_snapshot_ready = (
                await self._sync_memory_snapshots_if_changed(configuration)
            )
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
        artifact_count = 0
        artifact_uploads = await asyncio.to_thread(
            self._journal.claim_ready_artifact_uploads,
            limit=self._max_parallel_runs,
            lease_seconds=max(self._lease_seconds, 60.0),
        )
        if artifact_uploads:
            artifact_results = await asyncio.gather(
                *(
                    self._sync_artifact_upload(item, configuration)
                    for item in artifact_uploads
                )
            )
            artifact_count = sum(artifact_results)
        batches = await asyncio.to_thread(
            self._journal.claim_ready_outbox_batches,
            max_runs=self._max_parallel_runs,
            batch_size=self._batch_size,
            lease_seconds=self._lease_seconds,
        )
        if not batches:
            if artifact_uploads:
                self.notify()
            return memory_count + artifact_count
        results = await asyncio.gather(
            *(self._sync_batch(batch, configuration) for batch in batches)
        )
        # Drain another slice without waiting when more Runs or events are ready.
        self.notify()
        return memory_count + artifact_count + sum(results)

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
            await self._retry_artifact_upload(item, str(exc))
            return 0
        self.notify()
        return 1

    async def _retry_artifact_upload(
        self,
        item: ArtifactUploadSyncItem,
        error: str,
    ) -> None:
        delay = min(
            2 ** min(item.attempt_count + 1, 8),
            self._max_retry_seconds,
        )
        await asyncio.to_thread(
            self._journal.retry_artifact_upload,
            item,
            error=error,
            next_attempt_at=time.time() + delay,
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

    async def _sync_memory_snapshots_if_changed(
        self,
        configuration: CloudSyncConfiguration,
    ) -> set[tuple[str, str]]:
        put_snapshot = getattr(self._transport, "put_memory_snapshot", None)
        if not callable(put_snapshot):
            return set()
        snapshots = await asyncio.to_thread(
            self._journal.list_memory_sync_snapshots
        )
        ready: set[tuple[str, str]] = set()
        now = time.monotonic()
        for snapshot in snapshots:
            key = (str(snapshot["scope_type"]), str(snapshot["scope_id"]))
            revision = int(snapshot["revision"])
            if (
                self._memory_snapshot_revisions.get(key) == revision
                and now - self._memory_snapshot_verified_at.get(key, 0.0)
                < 30.0
            ):
                ready.add(key)
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
                detail = (
                    exc.detail.get("detail", exc.detail)
                    if isinstance(exc.detail, dict)
                    else {}
                )
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
                            await asyncio.to_thread(
                                self._journal.merge_cloud_memory_baseline,
                                scope_type=key[0],
                                scope_id=key[1],
                                scope=baseline_scope,
                                entries=baseline_entries,
                            )
                            refreshed = next(
                                (
                                    item
                                    for item in await asyncio.to_thread(
                                        self._journal.list_memory_sync_snapshots
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
                    except Exception:
                        logger.exception(
                            "Cloud Memory writer transfer failed for %s/%s",
                            *key,
                        )
                        continue
                else:
                    logger.exception(
                        "Cloud Memory snapshot sync failed for %s/%s", *key
                    )
                    continue
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(
                    "Cloud Memory snapshot sync failed for %s/%s", *key
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
            except asyncio.CancelledError:
                raise
            except Exception:
                # Scope isolation is deliberate: one malformed or stale scope
                # must not stop unrelated Memory outboxes from draining.
                logger.exception(
                    "Cloud Memory snapshot sync failed for %s/%s", *key
                )
                continue
            self._memory_snapshot_revisions[key] = revision
            self._memory_snapshot_verified_at[key] = now
            ready.add(key)
        return ready

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
            if self._is_permanent_event_error(exc.status_code):
                await self._block_memory_batch(
                    batch,
                    self._failed_memory_mutation_id(exc.detail, batch),
                    str(exc),
                )
            else:
                await self._retry_memory_batch(batch, str(exc))
        except OutboxLeaseLostError:
            logger.info(
                "Ignoring stale Memory sync result after lease handoff",
                extra={
                    "scope_type": batch.scope_type,
                    "scope_id": batch.scope_id,
                },
            )
        except (httpx.HTTPError, RunEventSyncProtocolError) as exc:
            await self._retry_memory_batch(batch, str(exc))
        except Exception as exc:
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
            logger.info("Retry result lost its Memory sync lease")

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
            logger.info("Permanent error lost its Memory sync lease")
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
            self._validate_response(batch, response)
            await asyncio.to_thread(
                self._journal.mark_outbox_batch_sent,
                batch,
            )
            return len(batch.events)
        except RunEventSyncHttpError as exc:
            if self._is_permanent_event_error(exc.status_code):
                failed_event_id = self._failed_event_id(exc.detail, batch)
                await self._mark_blocked(batch, failed_event_id, str(exc))
            else:
                await self._mark_retry(batch, str(exc))
        except OutboxLeaseLostError:
            logger.info(
                "Ignoring stale Run sync result after lease handoff",
                extra={"run_id": batch.run_id},
            )
        except (httpx.HTTPError, RunEventSyncProtocolError) as exc:
            await self._mark_retry(batch, str(exc))
        except Exception as exc:
            # Transport implementations may expose library-specific network
            # exceptions. Unknown failures remain retryable; only explicit HTTP
            # domain validation can poison a Run lane.
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
            logger.info(
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
            logger.info(
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
        await self._transport.close()
