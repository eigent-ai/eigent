#!/usr/bin/env python3
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
Initialize skills configuration file with default settings.

This script creates the skills-config.json file if it doesn't exist,
and optionally scans for existing skills to add them to the config.
"""

import json
import sys
from pathlib import Path


def init_global_config(
    user_id: str | None = None, scan_skills: bool = True
) -> None:
    """Initialize global skills configuration.

    Args:
        user_id: User identifier for user-specific config. If None, uses legacy path.
        scan_skills: If True, scan ~/.eigent/skills/ and add found skills to config
    """
    if user_id:
        # User-specific config: ~/.eigent/<user_id>/skills-config.json
        config_path = (
            Path.home() / ".eigent" / str(user_id) / "skills-config.json"
        )
    else:
        # Legacy global config: ~/.eigent/skills-config.json
        config_path = Path.home() / ".eigent" / "skills-config.json"

    skills_dir = Path.home() / ".eigent" / "skills"

    # Check if config already exists
    if config_path.exists():
        print(f"✅ Config already exists: {config_path}")
        with open(config_path) as f:
            config = json.load(f)
        print(f"   Current skills: {list(config.get('skills', {}).keys())}")
        return

    # Ensure directory exists
    config_path.parent.mkdir(parents=True, exist_ok=True)

    # Initialize config structure
    config = {"version": 1, "skills": {}}

    # Scan for existing skills if requested
    if scan_skills and skills_dir.exists():
        print(f"📂 Scanning for skills in {skills_dir}...")
        for skill_dir in skills_dir.iterdir():
            if skill_dir.is_dir() and not skill_dir.name.startswith("."):
                skill_md = skill_dir / "SKILL.md"
                if skill_md.exists():
                    skill_name = skill_dir.name
                    # Parse skill name from frontmatter
                    try:
                        content = skill_md.read_text(encoding="utf-8")
                        import re

                        match = re.search(
                            r"^---\s*\nname:\s*(.+?)\s*\n",
                            content,
                            re.MULTILINE,
                        )
                        if match:
                            skill_name = match.group(1).strip()
                    except Exception:
                        pass

                    # Add to config (enabled by default)
                    config["skills"][skill_name] = {
                        "enabled": True,
                        "scope": "global",
                        "addedAt": int(__import__("time").time() * 1000),
                        "isExample": False,
                    }
                    print(f"   ✅ Found: {skill_name}")

    # Save config
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    print(f"\n✨ Created config: {config_path}")
    print(f"   Total skills: {len(config['skills'])}")


def init_project_config(project_path: str) -> None:
    """Initialize project-level skills configuration.

    Args:
        project_path: Path to the project directory
    """
    project_dir = Path(project_path)
    if not project_dir.exists():
        print(f"❌ Project directory does not exist: {project_path}")
        sys.exit(1)

    config_path = project_dir / ".eigent" / "skills-config.json"

    # Check if config already exists
    if config_path.exists():
        print(f"✅ Project config already exists: {config_path}")
        with open(config_path) as f:
            config = json.load(f)
        print(f"   Current skills: {list(config.get('skills', {}).keys())}")
        return

    # Ensure directory exists
    config_path.parent.mkdir(parents=True, exist_ok=True)

    # Initialize empty project config
    config = {"version": 1, "skills": {}}

    # Save config
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    print(f"\n✨ Created project config: {config_path}")


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Initialize skills configuration files"
    )
    parser.add_argument(
        "--scope",
        choices=["global", "project"],
        default="global",
        help="Configuration scope (default: global)",
    )
    parser.add_argument(
        "--project-path",
        type=str,
        help="Project path (required for project scope)",
    )
    parser.add_argument(
        "--no-scan",
        action="store_true",
        help="Don't scan for existing skills (global only)",
    )
    parser.add_argument(
        "--user-id",
        type=str,
        help="User ID for user-specific config (optional)",
    )

    args = parser.parse_args()

    if args.scope == "global":
        if args.user_id:
            print(
                f"🔧 Initializing user-specific skills configuration for user '{args.user_id}'...\n"
            )
        else:
            print("🔧 Initializing global skills configuration...\n")
        init_global_config(user_id=args.user_id, scan_skills=not args.no_scan)
    elif args.scope == "project":
        if not args.project_path:
            print("❌ --project-path is required for project scope")
            sys.exit(1)
        print(
            f"🔧 Initializing project skills configuration for {args.project_path}...\n"
        )
        init_project_config(args.project_path)

    print("\n✅ Done!")


if __name__ == "__main__":
    main()
