from app import api
from app.component.environment import auto_include_routers, env
from loguru import logger
import os
from fastapi.staticfiles import StaticFiles
from fastapi import status
from fastapi.responses import JSONResponse

# Health check endpoint
@api.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint for monitoring."""
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={"status": "healthy", "service": "eigent-api"}
    )

prefix = env("url_prefix", "")
auto_include_routers(api, prefix, "app/controller")
public_dir = os.environ.get("PUBLIC_DIR") or os.path.join(os.path.dirname(__file__), "app", "public")
api.mount("/public", StaticFiles(directory=public_dir), name="public")

logger.add(
    "runtime/log/app.log",
    rotation="10 MB",
    retention="10 days",
    level="DEBUG",
    enqueue=True,
)
