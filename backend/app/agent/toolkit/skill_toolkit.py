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

"""
Skill Toolkit with two-tier hierarchy:
1. Project-level: <working_directory>/skills and <working_directory>/.eigent/skills
2. Global: ~/.eigent/skills/

Priority: Project > Global

Agent access control is managed via skills-config.json, not by physical separation.
"""

import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from camel.toolkits.skill_toolkit import SkillToolkit as BaseSkillToolkit

logger = logging.getLogger(__name__)

SKILL_FILENAME = "SKILL.md"
SKILL_CONFIG_FILENAME = "skills-config.json"

SkillScope = Literal["global", "project"]


@dataclass
class SkillMetadata:
    """Metadata for a discovered skill."""

    name: str
    path: Path
    scope: SkillScope

    def load_content(self) -> str:
        """Lazy load skill content when needed."""
        return self.path.read_text(encoding="utf-8", errors="replace")


def _skill_roots_for_discovery(
    working_directory: Path | None = None,
    agent_name: str | None = None,
) -> list[tuple[SkillScope, Path]]:
    """Return ordered list of skill root paths with scope labels.

    Args:
        working_directory: Current working directory
        agent_name: Unused, kept for backward compatibility

    Returns:
        List of (scope, path) tuples in priority order (highest first)
    """
    wd = working_directory if working_directory is not None else Path.cwd()
    wd = wd if isinstance(wd, Path) else Path(wd)
    roots: list[tuple[SkillScope, Path]] = []

    # 1. Project-level skills (highest priority)
    roots.append(("project", wd / "skills"))
    roots.append(("project", wd / ".eigent" / "skills"))

    # 2. Global skills (lowest priority)
    roots.append(("global", Path.home() / ".eigent" / "skills"))

    return roots


class SkillDiscovery:
    """Efficient skill discovery with caching and lazy loading."""

    _cache: dict[str, dict[str, SkillMetadata]] = {}
    _cache_timestamp: dict[str, float] = {}
    _cache_ttl: float = 60.0  # Cache for 60 seconds

    @classmethod
    def _build_cache_key(
        cls,
        working_directory: Path | None,
        agent_name: str | None,
    ) -> str:
        """Build a unique cache key."""
        wd = str(working_directory) if working_directory else "None"
        agent = agent_name or "None"
        return f"{wd}::{agent}"

    @classmethod
    def _is_cache_valid(cls, cache_key: str) -> bool:
        """Check if cache is still valid."""
        if cache_key not in cls._cache_timestamp:
            return False
        age = time.time() - cls._cache_timestamp[cache_key]
        return age < cls._cache_ttl

    @classmethod
    def _scan_root(
        cls, root: Path, scope: SkillScope
    ) -> dict[str, SkillMetadata]:
        """Scan a single root directory for skills.

        Supports symbolic links to avoid duplication.

        Returns:
            Dict mapping skill names (lowercase) to SkillMetadata
        """
        skills: dict[str, SkillMetadata] = {}

        if not root.is_dir():
            return skills

        try:
            for entry in root.iterdir():
                # Support symlinks - resolve to actual directory
                try:
                    # Check if it's a directory (following symlinks)
                    if not entry.is_dir():
                        continue
                except OSError:
                    # Broken symlink
                    logger.debug(f"Skipping broken symlink: {entry}")
                    continue

                # Skip hidden directories
                if entry.name.startswith("."):
                    continue

                # Follow symlink to find SKILL.md
                skill_file = entry / SKILL_FILENAME
                try:
                    # Check if file exists (following symlinks)
                    if not skill_file.is_file():
                        continue
                except OSError:
                    # Broken symlink
                    logger.debug(f"Skipping broken symlink: {skill_file}")
                    continue

                # Parse frontmatter to get skill name
                try:
                    content = skill_file.read_text(
                        encoding="utf-8", errors="replace"
                    )
                    parsed_name = _parse_skill_name_from_frontmatter(content)
                    if parsed_name:
                        name_lower = parsed_name.lower().strip()
                        # Resolve symlink to get the real path
                        real_path = skill_file.resolve()
                        skills[name_lower] = SkillMetadata(
                            name=parsed_name,
                            path=real_path,  # Use resolved path
                            scope=scope,
                        )

                        # Log if it's a symlink
                        if skill_file != real_path:
                            logger.debug(
                                f"Found skill '{parsed_name}' via symlink: "
                                f"{skill_file} -> {real_path}"
                            )
                except (OSError, UnicodeDecodeError) as e:
                    logger.debug(f"Failed to read skill at {skill_file}: {e}")
                    continue

        except OSError as e:
            logger.warning(f"Error scanning root {root}: {e}")

        return skills

    @classmethod
    def discover(
        cls,
        working_directory: Path | None = None,
        agent_name: str | None = None,
    ) -> dict[str, SkillMetadata]:
        """Discover all available skills with caching.

        Returns a dict mapping skill names (lowercase) to SkillMetadata.
        Higher priority skills override lower priority ones.

        Args:
            working_directory: Current working directory
            agent_name: Name of the agent requesting skills

        Returns:
            Dict of {skill_name_lower: SkillMetadata}
        """
        cache_key = cls._build_cache_key(working_directory, agent_name)

        # Return cached result if valid
        if cls._is_cache_valid(cache_key):
            logger.debug(f"Using cached skill discovery for {cache_key}")
            return cls._cache[cache_key]

        # Build skill index from all roots (reverse order for priority)
        skills: dict[str, SkillMetadata] = {}
        roots = _skill_roots_for_discovery(working_directory, agent_name)

        # Scan in reverse order so higher priority roots override
        for scope, root in reversed(roots):
            discovered = cls._scan_root(root, scope)
            skills.update(discovered)

        # Cache the result
        cls._cache[cache_key] = skills
        cls._cache_timestamp[cache_key] = time.time()

        logger.debug(
            f"Discovered {len(skills)} skills for {cache_key}: "
            f"{list(skills.keys())}"
        )

        return skills

    @classmethod
    def clear_cache(cls, cache_key: str | None = None) -> None:
        """Clear cache for a specific key or all keys."""
        if cache_key:
            cls._cache.pop(cache_key, None)
            cls._cache_timestamp.pop(cache_key, None)
        else:
            cls._cache.clear()
            cls._cache_timestamp.clear()


def _parse_skill_name_from_frontmatter(content: str) -> str | None:
    """Extract frontmatter 'name' from SKILL.md content."""
    if not content.strip().startswith("---"):
        return None
    match = re.search(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return None
    fm = match.group(1)
    name_m = re.search(r"^name:\s*(.+)$", fm, re.MULTILINE)
    if not name_m:
        return None
    return name_m.group(1).strip()


def _get_user_config_path(user_id: str | None = None) -> Path:
    """Get the config path for a specific user.

    Args:
        user_id: User identifier. If None, uses legacy global path.

    Returns:
        Path to user's config file
    """
    if user_id:
        # User-specific config: ~/.eigent/<user_id>/skills-config.json
        return Path.home() / ".eigent" / str(user_id) / SKILL_CONFIG_FILENAME
    else:
        # Legacy global config: ~/.eigent/skills-config.json
        return Path.home() / ".eigent" / SKILL_CONFIG_FILENAME


def _load_skill_config(config_path: Path) -> dict[str, dict]:
    """Load skill configuration from JSON file."""
    if not config_path.exists():
        logger.debug(f"No config file at: {config_path}")
        return {}

    try:
        with open(config_path, encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict) and "skills" in data:
                return data.get("skills", {})
            return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"Failed to load skill config from {config_path}: {e}")
        return {}


def _get_merged_skill_config(
    working_directory: Path | None = None,
    user_id: str | None = None,
) -> dict[str, dict]:
    """Get merged skill configuration (user-global + project-level).

    Priority: Project-level > User-global

    Args:
        working_directory: Current working directory
        user_id: User identifier for loading user-specific config

    Returns:
        Merged skill configuration
    """
    wd = working_directory if working_directory is not None else Path.cwd()
    wd = wd if isinstance(wd, Path) else Path(wd)

    # Load user-specific global config
    user_config_path = _get_user_config_path(user_id)
    config = _load_skill_config(user_config_path)
    logger.debug(
        f"Loaded user config (user_id={user_id or 'legacy'}): "
        f"{len(config)} skills from {user_config_path}"
    )

    # Load project-level config (overrides user config)
    project_config_path = wd / ".eigent" / SKILL_CONFIG_FILENAME
    project_config = _load_skill_config(project_config_path)
    if project_config:
        logger.debug(
            f"Loaded project skill config: {len(project_config)} skills"
        )
        config.update(project_config)

    return config


def _is_skill_enabled(skill_name: str, config: dict[str, dict]) -> bool:
    """Check if a skill is enabled according to config."""
    if not config or skill_name not in config:
        return True  # Not configured = enabled by default

    skill_config = config[skill_name]
    return skill_config.get("enabled", True)


def _is_agent_allowed(
    skill_name: str,
    agent_name: str | None,
    config: dict[str, dict],
) -> bool:
    """Check if an agent is allowed to use this skill.

    Args:
        skill_name: Name of the skill
        agent_name: Name of the agent requesting the skill
        config: Skill configuration

    Returns:
        True if agent is allowed, False otherwise
    """
    if not config or skill_name not in config:
        return True  # Not configured = all agents allowed

    skill_config = config[skill_name]
    allowed_agents = skill_config.get("agents", [])

    # Empty list = all agents allowed
    if not allowed_agents:
        return True

    # Check if current agent is in the allowed list
    if not agent_name:
        logger.warning(
            f"No agent_name provided for skill '{skill_name}' "
            f"with agent restrictions: {allowed_agents}"
        )
        return False

    return agent_name in allowed_agents


def get_skill_content_by_name(
    working_directory: str | None = None,
    skill_name: str = "",
    agent_name: str | None = None,
    user_id: str | None = None,
    check_enabled: bool = True,
) -> str | None:
    """Resolve a skill by name and return its SKILL.md content.

    Searches in priority order:
    1. Project-level: <working_directory>/skills, <working_directory>/.eigent/skills
    2. Global: ~/.eigent/skills/

    Args:
        working_directory: Directory to search from
        skill_name: Name of the skill to load
        agent_name: Name of the agent requesting the skill
        user_id: User identifier for loading user-specific config
        check_enabled: If True, check if skill is enabled (default: True)

    Returns:
        Skill content if found and allowed, None otherwise
    """
    name = (skill_name or "").strip()
    if not name:
        logger.warning(
            "get_skill_content_by_name called with empty skill_name"
        )
        return None

    wd = Path(working_directory) if working_directory else None

    # Load config and check permissions
    if check_enabled:
        config = _get_merged_skill_config(wd, user_id)

        # Check if skill is enabled
        if not _is_skill_enabled(name, config):
            logger.warning(
                f"⚠️  Skill '{name}' is disabled for user '{user_id or 'legacy'}'"
            )
            return None

        # Check if agent is allowed to use this skill
        if not _is_agent_allowed(name, agent_name, config):
            logger.warning(
                f"⚠️  Agent '{agent_name}' is not allowed to use skill '{name}'"
            )
            return None

    # Discover skills using efficient cached mechanism
    skills = SkillDiscovery.discover(wd, agent_name)
    name_lower = name.lower()

    # Look up skill in discovered index
    metadata = skills.get(name_lower)
    if metadata:
        logger.info(
            f"✅ Found skill '{name}' at {metadata.scope} level: {metadata.path} "
            f"(user_id={user_id or 'legacy'})"
        )
        content = metadata.load_content()
        logger.debug(f"📦 Loaded skill content: {len(content)} characters")
        return content

    logger.warning(
        f"❌ Skill '{name}' not found (user_id={user_id or 'legacy'})"
    )
    return None


def list_available_skills(
    working_directory: str | None = None,
    agent_name: str | None = None,
    user_id: str | None = None,
    check_enabled: bool = True,
) -> list[dict[str, str]]:
    """List all available skills for an agent.

    Args:
        working_directory: Directory to search from
        agent_name: Name of the agent requesting skills
        user_id: User identifier for loading user-specific config
        check_enabled: If True, filter by enabled status and agent permissions

    Returns:
        List of dicts with 'name', 'scope', and 'path' keys
    """
    wd = Path(working_directory) if working_directory else None
    skills = SkillDiscovery.discover(wd, agent_name)

    if check_enabled:
        config = _get_merged_skill_config(wd, user_id)
        # Filter by enabled status and agent permissions
        skills = {
            name: meta
            for name, meta in skills.items()
            if _is_skill_enabled(meta.name, config)
            and _is_agent_allowed(meta.name, agent_name, config)
        }

    return [
        {
            "name": meta.name,
            "scope": meta.scope,
            "path": str(meta.path),
        }
        for meta in skills.values()
    ]


class SkillToolkit(BaseSkillToolkit):
    """SkillToolkit with two-tier hierarchy.

    Skill Discovery Priority (highest to lowest):
    1. Project-level: <working_directory>/skills and .eigent/skills
    2. Global: ~/.eigent/skills/

    Agent access control is managed via skills-config.json (agents field).
    User isolation is managed via ~/.eigent/<user_id>/skills-config.json.
    """

    @classmethod
    def toolkit_name(cls) -> str:
        return "SkillToolkit"

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        working_directory: str | None = None,
        user_id: str | None = None,
        timeout: float | None = None,
    ) -> None:
        """Initialize SkillToolkit with agent context.

        Args:
            api_task_id: Task/project identifier for logging
            agent_name: Name of the agent (e.g., "developer", "browser")
            working_directory: Base directory for skill discovery
            user_id: User identifier for loading user-specific config
            timeout: Optional timeout for skill execution
        """
        self.api_task_id = api_task_id
        self.agent_name = agent_name
        self.user_id = user_id
        logger.info(
            f"Initialized SkillToolkit for agent '{agent_name}' "
            f"in task '{api_task_id}' (user_id={user_id or 'legacy'})"
        )
        super().__init__(
            working_directory=working_directory,
            timeout=timeout,
        )

    def _skill_roots(self) -> list[tuple[str, Path]]:
        """Return skill roots with three-tier precedence.

        Returns:
            List of (label, path) tuples in priority order
        """
        # Reuse the centralized discovery function
        roots = _skill_roots_for_discovery(
            self.working_directory, self.agent_name
        )

        # Fall back to CAMEL's default roots
        roots.extend(super()._skill_roots())

        return roots

    def clear_cache(self) -> None:
        """Clear the skill discovery cache for this toolkit's context."""
        cache_key = SkillDiscovery._build_cache_key(
            self.working_directory, self.agent_name
        )
        SkillDiscovery.clear_cache(cache_key)
        logger.debug(f"Cleared skill cache for {cache_key}")
