from fastapi import APIRouter, HTTPException
from app.utils.toolkit.notion_mcp_toolkit import NotionMCPToolkit
from app.utils.toolkit.google_calendar_toolkit import GoogleCalendarToolkit
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("tool_controller")
router = APIRouter()


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
            # Use a dummy task_id for installation, as this is just for pre-authentication
            toolkit = GoogleCalendarToolkit("install_auth")

            # Get available tools to verify connection
            tools = [tool_func.func.__name__ for tool_func in toolkit.get_tools()]
            logger.info(f"Successfully pre-instantiated {tool} toolkit with {len(tools)} tools")

            return {
                "success": True,
                "tools": tools,
                "message": f"Successfully installed {tool} toolkit",
                "count": len(tools),
                "toolkit_name": "GoogleCalendarToolkit"
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
