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

"""Skills config: ~/.eigent/<user_id>/skills-config.json."""

import json
import logging
import time
from pathlib import Path

logger = logging.getLogger("skill_config")

EIGENT_ROOT = Path.home() / ".eigent"


def _config_path(user_id: str) -> Path:
    return EIGENT_ROOT / str(user_id) / "skills-config.json"


def _load_config(user_id: str) -> dict:
    path = _config_path(user_id)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        default = {"version": 1, "skills": {}}
        path.write_text(json.dumps(default, indent=2, ensure_ascii=False))
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to load skill config: %s", e)
        return {"version": 1, "skills": {}}


def _save_config(user_id: str, config: dict) -> None:
    path = _config_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False))


def _ensure_skills_key(config: dict) -> dict:
    if "skills" not in config:
        config["skills"] = {}
    return config


def skill_config_load(user_id: str) -> dict:
    """Load skills config for user."""
    config = _load_config(user_id)
    return _ensure_skills_key(config)


def skill_config_init(user_id: str) -> dict:
    """Load or create config, merge default from example-skills if present."""
    config = _load_config(user_id)
    config = _ensure_skills_key(config)

    # Try to merge default-config.json from example-skills (same as Electron)
    try:
        backend_root = Path(__file__).resolve().parent.parent.parent
        default_path = (
            backend_root.parent
            / "resources"
            / "example-skills"
            / "default-config.json"
        )
        if default_path.exists():
            default = json.loads(default_path.read_text(encoding="utf-8"))
            if default.get("skills"):
                for skill_name, skill_cfg in default["skills"].items():
                    if skill_name not in config["skills"]:
                        config["skills"][skill_name] = {
                            **skill_cfg,
                            "addedAt": int(time.time() * 1000),
                        }
                        logger.info(
                            "Initialized config for example skill: %s",
                            skill_name,
                        )
            _save_config(user_id, config)
    except Exception as e:
        logger.warning("Failed to merge default config: %s", e)

    return config


def skill_config_update(
    user_id: str, skill_name: str, skill_config: dict
) -> None:
    """Update config for a skill (merge with existing, don't replace entirely)."""
    config = _load_config(user_id)
    config = _ensure_skills_key(config)
    existing = config["skills"].get(skill_name, {})
    config["skills"][skill_name] = {**existing, **skill_config}
    _save_config(user_id, config)


def skill_config_delete(user_id: str, skill_name: str) -> None:
    """Remove skill from config."""
    config = _load_config(user_id)
    config = _ensure_skills_key(config)
    if skill_name in config["skills"]:
        del config["skills"][skill_name]
        _save_config(user_id, config)


def skill_config_toggle(user_id: str, skill_name: str, enabled: bool) -> dict:
    """Toggle skill enabled state."""
    config = _load_config(user_id)
    config = _ensure_skills_key(config)
    if skill_name not in config["skills"]:
        config["skills"][skill_name] = {
            "enabled": enabled,
            "scope": {"isGlobal": True, "selectedAgents": []},
            "addedAt": int(time.time() * 1000),
            "isExample": False,
        }
    else:
        config["skills"][skill_name]["enabled"] = enabled
    _save_config(user_id, config)
    return config["skills"][skill_name]
