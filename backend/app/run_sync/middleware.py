"""Refresh Cloud sync credentials from ordinary authenticated Brain traffic."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from fastapi import Request, Response

from app.run_sync.runtime import configure_default_cloud_sync_worker

logger = logging.getLogger("run_sync.middleware")


async def cloud_sync_configuration_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    authorization = request.headers.get("authorization")
    desktop_instance_id = request.headers.get("x-desktop-instance-id")
    if authorization:
        try:
            configure_default_cloud_sync_worker(
                server_url=None,
                authorization=authorization,
                desktop_instance_id=desktop_instance_id,
            )
        except Exception:
            # Replication freshness is never allowed to break a local Brain API
            # request. The durable outbox will be retried on later traffic.
            logger.exception(
                "Failed to refresh background service configuration"
            )
    return await call_next(request)
