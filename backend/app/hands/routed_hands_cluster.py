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

import logging
from typing import Any

from app.hands.cluster_interface import IHandsCluster

logger = logging.getLogger("hands.cluster.routed")


class RoutedHandsCluster(IHandsCluster):
    """
    Route resource requests to different cluster clients by resource type.

    Example keys:
    - "browser"
    - "terminal"
    - "model"
    - "default"
    """

    def __init__(
        self,
        clusters: dict[str, IHandsCluster],
        default_key: str = "default",
    ) -> None:
        normalized = {
            k.strip().lower(): v
            for k, v in clusters.items()
            if k and isinstance(k, str)
        }
        if not normalized:
            raise ValueError("clusters must not be empty")
        self._clusters = normalized
        self._default_key = (
            default_key if default_key in self._clusters else None
        )
        self._session_cluster_key: dict[str, str] = {}

    async def acquire(
        self,
        resource_type: str,
        session_id: str,
        tenant_id: str = "default",
        **kwargs,
    ) -> dict[str, Any]:
        key = self._select_cluster_key(resource_type)
        cluster = self._clusters[key]
        acquired = await cluster.acquire(
            resource_type=resource_type,
            session_id=session_id,
            tenant_id=tenant_id,
            **kwargs,
        )
        self._session_cluster_key[session_id] = key
        if "cluster_key" not in acquired:
            acquired["cluster_key"] = key
        return acquired

    async def release(self, session_id: str) -> None:
        key = self._session_cluster_key.pop(session_id, None)
        if key is not None and key in self._clusters:
            await self._clusters[key].release(session_id)
            return

        if self._default_key is not None:
            await self._clusters[self._default_key].release(session_id)
            return

        last_error: Exception | None = None
        for cluster_key, cluster in self._clusters.items():
            try:
                await cluster.release(session_id)
                return
            except Exception as exc:  # pragma: no cover - best effort log path
                last_error = exc
                logger.warning(
                    "Release attempt failed on cluster key %s for session_id=%s: %s",
                    cluster_key,
                    session_id,
                    exc,
                )
        if last_error is not None:
            raise last_error

    async def health(self) -> dict[str, Any]:
        clusters_health: dict[str, Any] = {}
        for key, cluster in self._clusters.items():
            try:
                clusters_health[key] = await cluster.health()
            except Exception as exc:
                clusters_health[key] = {"error": str(exc)}
        return {
            "mode": "routed",
            "default_key": self._default_key,
            "clusters": clusters_health,
        }

    def _select_cluster_key(self, resource_type: str) -> str:
        wanted = (resource_type or "").strip().lower()
        if wanted in self._clusters:
            return wanted
        if self._default_key is not None:
            return self._default_key
        if len(self._clusters) == 1:
            return next(iter(self._clusters.keys()))
        raise ValueError(
            "No cluster configured for "
            f"resource_type={resource_type!r} and no default cluster"
        )
