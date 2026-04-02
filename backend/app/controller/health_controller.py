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
import os

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.router_layer.hands_resolver import get_environment_hands
from app.utils.browser_launcher import _is_cdp_available

logger = logging.getLogger("health_controller")

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    status: str
    service: str
    capabilities: dict | None = None


@router.get("/health", name="health check", response_model=HealthResponse)
async def health_check(detail: bool = Query(False)):
    """Health check endpoint for verifying backend
    is ready to accept requests."""
    logger.debug("Health check requested")
    response = HealthResponse(status="ok", service="eigent")
    if detail:
        hands = get_environment_hands()
        capabilities = hands.get_capability_manifest()
        try:
            browser_port = int(os.environ.get("browser_port", "9222"))
        except ValueError:
            browser_port = 9222
        capabilities["browser_cdp_reachable"] = _is_cdp_available(browser_port)
        response.capabilities = capabilities
    logger.debug(
        "Health check completed",
        extra={
            "status": response.status,
            "service": response.service,
            "detail": detail,
        },
    )
    return response
