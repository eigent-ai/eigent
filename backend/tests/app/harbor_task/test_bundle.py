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

import hashlib
import json
import os
import zipfile
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from app.harbor_task import (
    HARBOR_TASKS_DIR_ENV,
    HarborTaskBundleError,
    build_bundle,
    run_conversation,
    saved_bundle,
    upload_bundle,
)


def _event(event_type, payload, created_at):
    return SimpleNamespace(
        event_type=event_type, payload=payload, created_at=created_at
    )


class _Journal:
    def __init__(self, events, interactions=(), decisions=None):
        self.events = events
        self.interactions = list(interactions)
        self.decisions = decisions or {}

    def list_events(self, _run_id, *, event_type_prefix=None):
        return [
            event
            for event in self.events
            if event_type_prefix is None
            or event.event_type.startswith(event_type_prefix)
        ]

    def list_human_interactions(self, _run_id):
        return self.interactions

    def list_human_interaction_decisions(self, interaction_id):
        return self.decisions.get(interaction_id, [])


def test_conversation_is_what_the_user_and_the_agent_said_in_order(tmp_path):
    workspace = tmp_path / "space"
    workspace.mkdir()
    key = "sk-" + "a" * 40
    journal = _Journal(
        [
            _event(
                "user.message",
                {"content": f"Fix {workspace}/app.py; my key is {key}"},
                1.0,
            ),
            _event("tool.dispatched", {"request": {"cmd": "ls"}}, 2.0),
            _event("assistant.final", {"message": "Fixed /app/app.py."}, 6.0),
            _event("user.message", {"content": "   "}, 7.0),
        ],
        interactions=[
            SimpleNamespace(
                interaction_id="q1",
                interaction_type="question",
                request={"question": "Which Python version?"},
                created_at=3.0,
            )
        ],
        decisions={
            "q1": [
                SimpleNamespace(
                    actor_type="user",
                    decision={"reply": "3.12"},
                    created_at=4.0,
                )
            ]
        },
    )

    conversation = run_conversation(journal, "run-1", workspace_root=workspace)

    assert conversation == {
        "source": "eigent",
        "run_id": "run-1",
        "turns": [
            {
                "role": "user",
                "content": "Fix /app/app.py; my key is [redacted]",
            },
            {"role": "assistant", "content": "Which Python version?"},
            {"role": "user", "content": "3.12"},
            {"role": "assistant", "content": "Fixed /app/app.py."},
        ],
    }


def _task(root: Path) -> Path:
    task = root / "task-run-1"
    (task / "tests").mkdir(parents=True)
    (task / "instruction.md").write_text("Fix the app\n")
    (task / "task.toml").write_text('[task]\nname = "eigent/task-run-1"\n')
    test = task / "tests" / "test.sh"
    test.write_text("#!/bin/bash\n")
    os.chmod(test, 0o755)
    return task


def test_bundle_holds_the_task_the_conversation_and_a_manifest(tmp_path):
    task = _task(tmp_path)
    conversation = {"turns": [{"role": "user", "content": "Fix the app"}]}

    bundle = build_bundle(task, conversation)

    assert bundle.path == tmp_path / "task-run-1.env-hub.zip"
    data = bundle.path.read_bytes()
    assert bundle.size_bytes == len(data)
    assert bundle.sha256 == hashlib.sha256(data).hexdigest()
    assert bundle.turns == 1
    with zipfile.ZipFile(bundle.path) as archive:
        assert sorted(archive.namelist()) == [
            "conversation.json",
            "manifest.json",
            "task/instruction.md",
            "task/task.toml",
            "task/tests/test.sh",
        ]
        assert json.loads(archive.read("manifest.json")) == {
            "format_version": "1",
            "conversation": "conversation.json",
        }
        assert json.loads(archive.read("conversation.json")) == conversation
        mode = archive.getinfo("task/tests/test.sh").external_attr >> 16
        assert mode & 0o111
    # the same task makes the same bundle
    assert build_bundle(task, conversation).sha256 == bundle.sha256


def test_only_a_bundle_under_the_tasks_folder_is_found(monkeypatch, tmp_path):
    root = tmp_path / "harbor-tasks"
    root.mkdir()
    monkeypatch.setenv(HARBOR_TASKS_DIR_ENV, str(root))
    build_bundle(_task(root), {"turns": []})

    assert (
        saved_bundle("task-run-1")
        == (root / "task-run-1.env-hub.zip").resolve()
    )
    for name in ("task-run-2", "../task-run-1"):
        with pytest.raises(HarborTaskBundleError) as error:
            saved_bundle(name)
        assert error.value.reason == "bundle_not_found"


def test_upload_sends_the_bundle_with_only_the_upload_headers(tmp_path):
    path = tmp_path / "task.env-hub.zip"
    path.write_bytes(b"bundle")
    seen = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200)

    status = upload_bundle(
        path,
        url="https://storage.googleapis.com/upload?sig=1",
        method="PUT",
        headers={
            "Content-Type": "application/zip",
            "Content-Range": "bytes 0-5/6",
            "x-goog-meta-run": "run-1",
            "Authorization": "Bearer nope",
            "Cookie": "a=b",
        },
        transport=httpx.MockTransport(answer),
    )

    assert status == 200
    (request,) = seen
    assert request.method == "PUT" and request.content == b"bundle"
    assert request.headers["content-type"] == "application/zip"
    assert request.headers["content-range"] == "bytes 0-5/6"
    assert request.headers["x-goog-meta-run"] == "run-1"
    assert "authorization" not in request.headers
    assert "cookie" not in request.headers


@pytest.mark.parametrize(
    ("url", "method", "reason"),
    [
        ("http://example.com/upload", "PUT", "upload_url_not_allowed"),
        ("file:///etc/passwd", "PUT", "upload_url_not_allowed"),
        ("https://example.com/upload", "POST", "upload_method_not_allowed"),
    ],
)
def test_upload_goes_only_to_https_with_put(tmp_path, url, method, reason):
    path = tmp_path / "task.env-hub.zip"
    path.write_bytes(b"bundle")
    with pytest.raises(HarborTaskBundleError) as error:
        upload_bundle(path, url=url, method=method, headers={})
    assert error.value.reason == reason


def test_a_refused_upload_is_an_error(tmp_path):
    path = tmp_path / "task.env-hub.zip"
    path.write_bytes(b"bundle")
    with pytest.raises(HarborTaskBundleError) as error:
        upload_bundle(
            path,
            url="https://storage.googleapis.com/upload",
            method="PUT",
            headers={},
            transport=httpx.MockTransport(lambda _: httpx.Response(403)),
        )
    assert error.value.reason == "upload_failed"
