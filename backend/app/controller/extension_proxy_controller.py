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

from app.service.extension_proxy_service import (
    get_status,
    start_extension_proxy,
    stop_extension_proxy,
)

logger = logging.getLogger("extension_proxy_controller")
router = APIRouter()


@router.post("/extension-proxy/start", name="start extension proxy")
async def start_proxy():
    result = await start_extension_proxy()
    return {"success": True, **result}


@router.post("/extension-proxy/stop", name="stop extension proxy")
async def stop_proxy():
    result = await stop_extension_proxy()
    return {"success": True, **result}


@router.get("/extension-proxy/status", name="extension proxy status")
async def proxy_status():
    return {"status": get_status()}
