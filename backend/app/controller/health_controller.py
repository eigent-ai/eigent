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

from fastapi import APIRouter
from pydantic import BaseModel
<<<<<<< HEAD
<<<<<<< HEAD
from utils import traceroot_wrapper as traceroot
=======
from sqlalchemy import text
import logging
>>>>>>> 22fd45e11845bd7da55863bcd59260d410e6af81
=======
>>>>>>> upstream/main

logger = logging.getLogger("health_controller")

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    status: str
    service: str


@router.get("/health", name="health check", response_model=HealthResponse)
async def health_check():
<<<<<<< HEAD
    """
    Health check endpoint for verifying backend readiness.
    """

    logger.debug("Health check requested")

    response = HealthResponse(
        status="ok",
        service="eigent",
    )

=======
    """Health check endpoint for verifying backend
    is ready to accept requests."""
    logger.debug("Health check requested")
    response = HealthResponse(status="ok", service="eigent")
>>>>>>> upstream/main
    logger.debug(
        "Health check completed",
        extra={"status": response.status, "service": response.service},
    )
<<<<<<< HEAD

    return response
=======
    return response
>>>>>>> upstream/main
