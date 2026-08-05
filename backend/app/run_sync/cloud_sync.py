"""Durable per-Run FIFO replication from SQLite to the Cloud API."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

import httpx

from app.run_journal import (
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


class RunEventSyncTransport(Protocol):
    async def ingest(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
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

    async def ingest(
        self,
        configuration: CloudSyncConfiguration,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        response = await self._client.post(
            configuration.endpoint_url,
            json=payload,
            headers={
                "Authorization": configuration.authorization,
                "X-Desktop-Instance-ID": configuration.desktop_instance_id,
            },
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
                "Run event ingest returned non-JSON success response"
            ) from exc
        if not isinstance(result, dict):
            raise RunEventSyncProtocolError(
                "Run event ingest response must be a JSON object"
            )
        return result

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

    def configure(self, configuration: CloudSyncConfiguration) -> None:
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
