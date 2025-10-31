from fastapi import APIRouter, HTTPException
from app.utils.toolkit.notion_mcp_toolkit import NotionMCPToolkit
from app.utils.toolkit.google_calendar_toolkit import GoogleCalendarToolkit
from app.utils.oauth_state_manager import oauth_state_manager
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("tool_controller")
router = APIRouter(tags=["task"])


@router.post("/install/tool/{tool}", name="install tool")
async def install_tool(tool: str):
    """
    Install and pre-instantiate a specific MCP tool for authentication

    Args:
        tool: Tool name to install (notion)

    Returns:
        Installation result with tool information
    """
    if tool == "notion":
        try:
            # Use a dummy task_id for installation, as this is just for pre-authentication
            toolkit = NotionMCPToolkit("install_auth")

            try:
                # Pre-instantiate by connecting (this completes authentication)
                await toolkit.connect()

                # Get available tools to verify connection
                tools = [tool_func.func.__name__ for tool_func in toolkit.get_tools()]
                logger.info(f"Successfully pre-instantiated {tool} toolkit with {len(tools)} tools")

                # Disconnect, authentication info is saved
                await toolkit.disconnect()

                return {
                    "success": True,
                    "tools": tools,
                    "message": f"Successfully installed and authenticated {tool} toolkit",
                    "count": len(tools),
                    "toolkit_name": "NotionMCPToolkit"
                }
            except Exception as connect_error:
                logger.warning(f"Could not connect to {tool} MCP server: {connect_error}")
                # Even if connection fails, mark as installed so user can use it later
                return {
                    "success": True,
                    "tools": [],
                    "message": f"{tool} toolkit installed but not connected. Will connect when needed.",
                    "count": 0,
                    "toolkit_name": "NotionMCPToolkit",
                    "warning": "Could not connect to Notion MCP server. You may need to authenticate when using the tool."
                }
        except Exception as e:
            logger.error(f"Failed to install {tool} toolkit: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to install {tool}: {str(e)}"
            )
    elif tool == "google_calendar":
        try:
            # Try to initialize toolkit - will succeed if credentials exist
            try:
                toolkit = GoogleCalendarToolkit("install_auth")
                tools = [tool_func.func.__name__ for tool_func in toolkit.get_tools()]
                logger.info(f"Successfully initialized Google Calendar toolkit with {len(tools)} tools")
                
                return {
                    "success": True,
                    "tools": tools,
                    "message": f"Successfully installed {tool} toolkit",
                    "count": len(tools),
                    "toolkit_name": "GoogleCalendarToolkit"
                }
            except ValueError as auth_error:
                # No credentials - need authorization
                logger.info(f"No credentials found, starting authorization: {auth_error}")
                
                # Start background authorization in a new thread
                logger.info("Starting background Google Calendar authorization")
                GoogleCalendarToolkit.start_background_auth("install_auth")
                
                return {
                    "success": False,
                    "status": "authorizing",
                    "message": "Authorization required. Browser should open automatically. Complete authorization and try installing again.",
                    "toolkit_name": "GoogleCalendarToolkit",
                    "requires_auth": True
                }
        except Exception as e:
            logger.error(f"Failed to install {tool} toolkit: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to install {tool}: {str(e)}"
            )
    else:
        raise HTTPException(
            status_code=404,
            detail=f"Tool '{tool}' not found. Available tools: ['notion', 'google_calendar']"
        )


@router.get("/tools/available", name="list available tools")
async def list_available_tools():
    """
    List all available MCP tools that can be installed

    Returns:
        List of available tools with their information
    """
    return {
        "tools": [
            {
                "name": "notion",
                "display_name": "Notion MCP",
                "description": "Notion workspace integration for reading and managing Notion pages",
                "toolkit_class": "NotionMCPToolkit",
                "requires_auth": True
            },
            {
                "name": "google_calendar",
                "display_name": "Google Calendar",
                "description": "Google Calendar integration for managing events and schedules",
                "toolkit_class": "GoogleCalendarToolkit",
                "requires_auth": True
            }
        ]
    }


@router.get("/oauth/status/{provider}", name="get oauth status")
async def get_oauth_status(provider: str):
    """
    Get the current OAuth authorization status for a provider

    Args:
        provider: OAuth provider name (e.g., 'google_calendar')

    Returns:
        Current authorization status
    """
    state = oauth_state_manager.get_state(provider)
    
    if not state:
        return {
            "provider": provider,
            "status": "not_started",
            "message": "No authorization in progress"
        }
    
    return state.to_dict()


@router.post("/oauth/cancel/{provider}", name="cancel oauth")
async def cancel_oauth(provider: str):
    """
    Cancel an ongoing OAuth authorization flow

    Args:
        provider: OAuth provider name (e.g., 'google_calendar')

    Returns:
        Cancellation result
    """
    state = oauth_state_manager.get_state(provider)
    
    if not state:
        raise HTTPException(
            status_code=404,
            detail=f"No authorization found for provider '{provider}'"
        )
    
    if state.status not in ["pending", "authorizing"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel authorization with status '{state.status}'"
        )
    
    state.cancel()
    logger.info(f"Cancelled OAuth authorization for {provider}")
    
    return {
        "success": True,
        "provider": provider,
        "message": "Authorization cancelled successfully"
    }


@router.delete("/uninstall/tool/{tool}", name="uninstall tool")
async def uninstall_tool(tool: str):
    """
    Uninstall a tool and clean up its authentication data
    
    Args:
        tool: Tool name to uninstall (notion, google_calendar)
        
    Returns:
        Uninstallation result
    """
    import os
    import shutil
    
    if tool == "notion":
        try:
            import hashlib
            import glob
            
            # Calculate the hash for Notion MCP URL
            # mcp-remote uses MD5 hash of the URL to generate file names
            notion_url = "https://mcp.notion.com/mcp"
            url_hash = hashlib.md5(notion_url.encode()).hexdigest()
            
            # Find and remove Notion-specific auth files
            mcp_auth_dir = os.path.join(os.path.expanduser("~"), ".mcp-auth")
            deleted_files = []
            
            if os.path.exists(mcp_auth_dir):
                # Look for all files with the Notion hash prefix
                for version_dir in os.listdir(mcp_auth_dir):
                    version_path = os.path.join(mcp_auth_dir, version_dir)
                    if os.path.isdir(version_path):
                        # Find all files matching the hash pattern
                        pattern = os.path.join(version_path, f"{url_hash}_*")
                        notion_files = glob.glob(pattern)
                        
                        for file_path in notion_files:
                            try:
                                os.remove(file_path)
                                deleted_files.append(file_path)
                                logger.info(f"Removed Notion auth file: {file_path}")
                            except Exception as e:
                                logger.warning(f"Failed to remove {file_path}: {e}")
            
            message = f"Successfully uninstalled {tool}"
            if deleted_files:
                message += f" and cleaned up {len(deleted_files)} authentication file(s)"
            
            return {
                "success": True,
                "message": message,
                "deleted_files": deleted_files
            }
        except Exception as e:
            logger.error(f"Failed to uninstall {tool}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to uninstall {tool}: {str(e)}"
            )
            
    elif tool == "google_calendar":
        try:
            # Clean up Google Calendar token directory
            token_dir = os.path.join(os.path.expanduser("~"), ".eigent", "tokens", "google_calendar")
            if os.path.exists(token_dir):
                shutil.rmtree(token_dir)
                logger.info(f"Removed Google Calendar token directory: {token_dir}")
            
            # Clear OAuth state manager cache (this is the key fix!)
            # This removes the cached credentials from memory
            state = oauth_state_manager.get_state("google_calendar")
            if state:
                if state.status in ["pending", "authorizing"]:
                    state.cancel()
                    logger.info("Cancelled ongoing Google Calendar authorization")
                # Clear the state completely to remove cached credentials
                oauth_state_manager._states.pop("google_calendar", None)
                logger.info("Cleared Google Calendar OAuth state cache")
            
            return {
                "success": True,
                "message": f"Successfully uninstalled {tool} and cleaned up authentication tokens"
            }
        except Exception as e:
            logger.error(f"Failed to uninstall {tool}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to uninstall {tool}: {str(e)}"
            )
    else:
        raise HTTPException(
            status_code=404,
            detail=f"Tool '{tool}' not found. Available tools: ['notion', 'google_calendar']"
        )
