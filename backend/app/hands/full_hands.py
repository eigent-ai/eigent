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

from app.hands.interface import IHands


class FullHands(IHands):
    """Full capabilities: terminal, filesystem, browser, MCP all available"""

    def __init__(self, workspace_root: str = "~/.eigent/workspace") -> None:
        self.workspace_root = Path(workspace_root).expanduser()

    @property
    def mode(self) -> str:
        return "full"

    def can_execute_terminal(self) -> bool:
        return True

    def can_access_filesystem(self, path: str) -> bool:
        # Allow ~/ and workspace
        try:
            resolved = Path(path).expanduser().resolve()
            home = Path.home()
            workspace = self.workspace_root.resolve()
            try:
                resolved.relative_to(home)
                return True
            except ValueError:
                pass
            try:
                resolved.relative_to(workspace)
                return True
            except ValueError:
                return False
        except (OSError, RuntimeError):
            return False

    def can_use_mcp(self, mcp_name: str) -> bool:
        return True

    def can_use_browser(self) -> bool:
        return True

    def get_working_directory(
        self, session_id: str, tenant_id: str = "default"
    ) -> str:
        return str(self.workspace_root / session_id)

    def get_capability_manifest(self) -> dict[str, str | bool | list[str]]:
        return {
            "mode": self.mode,
            "terminal": True,
            "browser": True,
            "filesystem": "full",
            "mcp": "all",
            "mcp_allowlist": [],
            "deployment": "override_full",
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
