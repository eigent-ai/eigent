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
    if request.url.path.rstrip("/") == "/executions/capabilities":
        # The managed capability handshake is deliberately resource-free.
        return await call_next(request)
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
