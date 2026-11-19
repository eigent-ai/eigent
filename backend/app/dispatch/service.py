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
"""Start, queue and resume Tasks the Brain owns.

Nothing here executes a Task. Each function builds the ``Chat`` a renderer
would have sent and hands it to the existing ``/chat`` admission, then drops
its stream subscriber: execution is owned by the Run coordinator and carries
on with no listener.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import suppress
from typing import Any

from fastapi import HTTPException
from starlette.requests import Request

from app.dispatch.sessions import (
    DispatchSession,
    delete_session,
    is_safe_id,
    load_session,
    save_session,
)
from app.dispatch.settings import (
    LOCAL_OWNER_EMAIL,
    DispatchModel,
    ModelNotConfiguredError,
    resolve_dispatch_model,
    resolve_space_folder,
    space_id_for_folder,
)
from app.exception.exception import UserException
from app.model.chat import Chat
from app.model.enums import Status
from app.run_journal import SQLiteRunJournal, get_default_run_journal
from app.run_journal.transitions import RUN_TERMINAL_STATES
from app.run_runtime import get_default_run_coordinator
from app.service.task import get_task_lock_if_exists
from app.utils.workspace_paths import space_folder_conflict
from app.workspace_runtime.entry_guard import guard_legacy_execution_entry

logger = logging.getLogger("dispatch")

# Admission refusals that mean "this Session is busy", not "this Task is bad".
_BUSY_CODES = {"project_run_active", "project_consumer_active"}
_FIRST_EVENT_WAIT_SECONDS = 2.0


class DispatchError(Exception):
    """A refusal the client can act on, with a stable ``code``."""

    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class _SessionBusy(Exception):
    pass


def _journal() -> SQLiteRunJournal:
    journal = get_default_run_journal()
    if not isinstance(journal, SQLiteRunJournal):
        raise DispatchError(
            503, "run_journal_unavailable", "The Task history is unavailable."
        )
    return journal


def internal_request() -> Request:
    """Stand in for the HTTP request when the Brain admits a queued Task.

    Admission reads only ``state`` and ``headers`` from it.
    """

    from app.router_layer.hands_resolver import get_hands_for_channel

    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/tasks",
            "headers": [],
            "query_string": b"",
            "client": ("127.0.0.1", 0),
            "state": {
                "channel": "cli",
                "hands": get_hands_for_channel("cli", None),
            },
        }
    )


def _build_chat(
    session: DispatchSession,
    *,
    run_id: str,
    prompt: str,
    attachments: list[str],
    model: DispatchModel,
    resume_request_id: str | None = None,
) -> Chat:
    return Chat(
        task_id=run_id,
        run_id=run_id,
        project_id=session.project_id,
        space_id=session.space_id,
        space_root_path=session.space_root_path,
        question=prompt,
        email=session.email,
        attaches=attachments,
        model_platform=model.model_platform,
        model_type=model.model_type,
        api_key=model.api_key,
        api_url=model.api_url,
        language=session.language,
        timezone=session.timezone,
        # Same as Desktop: what a Task may actually do is decided by the
        # Space's permission profile, not by this switch.
        allow_local_system=True,
        summary_prompt="",
        session_mode=session.session_mode,
        resume_request_id=resume_request_id,
    )


async def _detach(stream: Any) -> None:
    """Drop the admission's stream subscriber; the Task keeps running.

    The stream is a generator that only unsubscribes once it has started, so
    advance it one step before closing it.
    """

    try:
        await asyncio.wait_for(
            stream.__anext__(), timeout=_FIRST_EVENT_WAIT_SECONDS
        )
    except (StopAsyncIteration, TimeoutError):
        pass
    except Exception:
        logger.debug("Stream ended while detaching", exc_info=True)
    finally:
        with suppress(Exception):
            await stream.aclose()


async def _retire_idle_consumer(project_id: str) -> bool:
    """Stop the finished Task's idle consumer so the next one can start.

    Returns whether the Session is free of a live consumer afterwards. A
    consumer whose Task has not ended is left alone.
    """

    task_lock = get_task_lock_if_exists(project_id)
    if task_lock is None:
        return True
    coordinator = get_default_run_coordinator()
    owner = await coordinator.get_queue_owner(task_lock.queue)
    if owner is None:
        return True
    if task_lock.status != Status.done:
        return False
    run = await asyncio.to_thread(_journal().get_run, owner.run_id)
    if run is None or run.status not in RUN_TERMINAL_STATES:
        return False
    async with coordinator.admission_scope(
        owner.run_id, project_id=project_id
    ):
        await coordinator.retire(owner.run_id, command_queue=task_lock.queue)
    return await coordinator.get_queue_owner(task_lock.queue) is None


def _refusal(exc: HTTPException) -> DispatchError | _SessionBusy:
    detail = exc.detail
    code = detail.get("code") if isinstance(detail, dict) else None
    if code in _BUSY_CODES:
        return _SessionBusy()
    message = (
        detail.get("message") or code or str(detail)
        if isinstance(detail, dict)
        else str(detail)
    )
    return DispatchError(
        exc.status_code, str(code or "task_refused"), str(message)
    )


async def _admit(chat: Chat, request: Request) -> None:
    """Run ``/chat`` admission for a Chat the Brain built."""

    # Imported late: the controller imports most of the Brain.
    from app.controller.chat_controller import post as admit_chat

    await _retire_idle_consumer(chat.project_id)
    try:
        response = await admit_chat(chat, request)
    except HTTPException as exc:
        raise _refusal(exc) from exc
    except UserException as exc:
        raise DispatchError(
            409, exc.error_code or "task_refused", exc.description
        ) from exc
    await _detach(response.body_iterator)
    DISPATCHER.track(chat.project_id)


def _validate_new_session(
    *,
    space_root_path: str | None,
    session_mode: str | None,
    model_type: str | None,
    language: str | None,
    timezone: str | None,
) -> DispatchSession:
    if not space_root_path:
        raise DispatchError(
            422,
            "space_folder_required",
            "A new Session needs a Space folder.",
        )
    if session_mode is None:
        raise DispatchError(
            422,
            "session_mode_required",
            "A new Session needs session_mode: single-agent or workforce.",
        )
    folder = resolve_space_folder(space_root_path)
    if not folder.is_dir():
        raise DispatchError(
            422,
            "space_folder_not_found",
            f"The Space folder does not exist: {folder}",
        )
    conflict = space_folder_conflict(folder, LOCAL_OWNER_EMAIL)
    if conflict is not None:
        from app.utils.workspace_resolver import SpaceFolderNotUsableError

        raise DispatchError(
            422, conflict, str(SpaceFolderNotUsableError(conflict))
        )
    return DispatchSession(
        project_id=str(uuid.uuid4()),
        space_id=space_id_for_folder(folder),
        space_root_path=str(folder),
        session_mode=session_mode,
        email=LOCAL_OWNER_EMAIL,
        model_type=(model_type or None),
        language=language or "en",
        timezone=timezone,
    )


def _existing_session(
    project_id: str, *, session_mode: str | None, model_type: str | None
) -> DispatchSession:
    session = load_session(project_id)
    if session is None:
        raise DispatchError(
            409,
            "session_not_started_here",
            "This Session was not started from the command line, so "
            "Eigent has nothing to continue it with. Continue it in the "
            "app.",
        )
    if session_mode is not None and session_mode != session.session_mode:
        raise DispatchError(
            409,
            "session_mode_mismatch",
            f"This Session runs in {session.session_mode} mode.",
        )
    if model_type and model_type != session.model_type:
        raise DispatchError(
            409,
            "session_model_mismatch",
            "A Session keeps the model it was started with.",
        )
    return session


def _resolve_model(session: DispatchSession) -> DispatchModel:
    try:
        return resolve_dispatch_model(session.model_type)
    except ModelNotConfiguredError as exc:
        raise DispatchError(409, "model_not_configured", str(exc)) from exc


def _task_response(
    session: DispatchSession, run_id: str, status: str
) -> dict[str, Any]:
    return {
        "task_id": run_id,
        "run_id": run_id,
        "project_id": session.project_id,
        "space_id": session.space_id,
        "session_mode": session.session_mode,
        "status": status,
        "events": f"/runs/{run_id}/stream",
    }


async def _enqueue(
    session: DispatchSession,
    *,
    run_id: str,
    prompt: str,
    attachments: list[str],
) -> dict[str, Any]:
    try:
        await asyncio.to_thread(
            _journal().put_follow_up_request,
            request_id=run_id,
            project_id=session.project_id,
            content=prompt,
            attachment_paths=attachments,
            delivery_mode="wait",
            source="local",
            reject_managed=True,
        )
    except ValueError as exc:
        raise DispatchError(422, "task_refused", str(exc)) from exc
    DISPATCHER.wake()
    return _task_response(session, run_id, "queued")


async def start_task(
    request: Request,
    *,
    prompt: str,
    project_id: str | None = None,
    space_root_path: str | None = None,
    session_mode: str | None = None,
    request_id: str | None = None,
    attachments: list[str] | None = None,
    model_type: str | None = None,
    language: str | None = None,
    timezone: str | None = None,
) -> dict[str, Any]:
    """Start a Task, or queue it behind the Session's running one."""

    attachments = list(attachments or [])
    run_id = request_id or str(uuid.uuid4())
    if not is_safe_id(run_id):
        raise DispatchError(
            422, "invalid_request_id", "request_id has unsupported characters."
        )
    journal = _journal()
    is_new_session = project_id is None
    if is_new_session:
        session = _validate_new_session(
            space_root_path=space_root_path,
            session_mode=session_mode,
            model_type=model_type,
            language=language,
            timezone=timezone,
        )
    else:
        session = _existing_session(
            project_id, session_mode=session_mode, model_type=model_type
        )
    model = _resolve_model(session)
    await guard_legacy_execution_entry(journal, project_id=session.project_id)

    if not is_new_session:
        active = await asyncio.to_thread(
            journal.get_active_project_run, session.project_id
        )
        if active is not None and active.run_id != run_id:
            return await _enqueue(
                session, run_id=run_id, prompt=prompt, attachments=attachments
            )
    else:
        session = await asyncio.to_thread(save_session, session)

    chat = _build_chat(
        session,
        run_id=run_id,
        prompt=prompt,
        attachments=attachments,
        model=model,
    )
    try:
        await _admit(chat, request)
    except _SessionBusy:
        if is_new_session:
            raise DispatchError(
                409, "project_run_active", "The Session is busy."
            ) from None
        return await _enqueue(
            session, run_id=run_id, prompt=prompt, attachments=attachments
        )
    except BaseException:
        if is_new_session and (
            await asyncio.to_thread(journal.get_run, run_id) is None
        ):
            # Nothing was admitted, so there is no Session to continue.
            await asyncio.to_thread(delete_session, session.project_id)
        raise
    return _task_response(session, run_id, "started")


async def get_task(task_id: str) -> dict[str, Any]:
    """Status of a Task that has started or is still queued."""

    journal = _journal()
    run = await asyncio.to_thread(journal.get_run, task_id)
    if run is not None:
        return {
            "task_id": run.run_id,
            "run_id": run.run_id,
            "project_id": run.project_id,
            "status": run.status,
            "terminal_reason": run.terminal_reason,
            "queued": False,
        }
    queued = await asyncio.to_thread(journal.get_follow_up_request, task_id)
    if queued is None:
        raise DispatchError(404, "task_not_found", "No such Task.")
    return {
        "task_id": queued.request_id,
        "run_id": None,
        "project_id": queued.project_id,
        "status": "queued" if queued.status == "pending" else queued.status,
        "terminal_reason": queued.last_error,
        "queued": True,
    }


def _original_prompt(journal: SQLiteRunJournal, run_id: str) -> str:
    events = journal.list_events(
        run_id, limit=20, event_type_prefix="user.message"
    )
    for event in events:
        content = event.payload.get("content")
        if isinstance(content, str) and content.strip():
            return content
    return "Resume the interrupted Task."


async def resume_task(
    request: Request, task_id: str, *, request_id: str | None = None
) -> dict[str, Any]:
    """Resume an interrupted Task in a Session the Brain started."""

    journal = _journal()
    run = await asyncio.to_thread(journal.get_run, task_id)
    if run is None:
        raise DispatchError(404, "task_not_found", "No such Task.")
    session = _existing_session(
        run.project_id, session_mode=None, model_type=None
    )
    resume_request_id = request_id or f"resume-{uuid.uuid4()}"
    if not is_safe_id(resume_request_id):
        raise DispatchError(
            422, "invalid_request_id", "request_id has unsupported characters."
        )
    if run.status != "interrupted" and request_id is None:
        raise DispatchError(
            409,
            "task_not_interrupted",
            f"Only an interrupted Task can be resumed; this one is "
            f"{run.status}.",
        )
    model = _resolve_model(session)
    await guard_legacy_execution_entry(
        journal, project_id=session.project_id, run_id=task_id
    )
    prompt = await asyncio.to_thread(_original_prompt, journal, task_id)
    chat = _build_chat(
        session,
        run_id=task_id,
        prompt=prompt,
        attachments=[],
        model=model,
        resume_request_id=resume_request_id,
    )
    try:
        await _admit(chat, request)
    except _SessionBusy:
        raise DispatchError(
            409,
            "project_run_active",
            "Another Task in this Session must finish or be stopped first.",
        ) from None
    return _task_response(session, task_id, "started")


class FollowUpDispatcher:
    """Admit queued Tasks for Brain-owned Sessions when the Session is free.

    Desktop's renderer does this for the Sessions it shows. Sessions started
    through ``/v1/tasks`` have no renderer, so the Brain does it. The queue
    row is the authority: it is durable, and admission marks it admitted in
    the same transaction as the Run's first Attempt, so a crash between the
    two cannot start a Task twice.
    """

    def __init__(self, interval_seconds: float = 2.0) -> None:
        self._interval = interval_seconds
        self._wake = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        # Brain-owned Sessions that may still have a live consumer to retire.
        self._tracked: set[str] = set()

    def wake(self) -> None:
        self._wake.set()

    def track(self, project_id: str) -> None:
        self._tracked.add(project_id)
        self._wake.set()

    def start(self) -> None:
        if self._task is None or self._task.done():
            # Start awake, to pick up rows queued before a restart.
            self._wake = asyncio.Event()
            self._wake.set()
            self._task = asyncio.create_task(
                self._run(), name="dispatch-follow-ups"
            )

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._tracked.clear()

    async def _run(self) -> None:
        work_left = True
        while True:
            try:
                await asyncio.wait_for(
                    self._wake.wait(),
                    timeout=self._interval if work_left else None,
                )
            except TimeoutError:
                pass
            self._wake.clear()
            try:
                work_left = await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Follow-up dispatch failed; will retry")
                work_left = True

    async def run_once(self) -> bool:
        """One pass. Returns whether there is anything left to wait for."""

        journal = _journal()
        pending = await asyncio.to_thread(
            journal.list_pending_follow_up_requests_by_source, source="local"
        )
        work_left = False
        seen: set[str] = set()
        for row in pending:
            if row.project_id in seen:
                continue
            seen.add(row.project_id)
            session = await asyncio.to_thread(load_session, row.project_id)
            if session is None:
                # Started from Desktop: the renderer dispatches it.
                continue
            work_left = True
            active = await asyncio.to_thread(
                journal.get_active_project_run, row.project_id
            )
            if active is not None:
                continue
            await self._admit_queued(journal, session, row)

        for project_id in list(self._tracked):
            if project_id in seen:
                continue
            if await _retire_idle_consumer(project_id):
                self._tracked.discard(project_id)
        return work_left or bool(self._tracked)

    async def _admit_queued(
        self, journal: SQLiteRunJournal, session: DispatchSession, row: Any
    ) -> None:
        try:
            model = _resolve_model(session)
            chat = _build_chat(
                session,
                run_id=row.request_id,
                prompt=row.content,
                attachments=list(row.attachment_paths),
                model=model,
            )
            await _admit(chat, internal_request())
        except _SessionBusy:
            return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            message = getattr(exc, "message", None) or str(exc) or repr(exc)
            logger.warning(
                "Queued Task could not start",
                extra={"request_id": row.request_id, "error": message},
            )
            with suppress(Exception):
                await asyncio.to_thread(
                    journal.reject_follow_up_request,
                    request_id=row.request_id,
                    project_id=row.project_id,
                    error=message[:2000],
                )


DISPATCHER = FollowUpDispatcher()


__all__ = [
    "DISPATCHER",
    "DispatchError",
    "FollowUpDispatcher",
    "get_task",
    "internal_request",
    "resume_task",
    "start_task",
]
