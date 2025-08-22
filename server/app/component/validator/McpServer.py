from pydantic import BaseModel, ValidationError, field_validator
from typing import Dict, List, Optional


class McpServerItem(BaseModel):
    command: str
    args: List[str]
    env: Optional[Dict[str, str]] = None


class McpServersModel(BaseModel):
    mcpServers: Dict[str, McpServerItem]


class McpRemoteServer(BaseModel):
    server_name: str
    server_url: str


def validate_mcp_servers(data: dict):
    try:
        model = McpServersModel.model_validate(data)
        return True, model
    except ValidationError as e:
        return False, e.errors()


def validate_mcp_remote_servers(data: dict):
    try:
        model = McpRemoteServer.model_validate(data)
        return True, model
    except ValidationError as e:
        return False, e.errors()
