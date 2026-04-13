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

"""MCP User controller - H15 ownership on GET/DELETE."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi_babel import _
from sqlmodel import Session, select

from app.core.database import session
from app.model.mcp.mcp_user import McpUser, McpUserIn, McpUserOut, McpUserUpdate

from app.shared.auth import auth_must
from app.shared.auth.ownership import require_owner

router = APIRouter(tags=["V1 McpUser Management"])


@router.get("/mcp/users", name="list mcp users", response_model=List[McpUserOut])
async def list_mcp_users(
    mcp_id: Optional[int] = None,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    query = select(McpUser).where(McpUser.user_id == auth.user.id)
    if mcp_id is not None:
        query = query.where(McpUser.mcp_id == mcp_id)
    return list(db_session.exec(query).all())


@router.get("/mcp/users/{mcp_user_id}", name="get mcp user", response_model=McpUserOut)
async def get_mcp_user(
    mcp_user_id: int,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    mcp_user = db_session.get(McpUser, mcp_user_id)
    require_owner(mcp_user, auth.user.id)
    return mcp_user


@router.post("/mcp/users", name="create mcp user", response_model=McpUserOut)
async def create_mcp_user(
    mcp_user: McpUserIn,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    exists = db_session.exec(
        select(McpUser).where(McpUser.mcp_id == mcp_user.mcp_id, McpUser.user_id == auth.user.id)
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail=_("mcp is installed"))
    db_mcp_user = McpUser(mcp_id=mcp_user.mcp_id, user_id=auth.user.id, env=mcp_user.env)
    db_session.add(db_mcp_user)
    db_session.commit()
    db_session.refresh(db_mcp_user)
    return db_mcp_user


@router.put("/mcp/users/{id}", name="update mcp user")
async def update_mcp_user(
    id: int,
    update_item: McpUserUpdate,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    model = db_session.get(McpUser, id)
    require_owner(model, auth.user.id)
    update_data = update_item.model_dump(exclude_unset=True)
    model.update_fields(update_data)
    model.save(db_session)
    db_session.refresh(model)
    return model


@router.delete("/mcp/users/{mcp_user_id}", name="delete mcp user")
async def delete_mcp_user(
    mcp_user_id: int,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    db_mcp_user = db_session.get(McpUser, mcp_user_id)
    require_owner(db_mcp_user, auth.user.id)
    db_session.delete(db_mcp_user)
    db_session.commit()
    return Response(status_code=204)
