import os
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
from camel.toolkits.mcp_toolkit import MCPToolkit
from app.component.environment import env
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_mcp_controller")

from app.component.validator.McpServer import (
    McpRemoteServer,
    McpServerItem,
    validate_mcp_remote_servers,
    validate_mcp_servers,
)

router = APIRouter(tags=["Mcp Servers"])


async def pre_instantiate_mcp_toolkit(config_dict: dict) -> bool:
    """
    Pre-instantiate MCP toolkit to complete authentication process

    Args:
        config_dict: MCP server configuration dictionary

    Returns:
        bool: Whether successfully instantiated and connected
    """
    try:
        # Ensure unified auth directory for all mcp servers
        for server_config in config_dict.get("mcpServers", {}).values():
            if "env" not in server_config:
                server_config["env"] = {}
            # Set global auth directory to persist authentication across tasks
            if "MCP_REMOTE_CONFIG_DIR" not in server_config["env"]:
                server_config["env"]["MCP_REMOTE_CONFIG_DIR"] = env(
                    "MCP_REMOTE_CONFIG_DIR",
                    os.path.expanduser("~/.mcp-auth")
                )

        # Create MCP toolkit and attempt to connect
        mcp_toolkit = MCPToolkit(config_dict=config_dict, timeout=30)
        await mcp_toolkit.connect()

        # Get tools list to ensure connection is successful
        tools = mcp_toolkit.get_tools()
        logger.info("MCP toolkit pre-instantiated", extra={"tools_count": len(tools)})

        # Disconnect, authentication info is already saved
        await mcp_toolkit.disconnect()
        return True

    except Exception as e:
        logger.warning("MCP toolkit pre-instantiation failed", extra={"error": str(e)}, exc_info=True)
        return False


@router.get("/mcps", name="mcp list")
@traceroot.trace()
async def gets(
    keyword: str | None = None,
    category_id: int | None = None,
    mine: int | None = None,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must),
) -> Page[McpOut]:
    """List MCP servers with optional filtering."""
    user_id = auth.user.id
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
            .where(McpUser.user_id == user_id)
            .options(
                selectinload(Mcp.mcp_user),
                with_loader_criteria(McpUser, col(McpUser.user_id) == user_id),
            )
        )
    
    result = paginate(session, stmt)
    total = result.total if hasattr(result, 'total') else 0
    logger.debug("MCP list retrieved", extra={"user_id": user_id, "keyword": keyword, "category_id": category_id, "mine": mine, "total": total})
    return result


@router.get("/mcp", name="mcp detail", response_model=McpOut)
@traceroot.trace()
async def get(id: int, session: Session = Depends(session)):
    """Get MCP server details."""
    try:
        stmt = select(Mcp).where(Mcp.no_delete(), Mcp.id == id).options(selectinload(Mcp.category), selectinload(Mcp.envs))
        model = session.exec(stmt).one()
        logger.debug("MCP detail retrieved", extra={"mcp_id": id, "mcp_key": model.key})
        return model
    except Exception as e:
        logger.warning("MCP not found", extra={"mcp_id": id})
        raise HTTPException(status_code=404, detail=_("Mcp not found"))


@router.post("/mcp/install", name="mcp install")
@traceroot.trace()
async def install(mcp_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Install MCP server for user."""
    user_id = auth.user.id
    
    mcp = session.get_one(Mcp, mcp_id)
    if not mcp:
        logger.warning("MCP install failed: MCP not found", extra={"user_id": user_id, "mcp_id": mcp_id})
        raise HTTPException(status_code=404, detail=_("Mcp not found"))
    
    exists = session.exec(select(McpUser).where(McpUser.mcp_id == mcp.id, McpUser.user_id == user_id)).first()
    if exists:
        logger.warning("MCP install failed: already installed", extra={"user_id": user_id, "mcp_id": mcp_id, "mcp_key": mcp.key})
        raise HTTPException(status_code=400, detail=_("mcp is installed"))

    install_command: dict = mcp.install_command

    # Pre-instantiate MCP toolkit for authentication
    config_dict = {
        "mcpServers": {
            mcp.key: install_command
        }
    }

    try:
        success = await pre_instantiate_mcp_toolkit(config_dict)
        if not success:
            logger.warning("MCP pre-instantiation failed, continuing with installation", extra={"user_id": user_id, "mcp_id": mcp_id, "mcp_key": mcp.key})
        else:
            logger.debug("MCP toolkit pre-instantiated", extra={"mcp_key": mcp.key})
    except Exception as e:
        logger.warning("MCP pre-instantiation exception", extra={"user_id": user_id, "mcp_key": mcp.key, "error": str(e)}, exc_info=True)

    try:
        mcp_user = McpUser(
            mcp_id=mcp.id,
            user_id=user_id,
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
        logger.info("MCP installed", extra={"user_id": user_id, "mcp_id": mcp_id, "mcp_key": mcp.key})
        return mcp_user
    except Exception as e:
        logger.error("MCP installation failed", extra={"user_id": user_id, "mcp_id": mcp_id, "mcp_key": mcp.key, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/mcp/import/{mcp_type}", name="mcp import")
@traceroot.trace()
async def import_mcp(
    mcp_type: McpImportType, mcp_data: dict, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    """Import MCP servers (local or remote)."""
    user_id = auth.user.id

    if mcp_type == McpImportType.Local:
        logger.info("Importing local MCP servers", extra={"user_id": user_id})
        is_valid, res = validate_mcp_servers(mcp_data)
        if not is_valid:
            logger.warning("Local MCP import validation failed", extra={"user_id": user_id, "error": res})
            raise HTTPException(status_code=400, detail=res)
        
        mcp_data: Dict[str, McpServerItem] = res.mcpServers
        imported_count = 0

        for name, data in mcp_data.items():
            config_dict = {
                "mcpServers": {
                    name: {
                        "command": data.command,
                        "args": data.args,
                        "env": data.env or {}
                    }
                }
            }

            try:
                success = await pre_instantiate_mcp_toolkit(config_dict)
                if not success:
                    logger.warning("Local MCP pre-instantiation failed, continuing", extra={"user_id": user_id, "mcp_name": name})
            except Exception as e:
                logger.warning("Local MCP pre-instantiation exception", extra={"user_id": user_id, "mcp_name": name, "error": str(e)})

            try:
                mcp_user = McpUser(
                    mcp_id=0,
                    user_id=user_id,
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
                mcp_user.save()
                imported_count += 1
            except Exception as e:
                logger.error("Failed to import local MCP", extra={"user_id": user_id, "mcp_name": name, "error": str(e)}, exc_info=True)
        
        logger.info("Local MCPs imported", extra={"user_id": user_id, "count": imported_count})
        return {"message": "Local MCP servers imported successfully", "count": imported_count}
    
    elif mcp_type == McpImportType.Remote:
        logger.info("Importing remote MCP server", extra={"user_id": user_id})
        is_valid, res = validate_mcp_remote_servers(mcp_data)
        if not is_valid:
            logger.warning("Remote MCP import validation failed", extra={"user_id": user_id, "error": res})
            raise HTTPException(status_code=400, detail=res)
        
        data: McpRemoteServer = res

        try:
        # For remote servers, we don't need to pre-instantiate as they typically don't require authentication
        # but we can still try to validate the connection if needed
            mcp_user = McpUser(
                mcp_id=0,
                user_id=user_id,
                type=McpType.Remote,
                status=Status.enable,
                mcp_name=data.server_name,
                server_url=data.server_url,
            )
            mcp_user.save()
            logger.info("Remote MCP imported", extra={"user_id": user_id, "server_name": data.server_name, "server_url": data.server_url})
            return mcp_user
        except Exception as e:
            logger.error("Remote MCP import failed", extra={"user_id": user_id, "server_name": data.server_name, "error": str(e)}, exc_info=True)
            raise HTTPException(status_code=500, detail="Internal server error")