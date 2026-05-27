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

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Query
from sqlmodel import Session

from app.core.database import session
from app.domains.space.service.apply_service import SpaceApplyService
from app.domains.space.service.overlay_service import (
    PendingOverlayError,
    SpaceOverlayService,
)
from app.domains.space.service.space_service import SpaceHasProjectsError, SpaceService
from app.model.project import ProjectIn, ProjectOut, ProjectUpdate
from app.model.space import (
    SpaceIn,
    SpaceOverlayDiscardIn,
    SpaceOverlayDiscardResponse,
    SpaceOverlayListResponse,
    SpaceOverlayOut,
    SpaceOverlayWriteIn,
    SpaceOut,
    SpaceProjectApplyIn,
    SpaceProjectApplyResponse,
    SpaceProjectRefreshIn,
    SpaceProjectRefreshResponse,
    SpaceRelocateIn,
    SpaceUpdate,
)
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth

router = APIRouter(prefix="/spaces", tags=["Spaces"])


@router.get("", name="list spaces", response_model=list[SpaceOut])
def list_spaces(
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    return SpaceService.list_spaces(auth.id, db_session)


@router.post("", name="create space", response_model=SpaceOut)
def create_space(
    data: SpaceIn,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return SpaceOut.from_model(SpaceService.create_space(data, auth.id, db_session))
    except ValueError as exc:
        detail = str(exc)
        status_code = 409 if "already bound" in detail else 400
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.get("/{space_id}", name="get space", response_model=SpaceOut)
def get_space(
    space_id: str,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return SpaceOut.from_model(SpaceService.get_space(space_id, auth.id, db_session))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/{space_id}", name="update space", response_model=SpaceOut)
def update_space(
    space_id: str,
    data: SpaceUpdate,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return SpaceOut.from_model(SpaceService.update_space(space_id, data, auth.id, db_session))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{space_id}", name="delete space", status_code=204)
def delete_space(
    space_id: str,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        SpaceService.delete_space(space_id, auth.id, db_session)
    except SpaceHasProjectsError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "space_has_projects",
                "message": str(exc),
                "project_count": exc.project_count,
                "projects": exc.projects,
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{space_id}/archive", name="archive space", response_model=SpaceOut)
def archive_space(
    space_id: str,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return SpaceOut.from_model(SpaceService.archive_space(space_id, auth.id, db_session))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{space_id}/unarchive", name="unarchive space", response_model=SpaceOut)
def unarchive_space(
    space_id: str,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return SpaceOut.from_model(SpaceService.unarchive_space(space_id, auth.id, db_session))
    except ValueError as exc:
        status_code = 409 if "already bound" in str(exc) else 404
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.post("/{space_id}/relocate", name="relocate space", response_model=SpaceOut)
def relocate_space(
    space_id: str,
    data: SpaceRelocateIn,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return SpaceOut.from_model(
            SpaceService.relocate_space(
                space_id,
                data.root_path,
                auth.id,
                db_session,
                force=data.force,
                root_fingerprint=data.root_fingerprint,
            )
        )
    except ValueError as exc:
        detail = str(exc)
        if (
            "already bound" in detail
            or "identity" in detail
            or "cannot be verified" in detail
        ):
            raise HTTPException(status_code=409, detail=detail) from exc
        raise HTTPException(status_code=404, detail=detail) from exc


@router.post("/legacy", name="ensure legacy space", response_model=SpaceOut)
def ensure_legacy_space(
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    return SpaceOut.from_model(SpaceService.ensure_legacy_space(auth.id, db_session))


@router.get("/{space_id}/projects", name="list space projects", response_model=list[ProjectOut])
def list_space_projects(
    space_id: str,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    return SpaceService.list_projects(space_id, auth.id, db_session)


@router.post("/{space_id}/projects", name="create space project", response_model=ProjectOut)
def create_space_project(
    space_id: str,
    data: ProjectIn,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return ProjectOut.from_model(SpaceService.create_project(space_id, data, auth.id, db_session))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/{space_id}/projects/{project_id}", name="update space project", response_model=ProjectOut)
def update_space_project(
    space_id: str,
    project_id: str,
    data: ProjectUpdate,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return ProjectOut.from_model(
            SpaceService.update_project(space_id, project_id, data, auth.id, db_session)
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{space_id}/projects/{project_id}/promote", name="promote project to folder space", response_model=ProjectOut)
def promote_space_project(
    space_id: str,
    project_id: str,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return ProjectOut.from_model(
            SpaceService.promote_project(space_id, project_id, auth.id, db_session)
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 409 if "Cannot promote" in detail or "target" in detail else 404
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.post(
    "/{space_id}/projects/{project_id}/apply",
    name="apply project run to space",
    response_model=SpaceProjectApplyResponse,
)
def apply_space_project_run(
    space_id: str,
    project_id: str,
    data: SpaceProjectApplyIn,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return SpaceApplyService.apply_project_run(
            space_id,
            project_id,
            data,
            auth.id,
            db_session,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 409 if "requires" in detail or "not available" in detail else 404
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.get(
    "/{space_id}/projects/{project_id}/overlays",
    name="list project overlays",
    response_model=SpaceOverlayListResponse,
)
def list_space_project_overlays(
    space_id: str,
    project_id: str,
    run_id: str | None = Query(None),
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return SpaceOverlayService.list_overlays(
            space_id,
            project_id,
            auth.id,
            db_session,
            run_id=run_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/{space_id}/projects/{project_id}/overlays",
    name="record project overlay write",
    response_model=SpaceOverlayOut,
)
def record_space_project_overlay(
    space_id: str,
    project_id: str,
    data: SpaceOverlayWriteIn,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return SpaceOverlayService.record_overlay_write(
            space_id,
            project_id,
            data,
            auth.id,
            db_session,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/{space_id}/projects/{project_id}/discard",
    name="discard project overlays",
    response_model=SpaceOverlayDiscardResponse,
)
def discard_space_project_overlays(
    space_id: str,
    project_id: str,
    data: SpaceOverlayDiscardIn,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return SpaceOverlayService.discard_overlays(
            space_id,
            project_id,
            auth.id,
            db_session,
            run_id=data.run_id,
            paths=data.paths,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/{space_id}/projects/{project_id}/refresh",
    name="refresh project workdir",
    response_model=SpaceProjectRefreshResponse,
)
def refresh_space_project(
    space_id: str,
    project_id: str,
    data: SpaceProjectRefreshIn,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    try:
        return SpaceOverlayService.refresh_project(
            space_id,
            project_id,
            data,
            auth.id,
            db_session,
        )
    except PendingOverlayError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "pending_overlays",
                "message": str(exc),
                "run_ids": exc.run_ids,
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
