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


class IAuthProvider(ABC):
    """
    Auth provider interface.

    This round only provides a no-op local implementation (NoneAuth).
    Future modes (API key / JWT / tenant-aware auth) can implement this
    interface without changing router/middleware call sites.
    """

    @abstractmethod
    async def authenticate(self, scope: dict[str, Any]) -> dict[str, str]:
        """
        Authenticate request context.

        Returns:
            {"user_id": "<id>", "tenant_id": "<id>"}
        """
        ...


class NoneAuth(IAuthProvider):
    """
    Local deployment default auth provider.
    Trusts inbound requests and emits a fixed local identity.
    """

    async def authenticate(self, scope: dict[str, Any]) -> dict[str, str]:
        _ = scope
        return {"user_id": "local", "tenant_id": "default"}
