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
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.controller import skill_controller
from app.service import skill_service


@pytest.fixture
def skill_api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    skills_root = tmp_path / "skills"
    package = skills_root / "research"
    (package / "scripts").mkdir(parents=True)
    (package / "SKILL.md").write_text("# Research", encoding="utf-8")
    (package / "scripts" / "collect.py").write_text(
        "print('ok')", encoding="utf-8"
    )
    monkeypatch.setattr(skill_service, "SKILLS_ROOT", skills_root)

    app = FastAPI()
    app.include_router(skill_controller.router)
    with TestClient(app) as client:
        yield client


def test_lists_and_streams_skill_package_files(skill_api: TestClient) -> None:
    listed = skill_api.get("/skills/research/files")

    assert listed.status_code == 200
    assert [entry["path"] for entry in listed.json()["files"]] == [
        "SKILL.md",
        "scripts/collect.py",
    ]

    streamed = skill_api.get(
        "/skills/research/file", params={"path": "scripts/collect.py"}
    )

    assert streamed.status_code == 200
    assert streamed.text == "print('ok')"
    assert streamed.headers["content-type"].startswith("text/x-python")


def test_skill_file_endpoint_rejects_traversal(skill_api: TestClient) -> None:
    response = skill_api.get(
        "/skills/research/file", params={"path": "../private.txt"}
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "A safe relative skill file path is required"
    )


def test_skill_package_endpoints_return_not_found(
    skill_api: TestClient,
) -> None:
    package_response = skill_api.get("/skills/missing/files")
    file_response = skill_api.get(
        "/skills/research/file", params={"path": "missing.txt"}
    )

    assert package_response.status_code == 404
    assert file_response.status_code == 404
