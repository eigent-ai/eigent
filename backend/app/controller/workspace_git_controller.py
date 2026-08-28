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

"""Authenticated Desktop-local Content Repository API."""

from __future__ import annotations

import mimetypes
from pathlib import Path, PurePosixPath
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator

from app.auth import require_local_control_principal
from app.run_journal import (
    IdempotencyConflictError,
    InvalidRunTransitionError,
    OptimisticConcurrencyError,
    configured_run_journal_path,
    get_default_run_journal,
)
from app.utils.workspace_resolver import get_workspace_resolver
from app.workspace_git import (
    AdvancedGitApprovalRequired,
    AdvancedGitCommandRejected,
    AdvancedGitError,
    AdvancedGitOutcomeUnknown,
    AdvancedGitService,
    ContentRepositoryConsentRequired,
    ContentRepositoryError,
    ContentRepositoryService,
    GitBackendError,
    NestedRepositoryError,
    NoCheckpointChangesError,
    RepositoryStateChangedError,
    RunWorkspaceEditService,
    WorkspaceGitCoordinator,
    WorkspaceSnapshotError,
    WorkspaceSnapshotService,
)
from app.workspace_git.backend import RepositoryDiagnostics

router = APIRouter(dependencies=[Depends(require_local_control_principal)])

_PROJECT_CHANGE_MAX_FILES = 500
_PROJECT_CHANGE_MAX_BYTES = 2_000_000
_PROJECT_IMAGE_PREVIEW_MAX_BYTES = 20_000_000


class GitBootstrapBody(BaseModel):
    email: str = Field(min_length=1)
    user_id: str | int | None = None
    allow_init: bool = False
    eigent_owned_space: bool = False


class GitCheckpointBody(BaseModel):
    email: str = Field(min_length=1)
    user_id: str | int | None = None
    operation_request_id: str = Field(min_length=1, max_length=128)
    expected_repo_state_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    paths: list[str] = Field(min_length=1, max_length=500)
    path_sources: dict[str, str]
    target_role: Literal["user", "project", "run", "agent"]
    target_id: str = Field(min_length=1, max_length=256)
    actor_id: str = Field(min_length=1, max_length=200)
    trigger: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=500)
    workspace_source: Literal["user", "run"] = "user"
    run_id: str | None = Field(default=None, max_length=256)

    @field_validator("paths")
    @classmethod
    def validate_relative_paths(cls, paths: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in paths:
            path = PurePosixPath(value)
            if (
                not value
                or path.is_absolute()
                or ".." in path.parts
                or value.startswith(("~/", "\\\\"))
                or (len(value) > 1 and value[1] == ":")
            ):
                raise ValueError("Git checkpoint paths must be relative")
            normalized.append(path.as_posix())
        if len(set(normalized)) != len(normalized):
            raise ValueError("Git checkpoint paths must be unique")
        return normalized


class GitSavePointBody(BaseModel):
    email: str = Field(min_length=1)
    user_id: str | int | None = None
    operation_request_id: str = Field(min_length=1, max_length=128)
    expected_repo_state_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    actor_id: str = Field(min_length=1, max_length=200)
    message: str = Field(default="Save progress", min_length=1, max_length=500)


class GitRestoreBody(BaseModel):
    email: str = Field(min_length=1)
    user_id: str | int | None = None
    checkpoint_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^checkpoint_[0-9a-f]{32}$",
    )
    operation_request_id: str = Field(min_length=1, max_length=128)
    expected_repo_state_digest: str = Field(pattern=r"^[0-9a-f]{64}$")


class GitMaterializeRunBody(BaseModel):
    space_id: str = Field(min_length=1, max_length=256)
    email: str = Field(min_length=1)
    user_id: str | int | None = None
    operation_request_id: str = Field(min_length=1, max_length=128)
    expected_repo_state_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_project_version: int = Field(ge=0)
    expected_project_head: str | None = Field(
        default=None,
        pattern=r"^[0-9a-f]{40,64}$",
    )


class GitPromoteRunBody(BaseModel):
    space_id: str = Field(min_length=1, max_length=256)
    email: str = Field(min_length=1)
    user_id: str | int | None = None
    operation_request_id: str = Field(min_length=1, max_length=128)
    expected_run_state_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_project_version: int = Field(ge=0)
    expected_project_head: str = Field(pattern=r"^[0-9a-f]{40,64}$")
    expected_run_head: str = Field(pattern=r"^[0-9a-f]{40,64}$")


class GitRefreshProjectBody(BaseModel):
    space_id: str = Field(min_length=1, max_length=256)
    email: str = Field(min_length=1)
    user_id: str | int | None = None
    operation_request_id: str = Field(min_length=1, max_length=128)
    expected_projection_state_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_project_version: int = Field(ge=0)
    expected_integration_head: str = Field(pattern=r"^[0-9a-f]{40,64}$")
    expected_projected_head: str = Field(pattern=r"^[0-9a-f]{40,64}$")


class GitSnapshotBody(BaseModel):
    space_id: str = Field(min_length=1, max_length=256)
    email: str = Field(min_length=1)
    user_id: str | int | None = None
    expected_user_working_state_digest: str = Field(pattern=r"^[0-9a-f]{64}$")


class GitRunWorkspaceEditBody(BaseModel):
    space_id: str = Field(min_length=1, max_length=256)
    email: str = Field(min_length=1)
    user_id: str | int | None = None
    operation_request_id: str = Field(min_length=1, max_length=128)
    editor_session_id: str = Field(min_length=1, max_length=128)
    relative_path: str = Field(min_length=1, max_length=4096)
    content: str = Field(max_length=4 * 1024 * 1024)
    expected_content_digest: str | None = Field(
        default=None,
        pattern=r"^[0-9a-f]{64}$",
    )
    actor_id: str = Field(min_length=1, max_length=200)


class AdvancedGitPreviewBody(BaseModel):
    email: str = Field(min_length=1)
    user_id: str | int | None = None
    operation_request_id: str = Field(min_length=1, max_length=128)
    argv: list[str] = Field(min_length=1, max_length=128)


class AdvancedGitExecuteBody(AdvancedGitPreviewBody):
    expected_repo_state_digest: str | None = Field(
        default=None,
        pattern=r"^[0-9a-f]{64}$",
    )
    confirmed_action_digest: str | None = Field(
        default=None,
        pattern=r"^[0-9a-f]{64}$",
    )
    actor_id: str = Field(min_length=1, max_length=200)


def _service() -> ContentRepositoryService:
    return ContentRepositoryService(
        get_default_run_journal(),
        state_root=configured_run_journal_path().parent / "workspace-git",
    )


def _coordinator() -> WorkspaceGitCoordinator:
    service = _service()
    return WorkspaceGitCoordinator(
        service.journal,
        state_root=service.state_root,
        git_backend=service.git,
    )


def _snapshot_service() -> WorkspaceSnapshotService:
    service = _service()
    return WorkspaceSnapshotService(
        service.journal,
        state_root=service.state_root,
        git_backend=service.git,
    )


def _run_edit_service() -> RunWorkspaceEditService:
    service = _service()
    return RunWorkspaceEditService(
        service.journal,
        state_root=service.state_root,
        coordinator=_coordinator(),
    )


def _advanced_service() -> AdvancedGitService:
    service = _service()
    return AdvancedGitService(
        service.journal,
        content=service,
        git_backend=service.git,
    )


def _binding_root(
    *,
    space_id: str,
    email: str,
    user_id: str | int | None,
) -> Path:
    binding = get_workspace_resolver().store.get_binding(
        email,
        space_id,
        user_id,
    )
    if binding is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "workspace_binding_not_found",
                "message": "The Space has no local workspace binding.",
            },
        )
    root = Path(binding.workspace_root).expanduser()
    if not root.is_dir():
        raise HTTPException(
            status_code=409,
            detail={
                "code": "workspace_binding_unavailable",
                "message": "The bound workspace folder is unavailable.",
            },
        )
    return root.resolve()


def _assert_repository_binding(repository, root: Path) -> None:
    if Path(repository.root_path).expanduser().resolve() != root:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "git_repository_binding_mismatch",
                "message": (
                    "The persisted Content Repository no longer matches the "
                    "Space binding. Reconciliation is required."
                ),
            },
        )


def _git_error(exc: Exception) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, ContentRepositoryConsentRequired):
        return HTTPException(
            status_code=409,
            detail={
                "code": "git_init_consent_required",
                "message": str(exc),
            },
        )
    if isinstance(exc, WorkspaceSnapshotError):
        detail = {
            "code": exc.code,
            "message": str(exc),
            "retryable": exc.retryable,
            "refresh_available": exc.refresh_available,
            "automatic_retry_limit": exc.automatic_retry_limit,
        }
        return HTTPException(
            status_code=(
                404 if exc.code == "workspace_path_not_found" else 409
            ),
            detail=detail,
        )
    if isinstance(exc, AdvancedGitApprovalRequired):
        return HTTPException(
            status_code=409,
            detail={
                "code": exc.code,
                "message": str(exc),
                "action_digest": exc.action_digest,
            },
        )
    if isinstance(exc, AdvancedGitCommandRejected):
        return HTTPException(
            status_code=422,
            detail={
                "code": exc.code,
                "reason_code": exc.reason_code,
                "message": str(exc),
                "remediation": exc.remediation,
                "human_interaction_required": (exc.human_interaction_required),
            },
        )
    if isinstance(exc, AdvancedGitOutcomeUnknown):
        return HTTPException(
            status_code=409,
            detail={
                "code": exc.code,
                "message": str(exc),
                "retryable": False,
            },
        )
    if isinstance(exc, AdvancedGitError):
        return HTTPException(
            status_code=409,
            detail={
                "code": getattr(exc, "code", "advanced_git_error"),
                "message": str(exc),
            },
        )
    if isinstance(exc, RepositoryStateChangedError):
        return HTTPException(
            status_code=409,
            detail={"code": "repo_state_changed", "message": str(exc)},
        )
    if isinstance(exc, OptimisticConcurrencyError):
        return HTTPException(
            status_code=409,
            detail={"code": "project_git_state_changed", "message": str(exc)},
        )
    if isinstance(exc, NoCheckpointChangesError):
        return HTTPException(
            status_code=409,
            detail={"code": "git_no_changes", "message": str(exc)},
        )
    if isinstance(
        exc,
        (IdempotencyConflictError, InvalidRunTransitionError),
    ):
        return HTTPException(
            status_code=409,
            detail={"code": "git_operation_conflict", "message": str(exc)},
        )
    if isinstance(exc, NestedRepositoryError):
        return HTTPException(
            status_code=409,
            detail={
                "code": "nested_repository_requires_binding",
                "message": str(exc),
            },
        )
    if isinstance(exc, (ValueError, GitBackendError)):
        return HTTPException(
            status_code=422,
            detail={"code": "invalid_git_operation", "message": str(exc)},
        )
    if isinstance(exc, ContentRepositoryError):
        return HTTPException(
            status_code=409,
            detail={"code": "git_needs_attention", "message": str(exc)},
        )
    return HTTPException(
        status_code=500,
        detail={"code": "git_operation_failed", "message": "Git failed"},
    )


def _diagnostics_payload(value: RepositoryDiagnostics) -> dict:
    return {
        "healthy": value.healthy,
        "issues": list(value.issues),
        "has_submodules": value.has_submodules,
        "has_remotes": value.has_remotes,
        "repo_state": {
            "head_oid": value.state_token.head_oid,
            "branch_or_detached_head": (
                value.state_token.branch_or_detached_head
            ),
            "index_digest": value.state_token.index_digest,
            "operation_state": value.state_token.operation_state,
            "digest": value.state_token.digest,
        },
    }


def _advanced_preview_payload(preview) -> dict:
    return {
        "classification": preview.classification.operation,
        "subcommand": preview.classification.subcommand,
        "safety_class": preview.classification.safety_class.value,
        "external_side_effect": preview.classification.external_side_effect,
        "risk_tags": list(preview.classification.risk_tags),
        "action_digest": preview.action_digest,
        "effect": preview.effect.value,
        "reason": preview.reason,
        "requires_confirmation": preview.requires_confirmation,
        "display_argv": list(preview.display_argv),
    }


@router.get("/spaces/{space_id}/git/status")
async def git_status(
    space_id: str,
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    root = _binding_root(space_id=space_id, email=email, user_id=user_id)
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    try:
        if repository is None:
            inspection = service.inspect(root)
            return {
                "space_id": space_id,
                "enabled": False,
                "enablement": inspection.enablement,
                "consent_required": inspection.consent_required,
                "existing_repository": inspection.probe.is_repository,
                "nested_in_parent": inspection.probe.nested_in_parent,
                "diagnostics": (
                    _diagnostics_payload(inspection.diagnostics)
                    if inspection.diagnostics is not None
                    else None
                ),
            }
        _assert_repository_binding(repository, root)
        status = service.status(repository.repository_id)
        return {
            "space_id": space_id,
            "enabled": True,
            "repository_id": repository.repository_id,
            "state": repository.state,
            "ownership": repository.ownership,
            "version_coverage": repository.version_coverage,
            "hooks_mode": repository.hooks_mode,
            "managed_paths": list(status.managed_paths),
            "pending_managed_paths": list(status.pending_managed_paths),
            "pending_managed_paths_truncated": (
                status.pending_managed_paths_truncated
            ),
            "diagnostics": _diagnostics_payload(status.diagnostics),
        }
    except Exception as exc:
        raise _git_error(exc) from exc


@router.post("/spaces/{space_id}/git/bootstrap")
async def git_bootstrap(space_id: str, body: GitBootstrapBody):
    root = _binding_root(
        space_id=space_id,
        email=body.email,
        user_id=body.user_id,
    )
    try:
        result = _service().bootstrap(
            space_id=space_id,
            space_root=root,
            allow_init=body.allow_init,
            eigent_owned_space=body.eigent_owned_space,
        )
    except Exception as exc:
        raise _git_error(exc) from exc
    return {
        "space_id": space_id,
        "repository_id": result.repository.repository_id,
        "initialized": result.initialized,
        "ownership": result.repository.ownership,
        "state": result.repository.state,
        "version_coverage": result.repository.version_coverage,
        "diagnostics": _diagnostics_payload(result.diagnostics),
    }


@router.get("/spaces/{space_id}/git/history")
async def git_history(
    space_id: str,
    limit: int = Query(50, ge=1, le=200),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    root = _binding_root(space_id=space_id, email=email, user_id=user_id)
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    if repository is None:
        raise HTTPException(status_code=404, detail="Git is not enabled")
    _assert_repository_binding(repository, root)
    try:
        return _advanced_service().history(
            repository_id=repository.repository_id,
            limit=limit,
        )
    except Exception as exc:
        raise _git_error(exc) from exc


@router.post("/spaces/{space_id}/git/operations:preview")
async def git_advanced_preview(
    space_id: str,
    body: AdvancedGitPreviewBody,
):
    root = _binding_root(
        space_id=space_id,
        email=body.email,
        user_id=body.user_id,
    )
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    if repository is None:
        raise HTTPException(status_code=404, detail="Git is not enabled")
    _assert_repository_binding(repository, root)
    try:
        preview = _advanced_service().preview(
            space_id=space_id,
            repository_id=repository.repository_id,
            argv=tuple(body.argv),
            operation_request_id=body.operation_request_id,
        )
        return _advanced_preview_payload(preview)
    except Exception as exc:
        raise _git_error(exc) from exc


@router.post("/spaces/{space_id}/git/operations")
async def git_advanced_execute(
    space_id: str,
    body: AdvancedGitExecuteBody,
):
    root = _binding_root(
        space_id=space_id,
        email=body.email,
        user_id=body.user_id,
    )
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    if repository is None:
        raise HTTPException(status_code=404, detail="Git is not enabled")
    _assert_repository_binding(repository, root)
    try:
        return _advanced_service().execute(
            space_id=space_id,
            repository_id=repository.repository_id,
            argv=tuple(body.argv),
            operation_request_id=body.operation_request_id,
            expected_repo_state_digest=body.expected_repo_state_digest,
            confirmed_action_digest=body.confirmed_action_digest,
            actor_id=body.actor_id,
        )
    except Exception as exc:
        raise _git_error(exc) from exc


@router.get("/spaces/{space_id}/git/diff")
async def git_diff(
    space_id: str,
    paths: Annotated[list[str], Query(min_length=1, max_length=500)],
    source_commit: str | None = Query(None),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    bound_root = _binding_root(
        space_id=space_id,
        email=email,
        user_id=user_id,
    )
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    if repository is None:
        raise HTTPException(status_code=404, detail="Git is not enabled")
    _assert_repository_binding(repository, bound_root)
    try:
        root = Path(repository.root_path)
        diff = service.diff(
            repository.repository_id,
            paths=tuple(root / path for path in paths),
            source_commit=source_commit,
        )
        return {"repository_id": repository.repository_id, "diff": diff}
    except Exception as exc:
        raise _git_error(exc) from exc


@router.get("/spaces/{space_id}/git/checkpoints")
async def git_checkpoints(
    space_id: str,
    limit: int = Query(100, ge=1, le=500),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    bound_root = _binding_root(
        space_id=space_id,
        email=email,
        user_id=user_id,
    )
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    if repository is None:
        raise HTTPException(status_code=404, detail="Git is not enabled")
    _assert_repository_binding(repository, bound_root)
    checkpoints = service.journal.list_git_checkpoints(
        repository.repository_id,
        limit=limit,
    )
    return {
        "repository_id": repository.repository_id,
        "checkpoints": [
            {
                "checkpoint_id": item.checkpoint_id,
                "target_role": item.target_role,
                "target_id": item.target_id,
                "commit_oid": item.commit_oid,
                "parent_oid": item.parent_oid,
                "paths": list(item.paths),
                "actor_id": item.actor_id,
                "trigger": item.trigger,
                "message": item.message,
                "created_at": item.created_at,
            }
            for item in checkpoints
        ],
    }


@router.post("/spaces/{space_id}/git/checkpoints", status_code=201)
async def git_checkpoint(space_id: str, body: GitCheckpointBody):
    root = _binding_root(
        space_id=space_id,
        email=body.email,
        user_id=body.user_id,
    )
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    if repository is None:
        raise HTTPException(status_code=404, detail="Git is not enabled")
    _assert_repository_binding(repository, root)
    worktree_root = None
    if body.workspace_source == "run":
        if not body.run_id:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "run_id_required",
                    "message": "run_id is required for a Run checkpoint.",
                },
            )
        run = service.journal.get_run_git_materialization(body.run_id)
        if (
            run is None
            or run.repository_id != repository.repository_id
            or run.materialization_state != "materialized"
            or not run.worktree_path
        ):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "run_workspace_not_materialized",
                    "message": "The Run workspace is not materialized.",
                },
            )
        worktree_root = Path(run.worktree_path)
    try:
        checkpoint = service.checkpoint(
            repository.repository_id,
            operation_request_id=body.operation_request_id,
            expected_repo_state_digest=body.expected_repo_state_digest,
            paths=tuple((worktree_root or root) / path for path in body.paths),
            path_sources=body.path_sources,
            target_role=body.target_role,
            target_id=body.target_id,
            actor_id=body.actor_id,
            trigger=body.trigger,
            message=body.message,
            worktree_root=worktree_root,
        )
    except Exception as exc:
        raise _git_error(exc) from exc
    return {
        "checkpoint_id": checkpoint.checkpoint_id,
        "repository_id": checkpoint.repository_id,
        "commit_oid": checkpoint.commit_oid,
        "parent_oid": checkpoint.parent_oid,
        "paths": list(checkpoint.paths),
        "created_at": checkpoint.created_at,
    }


@router.post("/spaces/{space_id}/git/save-point", status_code=201)
async def git_save_point(space_id: str, body: GitSavePointBody):
    """Checkpoint the current managed delta and nothing else."""

    root = _binding_root(
        space_id=space_id,
        email=body.email,
        user_id=body.user_id,
    )
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    if repository is None:
        raise HTTPException(status_code=404, detail="Git is not enabled")
    _assert_repository_binding(repository, root)
    try:
        status = service.status(repository.repository_id)
        if not status.pending_managed_paths:
            raise NoCheckpointChangesError(
                "No managed path has a pending change"
            )
        paths = status.pending_managed_paths
        checkpoint = service.checkpoint(
            repository.repository_id,
            operation_request_id=body.operation_request_id,
            expected_repo_state_digest=body.expected_repo_state_digest,
            paths=tuple(root / path for path in paths),
            path_sources={path: "user_selected" for path in paths},
            target_role="user",
            target_id=space_id,
            actor_id=body.actor_id,
            trigger="user.save_point",
            message=body.message,
        )
    except Exception as exc:
        raise _git_error(exc) from exc
    return {
        "checkpoint_id": checkpoint.checkpoint_id,
        "repository_id": checkpoint.repository_id,
        "commit_oid": checkpoint.commit_oid,
        "parent_oid": checkpoint.parent_oid,
        "paths": list(checkpoint.paths),
        "remaining_managed_changes": status.pending_managed_paths_truncated,
        "created_at": checkpoint.created_at,
    }


@router.post("/spaces/{space_id}/git/restore", status_code=201)
async def git_restore_candidate(
    space_id: str,
    body: GitRestoreBody,
):
    bound_root = _binding_root(
        space_id=space_id,
        email=body.email,
        user_id=body.user_id,
    )
    service = _service()
    checkpoint = service.journal.get_git_checkpoint(body.checkpoint_id)
    repository = service.journal.get_space_git_repository(space_id=space_id)
    if (
        repository is None
        or checkpoint is None
        or checkpoint.repository_id != repository.repository_id
    ):
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    _assert_repository_binding(repository, bound_root)
    try:
        candidate = service.prepare_restore_candidate(
            body.checkpoint_id,
            operation_request_id=body.operation_request_id,
            expected_repo_state_digest=body.expected_repo_state_digest,
        )
    except Exception as exc:
        raise _git_error(exc) from exc
    return {
        "checkpoint_id": body.checkpoint_id,
        "repository_id": repository.repository_id,
        "candidate_ref": candidate.ref_name,
        "commit_oid": candidate.commit_oid,
        "applied_to_user_worktree": False,
    }


def _project_workspace_payload(
    project,
    run=None,
    *,
    projection_state_digest: str | None = None,
) -> dict:
    return {
        "project_id": project.project_id,
        "repository_id": project.repository_id,
        "state": project.state,
        "version": project.version,
        "integration_ref": project.integration_ref,
        "integration_head": project.integration_head,
        "projected_head": project.projected_head,
        "freshness": (
            "current"
            if project.integration_head == project.projected_head
            else "stale"
        ),
        "pending_apply": project.pending_apply,
        "materialized": project.integration_ref is not None,
        "projection_state_digest": projection_state_digest,
        "run": (
            None
            if run is None
            else {
                "run_id": run.run_id,
                "workspace_base_ref": run.workspace_base_ref,
                "workspace_base_commit": run.workspace_base_commit,
                "materialization_state": run.materialization_state,
                "run_ref": run.run_ref,
                "promoted_commit": run.promoted_commit,
                "version": run.version,
            }
        ),
    }


def _project_change_path(value: str) -> str:
    path = PurePosixPath(value)
    if (
        not value
        or path.is_absolute()
        or ".." in path.parts
        or value.startswith(("~/", "\\\\"))
        or (len(value) > 1 and value[1] == ":")
    ):
        raise HTTPException(status_code=422, detail="Invalid change path")
    return path.as_posix()


def _project_change_context(
    *,
    project_id: str,
    space_id: str,
    email: str,
    user_id: str | None,
):
    root = _binding_root(space_id=space_id, email=email, user_id=user_id)
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    project = service.journal.get_project_git_state(project_id)
    if (
        repository is None
        or project is None
        or project.repository_id != repository.repository_id
    ):
        raise HTTPException(
            status_code=404, detail="Project Git state not found"
        )
    _assert_repository_binding(repository, root)
    base_commit = project.last_synced_user_head
    if base_commit is None:
        runs = sorted(
            (
                run
                for run in service.journal.list_run_git_materializations()
                if run.project_id == project_id
                and run.repository_id == repository.repository_id
                and run.workspace_base_commit is not None
            ),
            key=lambda run: (run.created_at, run.run_id),
        )
        base_commit = runs[0].workspace_base_commit if runs else None
    return service, repository, project, base_commit, project.integration_head


def _git_change_side(
    service: ContentRepositoryService,
    root: Path,
    commit: str,
    path: str,
) -> tuple[str | None, int | None]:
    oid = service.git.blob_oid_at_path(root, commit, path)
    if oid is None:
        return None, None
    return oid, service.git.object_size(root, oid)


def _read_git_change_side(
    service: ContentRepositoryService,
    root: Path,
    oid: str | None,
    size: int | None,
) -> dict:
    if oid is None or size is None:
        return {
            "content": None,
            "size": None,
            "binary": False,
            "too_large": False,
        }
    if size > _PROJECT_CHANGE_MAX_BYTES:
        return {
            "content": None,
            "size": size,
            "binary": False,
            "too_large": True,
        }
    data = (
        b""
        if size == 0
        else service.git.read_blob_range(
            root,
            oid,
            start_offset=0,
            max_bytes=size,
        )
    )
    try:
        content = data.decode("utf-8")
    except UnicodeDecodeError:
        content = None
    binary = b"\0" in data[:8000] or content is None
    return {
        "content": None if binary else content,
        "size": size,
        "binary": binary,
        "too_large": False,
    }


def _run_change_context(
    *,
    run_id: str,
    space_id: str,
    email: str,
    user_id: str | None,
):
    root = _binding_root(space_id=space_id, email=email, user_id=user_id)
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    run = service.journal.get_run_git_materialization(run_id)
    if (
        repository is None
        or run is None
        or run.repository_id != repository.repository_id
    ):
        raise HTTPException(status_code=404, detail="Run Git state not found")
    _assert_repository_binding(repository, root)
    canonical_run = service.journal.get_run(run_id)
    terminal = canonical_run is not None and canonical_run.status in {
        "completed",
        "failed",
        "cancelled",
    }
    if not terminal and (
        run.workspace_base_commit is None or run.promoted_commit is None
    ):
        raise HTTPException(
            status_code=409,
            detail="Run changes are not finalized yet",
        )
    return (
        service,
        repository,
        run,
        run.workspace_base_commit,
        run.promoted_commit,
    )


def _git_changes_payload(
    *,
    service: ContentRepositoryService,
    repository,
    identity: dict,
    base_commit: str | None,
    target_commit: str | None,
) -> dict:
    if base_commit is None or target_commit is None:
        return {
            "repository_id": repository.repository_id,
            **identity,
            "base_commit": base_commit,
            "target_commit": target_commit,
            "files": [],
            "totals": {"added": 0, "removed": 0},
            "truncated": False,
        }
    root = Path(repository.root_path)
    changes = service.git.changed_paths_between(
        root,
        base_commit=base_commit,
        target_commit=target_commit,
    )
    stats = {
        item.relative_path: item
        for item in service.git.path_line_stats_between(
            root,
            base_commit=base_commit,
            target_commit=target_commit,
        )
    }
    visible_changes = changes[:_PROJECT_CHANGE_MAX_FILES]
    visible_paths = tuple(item.relative_path for item in visible_changes)
    before_blobs = {
        item.relative_path: item
        for item in service.git.blobs_at_paths(
            root, base_commit, visible_paths
        )
    }
    after_blobs = {
        item.relative_path: item
        for item in service.git.blobs_at_paths(
            root, target_commit, visible_paths
        )
    }
    files = []
    for change in visible_changes:
        before_blob = before_blobs.get(change.relative_path)
        after_blob = after_blobs.get(change.relative_path)
        line_stat = stats.get(change.relative_path)
        files.append(
            {
                "path": change.relative_path,
                "status": {
                    "A": "added",
                    "M": "modified",
                    "D": "deleted",
                    "T": "modified",
                }[change.status],
                "before_size": (
                    before_blob.size_bytes if before_blob else None
                ),
                "after_size": (after_blob.size_bytes if after_blob else None),
                "binary": (
                    line_stat is not None and line_stat.added_lines is None
                ),
                "added_lines": (line_stat.added_lines if line_stat else None),
                "removed_lines": (
                    line_stat.removed_lines if line_stat else None
                ),
            }
        )
    text_stats = [
        item for item in stats.values() if item.added_lines is not None
    ]
    return {
        "repository_id": repository.repository_id,
        **identity,
        "base_commit": base_commit,
        "target_commit": target_commit,
        "files": files,
        "totals": {
            "added": sum(item.added_lines or 0 for item in text_stats),
            "removed": sum(item.removed_lines or 0 for item in text_stats),
        },
        "truncated": len(changes) > _PROJECT_CHANGE_MAX_FILES,
    }


def _git_change_content_payload(
    *,
    service: ContentRepositoryService,
    repository,
    identity: dict,
    path: str,
    base_commit: str,
    target_commit: str,
) -> dict:
    relative_path = _project_change_path(path)
    root = Path(repository.root_path)
    changed_paths = {
        item.relative_path
        for item in service.git.changed_paths_between(
            root,
            base_commit=base_commit,
            target_commit=target_commit,
        )
    }
    if relative_path not in changed_paths:
        raise HTTPException(status_code=404, detail="Change not found")
    before_oid, before_size = _git_change_side(
        service, root, base_commit, relative_path
    )
    after_oid, after_size = _git_change_side(
        service, root, target_commit, relative_path
    )
    return {
        **identity,
        "path": relative_path,
        "base_commit": base_commit,
        "target_commit": target_commit,
        "before": _read_git_change_side(
            service, root, before_oid, before_size
        ),
        "after": _read_git_change_side(service, root, after_oid, after_size),
    }


def _git_change_blob_response(
    *,
    service: ContentRepositoryService,
    repository,
    path: str,
    side: Literal["before", "after"],
    base_commit: str,
    target_commit: str,
) -> Response:
    """Read one changed image side from the exact pinned Git commit."""

    relative_path = _project_change_path(path)
    root = Path(repository.root_path)
    changed_paths = {
        item.relative_path
        for item in service.git.changed_paths_between(
            root,
            base_commit=base_commit,
            target_commit=target_commit,
        )
    }
    if relative_path not in changed_paths:
        raise HTTPException(status_code=404, detail="Change not found")

    commit = base_commit if side == "before" else target_commit
    oid, size = _git_change_side(service, root, commit, relative_path)
    if oid is None or size is None:
        raise HTTPException(
            status_code=404,
            detail=f"File is not present on the {side} side",
        )
    media_type = mimetypes.guess_type(relative_path)[0]
    if media_type is None or not media_type.startswith("image/"):
        raise HTTPException(
            status_code=415,
            detail="Only image changes support binary preview",
        )
    if size > _PROJECT_IMAGE_PREVIEW_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Image preview is too large",
        )
    data = (
        b""
        if size == 0
        else service.git.read_blob_range(
            root,
            oid,
            start_offset=0,
            max_bytes=size,
        )
    )
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _snapshot_payload(snapshot) -> dict:
    return {
        "snapshot_id": snapshot.snapshot_id,
        "run_id": snapshot.run_id,
        "project_id": snapshot.project_id,
        "repository_id": snapshot.repository_id,
        "generation": snapshot.generation,
        "project_base_commit": snapshot.project_base_commit,
        "project_state_version": snapshot.project_state_version,
        "user_head": snapshot.user_head,
        "user_working_state_digest": snapshot.user_working_state_digest,
        "overlay_manifest_digest": snapshot.overlay_manifest_digest,
        "state": snapshot.state,
        "created_at": snapshot.created_at,
        "updated_at": snapshot.updated_at,
    }


def _assert_snapshot_owner(
    *,
    run_id: str,
    space_id: str,
    email: str,
    user_id: str | int | None,
):
    root = _binding_root(space_id=space_id, email=email, user_id=user_id)
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    run = service.journal.get_run_git_materialization(run_id)
    if (
        repository is None
        or run is None
        or run.repository_id != repository.repository_id
    ):
        raise HTTPException(status_code=404, detail="Run Git state not found")
    _assert_repository_binding(repository, root)
    return repository


@router.get("/projects/{project_id}/git/workspace")
async def project_git_workspace(
    project_id: str,
    space_id: str = Query(..., min_length=1),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    root = _binding_root(space_id=space_id, email=email, user_id=user_id)
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    project = service.journal.get_project_git_state(project_id)
    if (
        repository is None
        or project is None
        or project.repository_id != repository.repository_id
    ):
        raise HTTPException(
            status_code=404, detail="Project Git state not found"
        )
    _assert_repository_binding(repository, root)
    projection_digest = (
        service.git.repo_state_token(Path(project.worktree_path)).digest
        if project.worktree_path
        else None
    )
    return _project_workspace_payload(
        project,
        projection_state_digest=projection_digest,
    )


@router.get("/projects/{project_id}/git/changes")
async def project_git_changes(
    project_id: str,
    space_id: str = Query(..., min_length=1),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    """List authoritative Project changes without reading file contents."""

    service, repository, _project, base_commit, target_commit = (
        _project_change_context(
            project_id=project_id,
            space_id=space_id,
            email=email,
            user_id=user_id,
        )
    )
    try:
        return _git_changes_payload(
            service=service,
            repository=repository,
            identity={"project_id": project_id},
            base_commit=base_commit,
            target_commit=target_commit,
        )
    except Exception as exc:
        raise _git_error(exc) from exc


@router.get("/projects/{project_id}/git/changes/content")
async def project_git_change_content(
    project_id: str,
    path: str = Query(..., min_length=1, max_length=4096),
    base_commit: str = Query(..., min_length=1),
    target_commit: str = Query(..., min_length=1),
    space_id: str = Query(..., min_length=1),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    """Read one changed file's before/after text from pinned Git commits."""

    service, repository, _project, current_base, current_target = (
        _project_change_context(
            project_id=project_id,
            space_id=space_id,
            email=email,
            user_id=user_id,
        )
    )
    if current_base != base_commit or current_target != target_commit:
        raise HTTPException(
            status_code=409,
            detail="Project changed; refresh the change review",
        )
    try:
        return _git_change_content_payload(
            service=service,
            repository=repository,
            identity={},
            path=path,
            base_commit=base_commit,
            target_commit=target_commit,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _git_error(exc) from exc


@router.get("/projects/{project_id}/git/changes/blob")
async def project_git_change_blob(
    project_id: str,
    path: str = Query(..., min_length=1, max_length=4096),
    side: Literal["before", "after"] = Query(...),
    base_commit: str = Query(..., min_length=1),
    target_commit: str = Query(..., min_length=1),
    space_id: str = Query(..., min_length=1),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    """Read one changed image side from pinned Project Git commits."""

    service, repository, _project, current_base, current_target = (
        _project_change_context(
            project_id=project_id,
            space_id=space_id,
            email=email,
            user_id=user_id,
        )
    )
    if current_base != base_commit or current_target != target_commit:
        raise HTTPException(
            status_code=409,
            detail="Project changed; refresh the change review",
        )
    try:
        return _git_change_blob_response(
            service=service,
            repository=repository,
            path=path,
            side=side,
            base_commit=base_commit,
            target_commit=target_commit,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _git_error(exc) from exc


@router.get("/runs/{run_id}/git/changes")
async def run_git_changes(
    run_id: str,
    space_id: str = Query(..., min_length=1),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    """List one finalized Run's authoritative Git changes lazily."""

    # A Run can legitimately have no Git materialization yet: materialization
    # is lazy and legacy/overlay-only Runs may never need one.  This is an
    # availability result for the review UI, not a missing canonical Run.
    root = _binding_root(space_id=space_id, email=email, user_id=user_id)
    service = _service()
    canonical_run = service.journal.get_run(run_id)
    run_materialization = service.journal.get_run_git_materialization(run_id)
    if canonical_run is not None and run_materialization is None:
        repository = service.journal.get_space_git_repository(
            space_id=space_id
        )
        if repository is not None:
            _assert_repository_binding(repository, root)
        return {
            "available": False,
            "reason": "run_git_not_materialized",
            "run_id": run_id,
            "project_id": canonical_run.project_id,
        }

    service, repository, run, base_commit, target_commit = _run_change_context(
        run_id=run_id,
        space_id=space_id,
        email=email,
        user_id=user_id,
    )
    try:
        return _git_changes_payload(
            service=service,
            repository=repository,
            identity={"run_id": run_id, "project_id": run.project_id},
            base_commit=base_commit,
            target_commit=target_commit,
        )
    except Exception as exc:
        raise _git_error(exc) from exc


@router.get("/runs/{run_id}/git/changes/content")
async def run_git_change_content(
    run_id: str,
    path: str = Query(..., min_length=1, max_length=4096),
    base_commit: str = Query(..., min_length=1),
    target_commit: str = Query(..., min_length=1),
    space_id: str = Query(..., min_length=1),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    """Read one finalized Run change from its pinned Git commits."""

    service, repository, run, current_base, current_target = (
        _run_change_context(
            run_id=run_id,
            space_id=space_id,
            email=email,
            user_id=user_id,
        )
    )
    if current_base != base_commit or current_target != target_commit:
        raise HTTPException(
            status_code=409,
            detail="Run changed; refresh the change review",
        )
    try:
        return _git_change_content_payload(
            service=service,
            repository=repository,
            identity={"run_id": run_id, "project_id": run.project_id},
            path=path,
            base_commit=base_commit,
            target_commit=target_commit,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _git_error(exc) from exc


@router.get("/runs/{run_id}/git/changes/blob")
async def run_git_change_blob(
    run_id: str,
    path: str = Query(..., min_length=1, max_length=4096),
    side: Literal["before", "after"] = Query(...),
    base_commit: str = Query(..., min_length=1),
    target_commit: str = Query(..., min_length=1),
    space_id: str = Query(..., min_length=1),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    """Read one finalized Run image side from pinned Git commits."""

    service, repository, _run, current_base, current_target = (
        _run_change_context(
            run_id=run_id,
            space_id=space_id,
            email=email,
            user_id=user_id,
        )
    )
    if current_base != base_commit or current_target != target_commit:
        raise HTTPException(
            status_code=409,
            detail="Run changed; refresh the change review",
        )
    try:
        return _git_change_blob_response(
            service=service,
            repository=repository,
            path=path,
            side=side,
            base_commit=base_commit,
            target_commit=target_commit,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _git_error(exc) from exc


@router.get("/runs/{run_id}/git/workspace")
async def run_git_workspace(
    run_id: str,
    space_id: str = Query(..., min_length=1),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    root = _binding_root(space_id=space_id, email=email, user_id=user_id)
    service = _service()
    repository = service.journal.get_space_git_repository(space_id=space_id)
    run = service.journal.get_run_git_materialization(run_id)
    project = (
        service.journal.get_project_git_state(run.project_id)
        if run is not None
        else None
    )
    if (
        repository is None
        or run is None
        or project is None
        or run.repository_id != repository.repository_id
    ):
        raise HTTPException(status_code=404, detail="Run Git state not found")
    _assert_repository_binding(repository, root)
    projection_digest = (
        service.git.repo_state_token(Path(project.worktree_path)).digest
        if project.worktree_path
        else None
    )
    return _project_workspace_payload(
        project,
        run,
        projection_state_digest=projection_digest,
    )


@router.post("/runs/{run_id}/git/workspace/files:save", status_code=201)
async def save_run_git_workspace_file(
    run_id: str,
    body: GitRunWorkspaceEditBody,
):
    _assert_snapshot_owner(
        run_id=run_id,
        space_id=body.space_id,
        email=body.email,
        user_id=body.user_id,
    )
    try:
        result = _run_edit_service().save_text(
            run_id=run_id,
            relative_path=body.relative_path,
            content=body.content,
            operation_request_id=body.operation_request_id,
            editor_session_id=body.editor_session_id,
            actor_id=body.actor_id,
            expected_content_digest=body.expected_content_digest,
        )
    except Exception as exc:
        raise _git_error(exc) from exc
    return {
        "run_id": result.run_id,
        "relative_path": result.relative_path,
        "content_digest": result.content_digest,
        "checkpoint_id": result.checkpoint.checkpoint_id,
        "commit_oid": result.checkpoint.commit_oid,
        "created_at": result.checkpoint.created_at,
    }


@router.get("/runs/{run_id}/git/snapshot")
async def run_git_snapshot(
    run_id: str,
    space_id: str = Query(..., min_length=1),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    _assert_snapshot_owner(
        run_id=run_id,
        space_id=space_id,
        email=email,
        user_id=user_id,
    )
    snapshot = _snapshot_service().get_snapshot(run_id)
    return {
        "run_id": run_id,
        "materialized": snapshot is not None,
        "snapshot": (
            _snapshot_payload(snapshot) if snapshot is not None else None
        ),
    }


@router.post("/runs/{run_id}/git/snapshot:refresh")
async def refresh_run_git_snapshot(
    run_id: str,
    body: GitSnapshotBody,
):
    _assert_snapshot_owner(
        run_id=run_id,
        space_id=body.space_id,
        email=body.email,
        user_id=body.user_id,
    )
    try:
        snapshot = _snapshot_service().refresh_snapshot(
            run_id,
            expected_user_working_state_digest=(
                body.expected_user_working_state_digest
            ),
        )
    except Exception as exc:
        raise _git_error(exc) from exc
    return {"snapshot": _snapshot_payload(snapshot)}


@router.get("/runs/{run_id}/git/snapshot/files")
async def read_run_git_snapshot_file(
    run_id: str,
    path: str = Query(..., min_length=1, max_length=4096),
    start_offset: int = Query(0, ge=0),
    max_bytes: int = Query(256 * 1024, ge=1, le=4 * 1024 * 1024),
    space_id: str = Query(..., min_length=1),
    email: str = Query(..., min_length=1),
    user_id: str | None = Query(None),
):
    _assert_snapshot_owner(
        run_id=run_id,
        space_id=space_id,
        email=email,
        user_id=user_id,
    )
    try:
        result = _snapshot_service().read_range(
            run_id=run_id,
            relative_path=path,
            start_offset=start_offset,
            max_bytes=max_bytes,
        )
    except Exception as exc:
        raise _git_error(exc) from exc
    headers = {
        "Accept-Ranges": "bytes",
        "X-Eigent-Snapshot-Id": result.snapshot.snapshot_id,
        "X-Eigent-Snapshot-Source": result.source_kind,
        "X-Content-SHA256": result.content_digest,
    }
    if result.end_offset > result.start_offset:
        headers["Content-Range"] = (
            f"bytes {result.start_offset}-{result.end_offset - 1}/"
            f"{result.size_bytes}"
        )
    else:
        headers["Content-Range"] = f"bytes */{result.size_bytes}"
    return Response(
        content=result.content,
        status_code=206,
        media_type="application/octet-stream",
        headers=headers,
    )


@router.post("/runs/{run_id}/git/workspace:materialize")
async def materialize_run_git_workspace(
    run_id: str,
    body: GitMaterializeRunBody,
):
    root = _binding_root(
        space_id=body.space_id,
        email=body.email,
        user_id=body.user_id,
    )
    service = _service()
    repository = service.journal.get_space_git_repository(
        space_id=body.space_id
    )
    run = service.journal.get_run_git_materialization(run_id)
    if (
        repository is None
        or run is None
        or run.repository_id != repository.repository_id
    ):
        raise HTTPException(status_code=404, detail="Run Git state not found")
    _assert_repository_binding(repository, root)
    try:
        workspace = _coordinator().ensure_run_materialized(
            run_id=run_id,
            operation_request_id=body.operation_request_id,
            expected_repo_state_digest=body.expected_repo_state_digest,
            expected_project_version=body.expected_project_version,
            expected_project_head=body.expected_project_head,
        )
    except Exception as exc:
        raise _git_error(exc) from exc
    return _project_workspace_payload(
        workspace.project,
        workspace.run,
        projection_state_digest=_coordinator()
        .git.repo_state_token(workspace.project_worktree)
        .digest,
    )


@router.post("/runs/{run_id}/git/workspace:promote")
async def promote_run_git_workspace(
    run_id: str,
    body: GitPromoteRunBody,
):
    root = _binding_root(
        space_id=body.space_id,
        email=body.email,
        user_id=body.user_id,
    )
    service = _service()
    repository = service.journal.get_space_git_repository(
        space_id=body.space_id
    )
    run = service.journal.get_run_git_materialization(run_id)
    if (
        repository is None
        or run is None
        or run.repository_id != repository.repository_id
    ):
        raise HTTPException(status_code=404, detail="Run Git state not found")
    _assert_repository_binding(repository, root)
    try:
        workspace = _coordinator().promote_run(
            run_id=run_id,
            operation_request_id=body.operation_request_id,
            expected_run_state_digest=body.expected_run_state_digest,
            expected_project_version=body.expected_project_version,
            expected_project_head=body.expected_project_head,
            expected_run_head=body.expected_run_head,
        )
    except Exception as exc:
        raise _git_error(exc) from exc
    return _project_workspace_payload(
        workspace.project,
        workspace.run,
        projection_state_digest=_coordinator()
        .git.repo_state_token(workspace.project_worktree)
        .digest,
    )


@router.post("/projects/{project_id}/git/workspace:refresh")
async def refresh_project_git_workspace(
    project_id: str,
    body: GitRefreshProjectBody,
):
    root = _binding_root(
        space_id=body.space_id,
        email=body.email,
        user_id=body.user_id,
    )
    service = _service()
    repository = service.journal.get_space_git_repository(
        space_id=body.space_id
    )
    project = service.journal.get_project_git_state(project_id)
    if (
        repository is None
        or project is None
        or project.repository_id != repository.repository_id
    ):
        raise HTTPException(
            status_code=404, detail="Project Git state not found"
        )
    _assert_repository_binding(repository, root)
    coordinator = _coordinator()
    try:
        project = coordinator.refresh_project_projection(
            project_id=project_id,
            operation_request_id=body.operation_request_id,
            expected_projection_state_digest=(
                body.expected_projection_state_digest
            ),
            expected_project_version=body.expected_project_version,
            expected_integration_head=body.expected_integration_head,
            expected_projected_head=body.expected_projected_head,
        )
    except Exception as exc:
        raise _git_error(exc) from exc
    if not project.worktree_path:
        raise HTTPException(status_code=409, detail="Project worktree missing")
    return _project_workspace_payload(
        project,
        projection_state_digest=coordinator.git.repo_state_token(
            Path(project.worktree_path)
        ).digest,
    )
