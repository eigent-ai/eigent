import os
from typing import List, Optional
from fastapi import Depends, HTTPException, Query, Response, APIRouter
from sqlmodel import Session, select
from app.component.database import session
from app.component.auth import Auth, auth_must
from fastapi_babel import _
from app.model.mcp.mcp_user import McpUser, McpUserIn, McpUserOut, McpUserUpdate, Status
from app.model.mcp.mcp import Mcp
from camel.toolkits.mcp_toolkit import MCPToolkit
from app.component.environment import env
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_mcp_user_controller")

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
        logger.info("MCP toolkit pre-instantiated", extra={"tools_count": len(tools)})

        # Disconnect, authentication info is already saved
        await mcp_toolkit.disconnect()
        return True

    except Exception as e:
        logger.warning("MCP toolkit pre-instantiation failed", extra={"error": str(e)}, exc_info=True)
        return False


@router.get("/mcp/users", name="list mcp users", response_model=List[McpUserOut])
@traceroot.trace()
async def list_mcp_users(
    mcp_id: Optional[int] = None,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must),
):
    """List MCP users for current user."""
    user_id = auth.user.id
    query = select(McpUser)
    if mcp_id is not None:
        query = query.where(McpUser.mcp_id == mcp_id)
    if user_id is not None:
        query = query.where(McpUser.user_id == user_id)
    mcp_users = session.exec(query).all()
    logger.debug("MCP users listed", extra={"user_id": user_id, "mcp_id": mcp_id, "count": len(mcp_users)})
    return mcp_users


@router.get("/mcp/users/{mcp_user_id}", name="get mcp user", response_model=McpUserOut)
@traceroot.trace()
async def get_mcp_user(mcp_user_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Get MCP user details."""
    query = select(McpUser).where(McpUser.id == mcp_user_id)
    mcp_user = session.exec(query).first()
    if not mcp_user:
        logger.warning("MCP user not found", extra={"user_id": auth.user.id, "mcp_user_id": mcp_user_id})
        raise HTTPException(status_code=404, detail=_("McpUser not found"))
    logger.debug("MCP user retrieved", extra={"user_id": auth.user.id, "mcp_user_id": mcp_user_id, "mcp_id": mcp_user.mcp_id})
    return mcp_user


@router.post("/mcp/users", name="create mcp user", response_model=McpUserOut)
@traceroot.trace()
async def create_mcp_user(mcp_user: McpUserIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Create MCP user installation."""
    user_id = auth.user.id
    mcp_id = mcp_user.mcp_id
    
    exists = session.exec(
        select(McpUser).where(McpUser.mcp_id == mcp_id, McpUser.user_id == user_id)
    ).first()
    if exists:
        logger.warning("MCP already installed", extra={"user_id": user_id, "mcp_id": mcp_id})
        raise HTTPException(status_code=400, detail=_("mcp is installed"))

    # Get MCP configuration from the main Mcp table
    mcp = session.get(Mcp, mcp_id)
    if mcp and mcp.install_command:
        config_dict = {
            "mcpServers": {
                mcp.key: mcp.install_command
            }
        }

        try:
            success = await pre_instantiate_mcp_toolkit(config_dict)
            if not success:
                logger.warning("MCP pre-instantiation failed, continuing", extra={"user_id": user_id, "mcp_id": mcp_id, "mcp_key": mcp.key})
        except Exception as e:
            logger.warning("MCP pre-instantiation exception", extra={"user_id": user_id, "mcp_id": mcp_id, "error": str(e)}, exc_info=True)

    try:
        db_mcp_user = McpUser(mcp_id=mcp_id, user_id=user_id, env=mcp_user.env)
        session.add(db_mcp_user)
        session.commit()
        session.refresh(db_mcp_user)
        logger.info("MCP user created", extra={"user_id": user_id, "mcp_id": mcp_id, "mcp_user_id": db_mcp_user.id})
        return db_mcp_user
    except Exception as e:
        session.rollback()
        logger.error("MCP user creation failed", extra={"user_id": user_id, "mcp_id": mcp_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/mcp/users/{id}", name="update mcp user")
@traceroot.trace()
async def update_mcp_user(
    id: int,
    update_item: McpUserUpdate,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must),
):
    """Update MCP user settings."""
    user_id = auth.user.id
    model = session.get(McpUser, id)
    if not model:
        logger.warning("MCP user not found for update", extra={"user_id": user_id, "mcp_user_id": id})
        raise HTTPException(status_code=404, detail=_("Mcp Info not found"))
    if model.user_id != user_id:
        logger.warning("Unauthorized MCP user update", extra={"user_id": user_id, "mcp_user_id": id, "owner_id": model.user_id})
        raise HTTPException(status_code=400, detail=_("current user have no permission to modify"))
    
    try:
        update_data = update_item.model_dump(exclude_unset=True)
        model.update_fields(update_data)
        model.save(session)
        session.refresh(model)
        logger.info("MCP user updated", extra={"user_id": user_id, "mcp_user_id": id})
        return model
    except Exception as e:
        logger.error("MCP user update failed", extra={"user_id": user_id, "mcp_user_id": id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/mcp/users/{mcp_user_id}", name="delete mcp user")
@traceroot.trace()
async def delete_mcp_user(mcp_user_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Delete MCP user installation."""
    user_id = auth.user.id
    db_mcp_user = session.get(McpUser, mcp_user_id)
    if not db_mcp_user:
        logger.warning("MCP user not found for deletion", extra={"user_id": user_id, "mcp_user_id": mcp_user_id})
        raise HTTPException(status_code=404, detail=_("Mcp Info not found"))
    
    try:
        session.delete(db_mcp_user)
        session.commit()
        logger.info("MCP user deleted", extra={"user_id": user_id, "mcp_user_id": mcp_user_id, "mcp_id": db_mcp_user.mcp_id})
        return Response(status_code=204)
    except Exception as e:
        session.rollback()
        logger.error("MCP user deletion failed", extra={"user_id": user_id, "mcp_user_id": mcp_user_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")