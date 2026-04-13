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

# STATUS: full-rewrite (uses ConfigService, self-managed session)
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi_babel import _

from app.model.config.config import ConfigCreate, ConfigUpdate, ConfigOut
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth
from app.domains.config.service.config_service import ConfigService

router = APIRouter(tags=["Config Management"])


@router.get("/configs", name="list configs", response_model=list[ConfigOut])
async def list_configs(
    config_group: Optional[str] = None,
    auth: V1UserAuth = Depends(auth_must),
):
    return ConfigService.list_for_user(auth.id, config_group)


@router.get("/configs/{config_id}", name="get config", response_model=ConfigOut)
async def get_config(config_id: int, auth: V1UserAuth = Depends(auth_must)):
    config = ConfigService.get(config_id, auth.id)
    if not config:
        raise HTTPException(status_code=404, detail=_("Configuration not found"))
    return config


@router.post("/configs", name="create config", response_model=ConfigOut)
async def create_config(config: ConfigCreate, auth: V1UserAuth = Depends(auth_must)):
    result = ConfigService.create(
        user_id=auth.id,
        config_name=config.config_name,
        config_value=config.config_value,
        config_group=config.config_group,
    )
    if not result["success"]:
        error_map = {
            "CONFIG_INVALID_NAME": (400, _("Config Name is invalid")),
            "CONFIG_DUPLICATE": (400, _("Configuration already exists for this user")),
        }
        status, detail = error_map.get(result["error_code"], (500, "Config error"))
        raise HTTPException(status_code=status, detail=detail)
    return result["config"]


@router.put("/configs/{config_id}", name="update config", response_model=ConfigOut)
async def update_config(config_id: int, config_update: ConfigUpdate, auth: V1UserAuth = Depends(auth_must)):
    result = ConfigService.update(
        config_id=config_id,
        user_id=auth.id,
        config_name=config_update.config_name,
        config_value=config_update.config_value,
        config_group=config_update.config_group,
    )
    if not result["success"]:
        error_map = {
            "CONFIG_NOT_FOUND": (404, _("Configuration not found")),
            "CONFIG_INVALID_NAME": (400, _("Invalid configuration group")),
            "CONFIG_DUPLICATE": (400, _("Configuration already exists for this user")),
        }
        status, detail = error_map.get(result["error_code"], (500, "Config error"))
        raise HTTPException(status_code=status, detail=detail)
    return result["config"]


@router.delete("/configs/{config_id}", name="delete config")
async def delete_config(config_id: int, auth: V1UserAuth = Depends(auth_must)):
    if not ConfigService.delete(config_id, auth.id):
        raise HTTPException(status_code=404, detail=_("Configuration not found"))
    return Response(status_code=204)


@router.get("/config/info", name="get config info")
async def get_config_info(
    show_all: bool = Query(False, description="Show all config info, including those with empty env_vars"),
):
    return ConfigService.get_config_info(show_all)
