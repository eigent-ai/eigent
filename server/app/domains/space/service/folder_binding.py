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

import os
from pathlib import Path
from typing import Any


def normalize_folder_root_reference(root_path: str) -> str:
    """Normalize a folder reference without touching the local filesystem.

    Space is a cloud-owned logical layer. A folder root may live on the user's
    desktop Brain, a Docker host, or a future cloud workspace, so the server
    must not require the path to exist in its own filesystem namespace during
    Space creation. Local readability is validated by the environment-specific
    Brain binding path.

    Normalization is intentionally string-only: collapse "./" / "//" / trailing
    separators via os.path.normpath, but never expand "~", resolve symlinks, or
    stat the path. That keeps "/Users/alice/./repo" and "/Users/alice/repo/"
    deduplicated without leaking the server's filesystem state.
    """

    value = str(root_path or "").strip()
    if not value:
        raise ValueError("Folder Space requires root_path")
    if "\x00" in value:
        raise ValueError("Space root_path contains an invalid character")
    normalized = os.path.normpath(value)
    if normalized in {"", "."}:
        raise ValueError("Folder Space requires root_path")
    return normalized.rstrip("/\\") or normalized


def resolve_folder_root(root_path: str) -> Path:
    try:
        resolved = Path(root_path).expanduser().resolve()
    except (OSError, RuntimeError) as exc:
        raise ValueError("Space root_path cannot be resolved") from exc
    if not resolved.exists() or not resolved.is_dir():
        raise ValueError("Space root_path must be an existing directory")
    return resolved


def folder_fingerprint(root: Path) -> dict[str, Any]:
    stat = root.stat()
    return {
        "kind": "local_folder",
        "path": str(root),
        "device": stat.st_dev,
        "inode": stat.st_ino,
        "mtime_ns": stat.st_mtime_ns,
        "ctime_ns": stat.st_ctime_ns,
    }


def same_folder_reference(left: str, right: str) -> bool:
    try:
        return normalize_folder_root_reference(left) == normalize_folder_root_reference(
            right
        )
    except ValueError:
        return False


def same_folder_path(left: str, right: str) -> bool:
    try:
        return (
            Path(left).expanduser().resolve()
            == Path(right).expanduser().resolve()
        )
    except (OSError, RuntimeError):
        return False
