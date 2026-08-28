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
from typing import Any

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

from app.auth import require_local_control_principal
from app.component import code
from app.component.environment import env, sanitize_env_path, set_user_env_path
from app.exception.exception import UserException
from app.model.chat import (
    AddTaskRequest,
    Chat,
    FollowUpRequestAdmitted,
    FollowUpRequestCreate,
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
    EventRecorder,
    FollowUpRequestRecord,
    IdempotencyConflictError,
    InvalidRunTransitionError,
    RunAttemptRecord,
    RunEventDraft,
    RunNotFoundError,
    SQLiteRunJournal,
    configured_run_journal_path,
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
    has_eigent_embedded_browser_target,
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
from app.workspace_bundle.runtime import (
    EnvironmentSetupRequiredError,
    ResolvedRuntimeEnvironment,
    RuntimeEnvironmentAssembler,
)
from app.workspace_config import (
    EffectiveEnvironmentSpec,
    WorkspaceBundleReconfigurationPendingError,
    canonical_digest,
)
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


def _follow_up_response(record: FollowUpRequestRecord) -> dict[str, Any]:
    return {
        "request_id": record.request_id,
        "project_id": record.project_id,
        "content": record.content,
        "attachment_paths": list(record.attachment_paths),
        "review_handoff_ids": list(record.review_handoff_ids),
        "delivery_mode": record.delivery_mode,
        "status": record.status,
        "admitted_run_id": record.admitted_run_id,
        "source": record.source,
        "source_command_id": record.source_command_id,
        "last_error": record.last_error,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def _raise_follow_up_http_error(exc: Exception) -> None:
    if isinstance(exc, RunNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, (IdempotencyConflictError, InvalidRunTransitionError)):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    raise exc


async def _record_canonical_user_message(
    journal: SQLiteRunJournal,
    *,
    run_context: RunContext,
    request_id: str,
    content: str,
    source: str,
    attaches: list[str],
    review_handoff_ids: list[str] | None = None,
) -> None:
    """Persist admission input against the injected journal instance."""

    await EventRecorder(journal).record_user_message(
        project_id=run_context.project_id,
        run_id=run_context.run_id,
        request_id=request_id,
        content=content,
        source=source,
        attachment_names=[Path(path).name for path in attaches],
        review_handoff_ids=review_handoff_ids,
    )


def _workspace_bundle_admission_error(
    exc: WorkspaceBundleReconfigurationPendingError,
) -> UserException:
    return UserException(
        code.error,
        f"{exc}. Open Workspace configuration > Local setup and sync the "
        "pending changes.",
        error_code=exc.code,
    )


def _environment_setup_error(
    exc: EnvironmentSetupRequiredError,
) -> UserException:
    return UserException(
        code.error,
        "This Workspace needs local setup before the Run can start. Open "
        "Workspace configuration and complete the missing bindings. "
        f"({', '.join(exc.issues)})",
        error_code=exc.code,
    )


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
    skill_config: dict[str, Any] = {}
    skill_owner = data.skill_config_user_id()
    if skill_owner:
        try:
            from app.service.skill_config_service import skill_config_load

            skill_config = skill_config_load(skill_owner)
        except Exception:
            chat_logger.warning(
                "Failed to import legacy skills into Personal Default Bundle",
                exc_info=True,
            )
    mcp_configs = data.installed_mcp.get("mcpServers") or {}
    return LegacyEnvironmentImporter().build_template(
        model_platform=data.model_platform,
        model_type=data.model_type,
        auth_source=data.auth_source,
        requested_effort=data.thinking_effort,
        allow_local_system=data.allow_local_system,
        mcp_server_names=tuple(mcp_configs.keys()),
        mcp_server_configs=mcp_configs,
        skill_config=skill_config,
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


def _planned_resume_attempt(
    *,
    run_id: str,
    resume_request_id: str,
    existing_attempt: RunAttemptRecord | None,
    binding_source: RunAttemptRecord | None,
) -> RunAttemptRecord:
    if existing_attempt is not None:
        return existing_attempt
    attempt_id = (
        "resume-"
        + hashlib.sha256(
            f"{run_id}\0{resume_request_id}".encode()
        ).hexdigest()[:32]
    )
    if binding_source is not None:
        return replace(
            binding_source,
            attempt_id=attempt_id,
            attempt_number=binding_source.attempt_number + 1,
            status="pending",
            started_at=0,
            ended_at=None,
            outcome=None,
            timeout_reason=None,
            resume_request_id=resume_request_id,
            resume_reason="explicit_resume",
            elapsed_active_ms=0,
            last_consumer_heartbeat_at=None,
        )
    return RunAttemptRecord(
        attempt_id=attempt_id,
        run_id=run_id,
        attempt_number=1,
        status="pending",
        started_at=0,
        ended_at=None,
        outcome=None,
        timeout_reason=None,
        resume_request_id=resume_request_id,
        resume_reason="explicit_resume",
        policy_version="v1",
        elapsed_active_ms=0,
        last_consumer_heartbeat_at=None,
    )


def _apply_environment_to_task_lock(
    task_lock: TaskLock,
    spec: EffectiveEnvironmentSpec,
    *,
    template: EnvironmentAdmissionTemplate | None,
    runtime_environment: ResolvedRuntimeEnvironment | None = None,
) -> None:
    task_lock.environment_admission_template = template
    task_lock.environment_spec_id = spec.spec_id
    task_lock.thinking_effort_requested = spec.thinking_effort_requested.value
    task_lock.thinking_effort_effective = spec.thinking_effort_effective.value
    task_lock.provider_effort_parameter_name = spec.provider_parameter_name
    task_lock.provider_effort_parameter_value = spec.provider_value
    task_lock.provider_capability_revision = spec.provider_capability_revision
    task_lock.resolved_runtime_environment = runtime_environment


def _space_root_for_run(run_context: RunContext) -> Path:
    root = get_workspace_resolver().space_root(
        run_context.space_id,
        run_context.project_id,
        run_context.email,
        run_context.user_id,
    )
    return (root or run_context.working_directory).expanduser().resolve()


def _assemble_runtime_environment(
    journal: SQLiteRunJournal,
    spec: EffectiveEnvironmentSpec,
    run_context: RunContext,
) -> ResolvedRuntimeEnvironment | None:
    return RuntimeEnvironmentAssembler(
        journal,
        state_root=(configured_run_journal_path().parent / "workspace-git"),
    ).assemble(
        spec,
        space_id=run_context.space_id,
        space_root=_space_root_for_run(run_context),
    )


def _require_supported_bundle_session_mode(
    session_mode: str | None,
    runtime_environment: ResolvedRuntimeEnvironment | None,
) -> None:
    if runtime_environment is not None and session_mode != "single-agent":
        raise EnvironmentSetupRequiredError(
            ["bundle_session_mode_unsupported"]
        )


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
    try:
        spec = EffectiveEnvironmentSpec.model_validate(record.spec)
    except Exception as exc:
        raise UserException(
            code.error,
            "The Run's persisted EnvironmentSpec is invalid.",
        ) from exc
    record_binding = (
        record.environment_spec_id,
        record.environment_spec_digest,
        record.bundle_revision_id,
        record.manifest_digest,
        record.semantic_spec_digest,
        record.local_materialization_digest,
        record.permission_profile_revision,
        record.provider_capability_revision,
    )
    spec_binding = (
        spec.spec_id,
        spec.digest,
        spec.bundle_revision_id,
        spec.manifest_digest,
        spec.semantic_spec_digest,
        spec.local_materialization_digest,
        spec.permission_profile_revision,
        spec.provider_capability_revision,
    )
    attempt_binding = (
        attempt.environment_spec_id,
        attempt.environment_spec_digest,
        attempt.bundle_revision_id,
        attempt.permission_profile_revision,
        attempt.thinking_effort_requested,
        attempt.thinking_effort_effective,
        attempt.provider_capability_revision,
    )
    expected_attempt_binding = (
        spec.spec_id,
        spec.digest,
        spec.bundle_revision_id,
        spec.permission_profile_revision,
        spec.thinking_effort_requested.value,
        spec.thinking_effort_effective.value,
        spec.provider_capability_revision,
    )
    if (
        record_binding != spec_binding
        or attempt_binding != expected_attempt_binding
    ):
        raise UserException(
            code.error,
            "The Run's persisted EnvironmentSpec binding is inconsistent.",
        )
    return spec


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
    review_handoff_ids: list[str] | None = None,
    project_context: str | None = None,
) -> str:
    # ``project_context`` is a rebuildable renderer projection and can change
    # between retries.  It must never participate in durable admission
    # identity.  Keep the parameter temporarily for call-site compatibility.
    del project_context
    canonical = json.dumps(
        {
            "question": question,
            "attaches": attaches,
            "review_handoff_ids": list(review_handoff_ids or []),
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


_WEAK_CONTINUATION_MESSAGES = frozenset(
    {
        "continue",
        "continue.",
        "go on",
        "go on.",
        "keep going",
        "keep going.",
        "proceed",
        "proceed.",
        "继续",
        "继续。",
        "继续吧",
        "接着继续",
    }
)

_UNKNOWN_SIDE_EFFECT_ACKNOWLEDGEMENTS = frozenset(
    {
        "i acknowledge the tool may have executed; do not retry it; continue",
        "我确认该工具可能已经执行，不要重试，继续",
        "我确认该工具可能已经执行，不要重试，继续。",
    }
)


def _is_weak_continuation(content: str) -> bool:
    return " ".join(content.strip().lower().split()) in (
        _WEAK_CONTINUATION_MESSAGES
    )


def _acknowledges_unknown_side_effect(content: str) -> bool:
    return " ".join(content.strip().lower().split()) in (
        _UNKNOWN_SIDE_EFFECT_ACKNOWLEDGEMENTS
    )


def _continuation_http_error(
    *, code_value: str, message: str, project_state_version: int
) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": code_value,
            "message": message,
            "project_state_version": project_state_version,
            "interaction_type": "continuation_clarification",
        },
    )


async def _reject_pending_continuation(
    journal: SQLiteRunJournal,
    *,
    project_id: str,
    request_id: str,
    code_value: str,
    message: str,
) -> None:
    """Stop durable retries for a continuation needing new user intent."""

    try:
        await asyncio.to_thread(
            journal.reject_follow_up_request,
            request_id=request_id,
            project_id=project_id,
            error=f"{code_value}: {message}",
        )
    except RunNotFoundError:
        # Direct messages are resolved before a queue row exists. The typed
        # HTTP response is their complete clarification contract.
        return


async def _resolve_continuation_admission(
    journal: SQLiteRunJournal,
    *,
    data: Chat | SupplementChat,
    project_id: str,
    run_id: str,
) -> Chat | SupplementChat:
    """Resolve weak continuation intent before any model inference."""

    acknowledges_unknown = _acknowledges_unknown_side_effect(data.question)
    if not _is_weak_continuation(data.question) and not acknowledges_unknown:
        return data
    active = await asyncio.to_thread(
        journal.get_active_project_run, project_id
    )
    state = await asyncio.to_thread(
        journal.get_project_execution_state, project_id
    )
    if active is not None and active.run_id != run_id:
        raise _continuation_http_error(
            code_value="follow_up_must_queue",
            message="The active Run must finish or be stopped before this message is admitted.",
            project_state_version=state.state_version,
        )

    recent = await asyncio.to_thread(
        journal.list_runs,
        project_id=project_id,
        limit=1,
    )
    latest = recent[0] if recent else None
    latest_tool_calls = (
        await asyncio.to_thread(journal.list_tool_calls, latest.run_id)
        if latest
        else []
    )
    latest_has_unknown_tool_outcome = any(
        tool.status == "outcome_unknown" for tool in latest_tool_calls
    )
    if latest is not None and latest.status == "interrupted":
        message = (
            "The interrupted Run has an unknown external side effect. Review it and explicitly Resume or Cancel."
            if latest_has_unknown_tool_outcome
            else "The latest Run was interrupted. Use the explicit Resume action; the word continue never resumes it."
        )
        code_value = (
            "continuation_outcome_unknown"
            if latest_has_unknown_tool_outcome
            else "continuation_resume_required"
        )
        await _reject_pending_continuation(
            journal,
            project_id=project_id,
            request_id=run_id,
            code_value=code_value,
            message=message,
        )
        raise _continuation_http_error(
            code_value=code_value,
            message=message,
            project_state_version=state.state_version,
        )

    frontier = state.frontier or {}
    next_action = frontier.get("next_action")
    remaining = frontier.get("remaining")
    retry_failed_run = False
    if latest is not None and latest.status == "failed":
        blocked_by = frontier.get("blocked_by")
        if (
            latest_has_unknown_tool_outcome
            or blocked_by == "external_tool_outcome_unknown"
        ):
            if not acknowledges_unknown:
                message = (
                    "The failed Run has an unknown external side effect. "
                    "Review the durable tool outcome. To continue without "
                    "replaying it, send exactly: I acknowledge the tool may "
                    "have executed; do not retry it; continue"
                )
                await _reject_pending_continuation(
                    journal,
                    project_id=project_id,
                    request_id=run_id,
                    code_value="continuation_outcome_unknown",
                    message=message,
                )
                raise _continuation_http_error(
                    code_value="continuation_outcome_unknown",
                    message=message,
                    project_state_version=state.state_version,
                )
        retry_failed_run = True
        if not isinstance(next_action, str) or not next_action.strip():
            objective = frontier.get("objective")
            if (
                not latest_tool_calls
                and isinstance(objective, str)
                and objective.strip()
            ):
                # A provider/admission failure can terminate before the Agent
                # produces a Todo frontier. Retrying the durable objective is
                # safe only after proving no tool execution began; this is a
                # new Run, never an implicit Resume.
                next_action = objective.strip()
    if not isinstance(next_action, str) or not next_action.strip():
        message = (
            "The saved Project frontier has no unfinished next action. "
            "Say what new work you want to continue."
        )
        await _reject_pending_continuation(
            journal,
            project_id=project_id,
            request_id=run_id,
            code_value="continuation_clarification_required",
            message=message,
        )
        raise _continuation_http_error(
            code_value="continuation_clarification_required",
            message=message,
            project_state_version=state.state_version,
        )
    if not isinstance(remaining, list):
        remaining = []
    claim, created = await asyncio.to_thread(
        journal.claim_continuation,
        # The future Run id is the durable transport idempotency key. The
        # payload-derived admission request id is intentionally not used as
        # semantic Project identity.
        request_id=run_id,
        project_id=project_id,
        intent="continue_project",
        base_run_id=state.frontier_run_id,
        next_action=next_action.strip(),
    )
    if not created and claim.request_id != run_id:
        message = (
            "The Project has not advanced since the previous continue "
            "request. Clarify what should change instead of repeating it."
        )
        await _reject_pending_continuation(
            journal,
            project_id=project_id,
            request_id=run_id,
            code_value="continuation_duplicate_without_progress",
            message=message,
        )
        raise _continuation_http_error(
            code_value="continuation_duplicate_without_progress",
            message=message,
            project_state_version=state.state_version,
        )
    continuation_mode = (
        "retry_failed_run" if retry_failed_run else "advance_frontier"
    )
    directive = (
        "=== Durable Continuation Intent ===\n"
        "intent: continue_project\n"
        f"mode: {continuation_mode}\n"
        f"project_state_version: {state.state_version}\n"
        f"base_run_id: {state.frontier_run_id or ''}\n"
        f"next_action: {next_action.strip()}\n"
        f"remaining: {json.dumps(remaining, ensure_ascii=False)}\n"
        "Continue from durable Project history. Do not repeat completed "
        "external actions or the prior final answer.\n"
        + (
            "unknown_external_side_effect_acknowledged: true\n"
            "A previous tool may already have executed. Do not replay it; "
            "continue only with the saved next action.\n"
            if acknowledges_unknown
            else ""
        )
        + "=== End Durable Continuation Intent ==="
    )
    # The Workforce execution path does not consume ``project_context``.
    # Put the resolved continuation in the actual model instruction so it
    # cannot be silently discarded after the durable claim is recorded.
    return data.model_copy(
        update={"question": f"{data.question.strip()}\n\n{directive}"}
    )


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
    target_url: str | None = None,
) -> bool:
    if env("EIGENT_RUNTIME", "").lower().strip() == "electron":
        configured_port = env("EIGENT_ELECTRON_CDP_PORT", "").strip()
        try:
            embedded_port = int(configured_port) if configured_port else port
        except (TypeError, ValueError):
            embedded_port = port
        endpoint = f"http://127.0.0.1:{embedded_port}"
        has_owned_target = await asyncio.to_thread(
            has_eigent_embedded_browser_target,
            endpoint,
            target_url,
        )
        if target_url and has_owned_target:
            if request is not None:
                request.state.browser_available = True
                request.state.cdp_url = endpoint
                request.state.browser_port = embedded_port
            return True

        chat_logger.warning(
            "Electron embedded browser is unavailable; refusing external "
            "browser fallback",
            extra={
                "port": embedded_port,
                "target_url_supplied": bool(target_url),
                "owned_target_available": has_owned_target,
            },
        )
        if request is not None:
            request.state.browser_available = False
            request.state.cdp_url = None
            request.state.browser_port = embedded_port
        return False

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
    target_url: str | None = None,
) -> bool:
    timeout = _browser_prepare_timeout_seconds()
    try:
        return await asyncio.wait_for(
            _prepare_browser_for_request(request, port, target_url),
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
        session_mode=data.session_mode,
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
    admission_request_id: str | None = None,
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
    # Never let a failed admission inherit an Agent/tool runtime from a prior
    # Run in the same Project-scoped TaskLock.
    task_lock.resolved_runtime_environment = None
    # Persist only the non-sensitive execution shape needed by a later
    # SupplementChat. The follow-up payload intentionally does not duplicate
    # Chat model credentials or session configuration.
    task_lock.runtime_session_mode = data.session_mode

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

    # Electron is restricted to its owned WebContentsView target. A standalone
    # Brain used by the Web client may reuse RemoteHands or provision an
    # external Chrome/Chromium endpoint.
    electron_runtime = env("EIGENT_RUNTIME", "").lower().strip() == "electron"
    embedded_target_url = next(
        (
            str(browser.get("targetUrl"))
            for browser in data.cdp_browsers
            if browser.get("managedBy") == "electron"
            and browser.get("targetUrl")
        ),
        None,
    )
    if electron_runtime or not data.cdp_browsers:
        browser_ready = await _prepare_browser_for_request_with_timeout(
            request,
            data.browser_port,
            embedded_target_url,
        )
        if electron_runtime and not browser_ready:
            # Never let an Electron request fall through to the shared CDP
            # endpoint without an exact Eigent-owned target descriptor.
            data.cdp_browsers = []

    camel_log = _camel_log_dir(
        data.email,
        data.project_id,
        data.run_id or data.task_id,
        data.user_id,
    )
    camel_log.mkdir(parents=True, exist_ok=True)
    run_context = _build_run_context(data, frozen_dirs, request, camel_log)
    journal = get_default_run_journal()
    if isinstance(journal, SQLiteRunJournal):
        # The request body is not an ownership authority. Persist only a
        # candidate; CloudSync promotes it after device registration proves
        # the authenticated Cloud account.
        await asyncio.to_thread(
            journal.register_memory_scope_owner_candidates,
            project_id=run_context.project_id,
            space_id=run_context.space_id,
            claimed_account_owner_id=run_context.user_id,
        )
        await asyncio.to_thread(
            journal.bind_memory_project_scopes,
            project_id=run_context.project_id,
            space_id=run_context.space_id,
            user_id=run_context.user_id,
        )
    is_resume = data.resume_request_id is not None
    if is_resume:
        request_id = str(data.resume_request_id)
        if (
            isinstance(journal, SQLiteRunJournal)
            and resume_attempt is not None
        ):
            attempt = resume_attempt
            persisted_spec = await asyncio.to_thread(
                _load_attempt_environment_spec,
                journal,
                resume_attempt,
            )
            needs_legacy_environment_backfill = persisted_spec is None
            backfilled_environment = None
            if needs_legacy_environment_backfill:
                template = _legacy_environment_template(data)
                try:
                    backfilled_environment = await asyncio.to_thread(
                        EnvironmentAdmissionService(journal).persist_for_run,
                        run_id=run_context.run_id,
                        space_id=run_context.space_id,
                        working_directory=run_context.working_directory,
                        space_root=_space_root_for_run(run_context),
                        created_by=(run_context.user_id or "local-user"),
                        template=template,
                    )
                except WorkspaceBundleReconfigurationPendingError as exc:
                    raise _workspace_bundle_admission_error(exc) from exc
                except EnvironmentSetupRequiredError as exc:
                    raise _environment_setup_error(exc) from exc
                persisted_spec = backfilled_environment.spec
            else:
                template = _validate_resume_model_capability(
                    data,
                    persisted_spec,
                )
            try:
                runtime_environment = await asyncio.to_thread(
                    _assemble_runtime_environment,
                    journal,
                    persisted_spec,
                    run_context,
                )
            except EnvironmentSetupRequiredError as exc:
                raise _environment_setup_error(exc) from exc
            try:
                _require_supported_bundle_session_mode(
                    data.session_mode,
                    runtime_environment,
                )
            except EnvironmentSetupRequiredError as exc:
                raise _environment_setup_error(exc) from exc
            if backfilled_environment is not None:
                attempt = await asyncio.to_thread(
                    journal.bind_pending_attempt_environment,
                    resume_attempt.attempt_id,
                    run_id=run_context.run_id,
                    request_id=request_id,
                    environment=backfilled_environment.binding,
                )
            _apply_environment_to_task_lock(
                task_lock,
                persisted_spec,
                template=template,
                runtime_environment=runtime_environment,
            )
            if needs_legacy_environment_backfill:
                try:
                    await asyncio.to_thread(
                        get_default_workspace_git_coordinator().admit_run,
                        space_id=run_context.space_id,
                        project_id=run_context.project_id,
                        run_id=run_context.run_id,
                        task_id=run_context.task_id,
                        session_mode=run_context.session_mode,
                    )
                except Exception:
                    chat_logger.warning(
                        "Failed to pin optional backfilled Resume Git workspace",
                        extra={
                            "space_id": run_context.space_id,
                            "project_id": run_context.project_id,
                            "run_id": run_context.run_id,
                        },
                        exc_info=True,
                    )
        else:
            attempt = resume_attempt
    else:
        await asyncio.to_thread(
            journal.ensure_run,
            run_id=run_context.run_id,
            project_id=run_context.project_id,
            status="pending",
        )
        request_id = admission_request_id or _admission_request_id(
            run_context.run_id,
            question=data.question,
            attaches=data.attaches or [],
            review_handoff_ids=data.review_handoff_ids,
            project_context=data.project_context,
        )
        environment = None
        if isinstance(journal, SQLiteRunJournal):
            template = _legacy_environment_template(data)
            try:
                environment = await asyncio.to_thread(
                    EnvironmentAdmissionService(journal).persist_for_run,
                    run_id=run_context.run_id,
                    space_id=run_context.space_id,
                    working_directory=run_context.working_directory,
                    space_root=_space_root_for_run(run_context),
                    created_by=(run_context.user_id or "local-user"),
                    template=template,
                )
            except WorkspaceBundleReconfigurationPendingError as exc:
                raise _workspace_bundle_admission_error(exc) from exc
            except EnvironmentSetupRequiredError as exc:
                raise _environment_setup_error(exc) from exc
            try:
                runtime_environment = await asyncio.to_thread(
                    _assemble_runtime_environment,
                    journal,
                    environment.spec,
                    run_context,
                )
            except EnvironmentSetupRequiredError as exc:
                raise _environment_setup_error(exc) from exc
            try:
                _require_supported_bundle_session_mode(
                    data.session_mode,
                    runtime_environment,
                )
            except EnvironmentSetupRequiredError as exc:
                raise _environment_setup_error(exc) from exc
            _apply_environment_to_task_lock(
                task_lock,
                environment.spec,
                template=template,
                runtime_environment=runtime_environment,
            )
        attempt = await asyncio.to_thread(
            journal.create_run_attempt,
            run_context.run_id,
            request_id=request_id,
            reason="initial_execution",
            activate=False,
            environment=(environment.binding if environment else None),
        )
        if isinstance(journal, SQLiteRunJournal):
            try:
                await asyncio.to_thread(
                    get_default_workspace_git_coordinator().admit_run,
                    space_id=run_context.space_id,
                    project_id=run_context.project_id,
                    run_id=run_context.run_id,
                    task_id=run_context.task_id,
                    session_mode=run_context.session_mode,
                )
            except Exception:
                # Git is optional at Run admission. A broken repository blocks
                # later Git/file mutation, while pure conversation remains
                # available for recovery and user guidance. The Attempt is
                # created first so a failed Project lease admission can never
                # leave a checkout writer without an owning Attempt.
                chat_logger.warning(
                    "Failed to pin optional Run Git workspace",
                    extra={
                        "space_id": run_context.space_id,
                        "project_id": run_context.project_id,
                        "run_id": run_context.run_id,
                    },
                    exc_info=True,
                )
        await _record_canonical_user_message(
            journal,
            run_context=run_context,
            request_id=request_id,
            content=data.question,
            source="chat",
            attaches=data.attaches or [],
            review_handoff_ids=data.review_handoff_ids,
        )
    if attempt is not None:
        run_context = replace(run_context, attempt_id=attempt.attempt_id)
    apply_run_env_for_third_party(run_context)
    task_lock.run_context = run_context

    # Canonical conversation and Run continuity live in SQLite RunJournal.
    # Lightweight Memory is maintained from that cursor after terminal events;
    # never duplicate the transcript into LocalMemory V1 here.
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
        attempt_id=(attempt.attempt_id if attempt is not None else None),
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
        attempt_id=(attempt.attempt_id if attempt is not None else ""),
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
            planned_attempt = _planned_resume_attempt(
                run_id=run_id,
                resume_request_id=data.resume_request_id,
                existing_attempt=existing_attempt,
                binding_source=binding_source,
            )
            if (
                existing_attempt is not None
                and existing_attempt.status
                not in {
                    "pending",
                    "running",
                }
            ):
                raise UserException(
                    code.error,
                    "This Resume request already ended; start a new Resume action.",
                )
            try:
                prepared = await _prepare_chat_run(
                    data,
                    request,
                    resume_attempt=planned_attempt,
                )
                attempts_after_preflight = await asyncio.to_thread(
                    journal.list_run_attempts,
                    run_id,
                )
                attempt = next(
                    (
                        item
                        for item in attempts_after_preflight
                        if item.resume_request_id == data.resume_request_id
                    ),
                    None,
                )
                if attempt is None:
                    attempt = await asyncio.to_thread(
                        journal.create_run_attempt,
                        run_id,
                        request_id=data.resume_request_id,
                        reason=planned_attempt.resume_reason,
                        activate=False,
                        attempt_id=planned_attempt.attempt_id,
                        environment=_attempt_environment_binding(
                            binding_source
                        ),
                    )
                bound_context = replace(
                    prepared.run_context,
                    attempt_id=attempt.attempt_id,
                )
                prepared.task_lock.run_context = bound_context
                prepared = replace(
                    prepared,
                    run_context=bound_context,
                    attempt_id=attempt.attempt_id,
                    initial_action=prepared.initial_action.model_copy(
                        update={"attempt_id": attempt.attempt_id}
                    ),
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
                # runtime preflight failure creates no Attempt; failures after
                # admission close the exact idempotent Resume Attempt.
                try:
                    attempts_after_failure = await asyncio.to_thread(
                        journal.list_run_attempts,
                        run_id,
                    )
                    failed_attempt = next(
                        (
                            item
                            for item in attempts_after_failure
                            if item.resume_request_id == data.resume_request_id
                            and item.status in {"pending", "running"}
                        ),
                        None,
                    )
                    if failed_attempt is None:
                        failed_attempt = await asyncio.to_thread(
                            journal.create_run_attempt,
                            run_id,
                            request_id=data.resume_request_id,
                            reason=planned_attempt.resume_reason,
                            activate=False,
                            attempt_id=planned_attempt.attempt_id,
                            environment=_attempt_environment_binding(
                                binding_source
                            ),
                        )
                    if failed_attempt is not None:
                        await asyncio.to_thread(
                            journal.append_event,
                            run_id,
                            RunEventDraft(
                                event_id=(
                                    "resume-admission-failed:"
                                    f"{failed_attempt.attempt_id}"
                                ),
                                event_type="runtime.interrupted",
                                payload={
                                    "reason": "resume_admission_failed",
                                    "attempt_id": failed_attempt.attempt_id,
                                },
                            ),
                        )
                        from app.run_sync.runtime import (
                            notify_default_cloud_sync_worker,
                        )

                        notify_default_cloud_sync_worker()
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
            review_handoff_ids=data.review_handoff_ids,
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

        data = await _resolve_continuation_admission(
            journal,
            data=data,
            project_id=data.project_id,
            run_id=run_id,
        )
        try:
            prepared = await _prepare_chat_run(
                data,
                request,
                admission_request_id=request_id,
            )
        except Exception:
            if _is_weak_continuation(data.question):
                await asyncio.to_thread(
                    journal.release_unadmitted_continuation,
                    request_id=run_id,
                )
            raise
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
    "/projects/{project_id}/follow-ups",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
async def enqueue_follow_up(project_id: str, data: FollowUpRequestCreate):
    try:
        record = await asyncio.to_thread(
            get_default_run_journal().put_follow_up_request,
            request_id=data.request_id,
            project_id=project_id,
            content=data.content,
            attachment_paths=data.attachment_paths,
            review_handoff_ids=data.review_handoff_ids,
            delivery_mode=data.delivery_mode,
            source=data.source,
            source_command_id=data.source_command_id,
        )
    except Exception as exc:
        _raise_follow_up_http_error(exc)
    return _follow_up_response(record)


@router.get(
    "/projects/{project_id}/follow-ups",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
async def pending_follow_ups(project_id: str):
    try:
        records = await asyncio.to_thread(
            get_default_run_journal().list_follow_up_requests,
            project_id=project_id,
        )
    except Exception as exc:
        _raise_follow_up_http_error(exc)
    return {"items": [_follow_up_response(record) for record in records]}


@router.get(
    "/follow-ups/pending",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
async def pending_follow_ups_by_source(
    source: str = "remote_control",
):
    try:
        records = await asyncio.to_thread(
            get_default_run_journal().list_pending_follow_up_requests_by_source,
            source=source,
        )
    except Exception as exc:
        _raise_follow_up_http_error(exc)
    return {"items": [_follow_up_response(record) for record in records]}


@router.get(
    "/follow-ups/source-command/{source_command_id}",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
async def follow_up_by_source_command(source_command_id: str):
    """Resolve a Remote Control enqueue after a renderer restart."""

    try:
        record = await asyncio.to_thread(
            get_default_run_journal().get_follow_up_request_by_source_command_id,
            source_command_id=source_command_id,
        )
    except Exception as exc:
        _raise_follow_up_http_error(exc)
    if record is None:
        raise HTTPException(status_code=404, detail="follow-up not found")
    return _follow_up_response(record)


@router.post(
    "/projects/{project_id}/follow-ups/{request_id}/send-now",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
async def send_follow_up_now(project_id: str, request_id: str):
    try:
        record = await asyncio.to_thread(
            get_default_run_journal().set_follow_up_delivery_mode,
            request_id=request_id,
            project_id=project_id,
            delivery_mode="send_now",
        )
    except Exception as exc:
        _raise_follow_up_http_error(exc)
    return _follow_up_response(record)


@router.delete(
    "/projects/{project_id}/follow-ups/{request_id}",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
async def cancel_follow_up(project_id: str, request_id: str):
    try:
        record = await asyncio.to_thread(
            get_default_run_journal().cancel_follow_up_request,
            request_id=request_id,
            project_id=project_id,
        )
    except Exception as exc:
        _raise_follow_up_http_error(exc)
    return _follow_up_response(record)


@router.post(
    "/projects/{project_id}/follow-ups/{request_id}/admitted",
    dependencies=_CHAT_CONTROL_DEPENDENCIES,
)
async def mark_follow_up_admitted(
    project_id: str,
    request_id: str,
    data: FollowUpRequestAdmitted,
):
    try:
        record = await asyncio.to_thread(
            get_default_run_journal().mark_follow_up_admitted,
            request_id=request_id,
            project_id=project_id,
            run_id=data.run_id,
        )
    except Exception as exc:
        _raise_follow_up_http_error(exc)
    return _follow_up_response(record)


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
                review_handoff_ids=data.review_handoff_ids,
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
            data = await _resolve_continuation_admission(
                get_default_run_journal(),
                data=data,
                project_id=id,
                run_id=data.task_id,
            )
            try:
                return await _improve_chat(
                    id, data, request, admission_request_id=request_id
                )
            except Exception:
                if _is_weak_continuation(data.question):
                    await asyncio.to_thread(
                        get_default_run_journal().release_unadmitted_continuation,
                        request_id=data.task_id,
                    )
                raise
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
        # Durable Run events and Project memory preserve prior results.

        # Log context preservation
        if hasattr(task_lock, "conversation_history"):
            hist_len = len(task_lock.conversation_history)
            chat_logger.info(
                f"[CONTEXT] Preserved {hist_len} conversation entries"
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
                        attempt_id=None,
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

    # This is a follow-up turn within the same Project. Strictly open its
    # canonical Run only when run_context was actually
    # rotated to the supplied task_id. The workspace-rotation block above is
    # wrapped in a best-effort try/except, so a missing email, a resolver
    # failure, or any other swallowed exception can leave task_lock.run_context
    # pointing at the previous finalized Run. Admission in that state would
    # attach new Project History events to the wrong immutable run_id.
    refreshed_context = getattr(task_lock, "run_context", None)
    rotation_succeeded = (
        data.task_id
        and isinstance(refreshed_context, RunContext)
        and refreshed_context.run_id == data.task_id
    )
    if rotation_succeeded:
        coordinator = get_default_run_coordinator()
        rebound_runtime = False

        async def rollback_runtime_binding() -> None:
            nonlocal rebound_runtime
            if (
                rebound_runtime
                and previous_run_id is not None
                and previous_run_id != refreshed_context.run_id
            ):
                restored = await coordinator.rebind_run(
                    refreshed_context.run_id,
                    previous_run_id,
                )
                if not restored:
                    chat_logger.critical(
                        "Failed to roll back follow-up runtime binding",
                        extra={
                            "previous_run_id": previous_run_id,
                            "new_run_id": refreshed_context.run_id,
                        },
                    )
            if isinstance(current_context, RunContext):
                task_lock.run_context = current_context
                await asyncio.to_thread(
                    apply_run_env_for_third_party, current_context
                )
            task_lock.status = previous_status
            rebound_runtime = False

        if previous_run_id is not None:
            rebound = await coordinator.rebind_run(
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
            rebound_runtime = previous_run_id != refreshed_context.run_id
        resolved_request_id = admission_request_id or _admission_request_id(
            refreshed_context.run_id,
            question=data.question,
            attaches=data.attaches or [],
            review_handoff_ids=data.review_handoff_ids,
            project_context=data.project_context,
        )
        journal = get_default_run_journal()
        try:
            await asyncio.to_thread(
                journal.ensure_run,
                run_id=refreshed_context.run_id,
                project_id=refreshed_context.project_id,
                status="pending",
            )
        except Exception:
            await rollback_runtime_binding()
            raise
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
            try:
                environment = await asyncio.to_thread(
                    EnvironmentAdmissionService(journal).persist_for_run,
                    run_id=refreshed_context.run_id,
                    space_id=refreshed_context.space_id,
                    working_directory=refreshed_context.working_directory,
                    space_root=_space_root_for_run(refreshed_context),
                    created_by=(refreshed_context.user_id or "local-user"),
                    template=template,
                )
            except WorkspaceBundleReconfigurationPendingError as exc:
                await rollback_runtime_binding()
                raise _workspace_bundle_admission_error(exc) from exc
            except EnvironmentSetupRequiredError as exc:
                await rollback_runtime_binding()
                raise _environment_setup_error(exc) from exc
            try:
                runtime_environment = await asyncio.to_thread(
                    _assemble_runtime_environment,
                    journal,
                    environment.spec,
                    refreshed_context,
                )
            except EnvironmentSetupRequiredError as exc:
                await rollback_runtime_binding()
                raise _environment_setup_error(exc) from exc
            try:
                _require_supported_bundle_session_mode(
                    getattr(task_lock, "runtime_session_mode", None),
                    runtime_environment,
                )
            except EnvironmentSetupRequiredError as exc:
                await rollback_runtime_binding()
                raise _environment_setup_error(exc) from exc
            _apply_environment_to_task_lock(
                task_lock,
                environment.spec,
                template=template,
                runtime_environment=runtime_environment,
            )
        try:
            attempt = await asyncio.to_thread(
                journal.create_run_attempt,
                refreshed_context.run_id,
                request_id=resolved_request_id,
                reason="follow_up_execution",
                activate=False,
                environment=(environment.binding if environment else None),
            )
            await _record_canonical_user_message(
                journal,
                run_context=refreshed_context,
                request_id=resolved_request_id,
                content=data.question,
                source="improve",
                attaches=data.attaches or [],
                review_handoff_ids=data.review_handoff_ids,
            )
            refreshed_context = replace(
                refreshed_context,
                attempt_id=attempt.attempt_id,
            )
            task_lock.run_context = refreshed_context
        except Exception:
            await rollback_runtime_binding()
            raise
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
        current_run = await asyncio.to_thread(
            journal.get_run, run_context.run_id
        )
        active_attempt_id = (
            current_run.active_attempt_id if current_run is not None else None
        )

        def belongs_to_current_attempt(item: object) -> bool:
            attempt_id = getattr(item, "attempt_id", None)
            return attempt_id is None or attempt_id == active_attempt_id

        interaction = next(
            (
                item
                for item in reversed(pending_interactions)
                if item.interaction_type != "approval"
                and belongs_to_current_attempt(item)
                and item.request.get("agent") == data.agent
                and (
                    data.interaction_id is None
                    or item.interaction_id == data.interaction_id
                )
            ),
            None,
        )
        pending_approval = next(
            (
                item
                for item in reversed(pending_interactions)
                if item.interaction_type == "approval"
                and belongs_to_current_attempt(item)
                and item.request.get("agent") == data.agent
                and (
                    data.interaction_id is None
                    or item.interaction_id == data.interaction_id
                )
            ),
            None,
        )
        if pending_approval is not None:
            raise UserException(
                code.error,
                "This task is waiting for an approval decision. Use the "
                "approval controls instead of sending a human reply.",
            )
        if data.interaction_id is not None and interaction is None:
            raise UserException(
                code.error,
                "The requested human interaction is no longer pending.",
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
    current_context = getattr(task_lock, "run_context", None)
    if isinstance(current_context, RunContext):
        await sync_step_event(
            task_id=current_context.run_id,
            project_id=id,
            run_id=current_context.run_id,
            step="human_reply",
            data={"agent": data.agent, "reply": data.reply},
            authorization=request.headers.get("authorization"),
        )
    else:
        # A mutable Project TaskLock cannot prove which Run owns the event.
        # Keep the in-process reply working for a legacy live task, but never
        # attribute it to whichever task id happens to be current now.
        chat_logger.warning(
            "Skipped legacy human-reply event sync without immutable RunContext",
            extra={"project_id": id, "agent": data.agent},
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
    - Preserves prior results through durable Run events and Project memory
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
