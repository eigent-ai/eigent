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

import asyncio

from fastapi import APIRouter, Depends

from app.apple_bridge.supervisor import (
    AppleBridgeUnavailableError,
    apple_intelligence_status,
    get_apple_bridge_supervisor,
)
from app.auth import require_local_control_if_configured

router = APIRouter(dependencies=[Depends(require_local_control_if_configured)])


@router.get("/model/apple-intelligence/status")
async def get_apple_intelligence_status(refresh: bool = False):
    """Whether Apple Intelligence can run here, and why not.

    Starts the bridge on macOS when needed. Off macOS it returns
    `reason: "not_macos"` without starting anything.
    """
    return await asyncio.to_thread(
        apple_intelligence_status,
        get_apple_bridge_supervisor(),
        refresh=refresh,
    )


@router.post("/model/apple-intelligence/test")
async def test_apple_intelligence():
    """Run a short generation and report how long it took."""
    supervisor = get_apple_bridge_supervisor()
    try:
        return await asyncio.to_thread(supervisor.test_generation)
    except AppleBridgeUnavailableError as exc:
        return {
            "ok": False,
            "elapsed_ms": None,
            "code": exc.reason,
            "message": str(exc),
        }
