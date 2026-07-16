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
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

SKILLS_ROOT = Path.home() / ".eigent" / "skills"
SKILL_FILE = "SKILL.md"
EXAMPLE_SKILLS_ENV = "EIGENT_EXAMPLE_SKILLS_DIR"
EXAMPLE_SKILL_MARKER = ".eigent-example-skill"
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


def _candidate_example_skill_roots() -> list[Path]:
    """Return likely example-skills roots for dev and packaged Electron."""
    candidates: list[Path] = []

    env_path = os.getenv(EXAMPLE_SKILLS_ENV)
    if env_path:
        candidates.append(Path(env_path).expanduser())

    backend_root = Path(__file__).resolve().parent.parent.parent
    candidates.extend(
        [
            # Packaged app: <Resources>/example-skills
            backend_root.parent / "example-skills",
            # Dev repo: <repo>/resources/example-skills
            backend_root.parent / "resources" / "example-skills",
            # CWD variants used by uvicorn when launched from backend/.
            Path.cwd().parent / "example-skills",
            Path.cwd().parent / "resources" / "example-skills",
        ]
    )

    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        resolved = str(candidate.resolve())
        if resolved not in seen:
            seen.add(resolved)
            unique.append(candidate)
    return unique


def get_example_skills_root() -> Path | None:
    """Find the bundled example-skills directory, if available."""
    for candidate in _candidate_example_skill_roots():
        if candidate.exists() and candidate.is_dir():
            return candidate
    return None


def _copy_dir_without_symlinks(src: Path, dst: Path) -> None:
    """Copy a directory tree while ignoring symlinks."""
    dst.mkdir(parents=True, exist_ok=True)
    for entry in src.iterdir():
        if entry.is_symlink():
            continue
        target = dst / entry.name
        if entry.is_dir():
            _copy_dir_without_symlinks(entry, target)
        elif entry.is_file():
            shutil.copy2(entry, target)


def _regular_files_by_relative_path(
    root: Path, ignored_names: set[str] | None = None
) -> dict[str, Path]:
    ignored_names = ignored_names or set()
    files: dict[str, Path] = {}
    for path in root.rglob("*"):
        if path.is_symlink() or path.name in ignored_names:
            continue
        if path.is_file():
            files[str(path.relative_to(root))] = path
    return files


def _dir_contents_match(src: Path, dst: Path) -> bool:
    src_files = _regular_files_by_relative_path(src)
    dst_files = _regular_files_by_relative_path(dst, {EXAMPLE_SKILL_MARKER})
    if set(src_files) != set(dst_files):
        return False
    for rel_path, src_file in src_files.items():
        try:
            if src_file.read_bytes() != dst_files[rel_path].read_bytes():
                return False
        except OSError:
            return False
    return True


def _skill_name_from_dir(skill_dir: Path) -> str | None:
    skill_path = skill_dir / SKILL_FILE
    if not skill_path.exists():
        return None
    try:
        meta = _parse_skill_frontmatter(skill_path.read_text(encoding="utf-8"))
        return meta["name"] if meta else None
    except (OSError, UnicodeDecodeError):
        return None


def _is_managed_example_skill(dst: Path, src: Path) -> bool:
    if (dst / EXAMPLE_SKILL_MARKER).exists():
        return True
    return _skill_name_from_dir(dst) == _skill_name_from_dir(src)


def _write_example_marker(dst: Path, source_dir_name: str) -> None:
    (dst / EXAMPLE_SKILL_MARKER).write_text(
        f"source={source_dir_name}\n",
        encoding="utf-8",
    )


def sync_example_skills() -> dict[str, int]:
    """Copy new bundled example skills and update existing managed examples."""
    example_root = get_example_skills_root()
    stats = {"copied": 0, "updated": 0, "skipped": 0}
    if example_root is None:
        logger.warning(
            "Example skills source dir missing. Checked: %s",
            [str(p) for p in _candidate_example_skill_roots()],
        )
        return stats

    SKILLS_ROOT.mkdir(parents=True, exist_ok=True)
    for entry in example_root.iterdir():
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        if not (entry / SKILL_FILE).exists():
            continue
        dest = SKILLS_ROOT / entry.name
        if not dest.exists():
            _copy_dir_without_symlinks(entry, dest)
            _write_example_marker(dest, entry.name)
            stats["copied"] += 1
            continue

        if not dest.is_dir() or not _is_managed_example_skill(dest, entry):
            logger.warning(
                "Skipping bundled example skill sync due to "
                "local conflict: %s",
                dest,
            )
            stats["skipped"] += 1
            continue

        if _dir_contents_match(entry, dest):
            _write_example_marker(dest, entry.name)
            continue

        shutil.rmtree(dest)
        _copy_dir_without_symlinks(entry, dest)
        _write_example_marker(dest, entry.name)
        stats["updated"] += 1

    if stats["copied"] or stats["updated"]:
        logger.info(
            "Synced example skills to %s from %s: copied=%s updated=%s",
            SKILLS_ROOT,
            example_root,
            stats["copied"],
            stats["updated"],
        )
    return stats


def seed_example_skills_if_missing() -> int:
    """Compatibility wrapper for older callers."""
    stats = sync_example_skills()
    return stats["copied"] + stats["updated"]


def is_example_skill_dir(skill_dir_name: str) -> bool:
    """Return whether a skill directory corresponds to a bundled example."""
    example_root = get_example_skills_root()
    if example_root is None:
        return False
    src = example_root / skill_dir_name
    dst = SKILLS_ROOT / skill_dir_name
    return (
        (src / SKILL_FILE).exists()
        and dst.exists()
        and _is_managed_example_skill(dst, src)
    )


def example_skills_metadata() -> list[dict]:
    """Read metadata for all bundled example skills."""
    example_root = get_example_skills_root()
    if example_root is None:
        return []

    skills = []
    for entry in example_root.iterdir():
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        skill_path = entry / SKILL_FILE
        if not skill_path.exists():
            continue
        try:
            meta = _parse_skill_frontmatter(
                skill_path.read_text(encoding="utf-8")
            )
            if meta:
                skills.append(
                    {
                        "name": meta["name"],
                        "description": meta["description"],
                        "skillDirName": entry.name,
                    }
                )
        except (OSError, UnicodeDecodeError):
            pass
    return skills


def skills_scan() -> list[dict]:
    """Scan skills directory and return list of skills with metadata."""
    sync_example_skills()
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
                        "isExample": is_example_skill_dir(entry.name),
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
