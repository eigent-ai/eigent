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

import re
from pathlib import Path

SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


class SessionIdError(ValueError):
    pass


def validate_session_id(session_id: str) -> str:
    normalized = (session_id or "").strip()
    if not SESSION_ID_PATTERN.fullmatch(normalized):
        raise SessionIdError("Invalid X-Session-ID")
    return normalized


def get_session_uploads_dir(session_id: str, workspace_root: Path) -> Path:
    root = workspace_root.expanduser().resolve()
    validated = validate_session_id(session_id)
    uploads_dir = (root / validated / "uploads").resolve()
    try:
        uploads_dir.relative_to(root)
    except ValueError as exc:
        raise SessionIdError("Invalid X-Session-ID") from exc
    return uploads_dir
