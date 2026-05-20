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
import unicodedata
from pathlib import Path

from app.utils.server.session import SessionIdError, get_session_uploads_dir
from app.utils.workspace_paths import get_workspace_root


class UploadIdError(Exception):
    pass


def _is_safe_stored_name(name: str) -> bool:
    if not name:
        return False
    if "/" in name or "\\" in name:
        return False
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in name):
        return False
    if name in {".", ".."}:
        return False
    if name.startswith(".."):
        return False
    if unicodedata.normalize("NFKC", name) != name:
        return False
    return True


def resolve_user_upload(upload_id: str, session_id: str) -> tuple[Path, str]:
    if not upload_id.startswith("upload://"):
        raise UploadIdError(f"invalid_prefix:{upload_id!r}")

    stored_name = upload_id[len("upload://") :]
    if not _is_safe_stored_name(stored_name):
        raise UploadIdError(f"invalid_stored_name:{stored_name!r}")
    if stored_name.endswith(".meta.json"):
        raise UploadIdError(f"sidecar_not_uploadable:{stored_name!r}")

    try:
        uploads_dir = get_session_uploads_dir(session_id, get_workspace_root())
    except SessionIdError as exc:
        raise UploadIdError(f"session_id_invalid:{exc}") from exc

    abs_path = (uploads_dir / stored_name).resolve()
    try:
        abs_path.relative_to(uploads_dir)
    except ValueError as exc:
        raise UploadIdError(f"escapes_uploads_dir:{stored_name!r}") from exc

    original = stored_name
    meta_path = uploads_dir / f"{stored_name}.meta.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            original = meta.get("original_filename") or stored_name
        except Exception:
            original = stored_name
    return abs_path, original
