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

from pathlib import Path

from app.file_access.interface import IFileAccess


class LocalFileAccess(IFileAccess):
    """Direct local filesystem access (Desktop/CLI)"""

    def __init__(self, workspace_root: str = "~/.eigent/workspace") -> None:
        self.workspace_root = Path(workspace_root).expanduser()

    def read_file(self, path: str) -> str:
        return Path(path).read_text(encoding="utf-8")

    def read_file_binary(self, path: str) -> bytes:
        return Path(path).read_bytes()

    def write_file(self, path: str, content: str | bytes) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, str):
            p.write_text(content, encoding="utf-8")
        else:
            p.write_bytes(content)

    def exists(self, path: str) -> bool:
        return Path(path).exists()

    def list_dir(self, path: str) -> list[str]:
        return [p.name for p in Path(path).iterdir()]

    def get_working_directory(self, session_id: str) -> str:
        return str(self.workspace_root / session_id)

    def resolve_path(self, path_or_id: str, session_id: str) -> str:
        if path_or_id.startswith("upload://"):
            return self._resolve_upload_id(path_or_id, session_id)
        return path_or_id

    def _resolve_upload_id(self, path_or_id: str, session_id: str) -> str:
        """Resolve upload://xxx to workspace/{session_id}/uploads/xxx"""
        file_id = path_or_id.removeprefix("upload://")
        return str(self.workspace_root / session_id / "uploads" / file_id)
