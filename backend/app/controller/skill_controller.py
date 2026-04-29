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
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.service.skill_config_service import (
    skill_config_delete,
    skill_config_init,
    skill_config_load,
    skill_config_toggle,
    skill_config_update,
)
from app.service.skill_service import (
    skill_delete,
    skill_get_path_by_name,
    skill_import_zip,
    skill_list_files,
    skill_read,
    skill_write,
    skills_scan,
)

router = APIRouter()
skill_logger = logging.getLogger("skill_controller")


# --- Skill config (must be before /skills/{skill_dir_name} to avoid path conflict) ---


@router.get("/skills/config")
def skill_config_get(user_id: str = Query(..., description="User ID")) -> dict:
    """Load skills config for user."""
    config = skill_config_load(user_id)
    return {"success": True, "config": config}


@router.post("/skills/config/init")
def skill_config_init_endpoint(body: dict) -> dict:
    """Initialize skills config for user (merge default if present)."""
    user_id = body.get("user_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    config = skill_config_init(user_id)
    return {"success": True, "config": config}


@router.put("/skills/config/{skill_name}")
def skill_config_update_endpoint(skill_name: str, body: dict) -> dict:
    """Update config for a skill."""
    user_id = body.get("user_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    skill_config = {k: v for k, v in body.items() if k != "user_id"}
    skill_config_update(user_id, skill_name, skill_config)
    return {"success": True}


@router.delete("/skills/config/{skill_name}")
def skill_config_delete_endpoint(
    skill_name: str, user_id: str = Query(..., description="User ID")
) -> dict:
    """Remove skill from config."""
    skill_config_delete(user_id, skill_name)
    return {"success": True}


@router.post("/skills/config/{skill_name}/toggle")
def skill_config_toggle_endpoint(skill_name: str, body: dict) -> dict:
    """Toggle skill enabled state."""
    user_id = body.get("user_id")
    enabled = body.get("enabled")
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    if enabled is None:
        raise HTTPException(status_code=400, detail="enabled is required")
    result = skill_config_toggle(user_id, skill_name, bool(enabled))
    return {"success": True, "config": result}


# --- Skills CRUD ---


@router.post("/skills/import")
async def skill_import_endpoint(
    file: Annotated[
        UploadFile, File(description="Zip file containing SKILL.md")
    ],
    replacements: Annotated[
        str | None, Form(description="Comma-separated folder names to replace")
    ] = None,
) -> dict:
    """Import skills from a zip archive. Returns {success, error?, conflicts?}."""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(
            status_code=400, detail="File must be a .zip archive"
        )
    try:
        zip_bytes = await file.read()
    except Exception:
        raise HTTPException(
            status_code=400, detail="Failed to read uploaded file"
        )
    repl_list = (
        [s for s in (s.strip() for s in replacements.split(",")) if s]
        if replacements
        else None
    )
    result = skill_import_zip(zip_bytes, repl_list)
    if not result.get("success") and "conflicts" not in result:
        raise HTTPException(
            status_code=400,
            detail=result.get("error", "Import failed"),
        )
    return result


@router.get("/skills/path")
def skill_get_path(
    name: str = Query(..., description="Skill display name"),
) -> dict:
    """Get absolute directory path for a skill by name. For reveal-in-folder."""
    path_val = skill_get_path_by_name(name)
    if path_val is None:
        raise HTTPException(status_code=404, detail=f"Skill not found: {name}")
    return {"path": path_val}


@router.get("/skills")
def skills_list() -> dict:
    """Scan and list all skills."""
    skills = skills_scan()
    return {"success": True, "skills": skills}


@router.post("/skills/{skill_dir_name}")
def skill_create(skill_dir_name: str, body: dict) -> dict:
    """Create or overwrite skill. Body: { content }."""
    content = body.get("content", "")
    try:
        skill_write(skill_dir_name, content)
        skill_logger.info("Skill written: %s", skill_dir_name)
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/skills/{skill_dir_name}")
def skill_get(skill_dir_name: str) -> dict:
    """Read skill content."""
    try:
        content = skill_read(skill_dir_name)
        return {"success": True, "content": content}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Skill not found")


@router.delete("/skills/{skill_dir_name}")
def skill_remove(skill_dir_name: str) -> dict:
    """Delete skill."""
    try:
        skill_delete(skill_dir_name)
        skill_logger.info("Skill deleted: %s", skill_dir_name)
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/skills/{skill_dir_name}/files")
def skill_files(skill_dir_name: str) -> dict:
    """List files in skill directory."""
    try:
        files = skill_list_files(skill_dir_name)
        return {"success": True, "files": files}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
