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
        logger.info(f"Successfully pre-instantiated MCP toolkit with {len(tools)} tools")

        # Disconnect, authentication info is already saved
        await mcp_toolkit.disconnect()
        return True

    except Exception as e:
        logger.warning(f"Failed to pre-instantiate MCP toolkit: {e!r}")
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
    logger.info(f"Listing MCPs for user {auth.user.id}, keyword: {keyword}, category: {category_id}, mine: {mine}")
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
    result = paginate(session, stmt)
    logger.debug(f"Found {result.total if hasattr(result, 'total') else 'N/A'} MCPs")
    return result


@router.get("/mcp", name="mcp detail", response_model=McpOut)
@traceroot.trace()
async def get(id: int, session: Session = Depends(session)):
    logger.info(f"Getting MCP detail for id: {id}")
    stmt = select(Mcp).where(Mcp.no_delete(), Mcp.id == id).options(selectinload(Mcp.category), selectinload(Mcp.envs))
    model = session.exec(stmt).one()
    logger.debug(f"MCP found: {model.key}")
    return model


@router.post("/mcp/install", name="mcp install")
@traceroot.trace()
async def install(mcp_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    logger.info(f"Installing MCP {mcp_id} for user {auth.user.id}")
    mcp = session.get_one(Mcp, mcp_id)
    if not mcp:
        logger.warning(f"MCP not found: {mcp_id}")
        raise HTTPException(status_code=404, detail=_("Mcp not found"))
    exists = session.exec(select(McpUser).where(McpUser.mcp_id == mcp.id, McpUser.user_id == auth.user.id)).first()
    if exists:
        logger.warning(f"MCP {mcp.key} already installed for user {auth.user.id}")
        raise HTTPException(status_code=400, detail=_("mcp is installed"))

    install_command: dict = mcp.install_command

    # Pre-instantiate MCP toolkit for authentication
    config_dict = {
        "mcpServers": {
            mcp.key: install_command
        }
    }

    try:
        logger.debug(f"Pre-instantiating MCP toolkit for {mcp.key}")
        success = await pre_instantiate_mcp_toolkit(config_dict)
        if not success:
            logger.warning(f"Pre-instantiation failed for MCP {mcp.key}, but continuing with installation")
        else:
            logger.info(f"MCP toolkit pre-instantiated successfully for {mcp.key}")
    except Exception as e:
        logger.error(f"Exception during pre-instantiation for MCP {mcp.key}: {e}", exc_info=True)

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
    logger.info(f"MCP {mcp.key} installed successfully for user {auth.user.id}")
    return mcp_user


@router.post("/mcp/import/{mcp_type}", name="mcp import")
@traceroot.trace()
async def import_mcp(
    mcp_type: McpImportType, mcp_data: dict, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    logger.info(f"Importing MCP, type: {mcp_type.value}, user: {auth.user.id}")

    if mcp_type == McpImportType.Local:
        is_valid, res = validate_mcp_servers(mcp_data)
        if not is_valid:
            raise HTTPException(status_code=400, detail=res)
        mcp_data: Dict[str, McpServerItem] = res.mcpServers

        for name, data in mcp_data.items():
            # Pre-instantiate MCP toolkit for authentication
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
                    logger.warning(f"Pre-instantiation failed for local MCP {name}, but continuing with installation")
            except Exception as e:
                logger.warning(f"Exception during pre-instantiation for local MCP {name}: {e}")

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
            mcp_user.save()
        logger.info(f"Imported {len(mcp_data)} local MCP servers for user {auth.user.id}")
        return {"message": "Local MCP servers imported successfully", "count": len(mcp_data)}
    elif mcp_type == McpImportType.Remote:
        is_valid, res = validate_mcp_remote_servers(mcp_data)
        if not is_valid:
            raise HTTPException(status_code=400, detail=res)
        data: McpRemoteServer = res

        # For remote servers, we don't need to pre-instantiate as they typically don't require authentication
        # but we can still try to validate the connection if needed

        mcp_user = McpUser(
            mcp_id=0,
            user_id=auth.user.id,
            type=McpType.Remote,
            status=Status.enable,
            mcp_name=data.server_name,
            server_url=data.server_url,
        )
        mcp_user.save()
        logger.info(f"Imported remote MCP server {data.server_name} for user {auth.user.id}")
        return mcp_user
