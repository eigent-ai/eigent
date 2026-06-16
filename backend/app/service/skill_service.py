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
import shutil
import tempfile
import zipfile
from pathlib import Path

SKILLS_ROOT = Path.home() / ".eigent" / "skills"
SKILL_FILE = "SKILL.md"
logger = logging.getLogger("skill_service")


def _parse_skill_frontmatter(content: str) -> dict | None:
    """Parse name and description from SKILL.md frontmatter."""
    if not content.startswith("---"):
        return None
    end = content.find("\n---", 3)
    block = content[4:end] if end > 0 else content[4:]
    name_match = re.search(r"^\s*name\s*:\s*(.+)$", block, re.MULTILINE)
    desc_match = re.search(r"^\s*description\s*:\s*(.+)$", block, re.MULTILINE)
    name = name_match.group(1).strip().strip("'\"") if name_match else None
    desc = desc_match.group(1).strip().strip("'\"") if desc_match else None
    if name and desc:
        return {"name": name, "description": desc}
    return None


def _assert_under_skills_root(target: Path) -> Path:
    """Ensure path is under SKILLS_ROOT (security)."""
    root = SKILLS_ROOT.resolve()
    resolved = target.resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        raise PermissionError("Path is outside skills directory")
    return resolved


def skills_scan() -> list[dict]:
    """Scan skills directory and return list of skills with metadata."""
    if not SKILLS_ROOT.exists():
        return []
    skills = []
    for entry in SKILLS_ROOT.iterdir():
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        skill_path = entry / SKILL_FILE
        try:
            raw = skill_path.read_text(encoding="utf-8")
            meta = _parse_skill_frontmatter(raw)
            if meta:
                skills.append(
                    {
                        "name": meta["name"],
                        "description": meta["description"],
                        "path": str(skill_path),
                        "scope": "user",
                        "skillDirName": entry.name,
                    }
                )
        except (OSError, UnicodeDecodeError):
            pass
    return skills


def skill_get_path_by_name(skill_name: str) -> str | None:
    """Return the absolute directory path for a skill by its display name, or None if not found."""
    if not SKILLS_ROOT.exists():
        return None
    name_lower = (skill_name or "").strip().lower()
    if not name_lower:
        return None
    for entry in SKILLS_ROOT.iterdir():
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        skill_path = entry / SKILL_FILE
        if not skill_path.exists():
            continue
        try:
            meta = _parse_skill_frontmatter(
                skill_path.read_text(encoding="utf-8")
            )
            if meta and meta.get("name", "").lower().strip() == name_lower:
                return str(entry.resolve())
        except (OSError, UnicodeDecodeError):
            pass
    return None


def skill_write(skill_dir_name: str, content: str) -> None:
    """Write SKILL.md for a skill."""
    name = (skill_dir_name or "").strip()
    if not name:
        raise ValueError("Skill folder name is required")
    dir_path = _assert_under_skills_root(SKILLS_ROOT / name)
    dir_path.mkdir(parents=True, exist_ok=True)
    (dir_path / SKILL_FILE).write_text(content, encoding="utf-8")


def skill_read(skill_dir_name: str) -> str:
    """Read SKILL.md content."""
    name = (skill_dir_name or "").strip()
    if not name:
        raise ValueError("Skill folder name is required")
    skill_path = _assert_under_skills_root(SKILLS_ROOT / name / SKILL_FILE)
    return skill_path.read_text(encoding="utf-8")


def skill_delete(skill_dir_name: str) -> None:
    """Delete skill directory."""
    name = (skill_dir_name or "").strip()
    if not name:
        raise ValueError("Skill folder name is required")
    dir_path = _assert_under_skills_root(SKILLS_ROOT / name)
    if dir_path.exists():
        import shutil

        shutil.rmtree(dir_path)


def skill_list_files(skill_dir_name: str) -> list[str]:
    """List files in skill directory."""
    name = (skill_dir_name or "").strip()
    if not name:
        raise ValueError("Skill folder name is required")
    dir_path = _assert_under_skills_root(SKILLS_ROOT / name)
    if not dir_path.exists():
        return []
    return [e.name for e in dir_path.iterdir()]


def _get_skill_name_from_file(skill_file_path: Path) -> str:
    """Extract skill name from SKILL.md frontmatter."""
    try:
        raw = skill_file_path.read_text(encoding="utf-8")
        name_match = re.search(r"^\s*name\s*:\s*(.+)$", raw, re.MULTILINE)
        parsed = (
            name_match.group(1).strip().strip("'\"") if name_match else None
        )
        return parsed or skill_file_path.parent.name
    except (OSError, UnicodeDecodeError):
        return skill_file_path.parent.name


def _folder_name_from_skill_name(skill_name: str, fallback: str) -> str:
    """Derive safe folder name from skill display name."""
    cleaned = (
        (skill_name or "")
        .replace("\\", "-")
        .replace("/", "-")
        .replace("*", "-")
        .replace("?", "-")
        .replace(":", "-")
        .replace('"', "-")
        .replace("<", "-")
        .replace(">", "-")
        .replace("|", "-")
        .replace(" ", "-")
    )
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return cleaned or fallback


def skill_import_zip(
    zip_bytes: bytes,
    replacements: list[str] | None = None,
) -> dict:
    """
    Import skills from a zip archive.
    Returns {success, error?, conflicts?} matching Electron IPC contract.
    """
    replacements_set = set(replacements or [])
    temp_dir = Path(tempfile.mkdtemp(prefix="eigent-skill-extract-"))
    try:
        SKILLS_ROOT.mkdir(parents=True, exist_ok=True)

        # Step 1: Extract zip into temp directory
        with zipfile.ZipFile(__import__("io").BytesIO(zip_bytes), "r") as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name = info.filename.replace("\\", "/").lstrip("/")
                if ".." in name or name.startswith("/"):
                    return {
                        "success": False,
                        "error": "Zip archive contains unsafe paths",
                    }
                dest = temp_dir / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(zf.read(info))

        # Step 2: Find all SKILL.md files
        skill_files: list[Path] = []

        def find_skill_md(d: Path) -> None:
            for entry in d.iterdir():
                if entry.name.startswith("."):
                    continue
                if entry.is_dir():
                    find_skill_md(entry)
                elif entry.name == SKILL_FILE:
                    skill_files.append(entry)

        find_skill_md(temp_dir)

        if not skill_files:
            return {
                "success": False,
                "error": "No SKILL.md files found in zip archive",
            }

        # Step 3: Build existing skill names map
        existing_names: dict[str, str] = {}
        if SKILLS_ROOT.exists():
            for entry in SKILLS_ROOT.iterdir():
                if not entry.is_dir() or entry.name.startswith("."):
                    continue
                skill_file = entry / SKILL_FILE
                if not skill_file.exists():
                    continue
                try:
                    meta = _parse_skill_frontmatter(
                        skill_file.read_text(encoding="utf-8")
                    )
                    if meta and meta.get("name"):
                        existing_names[meta["name"].lower()] = entry.name
                except (OSError, UnicodeDecodeError):
                    pass

        conflicts: list[dict] = []

        for skill_file in skill_files:
            skill_dir = skill_file.parent
            incoming_name = _get_skill_name_from_file(skill_file)
            incoming_lower = incoming_name.lower()

            fallback = (
                "imported-skill" if skill_dir == temp_dir else skill_dir.name
            )
            dest_folder = _folder_name_from_skill_name(incoming_name, fallback)
            dest_path = SKILLS_ROOT / dest_folder

            existing_folder = existing_names.get(incoming_lower)
            if existing_folder:
                if replacements is None:
                    conflicts.append(
                        {
                            "folderName": existing_folder,
                            "skillName": incoming_name,
                        }
                    )
                    continue
                if existing_folder in replacements_set:
                    shutil.rmtree(
                        SKILLS_ROOT / existing_folder, ignore_errors=True
                    )
                else:
                    continue

            dest_path.mkdir(parents=True, exist_ok=True)
            if skill_dir == temp_dir:
                for item in temp_dir.iterdir():
                    dest_item = dest_path / item.name
                    if item.is_dir():
                        shutil.copytree(item, dest_item, dirs_exist_ok=True)
                    else:
                        shutil.copy2(item, dest_item)
            else:
                for item in skill_dir.iterdir():
                    dest_item = dest_path / item.name
                    if item.is_dir():
                        shutil.copytree(item, dest_item, dirs_exist_ok=True)
                    else:
                        shutil.copy2(item, dest_item)

        if conflicts and replacements is None:
            return {"success": False, "conflicts": conflicts}

        return {"success": True}
    except zipfile.BadZipFile:
        return {"success": False, "error": "Invalid zip file"}
    except Exception:
        logger.exception("Failed to import skills from zip archive")
        return {"success": False, "error": "Failed to import skills"}
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
