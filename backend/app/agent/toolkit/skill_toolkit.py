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
import re
from pathlib import Path

from camel.toolkits.skill_toolkit import SkillToolkit as BaseSkillToolkit

logger = logging.getLogger(__name__)

SKILL_FILENAME = "SKILL.md"


def _skill_roots_for_inject(
    working_directory: Path | None = None,
) -> list[Path]:
    """Return ordered list of skill root paths (same precedence as SkillToolkit)."""
    wd = working_directory if working_directory is not None else Path.cwd()
    wd = wd if isinstance(wd, Path) else Path(wd)
    roots: list[Path] = []
    roots.append(wd / "skills")
    roots.append(wd / ".eigent" / "skills")
    roots.append(Path.home() / ".eigent" / "skills")
    return roots


def _parse_skill_name_from_frontmatter(content: str) -> str | None:
    """Extract frontmatter 'name' from SKILL.md content. Returns None if not found."""
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


def get_skill_content_by_name(
    working_directory: str | None = None,
    skill_name: str = "",
) -> str | None:
    """
    Resolve a skill by display name and return its full SKILL.md content.
    Uses the same root order as SkillToolkit (project, .eigent/skills, ~/.eigent/skills).
    Returns None if no matching skill is found.
    """
    name = (skill_name or "").strip()
    if not name:
        logger.warning(
            "get_skill_content_by_name called with empty skill_name"
        )
        return None

    logger.info(
        f"🔍 Searching for skill: '{name}' in working_directory: {working_directory}"
    )
    name_lower = name.lower()
    wd = Path(working_directory) if working_directory else None

    searched_paths = []
    for root in _skill_roots_for_inject(wd):
        searched_paths.append(str(root))
        if not root.is_dir():
            logger.debug(f"  ⏭️  Skipping non-existent root: {root}")
            continue
        try:
            for entry in root.iterdir():
                if not entry.is_dir() or entry.name.startswith("."):
                    continue
                skill_file = entry / SKILL_FILENAME
                if not skill_file.is_file():
                    continue
                raw = skill_file.read_text(encoding="utf-8", errors="replace")
                parsed_name = _parse_skill_name_from_frontmatter(raw)
                if parsed_name and parsed_name.lower().strip() == name_lower:
                    logger.info(f"✅ Found skill '{name}' at: {skill_file}")
                    logger.info(f"📦 Skill size: {len(raw)} characters")
                    return raw
        except OSError as e:
            logger.warning(f"  ⚠️  Error reading root {root}: {e}")
            continue

    logger.warning(
        f"❌ Skill '{name}' not found. Searched paths: {searched_paths}"
    )
    return None


class SkillToolkit(BaseSkillToolkit):
    """SkillToolkit that discovers skills with project/worker/global precedence.

    Accepts api_task_id and agent_name (like TerminalToolkit) for logging and
    per-agent skill roots. Skill roots: working_directory/skills,
    working_directory/.eigent/skills, ~/.eigent/skills, then CAMEL defaults.
    """

    @classmethod
    def toolkit_name(cls) -> str:
        return "SkillToolkit"

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        working_directory: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.api_task_id = api_task_id
        self.agent_name = agent_name
        super().__init__(
            working_directory=working_directory,
            timeout=timeout,
        )

    def _skill_roots(self) -> list[tuple[str, Path]]:
        """Return skill roots with Eigent-specific precedence.

        Precedence (highest to lowest) for skills with the same name:
        1. Project-level skills under <working_directory>/skills
        2. Worker/task-local skills under <working_directory>/.eigent/skills
        3. Global user skills under ~/.eigent/skills
        4. Default CAMEL roots (.camel/, .agents/, etc.)
        """
        roots: list[tuple[str, Path]] = []

        # 1) Project-level skills for this task/workspace
        roots.append(("repo", self.working_directory / "skills"))

        # 2) Worker/task-local skills under .eigent/skills inside working dir
        roots.append(("repo", self.working_directory / ".eigent" / "skills"))

        # 3) Global user-level skills managed by the Eigent app
        roots.append(("user", Path.home() / ".eigent" / "skills"))

        # 4) Fall back to CAMEL's default roots (.camel, .agents, etc.)
        roots.extend(super()._skill_roots())

        return roots
