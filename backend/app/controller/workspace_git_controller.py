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
    ContentRepositoryConsentRequired,
    ContentRepositoryError,
    ContentRepositoryService,
    GitBackendError,
    NestedRepositoryError,
    NoCheckpointChangesError,
    RepositoryStateChangedError,
    WorkspaceGitCoordinator,
    WorkspaceSnapshotError,
    WorkspaceSnapshotService,
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
        return HTTPException(
            status_code=(
                404 if exc.code == "workspace_path_not_found" else 409
            ),
            detail={"code": exc.code, "message": str(exc)},
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
        snapshot = _snapshot_service().refresh_snapshot(run_id)
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
