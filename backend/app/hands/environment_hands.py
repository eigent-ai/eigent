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

"""
EnvironmentHands — IHands implementation driven by BrainCapabilities.

Brain deployment env determines capability set; all Channels share one instance.
Channel only handles message display format adaptation.
"""

import os
import platform
from pathlib import Path

from app.hands.binding_path_policy import binding_path_refusal
from app.hands.capabilities import BrainCapabilities
from app.hands.interface import IHands
from app.utils.workspace_paths import get_eigent_root


def _app_data_roots(home: Path) -> list[Path]:
    # get_eigent_root() picks ~/eigent when it exists, else ~/.eigent, so
    # either folder can hold the journal and per-Run runtime storage.
    roots: list[Path] = []
    for candidate in (home / "eigent", home / ".eigent", get_eigent_root()):
        try:
            resolved = candidate.expanduser().resolve()
        except (OSError, RuntimeError):
            continue
        if resolved not in roots:
            roots.append(resolved)
    return roots


class EnvironmentHands(IHands):
    """
    IHands implementation based on BrainCapabilities.
    Initialized at Brain startup from deployment env; globally reused.
    """

    def __init__(self, caps: BrainCapabilities) -> None:
        self._caps = caps
        self.workspace_root = Path(caps.workspace_root).expanduser()

    @property
    def mode(self) -> str:
        """Capability tier: full | sandbox"""
        return self._caps.mode

    def can_execute_terminal(self) -> bool:
        return self._caps.has_terminal

    def can_access_filesystem(self, path: str) -> bool:
        if self._caps.filesystem_scope == "full":
            try:
                Path(path).expanduser().resolve()
                return True
            except (OSError, RuntimeError):
                return False
        if self._caps.filesystem_scope == "workspace_only":
            try:
                resolved = Path(path).expanduser().resolve()
                workspace = self.workspace_root.resolve()
                resolved.relative_to(workspace)
                return True
            except ValueError:
                return False
            except (OSError, RuntimeError):
                return False
        return False  # none

    def validate_workspace_binding_path(
        self, path: str
    ) -> tuple[bool, str | None]:
        """Check a folder the user picked as a Space's workspace root."""
        if not self.can_access_filesystem(path):
            return False, "filesystem_capability_denied"
        try:
            resolved = Path(path).expanduser().resolve()
        except (OSError, RuntimeError):
            return False, "path_resolve_failed"
        if not resolved.is_dir():
            return False, "path_not_directory"
        try:
            home = Path.home().resolve()
        except (OSError, RuntimeError):
            return False, "home_resolve_failed"
        reason = binding_path_refusal(
            resolved,
            home=home,
            system=platform.system(),
            environ=os.environ,
            app_data_roots=_app_data_roots(home),
        )
        if reason is not None:
            return False, reason
        return True, None

    def validate_agent_plugin_source_path(
        self, path: str
    ) -> tuple[bool, str | None]:
        """Check a folder or archive the user picked to import a plugin from.

        Full filesystem scope reaches every drive, so the locations a Space
        may never use are refused here as well. Eigent's own data folder
        stays allowed: an import only reads its source.
        """
        if not self.can_access_filesystem(path):
            return False, "filesystem_capability_denied"
        try:
            resolved = Path(path).expanduser().resolve()
        except (OSError, RuntimeError):
            return False, "path_resolve_failed"
        try:
            home = Path.home().resolve()
        except (OSError, RuntimeError):
            return False, "home_resolve_failed"
        reason = binding_path_refusal(
            resolved,
            home=home,
            system=platform.system(),
            environ=os.environ,
        )
        if reason is not None:
            return False, reason
        return True, None

    def can_use_mcp(self, mcp_name: str) -> bool:
        if self._caps.mcp_mode == "all":
            return True
        return mcp_name in self._caps.mcp_allowlist

    def can_use_browser(self) -> bool:
        return self._caps.has_browser

    def get_working_directory(
        self, session_id: str, tenant_id: str = "default"
    ) -> str:
        return str(self.workspace_root / session_id)

    def get_capability_manifest(self) -> dict[str, str | bool | list[str]]:
        return {
            "mode": self.mode,
            "terminal": self._caps.has_terminal,
            "browser": self._caps.has_browser,
            "filesystem": self._caps.filesystem_scope,
            "mcp": self._caps.mcp_mode,
            "mcp_allowlist": list(self._caps.mcp_allowlist),
            "deployment": self._caps.deployment_type,
            "workspace_root": str(self.workspace_root),
        }

    def acquire_resource(
        self, resource_type: str, session_id: str, **kwargs
    ) -> str:
        if resource_type == "browser":
            port = kwargs.get("port", 9222)
            return f"http://localhost:{port}"
        raise ValueError(f"Unknown resource type: {resource_type}")

    def release_resource(self, resource_type: str, session_id: str) -> None:
        return None
