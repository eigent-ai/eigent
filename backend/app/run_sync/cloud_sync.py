"""Durable per-Run FIFO replication from SQLite to the Cloud API."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol
from urllib.parse import quote

import httpx

from app.run_journal import (
    CloudRunEventReplica,
    CloudRunReplica,
    OutboxLeaseLostError,
    RunEventSyncBatch,
    SQLiteRunJournal,
)

logger = logging.getLogger("run_sync")


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
            "?event_limit=1",
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

    def configure(self, configuration: CloudSyncConfiguration) -> None:
        if configuration != self._configuration:
            self._bootstrap_pending = True
            self._bootstrap_attempt_count = 0
            self._bootstrap_next_attempt_at = 0.0
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
        batches = await asyncio.to_thread(
            self._journal.claim_ready_outbox_batches,
            max_runs=self._max_parallel_runs,
            batch_size=self._batch_size,
            lease_seconds=self._lease_seconds,
        )
        if not batches:
            return 0
        results = await asyncio.gather(
            *(self._sync_batch(batch, configuration) for batch in batches)
        )
        # Drain another slice without waiting when more Runs or events are ready.
        self.notify()
        return sum(results)

    async def bootstrap_once(self) -> tuple[str, ...]:
        """Synchronously repair the local read replica once per credential set.

        Returns the project ids whose restore failed this cycle; they stay
        pending and are retried on the next bootstrap attempt.
        """

        configuration = self._configuration
        if (
            configuration is None
            or not self._bootstrap_pending
            or time.monotonic() < self._bootstrap_next_attempt_at
        ):
            return ()
        async with self._bootstrap_lock:
            configuration = self._configuration
            if (
                configuration is None
                or not self._bootstrap_pending
                or time.monotonic() < self._bootstrap_next_attempt_at
            ):
                return ()
            try:
                failed_project_ids = await self._bootstrap_history(
                    configuration
                )
            except Exception:
                self._bootstrap_attempt_count += 1
                self._bootstrap_next_attempt_at = time.monotonic() + min(
                    2 ** min(self._bootstrap_attempt_count, 8),
                    self._max_retry_seconds,
                )
                raise
            if failed_project_ids:
                # Partial success: healthy projects were restored, poisoned
                # ones retry with backoff instead of blocking the whole set.
                self._bootstrap_attempt_count += 1
                self._bootstrap_next_attempt_at = time.monotonic() + min(
                    2 ** min(self._bootstrap_attempt_count, 8),
                    self._max_retry_seconds,
                )
            return failed_project_ids

    async def _bootstrap_history(
        self,
        configuration: CloudSyncConfiguration,
    ) -> tuple[str, ...]:
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
            return ()
        projects_response = await list_projects(configuration)
        project_items = projects_response.get("items")
        if not isinstance(project_items, list):
            raise RunEventSyncProtocolError(
                "Run sync project list must contain an items array"
            )
        failed_project_ids: list[str] = []
        for item in project_items:
            if (
                not isinstance(item, dict)
                or not str(item.get("project_id") or "").strip()
            ):
                raise RunEventSyncProtocolError(
                    "invalid Run sync project descriptor"
                )
            project_id = str(item["project_id"])
            try:
                await self._bootstrap_project(
                    configuration,
                    project_id,
                    project_snapshot=project_snapshot,
                    list_events=list_events,
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                # One poisoned project must not block restoring the others.
                # It stays pending and retries on the next bootstrap cycle.
                logger.exception(
                    "Cloud Run history bootstrap failed for project %s",
                    project_id,
                )
                failed_project_ids.append(project_id)
        if not failed_project_ids and self._configuration == configuration:
            self._bootstrap_pending = False
            self._bootstrap_attempt_count = 0
            self._bootstrap_next_attempt_at = 0.0
        return tuple(failed_project_ids)

    async def _bootstrap_project(
        self,
        configuration: CloudSyncConfiguration,
        project_id: str,
        *,
        project_snapshot: Any,
        list_events: Any,
    ) -> None:
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
                    "payload": event.payload,
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
