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

import platform
from pathlib import Path

from app.hands.capabilities import BrainCapabilities
from app.hands.interface import IHands


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
        if not self.can_access_filesystem(path):
            return False, "filesystem_capability_denied"
        try:
            resolved = Path(path).expanduser().resolve()
        except (OSError, RuntimeError):
            return False, "path_resolve_failed"
        if not resolved.exists():
            return False, "path_not_found"
        if not resolved.is_dir():
            return False, "path_not_directory"
        try:
            if resolved == Path.home().resolve():
                return False, "home_root_forbidden"
        except (OSError, RuntimeError):
            return False, "home_resolve_failed"
        for sensitive in self._sensitive_prefixes():
            try:
                resolved.relative_to(sensitive.resolve())
                return False, f"sensitive_path:{sensitive}"
            except ValueError:
                continue
            except (OSError, RuntimeError):
                continue
        if self._caps.filesystem_scope == "workspace_only":
            try:
                resolved.relative_to(self.workspace_root.resolve())
            except ValueError:
                return False, "workspace_scope_denied"
        return True, None

    def _sensitive_prefixes(self) -> list[Path]:
        prefixes = [
            Path("~/.ssh").expanduser(),
            Path("~/.aws").expanduser(),
            Path("~/.config/gh").expanduser(),
            Path("~/.gnupg").expanduser(),
        ]
        system = platform.system()
        if system == "Darwin":
            prefixes.extend(
                [
                    Path("~/Library/Keychains").expanduser(),
                    Path(
                        "~/Library/Application Support/com.apple.TCC"
                    ).expanduser(),
                    Path("/etc"),
                    Path("/System"),
                    Path("/private"),
                    Path("/var"),
                    Path("/Library"),
                ]
            )
        elif system == "Linux":
            prefixes.extend(
                [
                    Path("/etc"),
                    Path("/var"),
                    Path("/sys"),
                    Path("/proc"),
                    Path("/boot"),
                    Path("/root"),
                ]
            )
        elif system == "Windows":
            import os

            for raw in (
                r"C:\Windows",
                r"C:\Program Files",
                r"C:\Program Files (x86)",
                r"%APPDATA%\Microsoft\Credentials",
                r"%LOCALAPPDATA%\Microsoft\Credentials",
            ):
                prefixes.append(Path(os.path.expandvars(raw)))
        return prefixes

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
