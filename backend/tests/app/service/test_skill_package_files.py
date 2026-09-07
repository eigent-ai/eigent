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

from pathlib import Path

import pytest

from app.service import skill_service


@pytest.fixture
def skills_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "skills"
    root.mkdir()
    monkeypatch.setattr(skill_service, "SKILLS_ROOT", root)
    return root


def test_lists_nested_regular_files_with_metadata(skills_root: Path) -> None:
    skill = skills_root / "research"
    (skill / "scripts").mkdir(parents=True)
    (skill / "SKILL.md").write_text("# Research", encoding="utf-8")
    (skill / "scripts" / "collect.py").write_text(
        "print('ok')", encoding="utf-8"
    )
    (skill / skill_service.EXAMPLE_SKILL_MARKER).write_text(
        "source=research\n", encoding="utf-8"
    )

    files = skill_service.skill_list_files("research")

    assert [entry["path"] for entry in files] == [
        "SKILL.md",
        "scripts/collect.py",
    ]
    assert files[0]["size"] == len("# Research")
    assert files[0]["mimeType"] == "text/markdown"
    assert files[1]["mimeType"] == "text/x-python"


def test_resolves_a_nested_file_inside_one_skill(skills_root: Path) -> None:
    expected = skills_root / "research" / "references" / "guide.md"
    expected.parent.mkdir(parents=True)
    expected.write_text("Guide", encoding="utf-8")

    assert (
        skill_service.skill_file_path("research", "references/guide.md")
        == expected.resolve()
    )


@pytest.mark.parametrize(
    ("skill_name", "relative_path"),
    [
        (".", "research/SKILL.md"),
        ("../research", "SKILL.md"),
        ("research", "../private.txt"),
        ("research", "/private.txt"),
        ("research", "scripts//collect.py"),
    ],
)
def test_rejects_paths_outside_a_single_skill(
    skills_root: Path, skill_name: str, relative_path: str
) -> None:
    (skills_root / "research").mkdir(exist_ok=True)

    with pytest.raises((ValueError, PermissionError)):
        skill_service.skill_file_path(skill_name, relative_path)


def test_rejects_symlinked_package_files(
    skills_root: Path, tmp_path: Path
) -> None:
    skill = skills_root / "research"
    skill.mkdir()
    secret = tmp_path / "secret.txt"
    secret.write_text("secret", encoding="utf-8")
    link = skill / "secret.txt"
    try:
        link.symlink_to(secret)
    except OSError:
        pytest.skip("Symlinks are unavailable on this platform")

    assert skill_service.skill_list_files("research") == []
    with pytest.raises(PermissionError):
        skill_service.skill_file_path("research", "secret.txt")


def test_missing_skill_or_file_is_not_found(skills_root: Path) -> None:
    (skills_root / "research").mkdir()

    with pytest.raises(FileNotFoundError):
        skill_service.skill_list_files("missing")
    with pytest.raises(FileNotFoundError):
        skill_service.skill_file_path("research", "missing.txt")
