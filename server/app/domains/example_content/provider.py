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

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx

from app.domains.example_content.schema import ProviderCatalog, ProviderPolicy


class ProviderUnavailable(RuntimeError):
    """Raised when a provider cannot return an authoritative catalog."""


@dataclass(frozen=True)
class ProviderContext:
    scope_key: str


class ExampleContentProvider(Protocol):
    @property
    def provider_key(self) -> str: ...

    async def load_catalog(self, context: ProviderContext) -> ProviderCatalog: ...


@dataclass(frozen=True)
class ProviderRegistration:
    provider: ExampleContentProvider
    precedence: int = 0


@dataclass(frozen=True)
class ProviderSet:
    registrations: tuple[ProviderRegistration, ...]
    policy: ProviderPolicy
    configuration_revision: str


class ExampleContentProviderRegistry(Protocol):
    async def provider_set(self, context: ProviderContext) -> ProviderSet: ...


class StaticProviderRegistry:
    """Default registry; replace it to resolve account or organisation sources."""

    def __init__(
        self,
        registrations: list[ProviderRegistration],
        *,
        policy: ProviderPolicy,
        configuration_revision: str = "default",
    ):
        self._selection = ProviderSet(
            registrations=tuple(registrations),
            policy=policy,
            configuration_revision=configuration_revision,
        )

    async def provider_set(self, context: ProviderContext) -> ProviderSet:
        del context
        return self._selection


class HttpCatalogProvider:
    """Loads one normalized catalog; source details stay behind this adapter."""

    def __init__(
        self,
        *,
        provider_key: str,
        catalog_url: str | None,
        timeout_seconds: float = 5.0,
        bearer_token: str | None = None,
    ):
        self._provider_key = provider_key
        self._catalog_url = catalog_url
        self._timeout_seconds = timeout_seconds
        self._bearer_token = bearer_token

    @property
    def provider_key(self) -> str:
        return self._provider_key

    async def load_catalog(self, context: ProviderContext) -> ProviderCatalog:
        del context  # The public default catalog is not account-specific.
        if not self._catalog_url:
            raise ProviderUnavailable("catalog URL is not configured")
        headers = {"Accept": "application/json"}
        if self._bearer_token:
            headers["Authorization"] = f"Bearer {self._bearer_token}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout_seconds, follow_redirects=True) as client:
                response = await client.get(self._catalog_url, headers=headers)
                response.raise_for_status()
                catalog = ProviderCatalog.model_validate(response.json())
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderUnavailable("example content provider request failed") from exc
        if catalog.provider_key != self._provider_key:
            raise ProviderUnavailable("example content provider identity mismatch")
        return catalog
