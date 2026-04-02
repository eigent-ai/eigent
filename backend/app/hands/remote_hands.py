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

import asyncio
from pathlib import Path
from typing import Any

from app.hands.cluster_interface import IHandsCluster
from app.hands.interface import IHands


class RemoteHands(IHands):
    """
    Remote/cluster-backed Hands placeholder.

    This class is intentionally minimal for this refactor stage:
    - exposes a concrete IHands implementation for remote cluster mode
    - supports browser resource acquire/release via IHandsCluster when provided
    - keeps safe local fallback endpoint when cluster is not wired yet
    """

    def __init__(
        self,
        cluster: IHandsCluster | None = None,
        workspace_root: str = "~/.eigent/workspace",
    ) -> None:
        self._cluster = cluster
        self.workspace_root = Path(workspace_root).expanduser()
        self._acquired: dict[str, dict[str, Any]] = {}

    @property
    def mode(self) -> str:
        return "full"

    def can_execute_terminal(self) -> bool:
        return True

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
        _ = mcp_name
        return True

    def can_use_browser(self) -> bool:
        return True

    def get_working_directory(
        self, session_id: str, tenant_id: str = "default"
    ) -> str:
        _ = tenant_id
        return str(self.workspace_root / session_id)

    def get_capability_manifest(self) -> dict[str, str | bool | list[str]]:
        return {
            "mode": self.mode,
            "terminal": True,
            "browser": True,
            "filesystem": "workspace_only",
            "mcp": "all",
            "mcp_allowlist": [],
            "deployment": "remote_cluster",
            "workspace_root": str(self.workspace_root),
        }

    def acquire_resource(
        self, resource_type: str, session_id: str, **kwargs
    ) -> str:
        if self._cluster is None:
            if resource_type == "browser":
                port = int(kwargs.get("port", 9222))
                return f"http://localhost:{port}"
            raise ValueError(
                f"Unknown resource type without cluster configured: {resource_type}"
            )

        # IHands interface is sync; bridge to async cluster API here.
        try:
            _ = asyncio.get_running_loop()
        except RuntimeError:
            pass
        else:
            raise RuntimeError(
                "Cannot synchronously acquire remote resource while event loop is running"
            )

        acquired = asyncio.run(
            self._cluster.acquire(
                resource_type=resource_type,
                session_id=session_id,
                **kwargs,
            )
        )
        self._acquired[session_id] = acquired
        endpoint = acquired.get("endpoint")
        if not endpoint:
            raise RuntimeError(
                "Remote cluster acquire() did not return endpoint"
            )
        return str(endpoint)

    def release_resource(self, resource_type: str, session_id: str) -> None:
        _ = resource_type
        self._acquired.pop(session_id, None)
        if self._cluster is None:
            return

        # Best-effort release for sync interface.
        try:
            asyncio.run(self._cluster.release(session_id))
        except RuntimeError:
            # If called from a running loop, schedule best-effort release.
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._cluster.release(session_id))
            except RuntimeError:
                return
