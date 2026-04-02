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

# Terminal command allowlist for sandbox
SANDBOX_TERMINAL_ALLOWLIST = frozenset(
    {"ls", "cat", "python", "node", "pwd", "echo"}
)


class SandboxHands(IHands):
    """Limited capabilities: workspace only, MCP allowed, no browser"""

    def __init__(
        self,
        workspace_root: str = "~/.eigent/workspace",
        allowed_mcps: frozenset[str] | None = None,
    ) -> None:
        self.workspace_root = Path(workspace_root).expanduser()
        # None = allow all MCP (default for debug override); frozenset() = allow none
        self.allowed_mcps = allowed_mcps

    @property
    def mode(self) -> str:
        return "sandbox"

    def can_execute_terminal(self) -> bool:
        return (
            True  # Enabled; toolkit layer validates against command allowlist
        )

    def can_access_filesystem(self, path: str) -> bool:
        try:
            resolved = Path(path).expanduser().resolve()
            workspace = self.workspace_root.resolve()
            resolved.relative_to(workspace)
            return True
        except ValueError:
            return False
        except (OSError, RuntimeError):
            return False

    def can_use_mcp(self, mcp_name: str) -> bool:
        if self.allowed_mcps is None:
            return True  # MCP available in all cases
        if not self.allowed_mcps:
            return False
        return mcp_name in self.allowed_mcps

    def can_use_browser(self) -> bool:
        return False  # No browser hand in limited mode

    def get_working_directory(
        self, session_id: str, tenant_id: str = "default"
    ) -> str:
        return str(self.workspace_root / session_id)

    def get_capability_manifest(self) -> dict[str, str | bool | list[str]]:
        return {
            "mode": self.mode,
            "terminal": self.can_execute_terminal(),
            "browser": False,
            "filesystem": "workspace_only",
            "mcp": "all" if self.allowed_mcps is None else "allowlist",
            "mcp_allowlist": []
            if self.allowed_mcps is None
            else list(self.allowed_mcps),
            "deployment": "override_sandbox",
            "workspace_root": str(self.workspace_root),
        }

    def acquire_resource(
        self, resource_type: str, session_id: str, **kwargs
    ) -> str:
        raise ValueError(
            f"Resource type {resource_type!r} is not available in sandbox mode"
        )

    def release_resource(self, resource_type: str, session_id: str) -> None:
        return None
