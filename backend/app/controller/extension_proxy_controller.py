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
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.service.extension_proxy_service import (
    get_status,
    start_extension_proxy,
    stop_extension_proxy,
)

logger = logging.getLogger("extension_proxy_controller")
router = APIRouter()


class StartProxyRequest(BaseModel):
    host: str = "localhost"
    port: int = 8765
    model_platform: Optional[str] = None
    model_type: Optional[str] = None
    api_key: Optional[str] = None
    api_url: Optional[str] = None
    extra_params: Optional[dict] = None


@router.post("/extension-proxy/start", name="start extension proxy")
async def start_proxy(req: StartProxyRequest = StartProxyRequest()):
    # Build model config if provided
    model_config = None
    if req.model_platform and req.model_type and req.api_key:
        model_config = {
            "model_platform": req.model_platform,
            "model_type": req.model_type,
            "api_key": req.api_key,
            "api_url": req.api_url,
            "extra_params": req.extra_params or {},
        }

    result = await start_extension_proxy(
        host=req.host,
        port=req.port,
        model_config=model_config,
    )
    return {"success": True, **result}


@router.post("/extension-proxy/stop", name="stop extension proxy")
async def stop_proxy():
    result = await stop_extension_proxy()
    return {"success": True, **result}


@router.get("/extension-proxy/status", name="extension proxy status")
async def proxy_status():
    return {"status": get_status()}


@router.post(
    "/extension-proxy/chat/clear", name="clear extension chat context"
)
async def clear_chat():
    from app.service.extension_chat_service import clear_chat_context

    await clear_chat_context()
    return {"success": True}
