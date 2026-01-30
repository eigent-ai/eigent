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

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text
import logging

logger = logging.getLogger("health_controller")

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
