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
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.controller import file_controller


def _client_with_home(monkeypatch, tmp_path: Path) -> TestClient:
    monkeypatch.setattr(file_controller.Path, "home", lambda: tmp_path)
    app = FastAPI()
    app.include_router(file_controller.router)
    return TestClient(app)


def _write_widget(tmp_path: Path, manifest: dict) -> None:
    widget_dir = tmp_path / "eigent" / "alice" / "project_project-1" / "widget"
    widget_dir.mkdir(parents=True)
    (widget_dir / "widget.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    (widget_dir / "preview.html").write_text(
        "<div>Preview</div>", encoding="utf-8"
    )
    (widget_dir / "index.html").write_text(
        "<main>Full</main>", encoding="utf-8"
    )


def test_get_project_widget_returns_manifest_and_html(monkeypatch, tmp_path):
    client = _client_with_home(monkeypatch, tmp_path)
    _write_widget(
        tmp_path,
        {
            "name": "Search Console Dashboard",
            "version": 1,
            "preview": "preview.html",
            "entry": "index.html",
            "updatedAt": "2026-05-08T12:00:00Z",
        },
    )

    res = client.get(
        "/projects/project-1/widget",
        params={"email": "alice@example.com"},
    )

    assert res.status_code == 200
    data = res.json()
    assert data["exists"] is True
    assert data["manifest"]["name"] == "Search Console Dashboard"
    assert data["previewHtml"] == "<div>Preview</div>"
    assert data["entryHtml"] == "<main>Full</main>"
    assert data["previewUrl"].endswith("/widget/preview.html")


def test_get_project_widget_missing_folder_returns_exists_false(
    monkeypatch, tmp_path
):
    client = _client_with_home(monkeypatch, tmp_path)

    res = client.get(
        "/projects/project-1/widget",
        params={"email": "alice@example.com"},
    )

    assert res.status_code == 200
    assert res.json() == {"exists": False}


def test_get_project_widget_rejects_invalid_manifest(monkeypatch, tmp_path):
    client = _client_with_home(monkeypatch, tmp_path)
    widget_dir = tmp_path / "eigent" / "alice" / "project_project-1" / "widget"
    widget_dir.mkdir(parents=True)
    (widget_dir / "widget.json").write_text("{", encoding="utf-8")

    res = client.get(
        "/projects/project-1/widget",
        params={"email": "alice@example.com"},
    )

    assert res.status_code == 400
    assert "invalid JSON" in res.json()["detail"]


def test_get_project_widget_rejects_path_traversal(monkeypatch, tmp_path):
    client = _client_with_home(monkeypatch, tmp_path)
    _write_widget(
        tmp_path,
        {
            "name": "Bad Widget",
            "preview": "../preview.html",
            "entry": "index.html",
        },
    )

    res = client.get(
        "/projects/project-1/widget",
        params={"email": "alice@example.com"},
    )

    assert res.status_code == 400
    assert "inside widget" in res.json()["detail"]
