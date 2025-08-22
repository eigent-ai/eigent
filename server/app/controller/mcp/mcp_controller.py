from typing import Dict
from fastapi import Depends, HTTPException, APIRouter
from fastapi_babel import _
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from sqlmodel import Session, col, select
from sqlalchemy.orm import selectinload, with_loader_criteria
from app.component.auth import Auth, auth_must
from app.component.database import session
from app.model.mcp.mcp import Mcp, McpOut, McpType
from app.model.mcp.mcp_env import McpEnv, Status as McpEnvStatus
from app.model.mcp.mcp_user import McpImportType, McpUser, Status
from loguru import logger

from app.component.validator.McpServer import (
    McpRemoteServer,
    McpServerItem,
    validate_mcp_remote_servers,
    validate_mcp_servers,
)

router = APIRouter(tags=["Mcp Servers"])


@router.get("/mcps", name="mcp list")
async def gets(
    keyword: str | None = None,
    category_id: int | None = None,
    mine: int | None = None,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must),
) -> Page[McpOut]:
    stmt = (
        select(Mcp)
        .where(Mcp.no_delete())
        .options(
            selectinload(Mcp.category),
            selectinload(Mcp.envs),
            with_loader_criteria(McpEnv, col(McpEnv.status) == McpEnvStatus.in_use),
        )
        # .order_by(col(Mcp.sort).desc())
    )
    if keyword:
        stmt = stmt.where(col(Mcp.key).like(f"%{keyword.lower()}%"))
    if category_id:
        stmt = stmt.where(Mcp.category_id == category_id)
    if mine and auth:
        stmt = (
            stmt.join(McpUser)
            .where(McpUser.user_id == auth.user.id)
            .options(
                selectinload(Mcp.mcp_user),
                with_loader_criteria(McpUser, col(McpUser.user_id) == auth.user.id),
            )
        )
    return paginate(session, stmt)


@router.get("/mcp", name="mcp detail", response_model=McpOut)
async def get(id: int, session: Session = Depends(session)):
    stmt = select(Mcp).where(Mcp.no_delete(), Mcp.id == id).options(selectinload(Mcp.category), selectinload(Mcp.envs))
    model = session.exec(stmt).one()
    return model


@router.post("/mcp/install", name="mcp install")
async def install(mcp_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    mcp = session.get_one(Mcp, mcp_id)
    if not mcp:
        raise HTTPException(status_code=404, detail=_("Mcp not found"))
    exists = session.exec(select(McpUser).where(McpUser.mcp_id == mcp.id, McpUser.user_id == auth.user.id)).first()
    if exists:
        raise HTTPException(status_code=400, detail=_("mcp is installed"))
    install_command: dict = mcp.install_command
    mcp_user = McpUser(
        mcp_id=mcp.id,
        user_id=auth.user.id,
        mcp_name=mcp.name,
        mcp_key=mcp.key,
        mcp_desc=mcp.description,
        type=mcp.type,
        status=Status.enable,
        command=install_command["command"],
        args=install_command["args"],
        env=install_command["env"],
        server_url=None,
    )
    mcp_user.save()
    return mcp_user


@router.post("/mcp/import/{mcp_type}", name="mcp import")
async def import_mcp(
    mcp_type: McpImportType, mcp_data: dict, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    logger.debug(mcp_type, mcp_type.value)

    if mcp_type == McpImportType.Local:
        is_valid, res = validate_mcp_servers(mcp_data)
        if not is_valid:
            raise HTTPException(status_code=400, detail=res)
        mcp_data: Dict[str, McpServerItem] = res.mcpServers
        for name, data in mcp_data.items():
            mcp_user = McpUser(
                mcp_id=0,
                user_id=auth.user.id,
                mcp_name=name,
                mcp_key=name,
                mcp_desc=name,
                type=McpType.Local,
                status=Status.enable,
                command=data.command,
                args=data.args,
                env=data.env,
                server_url=None,
            )
            break
    elif mcp_type == McpImportType.Remote:
        is_valid, res = validate_mcp_remote_servers(mcp_data)
        if not is_valid:
            raise HTTPException(status_code=400, detail=res)
        data: McpRemoteServer = res
        mcp_user = McpUser(
            mcp_id=0,
            user_id=auth.user.id,
            type=McpType.Remote,
            status=Status.enable,
            mcp_name=data.server_name,
            server_url=data.server_url,
        )
    mcp_user.save()
    return mcp_user
