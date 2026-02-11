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

"""API endpoints for managing skill configurations (enable/disable)."""

import json
import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skills/config", tags=["skills"])

SKILL_CONFIG_FILENAME = "skills-config.json"


class SkillConfigItem(BaseModel):
    """Configuration for a single skill."""

    enabled: bool
    scope: Literal["global", "project"] | None = None
    addedAt: int | None = None
    isExample: bool | None = None


class SkillConfigUpdate(BaseModel):
    """Request body for updating skill configuration."""

    scope: Literal["global", "project"] = "global"
    skillName: str
    config: SkillConfigItem


class SkillToggleRequest(BaseModel):
    """Request body for toggling a skill."""

    enabled: bool
    scope: Literal["global", "project"] = "global"


def get_config_path(
    scope: str,
    user_id: str | None = None,
    project_path: str | None = None,
) -> Path:
    """Get the path to the skill config file based on scope.

    Args:
        scope: Configuration scope ('global' or 'project')
        user_id: User identifier for user-specific config
        project_path: Project path (required for 'project' scope)

    Returns:
        Path to config file
    """
    if scope == "global":
        if user_id:
            # User-specific config: ~/.eigent/<user_id>/skills-config.json
            return (
                Path.home() / ".eigent" / str(user_id) / SKILL_CONFIG_FILENAME
            )
        else:
            # Legacy global config: ~/.eigent/skills-config.json
            return Path.home() / ".eigent" / SKILL_CONFIG_FILENAME
    elif scope == "project" and project_path:
        return Path(project_path) / ".eigent" / SKILL_CONFIG_FILENAME
    else:
        raise ValueError(f"Invalid scope '{scope}' or missing project_path")


def load_config(config_path: Path) -> dict:
    """Load skill configuration from JSON file."""
    if not config_path.exists():
        return {"version": 1, "skills": {}}

    try:
        with open(config_path, encoding="utf-8") as f:
            data = json.load(f)
            # Ensure structure
            if "version" not in data:
                data["version"] = 1
            if "skills" not in data:
                data["skills"] = {}
            return data
    except (json.JSONDecodeError, OSError) as e:
        logger.error(f"Failed to load config from {config_path}: {e}")
        return {"version": 1, "skills": {}}


def save_config(config_path: Path, config: dict) -> None:
    """Save skill configuration to JSON file."""
    # Ensure directory exists
    config_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved skill config to {config_path}")
    except OSError as e:
        logger.error(f"Failed to save config to {config_path}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to save configuration: {e}"
        )


@router.get("/")
async def get_skill_configs(
    user_id: str | None = None, project_path: str | None = None
):
    """Get both user-global and project skill configurations.

    Args:
        user_id: User identifier for loading user-specific config
        project_path: Optional path to project for project-level config
    """
    user_global_path = get_config_path("global", user_id=user_id)
    user_global_config = load_config(user_global_path)

    result = {
        "global": user_global_config,
        "project": None,
        "user_id": user_id,
    }

    if project_path:
        try:
            project_path_obj = (
                Path(project_path) / ".eigent" / SKILL_CONFIG_FILENAME
            )
            if project_path_obj.exists():
                result["project"] = load_config(project_path_obj)
        except Exception as e:
            logger.warning(f"Failed to load project config: {e}")

    return result


@router.post("/update")
async def update_skill_config(
    update: SkillConfigUpdate,
    user_id: str | None = None,
    project_path: str | None = None,
):
    """Update configuration for a specific skill.

    Args:
        update: Configuration update containing scope, skillName, and config
        user_id: User identifier for user-specific config
        project_path: Required if scope is 'project'
    """
    try:
        config_path = get_config_path(
            update.scope, user_id=user_id, project_path=project_path
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Load existing config
    config = load_config(config_path)

    # Update the specific skill
    config["skills"][update.skillName] = update.config.model_dump(
        exclude_none=True
    )

    # Save back
    save_config(config_path, config)

    return {
        "success": True,
        "message": f"Updated skill '{update.skillName}' in {update.scope} config",
        "user_id": user_id,
    }


@router.post("/{skill_name}/toggle")
async def toggle_skill(
    skill_name: str,
    toggle: SkillToggleRequest,
    user_id: str | None = None,
    project_path: str | None = None,
):
    """Toggle a skill on or off.

    Args:
        skill_name: Name of the skill to toggle
        toggle: Toggle request with enabled status and scope
        user_id: User identifier for user-specific config
        project_path: Required if scope is 'project'
    """
    try:
        config_path = get_config_path(
            toggle.scope, user_id=user_id, project_path=project_path
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Load existing config
    config = load_config(config_path)

    # Get existing skill config or create new one
    if skill_name in config["skills"]:
        skill_config = config["skills"][skill_name]
        skill_config["enabled"] = toggle.enabled
    else:
        # Create new entry
        skill_config = {
            "enabled": toggle.enabled,
            "scope": toggle.scope,
            "addedAt": int(__import__("time").time() * 1000),
        }
        config["skills"][skill_name] = skill_config

    # Save back
    save_config(config_path, config)

    return {
        "success": True,
        "message": f"Skill '{skill_name}' {'enabled' if toggle.enabled else 'disabled'} in {toggle.scope} config",
        "skill": skill_config,
        "user_id": user_id,
    }


@router.delete("/{skill_name}")
async def delete_skill_config(
    skill_name: str,
    scope: Literal["global", "project"] = "global",
    user_id: str | None = None,
    project_path: str | None = None,
):
    """Remove a skill from configuration (revert to default).

    Args:
        skill_name: Name of the skill to remove from config
        scope: Configuration scope
        user_id: User identifier for user-specific config
        project_path: Required if scope is 'project'
    """
    try:
        config_path = get_config_path(
            scope, user_id=user_id, project_path=project_path
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Load existing config
    config = load_config(config_path)

    # Remove the skill if it exists
    if skill_name in config["skills"]:
        del config["skills"][skill_name]
        save_config(config_path, config)
        return {
            "success": True,
            "message": f"Removed '{skill_name}' from {scope} config",
            "user_id": user_id,
        }
    else:
        raise HTTPException(
            status_code=404,
            detail=f"Skill '{skill_name}' not found in {scope} config",
        )
