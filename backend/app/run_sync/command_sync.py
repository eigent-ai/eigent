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

"""Durable Desktop command Inbox and independent command-result sync lane."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from datetime import UTC, datetime
from typing import Any

import httpx

from app.run_journal import (
    CommandResultSyncBatch,
    OutboxLeaseLostError,
    RemoteCommandInboxRecord,
    SQLiteRunJournal,
)
from app.run_sync.cloud_sync import (
    CloudSyncConfiguration,
    RunEventSyncHttpError,
    RunEventSyncProtocolError,
    _is_authentication_sync_error,
    _raise_for_application_error,
    _sync_error_code,
)

logger = logging.getLogger("command_sync")

_EXECUTABLE_INBOX_STATES = frozenset({"received", "dispatched"})


class CommandSyncInfrastructureError(RuntimeError):
    """Device registration failure, not a poison command result event."""

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


def _timestamp(value: str | float | int) -> float:
    if isinstance(value, (float, int)):
        return float(value)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.timestamp()


class HttpCommandSyncTransport:
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
        self._registered: set[tuple[str, str, str]] = set()
        self._lock = asyncio.Lock()

    @staticmethod
    def _base(configuration: CloudSyncConfiguration) -> str:
        return configuration.endpoint_url.rsplit("/", 1)[0]

    @staticmethod
    def _headers(
        configuration: CloudSyncConfiguration,
    ) -> dict[str, str]:
        return {
            "Authorization": configuration.authorization,
            "X-Desktop-Instance-ID": configuration.desktop_instance_id,
        }

    async def _request(
        self,
        method: str,
        url: str,
        configuration: CloudSyncConfiguration,
        *,
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
                "Command sync returned non-JSON success response"
            ) from exc
        if not isinstance(result, dict):
            raise RunEventSyncProtocolError(
                "Command sync response must be a JSON object"
            )
        _raise_for_application_error(result, status_code=response.status_code)
        return result

    async def ensure_registered(
        self, configuration: CloudSyncConfiguration
    ) -> None:
        authorization_digest = hashlib.sha256(
            configuration.authorization.encode("utf-8")
        ).hexdigest()
        key = (
            self._base(configuration),
            configuration.desktop_instance_id,
            authorization_digest,
        )
        if key in self._registered:
            return
        async with self._lock:
            if key in self._registered:
                return
            try:
                await self._request(
                    "POST",
                    f"{key[0]}/devices/register",
                    configuration,
                    payload={
                        "capabilities": {
                            "durable_command_control": 1,
                            "command_inbox": 1,
                            "command_result_sync": 1,
                        }
                    },
                )
            except RunEventSyncHttpError as exc:
                raise CommandSyncInfrastructureError(
                    str(exc), code=exc.application_code
                ) from exc
            self._registered.add(key)

    async def pull_pending(
        self, configuration: CloudSyncConfiguration, *, limit: int
    ) -> list[dict[str, Any]]:
        await self.ensure_registered(configuration)
        result = await self._request(
            "GET",
            f"{self._base(configuration)}/commands/pending?limit={limit}",
            configuration,
        )
        items = result.get("items")
        if not isinstance(items, list):
            raise RunEventSyncProtocolError(
                "Pending command response must contain an items array"
            )
        return [item for item in items if isinstance(item, dict)]

    async def confirm_receipt(
        self,
        configuration: CloudSyncConfiguration,
        command: RemoteCommandInboxRecord,
    ) -> dict[str, Any]:
        await self.ensure_registered(configuration)
        return await self._request(
            "POST",
            f"{self._base(configuration)}/commands/{command.command_id}/confirm-receipt",
            configuration,
            payload={
                "event_id": command.receipt_event_id,
                "desktop_event_sequence": 1,
                "occurred_at": datetime.fromtimestamp(
                    command.created_at, tz=UTC
                ).isoformat(),
                "lease_token": command.delivery_lease_token,
            },
        )

    async def ingest_events(
        self,
        configuration: CloudSyncConfiguration,
        batch: CommandResultSyncBatch,
    ) -> dict[str, Any]:
        await self.ensure_registered(configuration)
        return await self._request(
            "POST",
            f"{self._base(configuration)}/commands/{batch.command_id}/events",
            configuration,
            payload={
                "delivery_lease_token": batch.delivery_lease_token,
                "events": [
                    {
                        "event_id": event.event_id,
                        "desktop_event_sequence": event.command_event_sequence,
                        "event_type": event.event_type,
                        "payload": event.payload,
                        "occurred_at": datetime.fromtimestamp(
                            event.occurred_at, tz=UTC
                        ).isoformat(),
                    }
                    for event in batch.events
                ],
            },
        )

    async def close(self) -> None:
        await self._client.aclose()


class CommandControlWorker:
    def __init__(
        self,
        journal: SQLiteRunJournal,
        transport: HttpCommandSyncTransport,
        *,
        max_commands: int = 8,
        batch_size: int = 100,
        poll_interval_seconds: float = 1.0,
        max_retry_seconds: float = 300.0,
    ) -> None:
        self._journal = journal
        self._transport = transport
        self._max_commands = max_commands
        self._batch_size = batch_size
        self._poll_interval_seconds = poll_interval_seconds
        self._max_retry_seconds = max_retry_seconds
        self._configuration: CloudSyncConfiguration | None = None
        self._wake = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._closed = False
        self._inbound_retry_attempt = 0
        self._next_inbound_attempt_at = 0.0
        self._auth_paused_configuration: CloudSyncConfiguration | None = None
        self._auth_pause_code: str | None = None
        self._auth_retry_at = 0.0

    def configure(self, configuration: CloudSyncConfiguration) -> None:
        if configuration != self._configuration:
            self._inbound_retry_attempt = 0
            self._next_inbound_attempt_at = 0.0
            self._auth_paused_configuration = None
            self._auth_pause_code = None
            self._auth_retry_at = 0.0
        self._configuration = configuration
        self.notify()

    def start(self) -> None:
        if self._closed:
            raise RuntimeError("CommandControlWorker is closed")
        if self._task is None:
            self._task = asyncio.create_task(
                self._run(), name="remote-command-control"
            )
        self.notify()

    def notify(self) -> None:
        if not self._closed:
            self._wake.set()

    async def persist_command(
        self, command: dict[str, Any]
    ) -> RemoteCommandInboxRecord:
        project_id = str(
            command.get("target_project_id") or command.get("project_id")
        )
        run_id = command.get("target_task_id") or command.get("run_id")
        expires_at = _timestamp(command["expires_at"])
        receipt_grace_until = _timestamp(command["receipt_grace_until"])
        canonical_envelope = {
            "id": str(command["id"]),
            "session_id": str(command["session_id"]),
            "user_id": int(command["user_id"]),
            "space_id": command.get("space_id"),
            "project_id": project_id,
            "target_project_id": project_id,
            "active_task_id": command.get("active_task_id"),
            "target_task_id": run_id,
            "brain_session_id": command.get("brain_session_id"),
            "target_brain_session_id": command.get("target_brain_session_id"),
            "source_channel": command.get("source_channel", "remote_web"),
            "type": str(command["type"]),
            "payload": dict(command.get("payload") or {}),
            "next_task_id": command.get("next_task_id"),
            "route_version": int(command.get("route_version") or 1),
            "expires_at": expires_at,
            "receipt_grace_until": receipt_grace_until,
            "requires_online_receipt_confirmation": bool(
                command.get("requires_online_receipt_confirmation", False)
            ),
        }
        record = await asyncio.to_thread(
            self._journal.persist_remote_command,
            command_id=str(command["id"]),
            session_id=str(command["session_id"]),
            user_id=int(command["user_id"]),
            project_id=project_id,
            run_id=run_id,
            route_version=int(command.get("route_version") or 1),
            command_type=str(command["type"]),
            payload=canonical_envelope,
            expires_at=expires_at,
            receipt_grace_until=receipt_grace_until,
            requires_online_receipt_confirmation=bool(
                command.get("requires_online_receipt_confirmation", False)
            ),
            delivery_lease_token=command.get("lease_token"),
            receipt_event_id=command.get("receipt_event_id"),
        )
        self.notify()
        return record

    async def confirm_receipt(
        self, command_id: str
    ) -> tuple[RemoteCommandInboxRecord, bool]:
        command = await asyncio.to_thread(
            self._journal.get_remote_command, command_id
        )
        if command is None:
            raise KeyError(command_id)
        if command.receipt_status == "confirmed":
            return command, command.state in _EXECUTABLE_INBOX_STATES
        if command.receipt_status == "expired_late":
            return command, False
        configuration = self._configuration
        if configuration is None:
            # Low-risk commands may proceed during a Cloud outage inside a small
            # skew window. High-risk actions remain gated on the Cloud CAS.
            may_execute = (
                command.state in _EXECUTABLE_INBOX_STATES
                and not command.requires_online_receipt_confirmation
                and time.time() <= command.expires_at + 5
            )
            return command, may_execute
        try:
            response = await self._transport.confirm_receipt(
                configuration, command
            )
        except (
            CommandSyncInfrastructureError,
            httpx.HTTPError,
            RunEventSyncHttpError,
            RunEventSyncProtocolError,
        ) as exc:
            self._pause_for_authentication_failure(configuration, exc)
            logger.exception(
                "Command receipt confirmation failed",
                extra={"command_id": command_id},
            )
            may_execute = (
                command.state in _EXECUTABLE_INBOX_STATES
                and not command.requires_online_receipt_confirmation
                and time.time() <= command.expires_at + 5
            )
            return command, may_execute
        self._resume_after_authentication_success(configuration)
        result = response.get("result")
        status = "expired_late" if result == "expired_late" else "confirmed"
        updated = await asyncio.to_thread(
            self._journal.set_command_receipt_status,
            command_id,
            status,
        )
        return updated, bool(response.get("may_execute")) and (
            updated.state in _EXECUTABLE_INBOX_STATES
        )

    async def drain_once(self) -> int:
        configuration = self._configuration
        if configuration is None:
            return 0
        if (
            configuration == self._auth_paused_configuration
            and time.monotonic() < self._auth_retry_at
        ):
            return 0
        synced = await self._drain_outbound(configuration)
        if (
            configuration == self._auth_paused_configuration
            and time.monotonic() < self._auth_retry_at
        ):
            return synced
        pulled_count = await self._pull_and_reconcile(configuration)
        return synced + pulled_count

    def _pause_for_authentication_failure(
        self,
        configuration: CloudSyncConfiguration,
        exc: BaseException,
    ) -> bool:
        """Pause command pull and result sync until credentials change."""

        if not _is_authentication_sync_error(exc):
            return False
        if configuration != self._configuration:
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
                "Remote command sync paused because authentication was "
                "rejected; durable inbox and result outboxes remain local "
                "and sync will resume after credentials refresh",
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
        logger.debug(
            "Remote command sync resumed after authentication recovered"
        )

    async def _drain_outbound(
        self, configuration: CloudSyncConfiguration
    ) -> int:
        batches = await asyncio.to_thread(
            self._journal.claim_command_result_batches,
            max_commands=self._max_commands,
            batch_size=self._batch_size,
        )
        if not batches:
            return 0
        results = await asyncio.gather(
            *(self._sync_batch(batch, configuration) for batch in batches)
        )
        self.notify()
        return sum(results)

    async def _pull_and_reconcile(
        self, configuration: CloudSyncConfiguration
    ) -> int:
        if time.monotonic() < self._next_inbound_attempt_at:
            return 0
        pulled_count = 0
        try:
            pulled = await self._transport.pull_pending(
                configuration, limit=self._max_commands
            )
        except Exception as exc:
            if self._pause_for_authentication_failure(configuration, exc):
                return 0
            self._inbound_retry_attempt += 1
            delay = min(
                2 ** min(self._inbound_retry_attempt, 8),
                self._max_retry_seconds,
            )
            if isinstance(exc, CommandSyncInfrastructureError):
                error_code = exc.code
            elif isinstance(exc, RunEventSyncHttpError):
                error_code = _sync_error_code(exc.detail)
            else:
                error_code = None
            if error_code == "device_owner_mismatch":
                # This cannot heal through a one-second retry loop. Keep the
                # outbound lane live, but slow the device registration path
                # enough to avoid a local/Cloud request and log storm.
                delay = max(delay, min(60.0, self._max_retry_seconds))
                logger.warning(
                    "Remote command pull paused: Desktop device belongs to "
                    "another account; explicit device transfer or reset is "
                    "required",
                    extra={
                        "error_code": error_code,
                        "retry_in_seconds": delay,
                    },
                )
            else:
                logger.exception(
                    "Remote command pull failed; outbound lane remains live; "
                    "retrying with backoff",
                    extra={"retry_in_seconds": delay},
                )
            self._next_inbound_attempt_at = time.monotonic() + delay
            return 0
        self._resume_after_authentication_success(configuration)
        self._inbound_retry_attempt = 0
        self._next_inbound_attempt_at = 0.0
        for item in pulled:
            try:
                await self.persist_command(
                    {
                        "id": item["command_id"],
                        "session_id": item["session_id"],
                        "user_id": item["user_id"],
                        "project_id": item["project_id"],
                        "run_id": item.get("run_id"),
                        "route_version": item["route_version"],
                        "type": item["command_type"],
                        "payload": item.get("payload") or {},
                        "space_id": item.get("space_id"),
                        "target_task_id": item.get("run_id"),
                        "target_brain_session_id": item.get(
                            "target_brain_session_id"
                        ),
                        "source_channel": item.get("source_channel"),
                        "next_task_id": item.get("next_task_id"),
                        "expires_at": item["expires_at"],
                        "receipt_grace_until": item["receipt_grace_until"],
                        "requires_online_receipt_confirmation": item.get(
                            "requires_online_receipt_confirmation", False
                        ),
                        "lease_token": item.get("lease_token"),
                    }
                )
                pulled_count += 1
            except Exception:
                logger.exception(
                    "Ignoring malformed or conflicting remote command"
                )
        for command in await asyncio.to_thread(
            self._journal.list_reconcilable_commands,
            limit=self._max_commands,
        ):
            if command.receipt_status == "pending":
                try:
                    await self.confirm_receipt(command.command_id)
                except Exception:
                    logger.exception(
                        "Remote command receipt reconciliation failed",
                        extra={"command_id": command.command_id},
                    )
        return pulled_count

    async def _sync_batch(
        self,
        batch: CommandResultSyncBatch,
        configuration: CloudSyncConfiguration,
    ) -> int:
        try:
            response = await self._transport.ingest_events(
                configuration, batch
            )
            self._resume_after_authentication_success(configuration)
            expected = response.get("expected_next_desktop_event_sequence")
            if not isinstance(expected, int):
                raise RunEventSyncProtocolError(
                    "Command ingest omitted expected next sequence"
                )
            await asyncio.to_thread(
                self._journal.mark_command_result_batch_sent, batch
            )
            return len(batch.events)
        except RunEventSyncHttpError as exc:
            if self._pause_for_authentication_failure(configuration, exc):
                await self._retry(batch, str(exc))
                return 0
            if exc.status_code in {400, 409, 413, 422}:
                failed = self._failed_event_id(exc.detail, batch)
                await asyncio.to_thread(
                    self._journal.block_command_result_batch,
                    batch,
                    failed_event_id=failed,
                    error=str(exc),
                )
            else:
                await self._retry(batch, str(exc))
        except OutboxLeaseLostError:
            logger.debug(
                "Ignoring stale command sync result",
                extra={"command_id": batch.command_id},
            )
        except Exception as exc:
            self._pause_for_authentication_failure(configuration, exc)
            await self._retry(batch, f"{type(exc).__name__}: {exc}")
        return 0

    async def _retry(self, batch: CommandResultSyncBatch, error: str) -> None:
        delay = min(
            2 ** min(batch.attempt_count + 1, 8), self._max_retry_seconds
        )
        try:
            await asyncio.to_thread(
                self._journal.retry_command_result_batch,
                batch,
                error=error,
                next_attempt_at=time.time() + delay,
            )
        except OutboxLeaseLostError:
            logger.debug("Command retry lost its lease")

    @staticmethod
    def _failed_event_id(detail: Any, batch: CommandResultSyncBatch) -> str:
        body = detail.get("detail", detail) if isinstance(detail, dict) else {}
        if isinstance(body, dict):
            failed = body.get("first_failed_event_id")
            if isinstance(failed, str) and any(
                event.event_id == failed for event in batch.events
            ):
                return failed
        return batch.events[0].event_id

    async def _run(self) -> None:
        while not self._closed:
            self._wake.clear()
            try:
                await self.drain_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Unexpected command control drain failure")
            try:
                await asyncio.wait_for(
                    self._wake.wait(), timeout=self._poll_interval_seconds
                )
            except TimeoutError:
                pass

    async def close(self) -> None:
        self._closed = True
        self._wake.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await self._transport.close()
