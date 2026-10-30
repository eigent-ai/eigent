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


class IHandsCluster(ABC):
    """Remote Hands worker cluster interface placeholder."""

    @abstractmethod
    async def acquire(
        self,
        resource_type: str,
        session_id: str,
        tenant_id: str = "default",
        **kwargs,
    ) -> dict[str, Any]:
        """Acquire a worker resource and return its endpoint metadata."""
        ...

    @abstractmethod
    async def release(self, session_id: str) -> None:
        """Release the worker resource bound to the session."""
        ...

    @abstractmethod
    async def health(self) -> dict[str, Any]:
        """Return cluster health and pool availability."""
        ...
