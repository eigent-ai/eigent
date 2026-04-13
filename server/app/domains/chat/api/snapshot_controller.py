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
from app.model.chat.chat_snpshot import ChatSnapshot, ChatSnapshotIn, ChatSnapshotUpdate

from app.shared.auth import auth_must
from app.shared.auth.ownership import require_owner

router = APIRouter(prefix="/chat", tags=["V1 Chat Snapshot"])

# H19: api_task_id must be safe for path - only alphanumeric, dash, underscore
API_TASK_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")


def _validate_api_task_id(value: str) -> None:
    """Reject path traversal: api_task_id must match safe charset."""
    if not value or not API_TASK_ID_PATTERN.match(value):
        raise HTTPException(status_code=400, detail=_("Invalid api_task_id: only letters, numbers, - and _ allowed"))

@router.get("/snapshots", name="list chat snapshots", response_model=List[ChatSnapshot])
async def list_chat_snapshots(
    api_task_id: Optional[str] = None,
    camel_task_id: Optional[str] = None,
    browser_url: Optional[str] = None,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    query = select(ChatSnapshot).where(ChatSnapshot.user_id == auth.user.id)
    if api_task_id is not None:
        query = query.where(ChatSnapshot.api_task_id == api_task_id)
    if camel_task_id is not None:
        query = query.where(ChatSnapshot.camel_task_id == camel_task_id)
    if browser_url is not None:
        query = query.where(ChatSnapshot.browser_url == browser_url)
    return list(db_session.exec(query).all())


@router.get("/snapshots/{snapshot_id}", name="get chat snapshot", response_model=ChatSnapshot)
async def get_chat_snapshot(
    snapshot_id: int,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    snapshot = db_session.get(ChatSnapshot, snapshot_id)
    require_owner(snapshot, auth.user.id)
    return snapshot


@router.post("/snapshots", name="create chat snapshot", response_model=ChatSnapshot)
async def create_chat_snapshot(
    snapshot: ChatSnapshotIn,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    _validate_api_task_id(snapshot.api_task_id)
    image_path = ChatSnapshotIn.save_image(auth.user.id, snapshot.api_task_id, snapshot.image_base64)
    chat_snapshot = ChatSnapshot(
        user_id=auth.user.id,
        api_task_id=snapshot.api_task_id,
        camel_task_id=snapshot.camel_task_id,
        browser_url=snapshot.browser_url,
        image_path=image_path,
    )
    db_session.add(chat_snapshot)
    db_session.commit()
    db_session.refresh(chat_snapshot)
    return chat_snapshot


@router.put("/snapshots/{snapshot_id}", name="update chat snapshot", response_model=ChatSnapshot)
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
    return db_snapshot


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
