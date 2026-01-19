from fastapi import APIRouter
from pydantic import BaseModel
import logging

logger = logging.getLogger("health_controller")

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    status: str
    service: str


@router.get("/health", name="health check", response_model=HealthResponse)
async def health_check():
    """Health check endpoint for verifying backend is ready to accept requests."""
    logger.debug("Health check requested")
    response = HealthResponse(status="ok", service="eigent")
    logger.debug("Health check completed", extra={"status": response.status, "service": response.service})
    return response

