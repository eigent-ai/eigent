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

"""Read-only global configuration registry used by discovery and runtime.

These references select a configured resource, not a portable Bundle asset.
Resolution follows the local global configuration at Attempt assembly, exactly
as the global settings do. Nothing is copied, bound, initialized or migrated.
Only resource names and availability leave this module during discovery;
physical paths, contents and MCP credentials stay at the local runtime boundary.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

from app.service import mcp_config, skill_config_service, skill_service

GLOBAL_SKILL_PREFIX = "registry://global/skills/"
GLOBAL_MCP_PREFIX = "registry://global/mcp/"
_MAX_BYTES = 4 * 1024 * 1024


class GlobalResourceUnavailable(ValueError):
    """Stable reason without config values, paths or credentials."""


def global_resource_ref(kind: str, name: str) -> str:
    prefix = GLOBAL_SKILL_PREFIX if kind == "skill" else GLOBAL_MCP_PREFIX
    return prefix + hashlib.sha256(name.encode("utf-8")).hexdigest()


def _read(path: Path) -> str:
    with path.open("rb") as handle:
        content = handle.read(_MAX_BYTES + 1)
    if len(content) > _MAX_BYTES:
        raise GlobalResourceUnavailable("global_configuration_too_large")
    return content.decode("utf-8")


def _json_file(path: Path) -> dict[str, Any]:
    try:
        if not path.exists():
            return {}
        value = json.loads(_read(path))
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, OSError, UnicodeError) as exc:
        raise GlobalResourceUnavailable(
            "global_configuration_invalid"
        ) from exc


def _skill_configuration(user_id: str | int | None, email: str) -> dict:
    # Match the canonical + legacy merge used by global Settings without
    # running its migration/initialization side effects from a GET.
    legacy = skill_config_service.legacy_skill_config_user_id(email)
    canonical = (
        skill_config_service.canonical_skill_config_user_id(user_id)
        if user_id is not None and str(user_id).strip()
        else legacy
    )
    if not canonical:
        raise GlobalResourceUnavailable("global_skill_identity_required")
    root = skill_config_service.EIGENT_ROOT
    filename = skill_config_service.SKILL_CONFIG_FILENAME
    primary = _json_file(root / canonical / filename)
    previous = (
        _json_file(root / legacy / filename)
        if legacy and legacy != canonical
        else {}
    )
    if not isinstance(primary.get("skills", {}), dict) or not isinstance(
        previous.get("skills", {}), dict
    ):
        raise GlobalResourceUnavailable("global_configuration_invalid")
    return {**previous.get("skills", {}), **primary.get("skills", {})}


def _skill_entries(user_id: str | int | None, email: str):
    config = _skill_configuration(user_id, email)
    root = skill_service.SKILLS_ROOT
    try:
        if not root.exists():
            return
        root = root.resolve(strict=True)
        entries = sorted(root.iterdir())
    except OSError as exc:
        raise GlobalResourceUnavailable(
            "global_configuration_unavailable"
        ) from exc
    for entry in entries:
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        ref = global_resource_ref("skill", entry.name)
        reason = None
        path = entry / skill_service.SKILL_FILE
        content = ""
        metadata = None
        try:
            # A registry identifier never grants access outside the same
            # global Skills root used by the existing settings.
            checked = path.resolve(strict=True)
            checked.relative_to(root)
            if checked != path or not checked.is_file():
                raise ValueError()
            content = _read(checked)
            metadata = skill_service._parse_skill_frontmatter(content)
            if not metadata:
                raise ValueError()
        except (ValueError, OSError, UnicodeError):
            reason = "global_skill_invalid"
        label = metadata["name"] if metadata else entry.name
        settings = config.get(label, {})
        if not isinstance(settings, dict):
            reason = "global_skill_invalid"
            settings = {}
        if settings.get("enabled", True) is False:
            reason = "global_resource_disabled"
        yield (
            {
                "ref": ref,
                "label": label,
                "source": "global_configuration",
                "enabled": reason is None,
                "unavailableReason": reason,
                "assignTo": [],
            },
            path,
            content,
        )


def _mcp_entries():
    config = _json_file(mcp_config.get_mcp_config_path())
    servers = config.get("mcpServers", {})
    if not isinstance(servers, dict):
        raise GlobalResourceUnavailable("global_configuration_invalid")
    for name, raw in sorted(servers.items()):
        reason = None
        server = (
            mcp_config._normalize_mcp(raw) if isinstance(raw, dict) else {}
        )
        if (
            server.get("enabled", True) is False
            or server.get("disabled") is True
        ):
            reason = "global_resource_disabled"
        elif not (
            isinstance(server.get("command"), str)
            and server["command"].strip()
        ) and not (
            isinstance(server.get("url"), str) and server["url"].strip()
        ):
            reason = "global_mcp_invalid"
        for category in ("env", "headers"):
            values = server.get(category, {})
            if not isinstance(values, dict) or any(
                not isinstance(key, str)
                or not isinstance(value, str)
                or value.startswith("slot://")
                for key, value in values.items()
            ):
                reason = "global_mcp_invalid"
        yield (
            {
                "id": name,
                "definition": global_resource_ref("mcp", name),
                "label": name,
                "source": "global_configuration",
                "enabled": reason is None,
                "unavailableReason": reason,
                # Credentials are already configured globally. They are neither
                # exported nor silently replaced with Bundle secret bindings.
                "secretSlots": [],
                "assignTo": [],
            },
            server,
        )


def discover_global_resources(
    *, user_id: str | int | None, email: str
) -> dict:
    return {
        "skills": [item for item, _, _ in _skill_entries(user_id, email)],
        "mcp_servers": [item for item, _ in _mcp_entries()],
    }


def resolve_global_skill(
    ref: str, *, user_id: str | int | None, email: str
) -> tuple[Path, str]:
    for item, path, content in _skill_entries(user_id, email):
        if item["ref"] == ref:
            if not item["enabled"]:
                raise GlobalResourceUnavailable(item["unavailableReason"])
            return path, content
    raise GlobalResourceUnavailable("global_skill_unavailable")


def resolve_global_mcp(ref: str, *, secret_slots=()) -> dict[str, Any]:
    if secret_slots:
        raise GlobalResourceUnavailable("global_mcp_secret_slots_unsupported")
    for item, server in _mcp_entries():
        if item["definition"] == ref:
            if not item["enabled"]:
                raise GlobalResourceUnavailable(item["unavailableReason"])
            return copy.deepcopy(server)
    raise GlobalResourceUnavailable("global_mcp_unavailable")
