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

"""Retry the existing publication outbox for ordinary Runs, including startup."""

from __future__ import annotations

import asyncio
import logging
import time

from .native_runtime import NATIVE_POLICY_VERSION
from .ordinary import publish_ordinary_workspace

logger = logging.getLogger(__name__)
_publisher = None


class OrdinaryWorkspacePublisher:
    def __init__(self, journal):
        self.journal = journal
        self.closed = asyncio.Event()
        self.task = None

    def drain_due(self):
        with self.journal._lock:
            runs = self.journal._connection.execute(
                """SELECT DISTINCT i.run_id FROM workspace_integration_requests i
                JOIN run_workspace_bindings b ON b.run_id=i.run_id
                WHERE b.policy_version=? AND i.worker_id IS NULL
                AND i.status IN ('pending','waiting','waiting_target_stable','partially_integrated')
                AND i.retry_after_at<=? ORDER BY i.created_at LIMIT 8""",
                (NATIVE_POLICY_VERSION, time.time()),
            ).fetchall()
        for row in runs:
            try:
                publish_ordinary_workspace(self.journal, row[0])
            except Exception:
                logger.exception(
                    "Ordinary Run publication needs attention",
                    extra={"run_id": row[0]},
                )

    async def _run(self):
        while not self.closed.is_set():
            # close() drains this concrete worker before the journal closes.
            await asyncio.to_thread(self.drain_due)
            try:
                await asyncio.wait_for(self.closed.wait(), 1)
            except TimeoutError:
                pass

    def start(self):
        if self.task is None:
            self.task = asyncio.create_task(self._run())

    async def close(self):
        self.closed.set()
        if self.task is not None:
            await asyncio.shield(self.task)


def start_ordinary_publication(journal):
    global _publisher
    if _publisher is None:
        _publisher = OrdinaryWorkspacePublisher(journal)
        _publisher.start()


async def close_ordinary_publication():
    global _publisher
    if _publisher is not None:
        await _publisher.close()
        _publisher = None
