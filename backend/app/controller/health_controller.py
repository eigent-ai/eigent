from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text
from utils import traceroot_wrapper as traceroot
import os

logger = traceroot.get_logger("health_controller")

router = APIRouter(tags=["Health"])


# -------------------------------
# Response Models
# -------------------------------

class DatabaseStatus(BaseModel):
    status: str


class ModelStatus(BaseModel):
    configured: bool


class ToolStatus(BaseModel):
    available: bool


class HealthResponse(BaseModel):
    status: str
    service: str
    database: DatabaseStatus
    model: ModelStatus
    tools: ToolStatus


# -------------------------------
# Health Endpoint
# -------------------------------

@router.get("/health", name="health check", response_model=HealthResponse)
async def health_check():
    """
    Health & diagnostics endpoint.

    Verifies:
    - Backend availability
    - Database connectivity
    - Model configuration
    - Tool registry availability
    """

    logger.debug("Health check requested")

    # -------------------------------
    # Database check
    # -------------------------------
    db_status = "unknown"
    try:
        from app.database import engine  # adjust path ONLY if needed
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception as e:
        logger.warning("Database health check failed", extra={"error": str(e)})
        db_status = "error"

    # -------------------------------
    # Model configuration check
    # -------------------------------
    model_api_key = os.getenv("MODEL_API_KEY")
    model_name = os.getenv("MODEL_NAME")

    model_configured = bool(model_api_key and model_name)

    # -------------------------------
    # Tool availability check
    # -------------------------------
    tools_available = False
    try:
        from app.tools.registry import TOOL_REGISTRY  # adjust path if needed
        tools_available = len(TOOL_REGISTRY) > 0
    except Exception as e:
        logger.warning("Tool registry check failed", extra={"error": str(e)})

    response = HealthResponse(
        status="ok",
        service="eigent",
        database=DatabaseStatus(status=db_status),
        model=ModelStatus(configured=model_configured),
        tools=ToolStatus(available=tools_available),
    )

    logger.debug(
        "Health check completed",
        extra={
            "status": response.status,
            "service": response.service,
            "database": db_status,
            "model_configured": model_configured,
            "tools_available": tools_available,
        },
    )

    return response
