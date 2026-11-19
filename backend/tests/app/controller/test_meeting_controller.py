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

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import require_local_control_principal
from app.meetings import MeetingStore
from app.router import register_routers

IDENTITY = {"email": "person@example.com", "user_id": 7}


@dataclass
class _Binding:
    workspace_root: str


class _BindingStore:
    def __init__(self, roots: dict[str, Path]) -> None:
        self.roots = roots

    def get_binding(self, _email, space_id, _user_id):
        root = self.roots.get(space_id)
        return _Binding(workspace_root=str(root)) if root else None


class _Resolver:
    def __init__(self, roots: dict[str, Path]) -> None:
        self.store = _BindingStore(roots)


@pytest.fixture
def meetings_api(tmp_path, monkeypatch):
    store = MeetingStore(tmp_path / "meetings")
    spaces = {"space-a": tmp_path / "space-a", "space-b": tmp_path / "space-b"}
    for root in spaces.values():
        root.mkdir()
    monkeypatch.setattr(
        "app.controller.meeting_controller.get_meeting_store", lambda: store
    )
    monkeypatch.setattr(
        "app.controller.meeting_controller.get_workspace_resolver",
        lambda: _Resolver(spaces),
    )
    app = FastAPI()
    register_routers(app)
    app.dependency_overrides[require_local_control_principal] = lambda: None
    with TestClient(app) as client:
        yield client, store, spaces


def test_meeting_routes_require_local_control(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.controller.meeting_controller.get_meeting_store",
        lambda: MeetingStore(tmp_path),
    )
    app = FastAPI()
    register_routers(app)
    with TestClient(app) as client:
        response = client.get("/meetings")

    assert response.status_code in {401, 403, 503}


def test_record_then_finish_a_meeting(meetings_api):
    client, store, _ = meetings_api

    created = client.post("/meetings", json={"title": "Weekly sync"})
    assert created.status_code == 201
    meeting_id = created.json()["id"]
    assert created.json()["status"] == "recording"

    upload = client.post(
        f"/meetings/{meeting_id}/recording",
        files={"file": ("microphone.webm", b"webm-bytes", "audio/webm")},
    )
    assert upload.status_code == 200
    assert upload.json()["recording_kept"] is True
    assert (
        store.recording_dir(meeting_id) / "microphone.webm"
    ).read_bytes() == b"webm-bytes"

    finished = client.patch(
        f"/meetings/{meeting_id}",
        json={
            "status": "ready",
            "duration_ms": 65_000,
            "typed_notes": [{"at_ms": 5_000, "text": "Decide owner"}],
        },
    )
    assert finished.status_code == 200
    assert finished.json()["status"] == "ready"
    assert finished.json()["typed_notes"] == [
        {"at_ms": 5_000, "text": "Decide owner"}
    ]

    audio = client.get(f"/meetings/{meeting_id}/recording")
    assert audio.status_code == 200
    assert audio.content == b"webm-bytes"

    listed = client.get("/meetings", params={"q": "weekly"}).json()["items"]
    assert [item["id"] for item in listed] == [meeting_id]


def test_import_accepts_audio_and_rejects_other_files(meetings_api):
    client, _, _ = meetings_api

    imported = client.post(
        "/meetings/import",
        files={"file": ("Board call.m4a", b"m4a", "audio/mp4")},
    )
    assert imported.status_code == 201
    assert imported.json()["title"] == "Board call"
    assert imported.json()["source"] == "import"
    assert imported.json()["status"] == "ready"

    rejected = client.post(
        "/meetings/import",
        files={"file": ("notes.exe", b"x", "application/octet-stream")},
    )
    assert rejected.status_code == 415
    assert len(client.get("/meetings").json()["items"]) == 1


def test_add_to_space_writes_a_file_and_asks_before_replacing_edits(
    meetings_api,
):
    client, _, spaces = meetings_api
    meeting_id = client.post("/meetings", json={"title": "Kickoff"}).json()[
        "id"
    ]
    client.patch(
        f"/meetings/{meeting_id}",
        json={"status": "ready", "note_markdown": "## Summary\n\nGo.\n"},
    )

    added = client.post(
        f"/meetings/{meeting_id}/spaces/space-a", json=IDENTITY
    )
    assert added.status_code == 200
    [link] = added.json()["spaces"]
    assert link["space_id"] == "space-a"
    assert link["changed_since_added"] is False
    copy = spaces["space-a"] / link["relative_path"]
    assert copy.parent.name == "Meetings"
    assert "## Summary\n\nGo." in copy.read_text(encoding="utf-8")

    # The note changes: the meeting says so, and Update copy rewrites it.
    changed = client.patch(
        f"/meetings/{meeting_id}",
        json={"note_markdown": "## Summary\n\nGo on Monday.\n"},
    ).json()
    assert changed["spaces"][0]["changed_since_added"] is True
    client.post(f"/meetings/{meeting_id}/spaces/space-a", json=IDENTITY)
    assert "Go on Monday." in copy.read_text(encoding="utf-8")

    # Someone edits the copy in the Space: Eigent asks first.
    copy.write_text("edited", encoding="utf-8")
    client.patch(
        f"/meetings/{meeting_id}", json={"note_markdown": "## Summary\n\n3"}
    )
    conflict = client.post(
        f"/meetings/{meeting_id}/spaces/space-a", json=IDENTITY
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "meeting_copy_conflict"
    assert copy.read_text(encoding="utf-8") == "edited"

    replaced = client.post(
        f"/meetings/{meeting_id}/spaces/space-a",
        json={**IDENTITY, "overwrite": True},
    )
    assert replaced.status_code == 200
    assert "## Summary\n\n3" in copy.read_text(encoding="utf-8")


def test_space_without_a_folder_is_reported(meetings_api):
    client, _, _ = meetings_api
    meeting_id = client.post("/meetings", json={"title": "x"}).json()["id"]

    response = client.post(
        f"/meetings/{meeting_id}/spaces/space-unknown", json=IDENTITY
    )

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "workspace_binding_not_found"


def test_removing_a_link_or_the_meeting_keeps_space_copies(meetings_api):
    client, store, spaces = meetings_api
    meeting_id = client.post("/meetings", json={"title": "Retro"}).json()["id"]
    for space_id in ("space-a", "space-b"):
        client.post(f"/meetings/{meeting_id}/spaces/{space_id}", json=IDENTITY)
    copies = [
        spaces[link.space_id] / link.relative_path
        for link in store.links(meeting_id)
    ]

    unlinked = client.delete(f"/meetings/{meeting_id}/spaces/space-a")
    assert [s["space_id"] for s in unlinked.json()["spaces"]] == ["space-b"]

    deleted = client.delete(f"/meetings/{meeting_id}")
    assert deleted.json() == {
        "deleted": True,
        "space_copies_kept": ["space-b"],
    }
    assert all(copy.is_file() for copy in copies)
    assert client.get(f"/meetings/{meeting_id}").status_code == 404


def test_unknown_meeting_is_404(meetings_api):
    client, _, _ = meetings_api

    assert client.get("/meetings/meeting_" + "0" * 32).status_code == 404
    assert client.get("/meetings/not-an-id").status_code == 404
