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

"""Retain known first-party async projections and blocking checkpoints.

This is lifecycle accounting, not a sandbox or arbitrary descendant proof.
The managed Agent profile only uses these tasks, async model I/O and the
BoundRuntime file worker. Cancellation of a waiter never abandons a thread.
"""

from __future__ import annotations

import asyncio
import threading
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar

_owner: ContextVar[OwnedTasks | None] = ContextVar("owned_tasks", default=None)
_projection: ContextVar[object] = ContextVar(
    "execution_projection", default=None
)


@contextmanager
def task_lock_scope(task_lock):
    """Scope only the Agent compatibility boundary; legacy maps stay intact."""
    token = _projection.set(task_lock)
    try:
        yield task_lock
    finally:
        _projection.reset(token)


def get_task_lock(project_id):
    from app.exception.exception import ProgramException
    from app.service.task import get_task_lock as legacy

    projection = _projection.get()
    if projection is None:
        return legacy(project_id)
    if projection.id != project_id:
        raise ProgramException("Task does not belong to this execution")
    return projection


def get_task_lock_if_exists(project_id):
    from app.service.task import get_task_lock_if_exists as legacy

    projection = _projection.get()
    if projection is None:
        return legacy(project_id)
    return projection if projection.id == project_id else None


class OwnedTasks:
    def __init__(self):
        self.loop = asyncio.get_running_loop()
        self.tasks: set[asyncio.Task] = set()
        self.submissions = set()
        self.lock = threading.Lock()
        self.sealed = False

    def create_task(self, coroutine):
        with self.lock:
            if self.sealed:
                coroutine.close()
                raise RuntimeError("execution task registry is closed")
            task = self.loop.create_task(coroutine)
            self.tasks.add(task)
        task.add_done_callback(
            lambda done: None if done.cancelled() else done.exception()
        )
        return task

    def schedule(self, coroutine):
        try:
            current = asyncio.get_running_loop()
        except RuntimeError:
            current = None
        if current is self.loop:
            return self.create_task(coroutine)

        async def register():
            return await asyncio.shield(self.create_task(coroutine))

        with self.lock:
            if self.sealed:
                coroutine.close()
                raise RuntimeError("execution task registry is closed")
            future = asyncio.run_coroutine_threadsafe(register(), self.loop)
            self.submissions.add(future)
        return future

    async def drain(self):
        # Tasks may schedule projections while finishing. No timeout or task
        # cancellation is interpreted as completion of their underlying work.
        errors = []
        while True:
            with self.lock:
                batch = tuple(self.tasks)
                submissions = tuple(self.submissions)
                if not batch and not submissions:
                    self.sealed = True
                    break
            outcomes = await asyncio.gather(
                *batch,
                *(asyncio.wrap_future(item) for item in submissions),
                return_exceptions=True,
            )
            errors.extend(
                value for value in outcomes if isinstance(value, Exception)
            )
            with self.lock:
                self.tasks.difference_update(batch)
                self.submissions.difference_update(submissions)
        if errors:
            raise errors[0]


def current_owned_tasks():
    return _owner.get()


@asynccontextmanager
async def owned_tasks_scope():
    owner = OwnedTasks()
    token = _owner.set(owner)
    try:
        yield owner
    finally:
        task = asyncio.create_task(owner.drain())
        cancelled = None
        try:
            while not task.done():
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError as error:
                    cancelled = error
            task.result()
            if cancelled is not None:
                raise cancelled
        finally:
            _owner.reset(token)


async def run_owned_thread(function, /, *args, **kwargs):
    owner = _owner.get()
    call = asyncio.to_thread(function, *args, **kwargs)
    if owner is None:
        return await call
    return await asyncio.shield(owner.create_task(call))
