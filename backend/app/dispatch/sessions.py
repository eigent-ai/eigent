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
"""Records of the Sessions (Projects) the Brain started itself.

A Session started from Desktop is described by the renderer on every request.
One started through ``/v1/tasks`` has no renderer, so the Brain keeps what it
needs to start the next Task in it, including after a restart: the Space, its
folder and the Session mode. No credentials are stored here.

The record also marks ownership. The Brain dispatches queued follow-ups only
for Sessions that have one; every other Session is left to the renderer.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path

logger = logging.getLogger("dispatch.sessions")

RECORD_VERSION = 1
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def is_safe_id(value: str) -> bool:
    """IDs become file names and URL segments."""

    return bool(_SAFE_ID.match(value)) and ".." not in value


@dataclass(frozen=True)
class DispatchSession:
    project_id: str
    space_id: str
    space_root_path: str
    session_mode: str
    email: str
    model_type: str | None = None
    language: str = "en"
    timezone: str | None = None
    created_at: float = 0.0
    version: int = RECORD_VERSION


def sessions_dir() -> Path:
    return Path.home() / ".eigent" / "dispatch" / "sessions"


def _path(project_id: str) -> Path:
    if not is_safe_id(project_id):
        raise ValueError("invalid Session id")
    return sessions_dir() / f"{project_id}.json"


def load_session(project_id: str) -> DispatchSession | None:
    try:
        path = _path(project_id)
    except ValueError:
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        logger.warning("Unreadable Session record: %s", path)
        return None
    if not isinstance(data, dict) or data.get("project_id") != project_id:
        return None
    known = DispatchSession.__dataclass_fields__
    try:
        return DispatchSession(
            **{key: value for key, value in data.items() if key in known}
        )
    except TypeError:
        logger.warning("Incomplete Session record: %s", path)
        return None


def save_session(session: DispatchSession) -> DispatchSession:
    path = _path(session.project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not session.created_at:
        session = DispatchSession(
            **{**asdict(session), "created_at": time.time()}
        )
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(asdict(session), indent=2), encoding="utf-8")
    os.replace(tmp, path)
    return session


def delete_session(project_id: str) -> None:
    try:
        _path(project_id).unlink()
    except (OSError, ValueError):
        pass
