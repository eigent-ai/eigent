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

"""MCP controller. Uses McpUserService for install and import."""

from fastapi import Depends, HTTPException, APIRouter
from fastapi_babel import _
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from sqlmodel import Session, col, select
from sqlalchemy.orm import selectinload, with_loader_criteria

from app.core.database import session
from app.model.mcp.mcp import Mcp, McpOut
from app.model.mcp.mcp_env import McpEnv, Status as McpEnvStatus
from app.model.mcp.mcp_user import McpImportType, McpUser
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth
from app.shared.middleware.rate_limit import install_rate_limiter
from app.domains.mcp.service.mcp_user_service import McpUserService

router = APIRouter(tags=["Mcp Servers"])

_INSTALL_ERROR_MAP = {
    "MCP_NOT_FOUND": (404, "Mcp not found"),
    "MCP_ALREADY_INSTALLED": (400, "mcp is installed"),
    "MCP_INVALID_INSTALL_COMMAND": (400, "Install command is not valid json"),
}


@router.get("/mcps", name="mcp list")
async def gets(
    keyword: str | None = None,
    category_id: int | None = None,
    mine: int | None = None,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
) -> Page[McpOut]:
    stmt = (
        select(Mcp)
        .where(Mcp.no_delete())
        .options(
            selectinload(Mcp.category),
            selectinload(Mcp.envs),
            with_loader_criteria(McpEnv, col(McpEnv.status) == McpEnvStatus.in_use),
        )
    )
    if keyword:
        stmt = stmt.where(col(Mcp.key).like(f"%{keyword.lower()}%"))
    if category_id:
        stmt = stmt.where(Mcp.category_id == category_id)
    if mine and auth:
        stmt = (
            stmt.join(McpUser)
            .where(McpUser.user_id == auth.id)
            .options(
                selectinload(Mcp.mcp_user),
                with_loader_criteria(McpUser, col(McpUser.user_id) == auth.id),
            )
        )
    return paginate(db_session, stmt)


@router.get("/mcp", name="mcp detail", response_model=McpOut)
async def get(id: int, db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)):
    stmt = select(Mcp).where(Mcp.no_delete(), Mcp.id == id).options(selectinload(Mcp.category), selectinload(Mcp.envs))
    model = db_session.exec(stmt).first()
    if not model:
        raise HTTPException(status_code=404, detail=_("Mcp not found"))
    return model


@router.post("/mcp/install", name="mcp install", dependencies=[install_rate_limiter])
async def install(mcp_id: int, db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)):
    result = McpUserService.install(mcp_id, auth.id, db_session)
    if not result["success"]:
        status, msg = _INSTALL_ERROR_MAP.get(result["error_code"], (400, "Install failed"))
        raise HTTPException(status_code=status, detail=_(msg))
    return result["mcp_user"]


@router.post("/mcp/import/{mcp_type}", name="mcp import", dependencies=[install_rate_limiter])
async def import_mcp(
    mcp_type: McpImportType, mcp_data: dict, auth: V1UserAuth = Depends(auth_must)
):
    result = McpUserService.import_mcp(mcp_type, mcp_data, auth.id)
    if not result["success"]:
        detail = result.get("detail", "Import failed")
        raise HTTPException(status_code=400, detail=detail)
    return result
