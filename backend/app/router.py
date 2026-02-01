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
All routers are explicitly registered here for better visibility and maintainability.
"""
from fastapi import FastAPI
from app.controller import (
    chat_controller,
    model_controller,
    task_controller,
    tool_controller,
    health_controller,
    knowledge_controller,
)
import logging

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
            "description": "Health check endpoint for service readiness"
        },
        {
            "router": chat_controller.router,
            "tags": ["chat"],
            "description": "Chat session management, improvements, and human interactions"
        },
        {
            "router": model_controller.router,
            "tags": ["model"],
            "description": "Model validation and configuration"
        },
        {
            "router": task_controller.router,
            "tags": ["task"],
            "description": "Task lifecycle management (start, stop, update, control)"
        },
        {
            "router": tool_controller.router,
            "tags": ["tool"],
            "description": "Tool installation and management"
        },
        {
            "router": knowledge_controller.router,
            "tags": ["Knowledge Base"],
            "description": "Knowledge base for long-term memory (issue #1099)"
        },
    ]
    
    for config in routers_config:
        app.include_router(
            config["router"],
            prefix=prefix,
            tags=config["tags"]
        )
        route_count = len(config["router"].routes)
        logger.info(
            f"Registered {config['tags'][0]} router: {route_count} routes - {config['description']}"
        )
    
    logger.info(f"Total routers registered: {len(routers_config)}")