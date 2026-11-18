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

"""Bounded retention of code-owned terminal environments, separate from Run outcomes."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import time
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path

from app.run_journal.transitions import RUN_ACTIVE_STATES
from app.utils.workspace_paths import runtime_task_root, task_dir_name

logger = logging.getLogger(__name__)
RETENTION_SECONDS = 24 * 60 * 60
SOFT_BUDGET_BYTES = 10 * 1024**3
LIVENESS_TIMEOUT_SECONDS = 30
ProjectGuard = Callable[[str], AbstractContextManager[bool]]


def validate_runtime_path(path: Path) -> Path:
    path = path.absolute()
    authority = Path.home().resolve() / ".eigent"
    if not path.is_relative_to(authority) or ".." in path.parts:
        raise ValueError("Runtime cleanup is outside application storage")
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise ValueError("Runtime cleanup may not traverse a symlink")
        if parent == authority:
            break
    return path


def _is_path_component(value: str) -> bool:
    return (
        bool(value)
        and value not in {".", ".."}
        and not any(c in value for c in "/\\\0")
    )


def delete_project_runtime(
    email: str, user_id: str | None, project_id: str
) -> bool:
    if not _is_path_component(project_id):
        raise ValueError("Invalid runtime project owner")
    if not email and user_id is None:
        raise ValueError("Missing runtime account owner")
    root = validate_runtime_path(
        runtime_task_root(email, project_id, "cleanup", user_id).parent
    )
    if root.exists():
        shutil.rmtree(root)
        return True
    return False


def release_run_environments(project_id: str, run_id: str) -> list[str]:
    """Remove a terminal Run's environment copies left on disk.

    After a Brain restart no toolkit owns an interrupted Run's retained copy,
    so the Run's journal identity locates it. Call only after every live
    toolkit has released the Run.
    """
    if not _is_path_component(project_id) or not _is_path_component(run_id):
        raise ValueError("Invalid runtime Run owner")
    home = Path.home() / ".eigent"
    if not home.exists() or home.is_symlink():
        return []
    agents = Path(
        "runtime",
        f"project_{project_id}",
        task_dir_name(run_id),
        "toolchains",
        "agents",
    )
    removed = []
    for owner in home.iterdir():
        if owner.is_symlink() or not (owner / agents).is_dir():
            continue
        for environment in (owner / agents).glob("*/.venv"):
            shutil.rmtree(validate_runtime_path(environment))
            removed.append(str(environment))
    return removed


def collect_runtime_environments(
    journal, *, project_guard: ProjectGuard, now: float | None = None
) -> list[str]:
    """Run on a worker thread. Active runs are never pressure-evicted.

    ``project_guard`` decides on the owning loop whether a project's live
    toolkits are idle, and holds them still while an environment is removed.
    """
    now = time.time() if now is None else now
    home = Path.home() / ".eigent"
    if not home.exists() or home.is_symlink():
        return []
    candidates = []
    for owner in home.iterdir():
        runtime = owner / "runtime"
        if owner.is_symlink() or not runtime.is_dir() or runtime.is_symlink():
            continue
        for project in runtime.glob("project_*"):
            try:
                validate_runtime_path(project)
                for task in project.glob("task_*"):
                    validate_runtime_path(task)
                    run_id = task.name.removeprefix("task_")
                    run = journal.get_run(run_id) or journal.get_run(task.name)
                    if run is not None:
                        run_id = getattr(run, "run_id", run_id)
                    if run is not None and (
                        run.project_id != project.name.removeprefix("project_")
                        or run.status in RUN_ACTIVE_STATES
                    ):
                        continue
                    for environment in task.glob("toolchains/agents/*/.venv"):
                        validate_runtime_path(environment)
                        size = 0
                        touched = environment.stat().st_mtime
                        for directory, _, files in os.walk(
                            environment, followlinks=False
                        ):
                            for name in files:
                                stat = (Path(directory) / name).lstat()
                                size += stat.st_size
                                touched = max(touched, stat.st_mtime)
                        if run is not None:
                            touched = max(touched, run.updated_at)
                        candidates.append((touched, size, environment, run_id))
            except (ValueError, OSError):
                logger.warning(
                    "Runtime environment scan skipped unsafe/unavailable path",
                    exc_info=True,
                )
    total = sum(size for _, size, _, _ in candidates)
    disk = shutil.disk_usage(home)
    pressure = disk.free / max(disk.total, 1) < 0.1
    removed = []
    for touched, size, environment, run_id in sorted(candidates):
        if (
            now - touched < RETENTION_SECONDS
            and total <= SOFT_BUDGET_BYTES
            and not pressure
        ):
            continue
        project_id = environment.parents[4].name.removeprefix("project_")
        # A live toolkit may still own an interrupted environment. Do not race
        # its process/checkpoint resources; restart or explicit deletion retries.
        with project_guard(project_id) as allowed:
            if not allowed:
                continue
            # Re-read inside the guard: a Resume admitted since the scan must
            # keep the environment it is about to use.
            run = journal.get_run(run_id)
            if run is not None and run.status in RUN_ACTIVE_STATES:
                continue
            try:
                shutil.rmtree(validate_runtime_path(environment))
                total -= size
                removed.append(str(environment))
                disk = shutil.disk_usage(home)
                pressure = disk.free / max(disk.total, 1) < 0.1
            except (ValueError, OSError):
                logger.warning(
                    "Runtime environment retention failed", exc_info=True
                )
    return removed


async def _idle_project_toolkits(project_id: str) -> tuple | None:
    """Read TaskLock state on its own loop; None means the project is busy."""
    from app.service.task import get_task_lock_if_exists

    lock = get_task_lock_if_exists(project_id)
    if lock is None:
        return ()
    if any(not task.done() for task in lock.background_tasks):
        return None
    return tuple(lock.registered_toolkits)


def loop_project_guard(loop: asyncio.AbstractEventLoop) -> ProjectGuard:
    """Guard for worker-thread retention against toolkits owned by ``loop``."""

    @contextmanager
    def guard(project_id: str) -> Iterator[bool]:
        held = []
        try:
            try:
                toolkits = asyncio.run_coroutine_threadsafe(
                    _idle_project_toolkits(project_id), loop
                ).result(timeout=LIVENESS_TIMEOUT_SECONDS)
            except Exception:
                logger.warning(
                    "Runtime environment liveness check failed", exc_info=True
                )
                toolkits = None
            allowed = toolkits is not None
            for toolkit in toolkits or ():
                lock = getattr(toolkit, "_terminal_mutation_lock", None)
                if lock is None:
                    continue
                # A held lock means a command is running or rebuilding.
                if not lock.acquire(blocking=False):
                    allowed = False
                    break
                held.append(lock)
            yield allowed
        finally:
            for lock in reversed(held):
                lock.release()

    return guard


async def runtime_environment_gc_loop(journal):
    project_guard = loop_project_guard(asyncio.get_running_loop())
    while True:
        try:
            removed = await asyncio.to_thread(
                collect_runtime_environments,
                journal,
                project_guard=project_guard,
            )
            logger.info(
                "Runtime environment retention removed %s environments",
                len(removed),
            )
        except Exception:
            logger.exception("Runtime environment retention needs attention")
        await asyncio.sleep(3600)
