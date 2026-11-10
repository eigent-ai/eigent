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

    def is_operational(self, relative_path: str) -> bool:
        if relative_path.endswith("/"):
            relative_path += "__entry__"
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
