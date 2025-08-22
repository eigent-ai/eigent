from pydantic import BaseModel, ValidationError, field_validator, validator
from typing import Dict, List, Optional
import re
import os


class McpServerItem(BaseModel):
    command: str
    args: List[str]
    env: Optional[Dict[str, str]] = None
    
    @validator('command')
    def validate_command(cls, v):
        # Only allow alphanumeric, dash, underscore, forward slash, and dot
        if not re.match(r'^[a-zA-Z0-9_\-./]+$', v):
            raise ValueError('Command contains invalid characters')
        # Prevent directory traversal
        if '..' in v:
            raise ValueError('Directory traversal not allowed')
        # Check if it's an absolute path or a command name
        if '/' in v and not os.path.isabs(v):
            raise ValueError('Relative paths not allowed')
        return v
    
    @validator('args', each_item=True)
    def validate_args(cls, v):
        # Prevent shell metacharacters that could lead to command injection
        dangerous_chars = ['&', '|', ';', '$', '`', '(', ')', '<', '>', '\n', '\r']
        for char in dangerous_chars:
            if char in v:
                raise ValueError(f'Argument contains dangerous character: {char}')
        return v


class McpServersModel(BaseModel):
    mcpServers: Dict[str, McpServerItem]


class McpRemoteServer(BaseModel):
    server_name: str
    server_url: str
    
    @validator('server_url')
    def validate_server_url(cls, v):
        # Only allow http/https URLs
        if not v.startswith(('http://', 'https://')):
            raise ValueError('Only HTTP/HTTPS URLs are allowed')
        # Basic URL validation to prevent SSRF
        # In production, you should use a proper URL validation library
        # and implement domain allowlisting
        forbidden_hosts = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254']
        from urllib.parse import urlparse
        parsed = urlparse(v)
        if parsed.hostname in forbidden_hosts:
            raise ValueError('Access to this host is forbidden')
        return v


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
