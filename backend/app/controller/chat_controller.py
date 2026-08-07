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

import asyncio
import hashlib
import inspect
import json
import logging
import os
from collections.abc import Mapping
from contextlib import suppress
from dataclasses import dataclass, replace
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse

from app.auth import require_local_control_principal
from app.component import code
from app.component.environment import env, sanitize_env_path, set_user_env_path
from app.exception.exception import UserException
from app.memory import get_memory_service
from app.model.chat import (
    AddTaskRequest,
    Chat,
    HumanReply,
    McpServers,
    Status,
    SupplementChat,
    sse_json,
)
from app.run_context import (
    RunContext,
    apply_run_env_for_third_party,
    stream_with_run_context,
)
from app.run_journal import (
    AttemptEnvironmentBinding,
    RunAttemptRecord,
    RunEventDraft,
    SQLiteRunJournal,
    get_default_run_journal,
)
from app.run_runtime import get_default_run_coordinator
from app.service.chat_service import step_solve
from app.service.task import (
    Action,
    ActionAddTaskData,
    ActionImproveData,
    ActionInstallMcpData,
    ActionRemoveTaskData,
    ActionSkipTaskData,
    ActionStopData,
    ActionSupplementData,
    ImprovePayload,
    TaskLock,
    get_or_create_task_lock,
    get_task_lock,
    get_task_lock_if_exists,
    set_current_task_id,
)
from app.utils.browser_launcher import (
    ensure_cdp_browser_endpoint,
    is_cdp_url_available,
    normalize_cdp_url,
)
from app.utils.cdp_browser_state import (
    clear_connected_cdp_browser_for_request,
    get_connected_cdp_endpoint_for_request,
)
from app.utils.event_loop_utils import schedule_async_task_from_worker
from app.utils.server.sync_step import sync_step_event
from app.utils.workspace_paths import camel_log_root
from app.utils.workspace_resolver import get_workspace_resolver
from app.workspace_config import EffectiveEnvironmentSpec, canonical_digest
from app.workspace_config.admission import (
    EnvironmentAdmissionService,
    EnvironmentAdmissionTemplate,
    LegacyEnvironmentImporter,
)
from app.workspace_git import get_default_workspace_git_coordinator

router = APIRouter()
_CHAT_CONTROL_DEPENDENCIES = [Depends(require_local_control_principal)]

# Logger for chat controller
chat_logger = logging.getLogger("chat_controller")

# SSE timeout configuration (60 minutes in seconds)
SSE_TIMEOUT_SECONDS = 60 * 60

# CAMEL reads this as a process-level logging toggle, not as per-run state.
os.environ.setdefault("CAMEL_MODEL_LOG_ENABLED", "true")


@dataclass(frozen=True)
class _PreparedChatRun:
    task_lock: TaskLock
    run_context: RunContext
    attempt_id: str
    initial_action: ActionImproveData


_EXPLICIT_RESUME_INSTRUCTION = """
Resume the interrupted Run from its persisted Project context and durable
tool ledger. Continue only unfinished work. Treat completed tool calls and
external side effects as already performed; do not repeat them unless the
persisted result proves that repetition is both necessary and safe. If the
durable context is insufficient, ask the user instead of guessing.
""".strip()
_RESUME_TOOL_LEDGER_MAX_CALLS = 50
_RESUME_TOOL_RESULT_MAX_CHARS = 1000


def _legacy_environment_template(data: Chat) -> EnvironmentAdmissionTemplate:
    return LegacyEnvironmentImporter().build_template(
        model_platform=data.model_platform,
        model_type=data.model_type,
        auth_source=data.auth_source,
        requested_effort=data.thinking_effort,
        allow_local_system=data.allow_local_system,
        mcp_server_names=tuple(
            (data.installed_mcp.get("mcpServers") or {}).keys()
        ),
        session_mode=data.session_mode,
    )


def _attempt_environment_binding(
    attempt: RunAttemptRecord | None,
) -> AttemptEnvironmentBinding | None:
    if attempt is None or attempt.environment_spec_id is None:
        return None
    values = {
        "environment_spec_digest": attempt.environment_spec_digest,
        "bundle_revision_id": attempt.bundle_revision_id,
        "permission_profile_revision": attempt.permission_profile_revision,
        "thinking_effort_requested": attempt.thinking_effort_requested,
        "thinking_effort_effective": attempt.thinking_effort_effective,
        "provider_capability_revision": (attempt.provider_capability_revision),
    }
    if any(value is None for value in values.values()):
        raise UserException(
            code.error,
            "The Run has an incomplete persisted EnvironmentSpec binding.",
        )
    return AttemptEnvironmentBinding(
        environment_spec_id=attempt.environment_spec_id,
        **values,
    )


def _apply_environment_to_task_lock(
    task_lock: TaskLock,
    spec: EffectiveEnvironmentSpec,
    *,
    template: EnvironmentAdmissionTemplate | None,
) -> None:
    task_lock.environment_admission_template = template
    task_lock.environment_spec_id = spec.spec_id
    task_lock.thinking_effort_requested = spec.thinking_effort_requested.value
    task_lock.thinking_effort_effective = spec.thinking_effort_effective.value
    task_lock.provider_effort_parameter_name = spec.provider_parameter_name
    task_lock.provider_effort_parameter_value = spec.provider_value
    task_lock.provider_capability_revision = spec.provider_capability_revision


def _load_attempt_environment_spec(
    journal: SQLiteRunJournal,
    attempt: RunAttemptRecord,
) -> EffectiveEnvironmentSpec | None:
    if attempt.environment_spec_id is None:
        return None
    record = journal.get_effective_environment_spec(
        attempt.environment_spec_id
    )
    if record is None:
        raise UserException(
            code.error,
            "The Run's persisted EnvironmentSpec is unavailable.",
        )
    return EffectiveEnvironmentSpec.model_validate(record.spec)


def _validate_resume_model_capability(
    data: Chat,
    spec: EffectiveEnvironmentSpec,
) -> EnvironmentAdmissionTemplate:
    template = _legacy_environment_template(data)
    current = template.provider_capability
    if current.capability_revision != spec.provider_capability_revision:
        raise UserException(
            code.error,
            "The model capability changed since this Attempt. Start a new "
            "Attempt with an explicit environment upgrade.",
        )
    persisted_model = spec.semantic_spec.get(
        "runtime_capability_manifest", {}
    ).get("model", {})
    if (
        persisted_model.get("platform") != data.model_platform.lower()
        or persisted_model.get("type") != data.model_type
    ):
        raise UserException(
            code.error,
            "Resume requires the original model, or an explicit environment "
            "upgrade into a new Attempt.",
        )
    return template


def _admission_request_id(
    run_id: str,
    *,
    question: str,
    attaches: list[str],
    project_context: str | None,
) -> str:
    canonical = json.dumps(
        {
            "question": question,
            "attaches": attaches,
            "project_context": project_context,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]
    return f"initial:{run_id}:{digest}"


async def _classify_persisted_admission(
    journal,
    *,
    run_id: str,
    request_id: str,
) -> tuple[str, object | None]:
    """Classify an existing Run as retryable, duplicate, or conflicting."""

    run = await asyncio.to_thread(journal.get_run, run_id)
    if run is None:
        return "new", None
    attempts = await asyncio.to_thread(journal.list_run_attempts, run_id)
    matching = next(
        (
            attempt
            for attempt in attempts
            if attempt.resume_request_id == request_id
        ),
        None,
    )
    if matching is None:
        # Legacy attempts predate payload fingerprints. Their input cannot be
        # proven equal to this request, so replay them but never re-execute.
        if any(
            attempt.resume_request_id == f"initial:{run_id}"
            for attempt in attempts
        ):
            return "duplicate", None
        if not attempts and run.status in {"pending", "running"}:
            return "retry", None
        return "conflict", None
    if run.status in {"pending", "running"} and matching.status in {
        "pending",
        "running",
    }:
        return "retry", matching
    return "duplicate", matching


def _is_remote_browser_hands(request: Request | None) -> bool:
    hands = getattr(getattr(request, "state", None), "hands", None)
    if hands is None:
        return False
    get_manifest = getattr(hands, "get_capability_manifest", None)
    if get_manifest is None or inspect.iscoroutinefunction(get_manifest):
        return False
    try:
        manifest = get_manifest()
    except Exception:
        return False
    if inspect.isawaitable(manifest):
        if hasattr(manifest, "close"):
            manifest.close()
        return False
    if not isinstance(manifest, dict):
        return False
    return manifest.get("deployment") == "remote_cluster"


async def _prepare_browser_for_request(
    request: Request | None,
    port: int,
) -> bool:
    existing_cdp_url = (
        get_connected_cdp_endpoint_for_request(request)
        or env("EIGENT_CDP_URL", "")
    ).strip()
    if existing_cdp_url:
        is_available = await asyncio.to_thread(
            is_cdp_url_available, existing_cdp_url
        )
        if is_available:
            normalized_endpoint, _, selected_port = normalize_cdp_url(
                existing_cdp_url
            )
            if request is not None:
                request.state.browser_available = True
                request.state.cdp_url = normalized_endpoint
                request.state.browser_port = selected_port
            return True
        clear_connected_cdp_browser_for_request(request)

    if _is_remote_browser_hands(request):
        if request is not None:
            request.state.browser_available = True
            request.state.cdp_url = None
            request.state.browser_port = port
        return True

    try:
        endpoint = await asyncio.to_thread(ensure_cdp_browser_endpoint, port)
    except Exception as e:
        chat_logger.warning(
            "Could not ensure CDP browser for web mode",
            extra={"error": str(e), "port": port},
        )
        if request is not None:
            request.state.browser_available = False
            request.state.cdp_url = None
            request.state.browser_port = port
        return False

    if endpoint:
        _, _, selected_port = normalize_cdp_url(endpoint)
        if request is not None:
            request.state.browser_available = True
            request.state.cdp_url = endpoint
            request.state.browser_port = selected_port
        return True

    chat_logger.warning(
        "CDP browser not available after ensure attempt",
        extra={"port": port},
    )
    if request is not None:
        request.state.browser_available = False
        request.state.cdp_url = None
        request.state.browser_port = port
    return False


def _browser_prepare_timeout_seconds() -> float:
    raw = env("BROWSER_PREPARE_TIMEOUT_SECONDS", "8")
    try:
        timeout = float(raw)
    except (TypeError, ValueError):
        return 8.0
    return timeout if timeout > 0 else 8.0


async def _prepare_browser_for_request_with_timeout(
    request: Request | None,
    port: int,
) -> bool:
    timeout = _browser_prepare_timeout_seconds()
    try:
        return await asyncio.wait_for(
            _prepare_browser_for_request(request, port),
            timeout=timeout,
        )
    except TimeoutError:
        chat_logger.warning(
            "Timed out preparing CDP browser",
            extra={"port": port, "timeout_seconds": timeout},
        )
        if request is not None:
            request.state.browser_available = False
            request.state.cdp_url = None
            request.state.browser_port = port
        return False


def _build_run_context(
    data: Chat,
    frozen_dirs,
    request: Request,
    camel_log: Path,
) -> RunContext:
    api_base_url = data.api_url or "https://api.openai.com/v1"
    browser_port = int(
        getattr(request.state, "browser_port", data.browser_port)
    )
    cdp_url = getattr(request.state, "cdp_url", None)
    request_headers = request.headers
    headers = request_headers if isinstance(request_headers, Mapping) else {}
    auth_header = headers.get("authorization")
    try:
        from app.run_sync.runtime import configure_default_cloud_sync_worker

        configure_default_cloud_sync_worker(
            server_url=data.server_url,
            authorization=auth_header,
            desktop_instance_id=headers.get("x-desktop-instance-id"),
        )
    except Exception:
        # Cloud sync is a freshness projection. Local Run admission and history
        # remain available when its configuration cannot be refreshed.
        chat_logger.exception("Failed to configure Run cloud sync")
    permissions = {"workspace.read", "workspace.write"}
    if data.allow_local_system:
        permissions.update({"terminal", "local_system"})
    if cdp_url or data.cdp_browsers:
        permissions.add("browser")
    permissions.update(
        f"mcp:{name}" for name in (data.installed_mcp.get("mcpServers") or {})
    )
    credential_sources = {
        "model": data.auth_source
        or ("request_api_key" if data.api_key else "none"),
        "cloud": "request_api_key" if data.is_cloud() else "none",
        "search": "request_search_config" if data.search_config else "none",
    }
    return RunContext(
        space_id=data.space_id or data.project_id,
        project_id=data.project_id,
        run_id=data.run_id or data.task_id,
        task_id=data.task_id,
        email=data.email,
        user_id=str(data.user_id) if data.user_id is not None else None,
        working_directory=frozen_dirs.working_directory,
        task_output_root=frozen_dirs.task_output_root,
        camel_log_dir=camel_log,
        binding_source=frozen_dirs.binding_source,
        workdir_mode=frozen_dirs.workdir_mode or data.workdir_mode,
        browser_port=browser_port,
        cdp_url=cdp_url,
        api_key=data.api_key,
        api_base_url=api_base_url,
        cloud_api_key=data.api_key if data.is_cloud() else None,
        server_url=data.server_url,
        auth_header=auth_header,
        search_config=data.search_config or {},
        extra_env={
            "baseSnapshotId": frozen_dirs.base_snapshot_id or "",
        },
        model_platform=data.model_platform,
        model_type=data.model_type,
        model_parameters=dict(data.model_config_dict or {}),
        permissions=frozenset(permissions),
        credential_sources=credential_sources,
    )


def _queue_action_from_worker(task_lock, action, description: str) -> None:
    schedule_async_task_from_worker(
        task_lock.put_queue(action),
        timeout=5.0,
        description=description,
    )


def _camel_log_dir(
    email: str,
    project_id: str,
    task_id: str,
    user_id: str | int | None = None,
) -> Path:
    return camel_log_root(email, project_id, task_id, user_id)


async def timeout_stream_wrapper(
    stream_generator,
    timeout_seconds: float = SSE_TIMEOUT_SECONDS,
    run_id: str | None = None,
):
    """Keep one transport subscriber alive without owning Run lifecycle."""

    generator = stream_generator.__aiter__()
    pending_next: asyncio.Task | None = None

    def current_run_id() -> str | None:
        handle = getattr(stream_generator, "handle", None)
        return getattr(handle, "run_id", run_id)

    try:
        while True:
            if pending_next is None:
                pending_next = asyncio.create_task(generator.__anext__())
            done, _ = await asyncio.wait(
                {pending_next},
                timeout=timeout_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                yield sse_json(
                    "heartbeat",
                    {
                        "scope": "transport",
                        "run_id": current_run_id(),
                    },
                )
                continue
            try:
                data = pending_next.result()
            except StopAsyncIteration:
                break
            pending_next = None
            yield data

    except asyncio.CancelledError:
        chat_logger.info(
            "SSE subscriber detached; Run execution continues",
            extra={"run_id": current_run_id()},
        )
        raise
    except Exception as e:
        chat_logger.error(
            "SSE subscriber failed; Run lifecycle is unchanged",
            extra={"run_id": current_run_id(), "error": str(e)},
            exc_info=True,
        )
        raise
    finally:
        if pending_next is not None and not pending_next.done():
            pending_next.cancel()
            with suppress(asyncio.CancelledError):
                await pending_next
        close = getattr(generator, "aclose", None)
        if close is not None:
            await close()


async def _replay_persisted_run(run_id: str):
    """Replay durable history without implicitly restarting execution."""

    events = await asyncio.to_thread(
        get_default_run_journal().list_events,
        run_id,
    )
    if not events:
        yield sse_json(
            "run_interrupted",
            {
                "run_id": run_id,
                "message": "Run has durable state but no live consumer; "
                "explicit resume is required.",
            },
        )
        return

    for event in events:
        yield sse_json(
            event.legacy_step or event.event_type,
            event.payload,
        )


async def _prepare_chat_run(
    data: Chat,
    request: Request,
    *,
    resume_attempt: RunAttemptRecord | None = None,
) -> _PreparedChatRun:
    """Bind fresh runtime inputs for a new Run or explicit Resume Attempt."""
    # TODO(brain-auth): Phase B should derive canonical user_id from
    # request.state.brain_auth, then verify/replace Chat.email before any
    # workspace snapshot, artifact path, or task lock is resolved.
    chat_logger.info(
        "Starting new chat session",
        extra={
            "project_id": data.project_id,
            "task_id": data.task_id,
            "user": data.email,
        },
    )

    task_lock = get_or_create_task_lock(data.project_id)

    # Set user-specific environment path for this thread
    set_user_env_path(data.env_path)
    # Load environment with validated path
    safe_env_path = sanitize_env_path(data.env_path)
    if safe_env_path:
        load_dotenv(dotenv_path=safe_env_path)

    resolver = get_workspace_resolver()
    try:
        frozen_dirs = resolver.freeze_task_directories(data, task_lock)
    except ValueError as exc:
        raise UserException(code.error, str(exc)) from exc

    try:
        await asyncio.to_thread(
            resolver.write_task_snapshot,
            data.email,
            frozen_dirs.snapshot,
        )
    except Exception:
        chat_logger.warning(
            "Failed to persist task workspace snapshot",
            extra={"project_id": data.project_id, "task_id": data.task_id},
            exc_info=True,
        )

    # Web mode: reuse an existing CDP endpoint first, otherwise acquire browser
    # through RemoteHands or launch a local browser when available.
    if not data.cdp_browsers:
        await _prepare_browser_for_request_with_timeout(
            request, data.browser_port
        )

    camel_log = _camel_log_dir(
        data.email,
        data.project_id,
        data.run_id or data.task_id,
        data.user_id,
    )
    camel_log.mkdir(parents=True, exist_ok=True)
    run_context = _build_run_context(data, frozen_dirs, request, camel_log)
    journal = get_default_run_journal()
    is_resume = resume_attempt is not None
    if is_resume:
        request_id = str(data.resume_request_id)
        attempt = resume_attempt
        if isinstance(journal, SQLiteRunJournal):
            persisted_spec = await asyncio.to_thread(
                _load_attempt_environment_spec,
                journal,
                attempt,
            )
            if persisted_spec is not None:
                template = _validate_resume_model_capability(
                    data,
                    persisted_spec,
                )
                _apply_environment_to_task_lock(
                    task_lock,
                    persisted_spec,
                    template=template,
                )
    else:
        await asyncio.to_thread(
            journal.ensure_run,
            run_id=run_context.run_id,
            project_id=run_context.project_id,
            status="pending",
        )
        request_id = _admission_request_id(
            run_context.run_id,
            question=data.question,
            attaches=data.attaches or [],
            project_context=data.project_context,
        )
        environment = None
        if isinstance(journal, SQLiteRunJournal):
            template = _legacy_environment_template(data)
            environment = await asyncio.to_thread(
                EnvironmentAdmissionService(journal).persist_for_run,
                run_id=run_context.run_id,
                space_id=run_context.space_id,
                working_directory=run_context.working_directory,
                created_by=(run_context.user_id or "local-user"),
                template=template,
            )
            _apply_environment_to_task_lock(
                task_lock,
                environment.spec,
                template=template,
            )
            try:
                await asyncio.to_thread(
                    get_default_workspace_git_coordinator().admit_run,
                    space_id=run_context.space_id,
                    project_id=run_context.project_id,
                    run_id=run_context.run_id,
                )
            except Exception:
                # Git is optional at Run admission. A broken repository blocks
                # later Git/file mutation, while pure conversation remains
                # available for recovery and user guidance.
                chat_logger.warning(
                    "Failed to pin optional Run Git workspace",
                    extra={
                        "space_id": run_context.space_id,
                        "project_id": run_context.project_id,
                        "run_id": run_context.run_id,
                    },
                    exc_info=True,
                )
        attempt = await asyncio.to_thread(
            journal.create_run_attempt,
            run_context.run_id,
            request_id=request_id,
            reason="initial_execution",
            activate=False,
            environment=(environment.binding if environment else None),
        )
    apply_run_env_for_third_party(run_context)
    task_lock.run_context = run_context

    # Local memory: write Space/Project/Run scaffolding + append user prompt.
    # Best-effort; MemoryService swallows write errors so chat keeps working.
    memory_service = get_memory_service()
    memory_mode = (
        "single_agent" if data.session_mode == "single-agent" else "workforce"
    )
    memory_space_source = (
        "legacy"
        if data.space_id and data.space_id.startswith("legacy_")
        else ("folder" if data.space_root_path else "blank")
    )
    if is_resume:
        memory_service.on_run_resume(run_context=run_context)
        # A prior consumer may have finalized the projection as interrupted in
        # this process. The new Attempt owns its own future finalization.
        finalized = getattr(task_lock, "_memory_finalized_runs", None)
        if finalized is not None:
            finalized.discard(run_context.run_id)
    else:
        memory_service.on_run_start(
            run_context=run_context,
            space_name=None,
            project_name=None,
            space_source_type=memory_space_source,
            mode=memory_mode,
            user_prompt=data.question,
            prompt_source="chat",
            conversation_event_id=f"memory:{request_id}",
        )
    task_lock.memory_service = memory_service

    # Set the initial current_task_id in task_lock
    set_current_task_id(data.project_id, data.task_id)

    resume_checkpoint = data.project_context
    if is_resume:
        tool_calls = await asyncio.to_thread(
            get_default_run_journal().list_tool_calls,
            run_context.run_id,
        )
        ledger_lines = ["=== Durable Tool Ledger (canonical) ==="]
        for tool in tool_calls[-_RESUME_TOOL_LEDGER_MAX_CALLS:]:
            ledger_lines.append(
                f"- {tool.tool_call_id}: {tool.tool_name}; "
                f"status={tool.status}; safety={tool.safety_class}; "
                f"outcome={tool.outcome or 'none'}"
            )
            if tool.result is not None:
                encoded_result = json.dumps(
                    tool.result,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                )
                ledger_lines.append(
                    "  persisted_result="
                    + encoded_result[:_RESUME_TOOL_RESULT_MAX_CHARS]
                )
        ledger_lines.append("=== End Durable Tool Ledger ===")
        resume_checkpoint = "\n\n".join(
            part
            for part in (
                data.project_context,
                "\n".join(ledger_lines),
            )
            if part
        )

    initial_action = ActionImproveData(
        data=ImprovePayload(
            question=(
                _EXPLICIT_RESUME_INSTRUCTION if is_resume else data.question
            ),
            attaches=data.attaches or [],
            project_context=resume_checkpoint,
        ),
        new_task_id=data.task_id,
        request_id=request_id,
        run_id=run_context.run_id,
        attempt_id=attempt.attempt_id,
    )

    chat_logger.info(
        "Chat session initialized",
        extra={
            "project_id": data.project_id,
            "task_id": data.task_id,
            "log_dir": str(camel_log),
            "working_directory": str(frozen_dirs.working_directory),
            "binding_source": frozen_dirs.binding_source,
        },
    )
    return _PreparedChatRun(
        task_lock=task_lock,
        run_context=run_context,
        attempt_id=attempt.attempt_id,
        initial_action=initial_action,
    )


async def start_chat_stream(data: Chat, request: Request):
    """Admit one detached execution or attach this SSE to an existing one."""

    run_id = data.run_id or data.task_id
    coordinator = get_default_run_coordinator()
    journal = get_default_run_journal()
    if isinstance(journal, SQLiteRunJournal):
        coordinator.bind_journal(journal)
    async with coordinator.admission_scope(run_id):
        subscription = await coordinator.attach_if_running(run_id)
        if subscription is not None:
            chat_logger.info(
                "Attached retry to existing Run consumer",
                extra={"run_id": run_id, "project_id": data.project_id},
            )
            return timeout_stream_wrapper(subscription, run_id=run_id)

        if data.resume_request_id:
            run = await asyncio.to_thread(journal.get_run, run_id)
            if run is None:
                raise UserException(code.error, "The Run no longer exists.")
            if run.project_id != data.project_id:
                raise UserException(
                    code.error, "The Run belongs to a different Project."
                )
            attempts = await asyncio.to_thread(
                journal.list_run_attempts, run_id
            )
            existing_attempt = next(
                (
                    attempt
                    for attempt in attempts
                    if attempt.resume_request_id == data.resume_request_id
                ),
                None,
            )
            if existing_attempt is None and run.status != "interrupted":
                raise UserException(
                    code.error,
                    f"Run cannot be resumed from state {run.status!r}.",
                )
            binding_source = existing_attempt or next(
                (
                    previous
                    for previous in reversed(attempts)
                    if previous.environment_spec_id is not None
                ),
                None,
            )
            resume_environment = _attempt_environment_binding(binding_source)
            attempt = await asyncio.to_thread(
                journal.create_run_attempt,
                run_id,
                request_id=data.resume_request_id,
                reason="explicit_resume",
                activate=False,
                environment=resume_environment,
            )
            if attempt.status not in {"pending", "running"}:
                raise UserException(
                    code.error,
                    "This Resume request already ended; start a new Resume action.",
                )
            try:
                prepared = await _prepare_chat_run(
                    data,
                    request,
                    resume_attempt=attempt,
                )
                await prepared.task_lock.put_queue(prepared.initial_action)
                execution_stream = step_solve(
                    data, request, prepared.task_lock
                )
                subscription = await coordinator.start_with_subscription(
                    run_id=prepared.run_context.run_id,
                    stream_factory=lambda: stream_with_run_context(
                        execution_stream,
                        lambda: getattr(
                            prepared.task_lock,
                            "run_context",
                            prepared.run_context,
                        ),
                    ),
                    command_queue=prepared.task_lock.queue,
                )
            except Exception:
                # Do not leave a durable pending Attempt with no consumer. A
                # fresh explicit Resume action can safely create Attempt N+1.
                try:
                    await asyncio.to_thread(
                        journal.append_event,
                        run_id,
                        RunEventDraft(
                            event_id=(
                                f"resume-admission-failed:{attempt.attempt_id}"
                            ),
                            event_type="runtime.interrupted",
                            payload={
                                "reason": "resume_admission_failed",
                                "attempt_id": attempt.attempt_id,
                            },
                        ),
                    )
                    from app.run_sync.runtime import (
                        notify_default_cloud_sync_worker,
                    )

                    notify_default_cloud_sync_worker()
                    get_memory_service().project_canonical_run_status(
                        run_id,
                        state="interrupted",
                        error="resume_admission_failed",
                    )
                except Exception:
                    chat_logger.exception(
                        "Failed to close a partial Resume admission",
                        extra={"run_id": run_id},
                    )
                raise
            return timeout_stream_wrapper(subscription, run_id=run_id)

        request_id = _admission_request_id(
            run_id,
            question=data.question,
            attaches=data.attaches or [],
            project_context=data.project_context,
        )
        admission, _attempt = await _classify_persisted_admission(
            journal,
            run_id=run_id,
            request_id=request_id,
        )
        if admission == "conflict":
            raise UserException(
                code.error,
                "This Run id is already bound to a different request.",
            )
        if admission == "duplicate":
            chat_logger.info(
                "Replaying persisted Run without implicit restart",
                extra={"run_id": run_id, "project_id": data.project_id},
            )
            return _replay_persisted_run(run_id)

        prepared = await _prepare_chat_run(data, request)
        await prepared.task_lock.put_queue(prepared.initial_action)
        execution_stream = step_solve(data, request, prepared.task_lock)
        subscription = await coordinator.start_with_subscription(
            run_id=prepared.run_context.run_id,
            stream_factory=lambda: stream_with_run_context(
                execution_stream,
                lambda: getattr(
                    prepared.task_lock, "run_context", prepared.run_context
                ),
            ),
            command_queue=prepared.task_lock.queue,
        )

    return timeout_stream_wrapper(subscription, run_id=run_id)


@router.post(
    "/chat", name="start chat", dependencies=_CHAT_CONTROL_DEPENDENCIES
)
async def post(data: Chat, request: Request):
    stream = await start_chat_stream(data, request)
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
    )


@router.get("/chat/{project_id}/status", name="get chat status")
async def status(project_id: str):
    task_lock = get_task_lock_if_exists(project_id)
    if task_lock is None:
        return {
            "project_id": project_id,
            "has_lock": False,
            "status": "offline",
            "current_task_id": None,
            "run_id": None,
            "consumer_alive": False,
            "subscriber_count": 0,
        }
    run_context = getattr(task_lock, "run_context", None)
    run_id = getattr(run_context, "run_id", None)
    handle = (
        await get_default_run_coordinator().get_handle(run_id)
        if run_id is not None
        else None
    )
    return {
        "project_id": project_id,
        "has_lock": True,
        "status": task_lock.status.value,
        "current_task_id": task_lock.current_task_id,
        "run_id": run_id,
        "consumer_alive": bool(handle and handle.consumer_alive),
        "subscriber_count": handle.subscriber_count if handle else 0,
    }


@router.post(
    "/chat/{id}",
    name="improve chat",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
async def improve(id: str, data: SupplementChat, request: Request):
    if data.task_id:
        coordinator = get_default_run_coordinator()
        async with coordinator.admission_scope(data.task_id):
            request_id = _admission_request_id(
                data.task_id,
                question=data.question,
                attaches=data.attaches or [],
                project_context=data.project_context,
            )
            admission, attempt = await _classify_persisted_admission(
                get_default_run_journal(),
                run_id=data.task_id,
                request_id=request_id,
            )
            if admission == "conflict":
                return Response(status_code=409)
            if admission == "duplicate" or (
                admission == "retry"
                and getattr(attempt, "status", None) == "running"
                and await coordinator.get_handle(data.task_id) is not None
            ):
                chat_logger.info(
                    "Ignored duplicate follow-up Run admission",
                    extra={"project_id": id, "run_id": data.task_id},
                )
                return Response(status_code=201)
            return await _improve_chat(
                id, data, request, admission_request_id=request_id
            )
    return await _improve_chat(id, data, request)


async def _improve_chat(
    id: str,
    data: SupplementChat,
    request: Request,
    *,
    admission_request_id: str | None = None,
):
    chat_logger.info(
        "Chat improvement requested",
        extra={"task_id": id, "question_length": len(data.question)},
    )
    task_lock = get_task_lock(id)

    # Reuse an existing endpoint when possible to avoid tearing down
    # a browser that was manually connected through the Browser page.
    current_context = getattr(task_lock, "run_context", None)
    previous_run_id = getattr(current_context, "run_id", None)
    previous_status = task_lock.status
    port = (
        current_context.browser_port
        if isinstance(current_context, RunContext)
        else int(env("browser_port", "9222"))
    )
    await _prepare_browser_for_request_with_timeout(request, port)

    # Allow continuing conversation even after task is done
    # This supports multi-turn conversation after complex task completion
    if task_lock.status == Status.done:
        # Reset status to allow processing new messages
        task_lock.status = Status.confirming
        # Clear any existing background tasks since workforce was stopped
        if hasattr(task_lock, "background_tasks"):
            task_lock.background_tasks.clear()
        # Note: conversation_history and last_task_result are preserved

        # Log context preservation
        if hasattr(task_lock, "conversation_history"):
            hist_len = len(task_lock.conversation_history)
            chat_logger.info(
                f"[CONTEXT] Preserved {hist_len} conversation entries"
            )
        if hasattr(task_lock, "last_task_result"):
            result_len = len(task_lock.last_task_result)
            chat_logger.info(
                f"[CONTEXT] Preserved task result: {result_len} chars"
            )

    # If task_id is provided, optimistically update
    # file_save_path (will be destroyed if task is
    # not complex)
    # this is because a NEW workforce instance may be created for this task
    new_folder_path = None
    if data.task_id:
        try:
            current_email = getattr(task_lock, "email", None)

            # If we have the necessary info, update
            # the file_save_path
            if current_email and id:
                resolver = get_workspace_resolver()
                frozen_dirs = await asyncio.to_thread(
                    resolver.freeze_task_directories_for,
                    space_id=getattr(task_lock, "space_id", id),
                    project_id=id,
                    task_id=data.task_id,
                    email=current_email,
                    task_lock=task_lock,
                    user_id=getattr(task_lock, "user_id", None),
                )
                try:
                    await asyncio.to_thread(
                        resolver.write_task_snapshot,
                        current_email,
                        frozen_dirs.snapshot,
                    )
                except Exception:
                    chat_logger.warning(
                        "Failed to persist task workspace snapshot",
                        extra={"project_id": id, "task_id": data.task_id},
                        exc_info=True,
                    )
                new_folder_path = frozen_dirs.task_output_root
                camel_log = _camel_log_dir(
                    current_email,
                    id,
                    data.task_id,
                    getattr(task_lock, "user_id", None),
                )
                await asyncio.to_thread(
                    camel_log.mkdir, parents=True, exist_ok=True
                )
                current_context = getattr(task_lock, "run_context", None)
                if isinstance(current_context, RunContext):
                    updated_context = replace(
                        current_context,
                        run_id=data.task_id,
                        task_id=data.task_id,
                        working_directory=frozen_dirs.working_directory,
                        task_output_root=frozen_dirs.task_output_root,
                        camel_log_dir=camel_log,
                        binding_source=frozen_dirs.binding_source,
                        browser_port=int(
                            getattr(request.state, "browser_port", port)
                        ),
                        cdp_url=getattr(
                            request.state, "cdp_url", current_context.cdp_url
                        ),
                    )
                    await asyncio.to_thread(
                        apply_run_env_for_third_party, updated_context
                    )
                    task_lock.run_context = updated_context
                chat_logger.info(
                    f"Updated file_save_path to: {new_folder_path}"
                )

                # Store the new folder path in task_lock
                # for potential cleanup and persistence
                task_lock.new_folder_path = (
                    new_folder_path
                    if frozen_dirs.binding_source == "default"
                    else None
                )
            else:
                chat_logger.warning(
                    "Could not update"
                    " file_save_path -"
                    f" email: {current_email},"
                    f" project_id: {id}"
                )

        except Exception as e:
            chat_logger.error(
                "Error updating file path for"
                f" project_id: {id},"
                f" task_id: {data.task_id}:"
                f" {e}"
            )

    # Local memory: this is a follow-up turn within the same Project. The
    # original on_run_start ran when the chat first started; here we open a
    # new Run record for the supplement turn so its conversation events are
    # bound to the right run_id.
    #
    # Strict guard: only open a new durable Run when run_context was actually
    # rotated to the supplied task_id. The workspace-rotation block above is
    # wrapped in a best-effort try/except, so a missing email, a resolver
    # failure, or any other swallowed exception can leave task_lock.run_context
    # pointing at the previous (finalized) run id. Calling on_run_start in
    # that state would reset the old run's status.json back to "running" and
    # the finalize dedup set then blocks the next end-of-turn writer from
    # closing it again -- leaving durable memory permanently divergent from
    # the visible chat flow.
    refreshed_context = getattr(task_lock, "run_context", None)
    rotation_succeeded = (
        data.task_id
        and isinstance(refreshed_context, RunContext)
        and refreshed_context.run_id == data.task_id
    )
    if rotation_succeeded:
        if previous_run_id is not None:
            rebound = await get_default_run_coordinator().rebind_run(
                previous_run_id,
                refreshed_context.run_id,
            )
            if not rebound:
                # Runtime ownership is a prerequisite for admission. Restore
                # the compatibility context before any canonical Run row,
                # Attempt, or Memory event is written so the same request can
                # be retried without leaving a replay-only orphan.
                if isinstance(current_context, RunContext):
                    task_lock.run_context = current_context
                    await asyncio.to_thread(
                        apply_run_env_for_third_party, current_context
                    )
                task_lock.status = previous_status
                raise UserException(
                    code.error,
                    "The previous Run has no live consumer for this follow-up.",
                )
        resolved_request_id = admission_request_id or _admission_request_id(
            refreshed_context.run_id,
            question=data.question,
            attaches=data.attaches or [],
            project_context=data.project_context,
        )
        journal = get_default_run_journal()
        await asyncio.to_thread(
            journal.ensure_run,
            run_id=refreshed_context.run_id,
            project_id=refreshed_context.project_id,
            status="pending",
        )
        environment = None
        template = getattr(
            task_lock,
            "environment_admission_template",
            None,
        )
        if isinstance(journal, SQLiteRunJournal) and isinstance(
            template,
            EnvironmentAdmissionTemplate,
        ):
            environment = await asyncio.to_thread(
                EnvironmentAdmissionService(journal).persist_for_run,
                run_id=refreshed_context.run_id,
                space_id=refreshed_context.space_id,
                working_directory=refreshed_context.working_directory,
                created_by=(refreshed_context.user_id or "local-user"),
                template=template,
            )
            _apply_environment_to_task_lock(
                task_lock,
                environment.spec,
                template=template,
            )
        attempt = await asyncio.to_thread(
            journal.create_run_attempt,
            refreshed_context.run_id,
            request_id=resolved_request_id,
            reason="follow_up_execution",
            activate=False,
            environment=(environment.binding if environment else None),
        )
        await asyncio.to_thread(
            get_memory_service().on_run_start,
            run_context=refreshed_context,
            space_name=None,
            project_name=None,
            space_source_type=(
                "legacy"
                if refreshed_context.space_id.startswith("legacy_")
                else "blank"
            ),
            mode=None,  # mode unchanged; preserve existing project.json value
            user_prompt=data.question,
            prompt_source="improve",
            conversation_event_id=f"memory:{resolved_request_id}",
        )
    elif data.task_id:
        # The client wanted a fresh run but rotation failed upstream. Don't
        # touch durable memory; the in-process turn still proceeds so the
        # user gets a response, but we leave a breadcrumb for diagnosis.
        raise UserException(
            code.error,
            "Could not durably prepare the requested follow-up Run.",
        )

    await task_lock.put_queue(
        ActionImproveData(
            data=ImprovePayload(
                question=data.question,
                attaches=data.attaches or [],
                project_context=data.project_context,
            ),
            new_task_id=data.task_id,
            request_id=(resolved_request_id if rotation_succeeded else None),
            run_id=(refreshed_context.run_id if rotation_succeeded else None),
            attempt_id=(attempt.attempt_id if rotation_succeeded else None),
        )
    )
    chat_logger.info(
        "Improvement request queued with preserved context",
        extra={"project_id": id},
    )
    return Response(status_code=201)


@router.put(
    "/chat/{id}",
    name="supplement task",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
def supplement(id: str, data: SupplementChat):
    chat_logger.info("Chat supplement requested", extra={"task_id": id})
    task_lock = get_task_lock(id)
    if task_lock.status != Status.done:
        raise UserException(code.error, "Please wait task done")
    _queue_action_from_worker(
        task_lock,
        ActionSupplementData(data=data),
        "supplement task queue action",
    )
    chat_logger.debug("Supplement data queued", extra={"task_id": id})
    return Response(status_code=201)


@router.delete(
    "/chat/{id}",
    name="stop chat",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
async def stop(id: str):
    """stop the task"""
    chat_logger.info("=" * 80)
    chat_logger.info(
        "🛑 [STOP-BUTTON] DELETE /chat/{id} request received from frontend"
    )
    chat_logger.info(f"[STOP-BUTTON] project_id/task_id: {id}")
    chat_logger.info("=" * 80)
    task_lock = get_task_lock_if_exists(id)
    if task_lock is not None:
        chat_logger.info(
            "[STOP-BUTTON] Task lock retrieved,"
            f" task_lock.id: {task_lock.id},"
            f" task_lock.status: {task_lock.status}"
        )
        chat_logger.info(
            "[STOP-BUTTON] Queueing"
            " ActionStopData(Action.stop)"
            " to task_lock queue"
        )
        try:
            await task_lock.put_queue(ActionStopData(action=Action.stop))
            chat_logger.info(
                "[STOP-BUTTON] ActionStopData queued"
                " successfully, this will trigger"
                " workforce.stop_gracefully()"
            )
        except Exception as e:
            chat_logger.warning(
                "[STOP-BUTTON] Failed to queue ActionStopData",
                extra={"task_id": id, "error": str(e)},
            )
    else:
        chat_logger.warning(
            "[STOP-BUTTON] Task lock not found, task may already be stopped",
            extra={"task_id": id},
        )
    return Response(status_code=204)


@router.post("/chat/{id}/human-reply", dependencies=_CHAT_CONTROL_DEPENDENCIES)
async def human_reply(id: str, data: HumanReply, request: Request):
    chat_logger.info(
        "Human reply received",
        extra={"task_id": id, "reply_length": len(data.reply)},
    )
    task_lock = get_task_lock_if_exists(id)
    if task_lock is None:
        chat_logger.warning(
            "Human reply ignored because task lock no longer exists",
            extra={"task_id": id, "agent": data.agent},
        )
        raise UserException(
            code.error,
            "This task is no longer waiting for a human reply. Please send a new message.",
        )
    run_context = getattr(task_lock, "run_context", None)
    if isinstance(run_context, RunContext):
        journal = get_default_run_journal()
        pending_interactions = await asyncio.to_thread(
            journal.list_human_interactions,
            run_context.run_id,
            pending_only=True,
        )
        interaction = next(
            (
                item
                for item in reversed(pending_interactions)
                if item.interaction_type != "approval"
                and item.request.get("agent") == data.agent
                and (
                    data.interaction_id is None
                    or item.interaction_id == data.interaction_id
                )
            ),
            None,
        )
        if interaction is not None:
            reply_decision = {"agent": data.agent, "reply": data.reply}
            request_id = data.decision_request_id or (
                "legacy-human-reply:"
                + canonical_digest(
                    {
                        "interaction_id": interaction.interaction_id,
                        "decision": reply_decision,
                    }
                )
            )
            await asyncio.to_thread(
                journal.resolve_human_interaction,
                interaction.interaction_id,
                decision_request_id=request_id,
                decision=reply_decision,
                expected_version=interaction.version,
                expected_run_id=run_context.run_id,
                continue_active_attempt=True,
            )
            try:
                from app.run_sync.runtime import (
                    notify_default_cloud_sync_worker,
                )

                notify_default_cloud_sync_worker()
            except Exception:
                chat_logger.exception(
                    "Failed to wake cloud sync after HumanInteraction decision"
                )
    try:
        await task_lock.put_human_input(data.agent, data.reply)
    except KeyError as exc:
        chat_logger.warning(
            "Human reply target is no longer waiting for input",
            extra={"task_id": id, "agent": data.agent},
        )
        raise UserException(
            code.error,
            "This task is no longer waiting for a human reply. Please send a new message.",
        ) from exc

    task_lock.add_conversation(
        "human_reply",
        {"agent": data.agent, "reply": data.reply},
    )
    memory_service = getattr(task_lock, "memory_service", None)
    if memory_service is not None and run_context is not None:
        memory_service.on_human_reply(
            run_context=run_context,
            content=data.reply,
        )

    current_context = getattr(task_lock, "run_context", None)
    cloud_task_id = (
        current_context.run_id
        if isinstance(current_context, RunContext)
        else (getattr(task_lock, "current_task_id", None) or id)
    )
    await sync_step_event(
        task_id=cloud_task_id,
        project_id=id,
        run_id=cloud_task_id,
        step="human_reply",
        data={"agent": data.agent, "reply": data.reply},
        authorization=request.headers.get("authorization"),
    )
    chat_logger.debug("Human reply processed", extra={"task_id": id})
    return Response(status_code=201)


@router.post("/chat/{id}/install-mcp", dependencies=_CHAT_CONTROL_DEPENDENCIES)
def install_mcp(id: str, data: McpServers):
    chat_logger.info(
        "Installing MCP servers",
        extra={
            "task_id": id,
            "servers_count": len(data.get("mcpServers", {})),
        },
    )
    task_lock = get_task_lock(id)
    _queue_action_from_worker(
        task_lock,
        ActionInstallMcpData(action=Action.install_mcp, data=data),
        "install MCP queue action",
    )
    chat_logger.info("MCP installation queued", extra={"task_id": id})
    return Response(status_code=201)


@router.post(
    "/chat/{id}/add-task",
    name="add task to workforce",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
def add_task(id: str, data: AddTaskRequest):
    """Add a new task to the workforce"""
    chat_logger.info(
        "Adding task to workforce for"
        f" task_id: {id},"
        f" content: {data.content[:100]}..."
    )
    task_lock = get_task_lock(id)

    try:
        # Queue the add task action
        add_task_action = ActionAddTaskData(
            content=data.content,
            project_id=data.project_id,
            task_id=data.task_id,
            additional_info=data.additional_info,
            insert_position=data.insert_position,
        )
        _queue_action_from_worker(
            task_lock,
            add_task_action,
            "add task queue action",
        )
        return Response(status_code=201)

    except Exception as e:
        chat_logger.error(f"Error adding task for task_id: {id}: {e}")
        raise UserException(code.error, f"Failed to add task: {str(e)}")


@router.delete(
    "/chat/{project_id}/remove-task/{task_id}",
    name="remove task from workforce",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
def remove_task(project_id: str, task_id: str):
    """Remove a task from the workforce"""
    chat_logger.info(
        f"Removing task {task_id} from workforce for project_id: {project_id}"
    )
    task_lock = get_task_lock(project_id)

    try:
        # Queue the remove task action
        remove_task_action = ActionRemoveTaskData(
            task_id=task_id, project_id=project_id
        )
        _queue_action_from_worker(
            task_lock,
            remove_task_action,
            "remove task queue action",
        )

        chat_logger.info(
            "Task removal request queued for"
            f" project_id: {project_id},"
            f" removing task: {task_id}"
        )
        return Response(status_code=204)

    except Exception as e:
        chat_logger.error(
            f"Error removing task {task_id} for project_id: {project_id}: {e}"
        )
        raise UserException(code.error, f"Failed to remove task: {str(e)}")


@router.post(
    "/chat/{project_id}/skip-task",
    name="skip task in workforce",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
def skip_task(project_id: str):
    """
    Skip/Stop current task execution while preserving context.
    This endpoint is called when user clicks the Stop button.

    Behavior:
    - Stops workforce gracefully
    - Marks task as done
    - Preserves conversation_history and last_task_result in task_lock
    - Sends 'end' event to frontend
    - Keeps SSE connection alive for multi-turn conversation
    """
    chat_logger.info("=" * 80)
    chat_logger.info(
        "[STOP-BUTTON] SKIP-TASK request"
        " received from frontend"
        " (User clicked Stop)"
    )
    chat_logger.info(f"[STOP-BUTTON] project_id: {project_id}")
    chat_logger.info("=" * 80)
    task_lock = get_task_lock_if_exists(project_id)
    if task_lock is None:
        chat_logger.warning(
            "[STOP-BUTTON] Task lock not found, task may already be stopped",
            extra={"project_id": project_id},
        )
        return Response(status_code=204)
    chat_logger.info(
        "[STOP-BUTTON] Task lock retrieved,"
        f" task_lock.id: {task_lock.id},"
        " task_lock.status:"
        f" {task_lock.status}"
    )

    try:
        # Queue the skip task action - this will
        # preserve context for multi-turn
        skip_task_action = ActionSkipTaskData(project_id=project_id)
        chat_logger.info(
            "[STOP-BUTTON] Queueing"
            " ActionSkipTaskData"
            " (preserves context,"
            " marks as done)"
        )
        _queue_action_from_worker(
            task_lock,
            skip_task_action,
            "skip task queue action",
        )

        chat_logger.info(
            "[STOP-BUTTON] Skip request"
            " queued - task will stop"
            " gracefully and preserve context"
        )
        return Response(status_code=201)

    except Exception as e:
        chat_logger.error(
            "[STOP-BUTTON] Error skipping"
            " task for"
            f" project_id: {project_id}:"
            f" {e}"
        )
        raise UserException(code.error, f"Failed to skip task: {str(e)}")
