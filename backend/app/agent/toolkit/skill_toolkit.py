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
Skill Toolkit with multi-tier hierarchy:

Agent access control is managed via skills-config.json.
User isolation is managed via ~/.eigent/<user_id>/skills-config.json.
"""

import json
import logging
from pathlib import Path
from typing import Literal

from camel.toolkits.function_tool import FunctionTool
from camel.toolkits.skill_toolkit import SkillToolkit as BaseSkillToolkit

logger = logging.getLogger(__name__)

SKILL_FILENAME = "SKILL.md"
SKILL_CONFIG_FILENAME = "skills-config.json"

# Unified scope naming
SkillScope = Literal["repo", "user", "system"]


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

    scope = skill_config.get("scope")
    if isinstance(scope, dict):
        is_global = scope.get("isGlobal", True)
        selected_agents = scope.get("selectedAgents", [])

        # If isGlobal is True, all agents are allowed
        if is_global:
            return True

        if not selected_agents:
            return False

        if not agent_name:
            logger.warning(
                f"No agent_name provided for skill '{skill_name}' "
                f"with agent restrictions: {selected_agents}"
            )
            return False

        return agent_name in selected_agents

    allowed_agents = skill_config.get("agents", [])

    # Empty list = all agents allowed
    if not allowed_agents:
        return True

    if not agent_name:
        logger.warning(
            f"No agent_name provided for skill '{skill_name}' "
            f"with agent restrictions: {allowed_agents}"
        )
        return False

    return agent_name in allowed_agents


class SkillToolkit(BaseSkillToolkit):
    """Enhanced SkillToolkit with Eigent-specific features.

    Extends CAMEL's SkillToolkit with:
    - User-specific skill configuration
    - Agent-based access control
    - Eigent-specific skill paths (.eigent/skills)

    Skill Discovery Priority (highest to lowest):
    1. Repo scope: <wd>/skills, <wd>/.eigent/skills, <wd>/.camel/skills
    2. User scope: ~/.eigent/skills, ~/.camel/skills, ~/.config/camel/skills
    3. System scope: /etc/camel/skills

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
        """Initialize SkillToolkit with Eigent-specific context.

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
        """Return skill roots with Eigent + CAMEL paths.

        Integrates Eigent-specific paths with CAMEL standard paths.
        Priority order (highest to lowest):
        1. Repo scope: project-specific skills
        2. User scope: user-level skills
        3. System scope: system-wide skills

        Returns:
            List of (scope, path) tuples in priority order
        """
        roots: list[tuple[str, Path]] = []

        # 1. Repo scope - project-specific skills (highest priority)
        roots.append(("repo", self.working_directory / "skills"))
        roots.append(("repo", self.working_directory / ".eigent" / "skills"))
        roots.append(("repo", self.working_directory / ".camel" / "skills"))
        roots.append(("repo", self.working_directory / ".agents" / "skills"))

        # 2. User scope - user-level skills
        roots.append(("user", Path.home() / ".eigent" / "skills"))
        roots.append(("user", Path.home() / ".camel" / "skills"))
        roots.append(("user", Path.home() / ".config" / "camel" / "skills"))

        # 3. System scope - system-wide skills (lowest priority)
        roots.append(("system", Path("/etc/camel/skills")))

        logger.debug(
            f"Skill roots configured for {self.agent_name}: {len(roots)} paths"
        )

        return roots

    def _apply_access_control(
        self, skills: dict[str, dict[str, str]]
    ) -> dict[str, dict[str, str]]:
        """Apply agent-based access control to discovered skills.

        Args:
            skills: Dict of discovered skills from base class

        Returns:
            Filtered dict of skills based on configuration
        """
        # Load merged config (user + project)
        config = _get_merged_skill_config(self.working_directory, self.user_id)

        if not config:
            # No config = all skills available
            return skills

        filtered = {}
        for name, metadata in skills.items():
            skill_name = metadata["name"]

            # Check if skill is enabled
            if not _is_skill_enabled(skill_name, config):
                logger.debug(
                    f"Skill '{skill_name}' disabled for user "
                    f"'{self.user_id or 'legacy'}'"
                )
                continue

            # Check if agent is allowed
            if not _is_agent_allowed(skill_name, self.agent_name, config):
                logger.debug(
                    f"Skill '{skill_name}' not allowed for agent "
                    f"'{self.agent_name}'"
                )
                continue

            filtered[name] = metadata

        logger.debug(
            f"Access control: {len(skills)} -> {len(filtered)} skills "
            f"(agent={self.agent_name}, user={self.user_id or 'legacy'})"
        )

        return filtered

    def _get_skills(self) -> dict[str, dict[str, str]]:
        """Override to apply access control to discovered skills.

        Returns:
            Dict of skills after applying access control
        """
        # Get skills from base class (with caching)
        skills = super()._get_skills()

        # Apply Eigent-specific access control
        return self._apply_access_control(skills)

    def get_tools(self) -> list[FunctionTool]:
        """Return skill tools with access control applied.

        The returned tools will respect:
        - User-specific configurations (~/.eigent/<user_id>/skills-config.json)
        - Project-level configurations (.eigent/skills-config.json)
        - Agent-based access restrictions

        Returns:
            List of FunctionTool instances for skill operations
        """
        tools = super().get_tools()
        logger.debug(
            f"Created {len(tools)} skill tools for agent '{self.agent_name}' "
            f"(user_id={self.user_id or 'legacy'})"
        )
        return tools
