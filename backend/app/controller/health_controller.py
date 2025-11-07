from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    status: str
    service: str


@router.get("/health", name="health check", response_model=HealthResponse)
async def health_check():
    """Health check endpoint for verifying backend is ready to accept requests."""
    return HealthResponse(status="ok", service="eigent")

