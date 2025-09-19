import os
from typing import List, Optional
from fastapi import Depends, HTTPException, Query, Response, APIRouter
from sqlmodel import Session, select
from app.component.database import session
from app.component.auth import Auth, auth_must
from fastapi_babel import _
from app.model.mcp.mcp_user import McpUser, McpUserIn, McpUserOut, McpUserUpdate, Status
from app.model.mcp.mcp import Mcp
from loguru import logger
from camel.toolkits.mcp_toolkit import MCPToolkit
from app.component.environment import env

router = APIRouter(tags=["McpUser Management"])


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


@router.get("/mcp/users", name="list mcp users", response_model=List[McpUserOut])
async def list_mcp_users(
    mcp_id: Optional[int] = None,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must),
):
    user_id = auth.user.id
    query = select(McpUser)
    if mcp_id is not None:
        query = query.where(McpUser.mcp_id == mcp_id)
    if user_id is not None:
        query = query.where(McpUser.user_id == user_id)
    mcp_users = session.exec(query).all()
    return mcp_users


@router.get("/mcp/users/{mcp_user_id}", name="get mcp user", response_model=McpUserOut)
async def get_mcp_user(mcp_user_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    query = select(McpUser).where(McpUser.id == mcp_user_id)
    mcp_user = session.exec(query).first()
    if not mcp_user:
        raise HTTPException(status_code=404, detail=_("McpUser not found"))
    return mcp_user


@router.post("/mcp/users", name="create mcp user", response_model=McpUserOut)
async def create_mcp_user(mcp_user: McpUserIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    exists = session.exec(
        select(McpUser).where(McpUser.mcp_id == mcp_user.mcp_id, McpUser.user_id == auth.user.id)
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail=_("mcp is installed"))

    # Get MCP configuration from the main Mcp table
    mcp = session.get(Mcp, mcp_user.mcp_id)
    if mcp and mcp.install_command:
        # Pre-instantiate MCP toolkit for authentication
        config_dict = {
            "mcpServers": {
                mcp.key: mcp.install_command
            }
        }

        try:
            success = await pre_instantiate_mcp_toolkit(config_dict)
            if not success:
                logger.warning(f"Pre-instantiation failed for MCP {mcp.key}, but continuing with user creation")
        except Exception as e:
            logger.warning(f"Exception during pre-instantiation for MCP {mcp.key}: {e}")

    db_mcp_user = McpUser(mcp_id=mcp_user.mcp_id, user_id=auth.user.id, env=mcp_user.env)
    session.add(db_mcp_user)
    session.commit()
    session.refresh(db_mcp_user)
    return db_mcp_user


@router.put("/mcp/users/{id}", name="update mcp user")
async def update_mcp_user(
    id: int,
    update_item: McpUserUpdate,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must),
):
    model = session.get(McpUser, id)
    if not model:
        raise HTTPException(status_code=404, detail=_("Mcp Info not found"))
    if model.user_id != auth.user.id:
        raise HTTPException(status_code=400, detail=_("current user have no permission to modify"))
    update_data = update_item.model_dump(exclude_unset=True)
    model.update_fields(update_data)
    model.save(session)
    session.refresh(model)
    return model


@router.delete("/mcp/users/{mcp_user_id}", name="delete mcp user")
async def delete_mcp_user(mcp_user_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    db_mcp_user = session.get(McpUser, mcp_user_id)
    if not db_mcp_user:
        raise HTTPException(status_code=404, detail=_("Mcp Info not found"))
    session.delete(db_mcp_user)
    session.commit()
    return Response(status_code=204)
