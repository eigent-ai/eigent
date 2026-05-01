# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import logging

from fastapi import APIRouter, HTTPException

from app.service.mcp_config import (
    add_mcp,
    read_mcp_config,
    remove_mcp,
    update_mcp,
)

router = APIRouter()
mcp_logger = logging.getLogger("mcp_controller")


@router.get("/mcp/list")
def mcp_list() -> dict:
    """List all MCP servers (global config)."""
    return read_mcp_config()


@router.post("/mcp/install")
def mcp_install(body: dict) -> dict:
    """Install/add MCP server to global config. Body: { name, mcp }."""
    name = body.get("name")
    mcp = body.get("mcp")
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not mcp or not isinstance(mcp, dict):
        raise HTTPException(status_code=400, detail="mcp object is required")
    add_mcp(str(name).strip(), mcp)
    mcp_logger.info("MCP installed: %s", name)
    return {"success": True}


@router.delete("/mcp/{name}")
def mcp_remove(name: str) -> dict:
    """Remove MCP server from global config."""
    remove_mcp(name)
    mcp_logger.info("MCP removed: %s", name)
    return {"success": True}


@router.put("/mcp/{name}")
def mcp_update(name: str, mcp: dict) -> dict:
    """Update MCP server in global config. Body is the mcp config object."""
    update_mcp(name, mcp)
    mcp_logger.info("MCP updated: %s", name)
    return {"success": True}
