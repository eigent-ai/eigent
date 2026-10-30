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

"""Path resolution for the local memory tree (§5, §23 of the design doc).

Layout:

    ~/.eigent/memory/
      users/{canonical_user_id}/
        spaces/{space_id}/
          projects/{project_id}/
            runs/{run_id}/

`canonical_user_id` must match the on-disk owner key used by
`Chat.file_save_path`, otherwise memory and artifacts would land under
different roots for the same user. The helper here intentionally mirrors that
derivation rule and is the single place to change if the owner-key policy
changes.
"""

from __future__ import annotations

import re
from pathlib import Path


def memory_root() -> Path:
    """Top-level memory directory. Not created on import (lazy)."""

    return Path.home() / ".eigent" / "memory"


def canonical_user_id(
    user_id: str | int | None,
    email: str | None = None,
) -> str:
    """Derive the on-disk owner key for memory files.

    Mirrors `Chat.file_save_path` (backend/app/model/chat.py): prefer
    `user_<id>` when a canonical user id is supplied, otherwise sanitise the
    email local-part the same way file_save_path's legacy fallback does.

    Raises ValueError when both inputs are empty -- callers must surface this
    rather than write under an unowned root.
    """

    if user_id is not None and str(user_id).strip():
        sanitized = re.sub(r'[\\/*?:"<>|\s]', "_", str(user_id)).strip(".")
        if sanitized:
            return f"user_{sanitized}"

    if email and email.strip():
        local_part = email.split("@")[0]
        sanitized = re.sub(r'[\\/*?:"<>|\s]', "_", local_part).strip(".")
        if sanitized:
            return sanitized

    raise ValueError("canonical_user_id requires non-empty user_id or email")


def user_dir(user_key: str, root: Path | None = None) -> Path:
    return (root or memory_root()) / "users" / user_key


def space_dir(user_key: str, space_id: str, root: Path | None = None) -> Path:
    return user_dir(user_key, root) / "spaces" / space_id


def project_dir(
    user_key: str,
    space_id: str,
    project_id: str,
    root: Path | None = None,
) -> Path:
    return space_dir(user_key, space_id, root) / "projects" / project_id


def run_dir(
    user_key: str,
    space_id: str,
    project_id: str,
    run_id: str,
    root: Path | None = None,
) -> Path:
    return project_dir(user_key, space_id, project_id, root) / "runs" / run_id
