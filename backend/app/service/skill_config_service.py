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

"""Skills config: ~/.eigent/user_<id>/skills-config.json."""

import json
import logging
import re
import shutil
import time
from pathlib import Path

from app.service.skill_service import (
    example_skills_metadata,
    get_example_skills_root,
)

logger = logging.getLogger("skill_config")

EIGENT_ROOT = Path.home() / ".eigent"
SKILL_CONFIG_FILENAME = "skills-config.json"


def _sanitize_identity(value: str | int | None) -> str:
    if value is None:
        return ""
    return re.sub(r'[\\/*?:"<>|\s]', "_", str(value)).strip(".")


def canonical_skill_config_user_id(user_id: str | int) -> str:
    """Return the canonical on-disk skills config owner key."""
    sanitized = _sanitize_identity(user_id)
    if not sanitized:
        raise ValueError("user_id is required")
    if sanitized.startswith("user_"):
        return sanitized
    return f"user_{sanitized}"


def legacy_skill_config_user_id(value: str | int | None) -> str | None:
    """Return the legacy email-derived owner key, when available."""
    if value is None:
        return None
    raw = str(value)
    legacy_source = raw.split("@")[0] if "@" in raw else raw
    sanitized = _sanitize_identity(legacy_source)
    return sanitized or None


def _config_path_for_key(user_key: str) -> Path:
    return EIGENT_ROOT / user_key / SKILL_CONFIG_FILENAME


def _config_path(user_id: str | int) -> Path:
    return _config_path_for_key(canonical_skill_config_user_id(user_id))


def _read_config_file(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return _ensure_skills_key(data if isinstance(data, dict) else {})
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to load skill config from %s: %s", path, e)
        return {"version": 1, "skills": {}}


def _merge_configs(primary: dict, legacy: dict) -> dict:
    """Merge legacy config into primary, preserving primary values."""
    merged = {**legacy, **primary}
    legacy_skills = legacy.get("skills", {})
    primary_skills = primary.get("skills", {})
    merged["skills"] = {**legacy_skills, **primary_skills}
    merged.setdefault(
        "version", primary.get("version", legacy.get("version", 1))
    )
    return _ensure_skills_key(merged)


def migrate_legacy_skill_config(
    user_id: str | int, legacy_user_id: str | int | None = None
) -> Path:
    """Move legacy email-keyed skills config into the canonical user dir."""
    canonical_key = canonical_skill_config_user_id(user_id)
    legacy_key = legacy_skill_config_user_id(legacy_user_id)
    dest = _config_path_for_key(canonical_key)
    if not legacy_key or legacy_key == canonical_key:
        return dest

    source = _config_path_for_key(legacy_key)
    if not source.exists():
        return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        shutil.move(str(source), str(dest))
        logger.info("Migrated skills config from %s to %s", source, dest)
    else:
        primary = _read_config_file(dest)
        legacy = _read_config_file(source)
        dest.write_text(
            json.dumps(
                _merge_configs(primary=primary, legacy=legacy),
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        source.unlink()
        logger.info(
            "Merged legacy skills config from %s into %s", source, dest
        )

    try:
        source.parent.rmdir()
    except OSError:
        pass
    return dest


def _load_config(
    user_id: str | int, legacy_user_id: str | int | None = None
) -> dict:
    path = migrate_legacy_skill_config(user_id, legacy_user_id)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        default = {"version": 1, "skills": {}}
        path.write_text(json.dumps(default, indent=2, ensure_ascii=False))
        return default
    return _read_config_file(path)


def _save_config(user_id: str | int, config: dict) -> None:
    path = _config_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False))


def _ensure_skills_key(config: dict) -> dict:
    if "skills" not in config:
        config["skills"] = {}
    return config


def skill_config_load(
    user_id: str | int, legacy_user_id: str | int | None = None
) -> dict:
    """Load skills config for user."""
    config = _load_config(user_id, legacy_user_id)
    return _ensure_skills_key(config)


def skill_config_init(
    user_id: str | int, legacy_user_id: str | int | None = None
) -> dict:
    """Load or create config, merge default from example-skills if present."""
    config = _load_config(user_id, legacy_user_id)
    config = _ensure_skills_key(config)
    changed = False

    # Try to merge default-config.json from example-skills (same as Electron)
    try:
        example_root = get_example_skills_root()
        default_path = (
            example_root / "default-config.json" if example_root else None
        )
        if default_path and default_path.exists():
            default = json.loads(default_path.read_text(encoding="utf-8"))
            if default.get("skills"):
                for skill_name, skill_cfg in default["skills"].items():
                    if skill_name not in config["skills"]:
                        config["skills"][skill_name] = {
                            **skill_cfg,
                            "addedAt": int(time.time() * 1000),
                        }
                        changed = True
                        logger.info(
                            "Initialized config for example skill: %s",
                            skill_name,
                        )
    except Exception as e:
        logger.warning("Failed to merge default config: %s", e)

    try:
        for skill in example_skills_metadata():
            skill_name = skill["name"]
            if skill_name in config["skills"]:
                continue
            config["skills"][skill_name] = {
                "enabled": True,
                "scope": {"isGlobal": True, "selectedAgents": []},
                "addedAt": int(time.time() * 1000),
                "isExample": True,
            }
            changed = True
            logger.info(
                "Initialized config for bundled example skill: %s",
                skill_name,
            )
    except Exception as e:
        logger.warning("Failed to initialize bundled example config: %s", e)

    if changed:
        _save_config(user_id, config)

    return config


def skill_config_update(
    user_id: str | int,
    skill_name: str,
    skill_config: dict,
    legacy_user_id: str | int | None = None,
) -> None:
    """Update config for a skill (merge with existing, don't replace entirely)."""
    config = _load_config(user_id, legacy_user_id)
    config = _ensure_skills_key(config)
    existing = config["skills"].get(skill_name, {})
    config["skills"][skill_name] = {**existing, **skill_config}
    _save_config(user_id, config)


def skill_config_delete(
    user_id: str | int,
    skill_name: str,
    legacy_user_id: str | int | None = None,
) -> None:
    """Remove skill from config."""
    config = _load_config(user_id, legacy_user_id)
    config = _ensure_skills_key(config)
    if skill_name in config["skills"]:
        del config["skills"][skill_name]
        _save_config(user_id, config)


def skill_config_toggle(
    user_id: str | int,
    skill_name: str,
    enabled: bool,
    legacy_user_id: str | int | None = None,
) -> dict:
    """Toggle skill enabled state."""
    config = _load_config(user_id, legacy_user_id)
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
