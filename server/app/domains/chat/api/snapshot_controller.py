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

"""v1 Chat Snapshot - H3 auth, H4 ownership, H19 path traversal, P2 Update model.
STATUS: full-rewrite (security: H3, H4, H19, P2 Update model)
"""

import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi_babel import _
from sqlmodel import Session, select

from app.core.database import session
from app.model.chat.chat_snpshot import ChatSnapshot, ChatSnapshotIn, ChatSnapshotOut, ChatSnapshotUpdate

from app.shared.auth import auth_must
from app.shared.auth.ownership import require_owner

router = APIRouter(prefix="/chat", tags=["V1 Chat Snapshot"])

# H19: api_task_id must be safe for path - only alphanumeric, dash, underscore
API_TASK_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")
SNAPSHOT_COMPONENT_PATTERN = re.compile(r"^[a-zA-Z0-9_.:-]{1,200}$")


def _validate_api_task_id(value: str) -> None:
    """Reject path traversal: api_task_id must match safe charset."""
    if not value or not API_TASK_ID_PATTERN.match(value):
        raise HTTPException(status_code=400, detail=_("Invalid api_task_id: only letters, numbers, - and _ allowed"))


def _validate_snapshot_component(value: str | None, field_name: str) -> None:
    if value is not None and (value in {".", ".."} or not SNAPSHOT_COMPONENT_PATTERN.match(value)):
        raise HTTPException(status_code=400, detail=_(f"Invalid {field_name}: unsafe snapshot path component"))


def _snapshot_storage_key(user_id: int, snapshot: ChatSnapshotIn, image_path: str) -> str:
    if snapshot.storage_key:
        return snapshot.storage_key
    filename = image_path.rsplit("/", 1)[-1]
    if snapshot.space_id and snapshot.project_id:
        run_id = snapshot.run_id or snapshot.api_task_id
        return (
            f"local://{user_id}/spaces/{snapshot.space_id}/projects/"
            f"{snapshot.project_id}/runs/{run_id}/snapshot/{filename}"
        )
    return f"local://{image_path.lstrip('/')}"


def _snapshot_image_url(snapshot: ChatSnapshot) -> str:
    if snapshot.storage_key and snapshot.storage_key.startswith("local://"):
        key = snapshot.storage_key.removeprefix("local://").lstrip("/")
        if key.startswith("public/upload/"):
            return f"/{key}"
        match = re.match(
            r"^[^/]+/spaces/([^/]+)/projects/([^/]+)/runs/([^/]+)/snapshot/([^/]+)$",
            key,
        )
        if match:
            space_id, project_id, run_id, filename = match.groups()
            return f"/public/upload/v2/{space_id}/{project_id}/{run_id}/{filename}"
    # Unknown schemes such as s3://, or no storage_key at all, keep returning
    # the legacy renderable image_path until a scheme-aware URL resolver lands.
    return snapshot.image_path


def _snapshot_out(snapshot: ChatSnapshot) -> ChatSnapshotOut:
    data = snapshot.model_dump()
    data["image_url"] = _snapshot_image_url(snapshot)
    return ChatSnapshotOut(**data)


@router.get("/snapshots", name="list chat snapshots", response_model=List[ChatSnapshotOut])
async def list_chat_snapshots(
    api_task_id: Optional[str] = None,
    run_id: Optional[str] = None,
    camel_task_id: Optional[str] = None,
    browser_url: Optional[str] = None,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    if run_id is not None:
        _validate_api_task_id(run_id)
    query = select(ChatSnapshot).where(ChatSnapshot.user_id == auth.user.id)
    task_or_run_id = run_id or api_task_id
    if task_or_run_id is not None:
        _validate_api_task_id(task_or_run_id)
        query = query.where(ChatSnapshot.api_task_id == task_or_run_id)
    if camel_task_id is not None:
        query = query.where(ChatSnapshot.camel_task_id == camel_task_id)
    if browser_url is not None:
        query = query.where(ChatSnapshot.browser_url == browser_url)
    return [_snapshot_out(snapshot) for snapshot in db_session.exec(query).all()]


@router.get("/snapshots/{snapshot_id}", name="get chat snapshot", response_model=ChatSnapshotOut)
async def get_chat_snapshot(
    snapshot_id: int,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    snapshot = db_session.get(ChatSnapshot, snapshot_id)
    require_owner(snapshot, auth.user.id)
    return _snapshot_out(snapshot)


@router.post("/snapshots", name="create chat snapshot", response_model=ChatSnapshotOut)
async def create_chat_snapshot(
    snapshot: ChatSnapshotIn,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    _validate_api_task_id(snapshot.api_task_id)
    _validate_snapshot_component(snapshot.space_id, "space_id")
    _validate_snapshot_component(snapshot.project_id, "project_id")
    _validate_snapshot_component(snapshot.run_id, "run_id")
    try:
        image_path = ChatSnapshotIn.save_image(
            auth.user.id,
            snapshot.api_task_id,
            snapshot.image_base64,
            space_id=snapshot.space_id,
            project_id=snapshot.project_id,
            run_id=snapshot.run_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    chat_snapshot = ChatSnapshot(
        user_id=auth.user.id,
        api_task_id=snapshot.api_task_id,
        camel_task_id=snapshot.camel_task_id,
        browser_url=snapshot.browser_url,
        image_path=image_path,
        storage_key=_snapshot_storage_key(auth.user.id, snapshot, image_path),
    )
    db_session.add(chat_snapshot)
    db_session.commit()
    db_session.refresh(chat_snapshot)
    return _snapshot_out(chat_snapshot)


@router.put("/snapshots/{snapshot_id}", name="update chat snapshot", response_model=ChatSnapshotOut)
async def update_chat_snapshot(
    snapshot_id: int,
    snapshot_update: ChatSnapshotUpdate,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    db_snapshot = db_session.get(ChatSnapshot, snapshot_id)
    require_owner(db_snapshot, auth.user.id)
    for key, value in snapshot_update.model_dump(exclude_unset=True).items():
        if key == "api_task_id" and value is not None:
            _validate_api_task_id(str(value))
        setattr(db_snapshot, key, value)
    db_session.add(db_snapshot)
    db_session.commit()
    db_session.refresh(db_snapshot)
    return _snapshot_out(db_snapshot)


@router.delete("/snapshots/{snapshot_id}", name="delete chat snapshot")
async def delete_chat_snapshot(
    snapshot_id: int,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    db_snapshot = db_session.get(ChatSnapshot, snapshot_id)
    require_owner(db_snapshot, auth.user.id)
    db_session.delete(db_snapshot)
    db_session.commit()
    return Response(status_code=204)
