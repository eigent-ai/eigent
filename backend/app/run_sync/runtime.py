"""Process-owned CloudSyncWorker lifecycle and credential handoff."""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlparse

from app.component.environment import env
from app.run_sync.cloud_sync import (
    CloudSyncConfiguration,
    CloudSyncWorker,
    HttpRunEventSyncTransport,
)
from app.run_sync.command_sync import (
    CommandControlWorker,
    HttpCommandSyncTransport,
)

logger = logging.getLogger("run_sync.runtime")

_default_worker: CloudSyncWorker | None = None
_default_command_worker: CommandControlWorker | None = None
_worker_loop: asyncio.AbstractEventLoop | None = None


def _sync_endpoint(server_url: str | None) -> str:
    value = str(server_url or env("SERVER_URL", "")).strip().rstrip("/")
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        logger.warning("Ignoring invalid Run sync SERVER_URL: %s", value)
        return ""
    if value.endswith("/api/v1"):
        base = value
    elif value.endswith("/api"):
        base = f"{value}/v1"
    else:
        base = f"{value}/api/v1"
    return f"{base}/sync/events:ingest"


def configure_default_cloud_sync_worker(
    *,
    server_url: str | None,
    authorization: str | None,
    desktop_instance_id: str | None,
) -> bool:
    global _default_command_worker, _default_worker, _worker_loop
    endpoint = _sync_endpoint(server_url)
    auth = str(authorization or "").strip()
    instance_id = str(
        desktop_instance_id or env("EIGENT_DESKTOP_INSTANCE_ID", "")
    ).strip()
    if not endpoint or not auth or not instance_id:
        return False
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("Run sync configuration requires a running event loop")
        return False
    if _default_worker is None:
        from app.run_journal.runtime import get_default_run_journal

        _default_worker = CloudSyncWorker(
            get_default_run_journal(),
            HttpRunEventSyncTransport(),
        )
        _worker_loop = loop
        _default_worker.start()
        _default_command_worker = CommandControlWorker(
            get_default_run_journal(),
            HttpCommandSyncTransport(),
        )
        _default_command_worker.start()
    elif _worker_loop is not loop:
        logger.error("Refusing to move CloudSyncWorker across event loops")
        return False
    configuration = CloudSyncConfiguration(
        endpoint_url=endpoint,
        authorization=auth,
        desktop_instance_id=instance_id,
    )
    _default_worker.configure(configuration)
    if _default_command_worker is not None:
        _default_command_worker.configure(configuration)
    return True


def notify_default_cloud_sync_worker() -> None:
    worker = _default_worker
    loop = _worker_loop
    if worker is None or loop is None or loop.is_closed():
        return
    loop.call_soon_threadsafe(worker.notify)
    if _default_command_worker is not None:
        loop.call_soon_threadsafe(_default_command_worker.notify)


async def bootstrap_default_cloud_history() -> None:
    """Wait for the configured one-shot PG -> SQLite history repair."""

    worker = _default_worker
    if worker is None:
        return
    await worker.bootstrap_once()


async def persist_and_confirm_remote_command(
    command: dict,
) -> tuple[object, bool]:
    worker = _default_command_worker
    if worker is None:
        raise RuntimeError("Command control worker is not configured")
    record = await worker.persist_command(command)
    return await worker.confirm_receipt(record.command_id)


async def close_default_cloud_sync_worker() -> None:
    global _default_command_worker, _default_worker, _worker_loop
    worker = _default_worker
    command_worker = _default_command_worker
    _default_worker = None
    _default_command_worker = None
    _worker_loop = None
    if worker is not None:
        await worker.close()
    if command_worker is not None:
        await command_worker.close()
