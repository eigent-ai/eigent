from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("health_controller")

router = APIRouter(tags=["Health"])


class DatabaseStatus(BaseModel):
    status: str


class HealthResponse(BaseModel):
    status: str
    service: str
    database: DatabaseStatus


@router.get("/health", name="health check", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint for verifying backend and database readiness.
    """

    logger.debug("Health check requested")

    # Database connectivity check
    db_status = "unknown"
    try:
        from app.database import engine  # existing project database engine
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception as e:
        logger.warning("Database health check failed", extra={"error": str(e)})
        db_status = "error"

    response = HealthResponse(
        status="ok",
        service="eigent",
        database=DatabaseStatus(status=db_status),
    )

    logger.debug(
        "Health check completed",
        extra={"status": response.status, "database": db_status},
    )

    return response
