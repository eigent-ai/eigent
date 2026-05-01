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

from abc import ABC, abstractmethod
from typing import Any


class IHands(ABC):
    """
    Brain capability interface — what the Brain can operate (Hand Types).

    mode: full | sandbox (capability tier)
    can_*: whether each Hand Type is available
    """

    @property
    @abstractmethod
    def mode(self) -> str:
        """Capability tier: full | sandbox"""
        pass

    @abstractmethod
    def can_execute_terminal(self) -> bool:
        """terminal hand: can execute shell"""
        pass

    @abstractmethod
    def can_access_filesystem(self, path: str) -> bool:
        """filesystem hand: whether path is within accessible scope"""
        pass

    @abstractmethod
    def can_use_mcp(self, mcp_name: str) -> bool:
        """mcp hand: whether this MCP is available"""
        pass

    @abstractmethod
    def can_use_browser(self) -> bool:
        """browser hand: can control CDP browser"""
        pass

    @abstractmethod
    def get_working_directory(
        self, session_id: str, tenant_id: str = "default"
    ) -> str:
        """Return session working directory"""
        pass

    @abstractmethod
    def get_capability_manifest(self) -> dict[str, Any]:
        """Return a serializable capability manifest for clients."""
        pass

    @abstractmethod
    def acquire_resource(
        self, resource_type: str, session_id: str, **kwargs
    ) -> str:
        """Acquire a resource endpoint for the requested hand type."""
        pass

    @abstractmethod
    def release_resource(self, resource_type: str, session_id: str) -> None:
        """Release a previously acquired resource."""
        pass
