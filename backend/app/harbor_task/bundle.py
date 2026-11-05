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
"""A saved Harbor task as the bundle Env Hub takes, and its upload.

The bundle (format 1) is a zip of the task folder under ``task/``, the Run's
conversation as ``conversation.json`` and ``manifest.json``, written beside
the task folder. The app gets a one-time upload URL from the Env Hub connector
(its ``create_upload`` action) and the backend sends the bundle there
(``upload_bundle``); nothing else leaves the machine from here.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import zipfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from app.harbor_task.exporter import (
    _WORKDIR,
    _localize,
    _user_answers,
    _user_messages,
    harbor_tasks_root,
)

BUNDLE_FORMAT = "1"
BUNDLE_CONTENT_TYPE = "application/zip"
_BUNDLE_SUFFIX = ".env-hub.zip"
_UPLOAD_TIMEOUT_SEC = 300.0
# The headers an upload URL may ask for; anything else is not sent.
_UPLOAD_HEADERS = frozenset({"content-type", "content-range", "content-md5"})
_GOOGLE_HEADER = re.compile(r"^x-goog-[a-z0-9-]+$")

# Text that looks like a credential is replaced before the conversation is
# kept; the patterns match the env-hub skill's.
_SECRET_PATTERNS = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}"),
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]{32,}"),
    re.compile(
        r"\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}"
    ),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    re.compile(r"\bhh[a-z]?_[A-Za-z0-9_-]{30,}"),
)
_REDACTED = "[redacted]"


class HarborTaskBundleError(Exception):
    """The bundle cannot be made or sent; ``reason`` is a stable code."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class HarborTaskBundle:
    path: Path
    filename: str
    size_bytes: int
    sha256: str
    turns: int


def redact(text: str) -> str:
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(_REDACTED, text)
    return text


def _final_message(payload: Mapping) -> str | None:
    for key in ("content", "message", "result"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def run_conversation(journal, run_id: str, *, workspace_root: Path) -> dict:
    """What the user and the agent said in the Run, in order: the user's
    messages and answers, the agent's questions and its final reply. Tools'
    output stays out; workspace paths become ``/app`` and anything that looks
    like a credential is redacted."""

    host_paths = {
        str(workspace_root): _WORKDIR,
        str(workspace_root.resolve()): _WORKDIR,
    }
    said: list[tuple[float, str, str]] = [
        (float(event.created_at), "user", event.payload["content"])
        for event in _user_messages(journal, run_id)
    ]
    said += [
        (at, "user", reply) for at, reply in _user_answers(journal, run_id)
    ]
    for interaction in journal.list_human_interactions(run_id):
        question = (interaction.request or {}).get("question")
        if interaction.interaction_type == "question" and isinstance(
            question, str
        ):
            said.append((float(interaction.created_at), "assistant", question))
    for event in journal.list_events(run_id, event_type_prefix="assistant."):
        message = (
            _final_message(event.payload)
            if event.event_type == "assistant.final"
            else None
        )
        if message:
            said.append((float(event.created_at), "assistant", message))
    said.sort(key=lambda item: item[0])
    return {
        "source": "eigent",
        "run_id": run_id,
        "turns": [
            {
                "role": role,
                "content": redact(_localize(text.strip(), host_paths)),
            }
            for _, role, text in said
            if text.strip()
        ],
    }


def bundle_path(task_path: Path) -> Path:
    return task_path.with_name(task_path.name + _BUNDLE_SUFFIX)


def build_bundle(task_path: Path, conversation: dict) -> HarborTaskBundle:
    """Write the bundle beside the task folder; the same task and
    conversation always make the same bytes."""

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:

        def add(name: str, data: bytes, executable: bool = False) -> None:
            info = zipfile.ZipInfo(name, date_time=(2000, 1, 1, 0, 0, 0))
            info.external_attr = (0o100755 if executable else 0o100644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)

        for path in sorted(task_path.rglob("*")):
            if path.is_file() and not path.is_symlink():
                add(
                    f"task/{path.relative_to(task_path).as_posix()}",
                    path.read_bytes(),
                    os.access(path, os.X_OK),
                )
        add(
            "conversation.json",
            json.dumps(conversation, ensure_ascii=False, indent=2).encode(),
        )
        add(
            "manifest.json",
            json.dumps(
                {
                    "format_version": BUNDLE_FORMAT,
                    "conversation": "conversation.json",
                }
            ).encode(),
        )
    data = buffer.getvalue()
    target = bundle_path(task_path)
    target.write_bytes(data)
    return HarborTaskBundle(
        path=target,
        filename=target.name,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        turns=len(conversation.get("turns", [])),
    )


def saved_bundle(directory_name: str) -> Path:
    """The bundle made for the saved task ``directory_name``, under the Harbor
    tasks folder only."""

    root = harbor_tasks_root().resolve()
    path = (root / (directory_name + _BUNDLE_SUFFIX)).resolve()
    if path.parent != root or not path.is_file():
        raise HarborTaskBundleError(
            "bundle_not_found", "Save the Task for Env Hub again"
        )
    return path


def upload_bundle(
    path: Path,
    *,
    url: str,
    method: str,
    headers: Mapping[str, str],
    transport: httpx.BaseTransport | None = None,
) -> int:
    """Send the bundle to the one-time upload URL Env Hub gave; only HTTPS,
    only PUT, only the headers an upload needs."""

    parts = urlsplit(url)
    local = parts.hostname in {"localhost", "127.0.0.1"}
    if parts.scheme != "https" and not (parts.scheme == "http" and local):
        raise HarborTaskBundleError(
            "upload_url_not_allowed", "The upload URL is not HTTPS"
        )
    if method.upper() != "PUT":
        raise HarborTaskBundleError(
            "upload_method_not_allowed", "Env Hub uploads are PUT requests"
        )
    sent = {
        key: value
        for key, value in headers.items()
        if key.lower() in _UPLOAD_HEADERS or _GOOGLE_HEADER.match(key.lower())
    }
    with httpx.Client(
        timeout=_UPLOAD_TIMEOUT_SEC, transport=transport
    ) as client:
        response = client.put(url, content=path.read_bytes(), headers=sent)
    if response.status_code >= 300:
        raise HarborTaskBundleError(
            "upload_failed",
            f"The upload was refused ({response.status_code})",
        )
    return response.status_code
