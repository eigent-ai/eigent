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

from pathlib import Path, PurePosixPath
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.auth import require_local_control_principal
from app.run_journal import (
    IdempotencyConflictError,
    InvalidRunTransitionError,
    default_run_journal_path,
    get_default_run_journal,
)
from app.utils.workspace_resolver import get_workspace_resolver
from app.workspace_git import (
    ContentRepositoryConsentRequired,
    ContentRepositoryError,
    ContentRepositoryService,
    GitBackendError,
    NestedRepositoryError,
    NoCheckpointChangesError,
    RepositoryStateChangedError,
)
from app.workspace_git.backend import RepositoryDiagnostics

router = APIRouter(dependencies=[Depends(require_local_control_principal)])


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


def _service() -> ContentRepositoryService:
    return ContentRepositoryService(
        get_default_run_journal(),
        state_root=default_run_journal_path().parent / "workspace-git",
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
    if isinstance(exc, RepositoryStateChangedError):
        return HTTPException(
            status_code=409,
            detail={"code": "repo_state_changed", "message": str(exc)},
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
    try:
        checkpoint = service.checkpoint(
            repository.repository_id,
            operation_request_id=body.operation_request_id,
            expected_repo_state_digest=body.expected_repo_state_digest,
            paths=tuple(root / path for path in body.paths),
            path_sources=body.path_sources,
            target_role=body.target_role,
            target_id=body.target_id,
            actor_id=body.actor_id,
            trigger=body.trigger,
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
