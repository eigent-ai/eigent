from fastapi import APIRouter

from app.utils.toolkit.notion_mcp_toolkit import NotionMCPToolkit


router = APIRouter(tags=["task"])


@router.post("/install/tool/{tool}", name="install tool")
async def install_tool(tool: str):
    if tool == "notion":
        toolkit = NotionMCPToolkit(tool)
        await toolkit.connect()
    else:
        return {"error": "Tool not found"}
    tools = [tool.func.__name__ for tool in toolkit.get_tools()]
    await toolkit.disconnect()
    return tools
