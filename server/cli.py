from app.component.environment import auto_import
from app.command import cli
from app.model.mcp.mcp_user import McpUser

auto_import("app.command")


if __name__ == "__main__":
    cli()
