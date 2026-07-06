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

import json

import pytest

from app.agent.toolkit import skill_toolkit as agent_skill_toolkit
from app.service import skill_config_service, skill_service

pytestmark = pytest.mark.unit


def write_skill(
    root,
    folder_name,
    name,
    description="Example skill",
    body="Use this skill.",
):
    skill_dir = root / folder_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        "\n".join(
            [
                "---",
                f"name: {name}",
                f'description: "{description}"',
                "---",
                "",
                body,
            ]
        ),
        encoding="utf-8",
    )
    return skill_dir


def test_skills_scan_seeds_and_marks_example_skills(tmp_path, monkeypatch):
    example_root = tmp_path / "bundled" / "example-skills"
    skills_root = tmp_path / "home" / ".eigent" / "skills"
    write_skill(example_root, "pdf", "pdf")
    write_skill(skills_root, "custom", "Custom")

    monkeypatch.setenv(skill_service.EXAMPLE_SKILLS_ENV, str(example_root))
    monkeypatch.setattr(skill_service, "SKILLS_ROOT", skills_root)

    skills = skill_service.skills_scan()

    by_name = {skill["name"]: skill for skill in skills}
    assert (skills_root / "pdf" / "SKILL.md").exists()
    assert by_name["pdf"]["isExample"] is True
    assert by_name["Custom"]["isExample"] is False


def test_skills_scan_updates_existing_example_skills(tmp_path, monkeypatch):
    example_root = tmp_path / "bundled" / "example-skills"
    skills_root = tmp_path / "home" / ".eigent" / "skills"
    write_skill(example_root, "pdf", "pdf", body="New bundled content")
    existing_dir = write_skill(
        skills_root, "pdf", "pdf", body="Old bundled content"
    )
    (existing_dir / "stale.txt").write_text("remove me", encoding="utf-8")

    monkeypatch.setenv(skill_service.EXAMPLE_SKILLS_ENV, str(example_root))
    monkeypatch.setattr(skill_service, "SKILLS_ROOT", skills_root)

    skill_service.skills_scan()

    updated_content = (skills_root / "pdf" / "SKILL.md").read_text(
        encoding="utf-8"
    )
    assert "New bundled content" in updated_content
    assert not (skills_root / "pdf" / "stale.txt").exists()
    assert (skills_root / "pdf" / skill_service.EXAMPLE_SKILL_MARKER).exists()


def test_skill_config_init_registers_bundled_example_skills(
    tmp_path, monkeypatch
):
    example_root = tmp_path / "bundled" / "example-skills"
    example_root.mkdir(parents=True)
    (example_root / "default-config.json").write_text(
        json.dumps({"version": 1, "skills": {}}),
        encoding="utf-8",
    )
    write_skill(example_root, "docx", "docx")

    eigent_root = tmp_path / "home" / ".eigent"
    monkeypatch.setenv(skill_service.EXAMPLE_SKILLS_ENV, str(example_root))
    monkeypatch.setattr(skill_config_service, "EIGENT_ROOT", eigent_root)

    config = skill_config_service.skill_config_init("new_user")

    assert config["skills"]["docx"]["enabled"] is True
    assert config["skills"]["docx"]["scope"] == {
        "isGlobal": True,
        "selectedAgents": [],
    }
    assert config["skills"]["docx"]["isExample"] is True

    persisted = json.loads(
        (eigent_root / "user_new_user" / "skills-config.json").read_text(
            encoding="utf-8"
        )
    )
    assert persisted["skills"]["docx"]["isExample"] is True


def test_skill_config_load_migrates_legacy_email_config(tmp_path, monkeypatch):
    eigent_root = tmp_path / "home" / ".eigent"
    legacy_dir = eigent_root / "alice"
    legacy_dir.mkdir(parents=True)
    (legacy_dir / "skills-config.json").write_text(
        json.dumps(
            {
                "version": 1,
                "skills": {
                    "pdf": {
                        "enabled": False,
                        "scope": {"isGlobal": True, "selectedAgents": []},
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(skill_config_service, "EIGENT_ROOT", eigent_root)

    config = skill_config_service.skill_config_load(
        "user_42", legacy_user_id="alice@example.com"
    )

    assert config["skills"]["pdf"]["enabled"] is False
    assert not (legacy_dir / "skills-config.json").exists()
    assert (eigent_root / "user_42" / "skills-config.json").exists()


def test_skill_config_migration_merges_without_overwriting_new_config(
    tmp_path, monkeypatch
):
    eigent_root = tmp_path / "home" / ".eigent"
    legacy_dir = eigent_root / "alice"
    user_dir = eigent_root / "user_42"
    legacy_dir.mkdir(parents=True)
    user_dir.mkdir(parents=True)
    (legacy_dir / "skills-config.json").write_text(
        json.dumps(
            {
                "version": 1,
                "skills": {
                    "pdf": {"enabled": False},
                    "docx": {"enabled": True},
                },
            }
        ),
        encoding="utf-8",
    )
    (user_dir / "skills-config.json").write_text(
        json.dumps(
            {
                "version": 1,
                "skills": {
                    "pdf": {"enabled": True},
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(skill_config_service, "EIGENT_ROOT", eigent_root)

    config = skill_config_service.skill_config_load(42, legacy_user_id="alice")

    assert config["skills"]["pdf"]["enabled"] is True
    assert config["skills"]["docx"]["enabled"] is True
    assert not (legacy_dir / "skills-config.json").exists()


def test_agent_skill_toolkit_reads_canonical_user_config_path(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(agent_skill_toolkit.Path, "home", lambda: tmp_path)

    assert agent_skill_toolkit._get_user_config_path("42") == (
        tmp_path / ".eigent" / "user_42" / "skills-config.json"
    )
    assert agent_skill_toolkit._get_user_config_path("user_42") == (
        tmp_path / ".eigent" / "user_42" / "skills-config.json"
    )
