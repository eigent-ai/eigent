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
"""
Centralized router registration for the Eigent API.
All routers are explicitly registered here
for better visibility and maintainability.
"""

import logging

from fastapi import Depends, FastAPI

from app.auth import get_brain_auth_context
from app.controller import (
    chat_controller,
    file_controller,
    health_controller,
    mcp_controller,
    memory_controller,
    message_controller,
    model_controller,
    permission_controller,
    remote_command_controller,
    remote_sub_agent_controller,
    run_controller,
    skill_controller,
    task_controller,
    tool_controller,
    workspace_bundle_controller,
    workspace_config_controller,
    workspace_controller,
    workspace_git_controller,
)

logger = logging.getLogger("router")


def register_routers(app: FastAPI, prefix: str = "") -> None:
    """
    Register all API routers with their respective prefixes and tags.

    This replaces the auto-discovery mechanism for better:
    - Visibility: See all routes in one place
    - Maintainability: Easy to add/remove routes
    - Debugging: Clear registration order and configuration

    Args:
        app: FastAPI application instance
        prefix: Optional global prefix for all routes (e.g., "/api")
    """
    routers_config = [
        {
            "router": health_controller.router,
            "tags": ["Health"],
            "description": "Health check endpoint for service readiness",
        },
        {
            "router": file_controller.router,
            "tags": ["Files"],
            "description": "File upload for Web/Channel clients",
        },
        {
            "router": mcp_controller.router,
            "tags": ["MCP"],
            "description": "MCP config (list, install, remove, update)",
        },
        {
            "router": skill_controller.router,
            "tags": ["Skills"],
            "description": "Skills scan, write, read, delete",
        },
        {
            "router": chat_controller.router,
            "tags": ["chat"],
            "description": "Chat session management, improvements, and human interactions",
        },
        {
            "router": message_controller.router,
            "tags": ["Message Router"],
            "description": "Phase 2 Message Router - /messages endpoint (prefix-aware)",
        },
        {
            "router": run_controller.router,
            "tags": ["Runs"],
            "description": "Durable Run snapshots, event replay, and live streams",
            "self_authenticated": True,
        },
        {
            "router": permission_controller.router,
            "tags": ["Permissions"],
            "description": "Authenticated local Space permission profiles",
            "self_authenticated": True,
        },
        {
            "router": memory_controller.router,
            "tags": ["Memory"],
            "description": "Authenticated local Lightweight Memory CRUD",
            "self_authenticated": True,
        },
        {
            "router": remote_command_controller.router,
            "tags": ["Remote Command Inbox"],
            "description": "Durable Remote Control Inbox and command-result lane",
            "self_authenticated": True,
        },
        {
            "router": model_controller.router,
            "tags": ["model"],
            "description": "Model validation and configuration",
        },
        {
            "router": remote_sub_agent_controller.router,
            "tags": ["remote-sub-agent"],
            "description": "Remote sub-agent validation",
        },
        {
            "router": task_controller.router,
            "tags": ["task"],
            "description": "Task lifecycle management (start, stop, update, control)",
        },
        {
            "router": tool_controller.router,
            "tags": ["tool"],
            "description": "Tool installation and management",
        },
        {
            "router": workspace_controller.router,
            "tags": ["workspace"],
            "description": "Space-level local workspace binding",
        },
        {
            "router": workspace_bundle_controller.router,
            "tags": ["Workspace Bundles"],
            "description": "Review-first local Bundle installation",
            "self_authenticated": True,
        },
        {
            "router": workspace_config_controller.router,
            "tags": ["Workspace Configuration"],
            "description": "Mutable local Workspace Configuration working copy",
            "self_authenticated": True,
        },
        {
            "router": workspace_git_controller.router,
            "tags": ["workspace-git"],
            "description": "Authenticated local Space Git operations",
            "self_authenticated": True,
        },
    ]

    app.include_router(health_controller.router, tags=["Health"])
    logger.info(
        "Registered Health router at root level for Docker health checks"
    )

    for config in routers_config:
        dependencies = (
            []
            if config["tags"] == ["Health"]
            or config.get("self_authenticated", False)
            else [Depends(get_brain_auth_context)]
        )
        app.include_router(
            config["router"],
            prefix=prefix,
            tags=config["tags"],
            dependencies=dependencies,
        )
        route_count = len(config["router"].routes)
        logger.info(
            f"Registered {config['tags'][0]} router:"
            f" {route_count} routes -"
            f" {config['description']}"
        )

    logger.info(f"Total routers registered: {len(routers_config)}")
