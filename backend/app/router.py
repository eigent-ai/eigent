"""
Centralized router registration for the Eigent API.
All routers are explicitly registered here for better visibility and maintainability.
"""
from fastapi import FastAPI
from app.controller import chat_controller, model_controller, task_controller, tool_controller, health_controller
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("router")


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