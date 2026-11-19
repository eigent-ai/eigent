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
"""Write a meeting note into a Space folder without overwriting edits."""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path, PurePosixPath

from app.utils.workspace_resolver import _filesystem_space_lock


class MeetingCopyPathError(ValueError):
    """The copy's path would leave the Space folder."""


class MeetingCopyConflictError(Exception):
    """The Space file changed since Eigent wrote it, or is not Eigent's."""

    def __init__(self, relative_path: str, reason: str) -> None:
        super().__init__(f"{relative_path}: {reason}")
        self.relative_path = relative_path
        self.reason = reason


def content_digest(content: str | bytes) -> str:
    data = content.encode("utf-8") if isinstance(content, str) else content
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _target(space_root: Path, relative_path: str) -> tuple[Path, Path]:
    root = space_root.expanduser().resolve()
    relative = PurePosixPath(relative_path)
    if (
        relative.is_absolute()
        or not relative.parts
        or any(part in {"", ".", ".."} for part in relative.parts)
    ):
        raise MeetingCopyPathError(relative_path)
    return root, root.joinpath(*relative.parts)


def write_space_copy(
    space_root: Path,
    relative_path: str,
    content: str,
    *,
    known_digest: str | None,
    overwrite: bool = False,
) -> str:
    """Write ``content`` at ``relative_path`` and return its digest.

    An existing file is replaced only when it is exactly what Eigent wrote
    last time (``known_digest``) or ``overwrite`` is set after the person
    confirmed. A Space file is never replaced silently (plan §4.5).
    """

    root, target = _target(space_root, relative_path)
    digest = content_digest(content)
    with _filesystem_space_lock(root):
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.parent.resolve().is_relative_to(root):
            raise MeetingCopyPathError(relative_path)
        if target.is_symlink():
            raise MeetingCopyPathError(relative_path)
        if target.exists():
            current = content_digest(target.read_bytes())
            if current == digest:
                return digest
            if current != known_digest and not overwrite:
                raise MeetingCopyConflictError(
                    relative_path,
                    "edited" if known_digest else "exists",
                )
        fd, temp_name = tempfile.mkstemp(
            dir=target.parent, prefix=".eigent-meeting-", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(content)
            os.replace(temp_name, target)
        except BaseException:
            Path(temp_name).unlink(missing_ok=True)
            raise
    return digest
