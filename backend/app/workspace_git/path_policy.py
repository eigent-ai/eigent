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

"""Shared checkpoint/Artifact classification. Tracked content always wins.

Only conventional operational directories and identifiable Python environments
are automatic exclusions. Ordinary tools/, frames/, MP4 and blend files are
content, regardless of their size or count. No ignore file is rewritten.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath

OPERATIONAL_DIRECTORIES = frozenset(
    {".venv", "venv", "node_modules", "__pycache__", ".cache"}
)


class WorkspacePathPolicy:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self._venvs: dict[Path, bool] = {}
        from app.recording.runtime import catalog_path
        from app.recording.store import RecordingStore

        path = catalog_path()
        self._recording_catalog = (
            RecordingStore(path) if path.exists() else None
        )

    def is_operational(self, relative_path: str) -> bool:
        if relative_path.endswith("/"):
            relative_path += "__entry__"
        if self._recording_catalog and self._recording_catalog.reserved(
            self.root, relative_path.rstrip("/")
        ):
            return True
        parts = PurePosixPath(relative_path).parts
        if any(part in OPERATIONAL_DIRECTORIES for part in parts[:-1]):
            return True
        for depth in range(1, len(parts)):
            parent = self.root.joinpath(*parts[:depth])
            if parent not in self._venvs:
                marker = parent / "pyvenv.cfg"
                # Never follow a symlink to discover or classify another root.
                self._venvs[parent] = (
                    not any(
                        p.is_symlink()
                        for p in (parent, *parent.parents)
                        if p != self.root and p.is_relative_to(self.root)
                    )
                    and not marker.is_symlink()
                    and marker.is_file()
                )
            if self._venvs[parent]:
                return True
        return False
