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

import asyncio
import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.domains.example_content.provider import (
    ExampleContentProviderRegistry,
    ProviderContext,
    ProviderRegistration,
    ProviderUnavailable,
    StaticProviderRegistry,
)
from app.domains.example_content.schema import (
    DeliveryKind,
    ExampleOptionsResponse,
    ExampleRecommendationsResponse,
    ExampleSurface,
    LocalizedCategory,
    LocalizedExample,
    ProviderCatalog,
    ProviderCategory,
    ProviderExample,
    ProviderPolicy,
    ResolvedAutomationDefaults,
    ResolvedCategory,
    ResolvedExample,
)


@dataclass
class _CacheEntry:
    catalog: ProviderCatalog
    loaded_at: datetime


@dataclass(frozen=True)
class _ResolvedCatalog:
    catalog: ProviderCatalog
    precedence: int
    delivery: DeliveryKind
    expires_at: datetime | None
    configuration_revision: str


class CategoryDefinitionConflict(ValueError):
    """The same stored key was assigned incompatible provider meanings."""


class ExampleContentResolver:
    def __init__(
        self,
        registrations: list[ProviderRegistration] | None = None,
        *,
        registry: ExampleContentProviderRegistry | None = None,
        policy: ProviderPolicy = "augment",
        bundled_fallback: ProviderCatalog | None = None,
        enabled: bool = True,
        refresh_after: timedelta = timedelta(minutes=5),
        maximum_age: timedelta = timedelta(hours=24),
        provider_timeout_seconds: float = 5.0,
        now: Callable[[], datetime] | None = None,
    ):
        if (registrations is None) == (registry is None):
            raise ValueError("provide either registrations or a provider registry")
        self._registry = registry or StaticProviderRegistry(
            registrations or [],
            policy="replace" if policy == "replace" else "augment",
        )
        self._bundled_fallback = bundled_fallback
        self._enabled = enabled
        self._refresh_after = refresh_after
        self._maximum_age = maximum_age
        self._provider_timeout_seconds = provider_timeout_seconds
        self._now = now or (lambda: datetime.now(UTC))
        self._cache: dict[tuple[str, str, str], _CacheEntry] = {}
        self._locks: dict[tuple[str, str, str], asyncio.Lock] = {}

    async def get_options(self, *, scope_key: str, locale: str) -> ExampleOptionsResponse:
        catalogs, status, delivery, expires_at = await self._resolve_catalogs(scope_key)
        if status != "ready":
            return ExampleOptionsResponse(
                content_revision=self._revision(catalogs, status),
                status=status,
                delivery=delivery,
                expires_at=expires_at,
                space_categories=[],
            )

        categories = self._merge_categories(catalogs, locale)
        return ExampleOptionsResponse(
            content_revision=self._revision(catalogs, status),
            status="ready",
            delivery=delivery,
            expires_at=expires_at,
            space_categories=categories,
        )

    async def get_recommendations(
        self,
        *,
        scope_key: str,
        surface: ExampleSurface,
        role_key: str | None,
        space_category_key: str | None,
        locale: str,
        limit: int,
    ) -> ExampleRecommendationsResponse:
        catalogs, status, delivery, expires_at = await self._resolve_catalogs(scope_key)
        revision = self._revision(catalogs, status)
        if status != "ready":
            return ExampleRecommendationsResponse(
                content_revision=revision,
                status=status,
                delivery=delivery,
                expires_at=expires_at,
                items=[],
            )

        candidates: list[tuple[int, int, int, str, ProviderExample, str]] = []
        for resolved in catalogs:
            if not resolved.catalog.enabled:
                continue
            for item in resolved.catalog.items:
                if not item.enabled or surface not in item.surfaces:
                    continue
                tier = self._matching_tier(item, role_key, space_category_key)
                if tier is None:
                    continue
                reference = self._example_reference(resolved.catalog.provider_key, item.id)
                candidates.append(
                    (tier, -resolved.precedence, -item.priority, reference, item, resolved.catalog.provider_key)
                )

        candidates.sort(key=lambda value: value[:4])
        seen: set[str] = set()
        items: list[ResolvedExample] = []
        for _, _, _, reference, item, _provider_key in candidates:
            if reference in seen:
                continue
            seen.add(reference)
            translation_locale, translation = self._translation(item.translations, locale)
            automation_defaults = None
            if translation.automation_name or translation.automation_description:
                automation_defaults = ResolvedAutomationDefaults(
                    name=translation.automation_name,
                    description=translation.automation_description,
                )
            items.append(
                ResolvedExample(
                    example_ref=reference,
                    title=translation.title,
                    summary=translation.summary,
                    prompt=translation.prompt,
                    resolved_locale=translation_locale,
                    attribution=item.attribution,
                    learn_more_url=item.learn_more_url,
                    automation_defaults=automation_defaults,
                    requirements=item.requirements,
                )
            )
            if len(items) == limit:
                break

        return ExampleRecommendationsResponse(
            content_revision=revision,
            status="ready",
            delivery=delivery,
            expires_at=expires_at,
            items=items,
        )

    async def _resolve_catalogs(
        self, scope_key: str
    ) -> tuple[list[_ResolvedCatalog], str, DeliveryKind, datetime | None]:
        if not self._enabled:
            return [], "disabled", "none", None

        try:
            provider_set = await self._registry.provider_set(ProviderContext(scope_key=scope_key))
        except ProviderUnavailable:
            if self._bundled_fallback is None:
                return [], "unavailable", "none", None
            fallback = _ResolvedCatalog(
                catalog=self._bundled_fallback,
                precedence=-10_000,
                delivery="bundled",
                expires_at=self._now() + self._refresh_after,
                configuration_revision="registry-unavailable",
            )
            return [fallback], "ready", "bundled", fallback.expires_at

        registrations = sorted(
            provider_set.registrations,
            key=lambda value: value.precedence,
            reverse=True,
        )
        if provider_set.policy == "replace":
            registrations = registrations[:1]
        results: list[_ResolvedCatalog] = []
        had_failure = False
        for registration in registrations:
            try:
                results.append(
                    await self._load_registration(
                        registration,
                        scope_key,
                        provider_set.configuration_revision,
                    )
                )
            except ProviderUnavailable:
                had_failure = True

        enabled_results = [result for result in results if result.catalog.enabled]
        if enabled_results:
            delivery = self._combined_delivery(enabled_results)
            expires_at = self._minimum_expiry(enabled_results)
            return enabled_results, "ready", delivery, expires_at

        # A successful disabled response is authoritative. It suppresses cached
        # or bundled content and remains sticky through later transport errors.
        if results:
            delivery = self._combined_delivery(results)
            return results, "disabled", delivery, self._minimum_expiry(results)

        if had_failure and self._bundled_fallback is not None:
            fallback = _ResolvedCatalog(
                catalog=self._bundled_fallback,
                precedence=-10_000,
                delivery="bundled",
                expires_at=self._now() + self._refresh_after,
                configuration_revision=provider_set.configuration_revision,
            )
            return [fallback], "ready", "bundled", fallback.expires_at

        return [], "unavailable", "none", None

    async def _load_registration(
        self,
        registration: ProviderRegistration,
        scope_key: str,
        configuration_revision: str,
    ) -> _ResolvedCatalog:
        key = (scope_key, configuration_revision, registration.provider.provider_key)
        now = self._now()
        cached = self._cache.get(key)
        if cached and now - cached.loaded_at < self._refresh_after:
            return self._resolved_from_cache(cached, registration.precedence, configuration_revision, now)

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            now = self._now()
            cached = self._cache.get(key)
            if cached and now - cached.loaded_at < self._refresh_after:
                return self._resolved_from_cache(cached, registration.precedence, configuration_revision, now)
            try:
                catalog = await asyncio.wait_for(
                    registration.provider.load_catalog(ProviderContext(scope_key=scope_key)),
                    timeout=self._provider_timeout_seconds,
                )
            except TimeoutError as exc:
                if cached and not cached.catalog.enabled:
                    return self._resolved_from_cache(cached, registration.precedence, configuration_revision, now)
                if cached and now - cached.loaded_at <= self._maximum_age:
                    return self._resolved_from_cache(cached, registration.precedence, configuration_revision, now)
                raise ProviderUnavailable("example content provider timed out") from exc
            except ProviderUnavailable:
                if cached and not cached.catalog.enabled:
                    return self._resolved_from_cache(cached, registration.precedence, configuration_revision, now)
                if cached and now - cached.loaded_at <= self._maximum_age:
                    return self._resolved_from_cache(cached, registration.precedence, configuration_revision, now)
                raise
            entry = _CacheEntry(catalog=catalog, loaded_at=now)
            self._cache[key] = entry
            return _ResolvedCatalog(
                catalog=catalog,
                precedence=registration.precedence,
                delivery="live",
                expires_at=None if not catalog.enabled else now + self._maximum_age,
                configuration_revision=configuration_revision,
            )

    def _resolved_from_cache(
        self,
        cached: _CacheEntry,
        precedence: int,
        configuration_revision: str,
        now: datetime,
    ) -> _ResolvedCatalog:
        if cached.catalog.enabled and now - cached.loaded_at > self._maximum_age:
            raise ProviderUnavailable("cached example content expired")
        return _ResolvedCatalog(
            catalog=cached.catalog,
            precedence=precedence,
            delivery="cache",
            expires_at=None if not cached.catalog.enabled else cached.loaded_at + self._maximum_age,
            configuration_revision=configuration_revision,
        )

    def _merge_categories(self, catalogs: list[_ResolvedCatalog], locale: str) -> list[ResolvedCategory]:
        merged: dict[str, tuple[str, ProviderCategory]] = {}
        for resolved in sorted(catalogs, key=lambda value: value.precedence, reverse=True):
            for category in resolved.catalog.space_categories:
                definition = category.definition_key or category.key
                existing = merged.get(category.key)
                if existing and existing[0] != definition:
                    raise CategoryDefinitionConflict(f"category {category.key!r} has incompatible provider definitions")
                if existing is None:
                    merged[category.key] = (definition, category)

        output: list[ResolvedCategory] = []
        for key, (_, category) in merged.items():
            if not category.enabled:
                continue
            resolved_locale, translation = self._translation(category.translations, locale)
            output.append(
                ResolvedCategory(
                    key=key,
                    label=translation.label,
                    description=translation.description,
                    sort_order=category.sort_order,
                    resolved_locale=resolved_locale,
                )
            )
        return sorted(output, key=lambda category: (category.sort_order, category.label.casefold(), category.key))

    @staticmethod
    def _matching_tier(item: ProviderExample, role_key: str | None, space_category_key: str | None) -> int | None:
        role_wildcard = item.role_keys == ["*"]
        category_wildcard = item.space_category_keys == ["*"]
        role_exact = role_key is not None and role_key in item.role_keys
        category_exact = space_category_key is not None and space_category_key in item.space_category_keys
        if role_exact and category_exact:
            return 1
        if role_wildcard and category_exact:
            return 2
        if role_exact and category_wildcard:
            return 3
        if role_wildcard and category_wildcard:
            return 4
        return None

    @staticmethod
    def _translation(translations: dict[str, LocalizedCategory] | dict[str, LocalizedExample], locale: str):
        normalized = {key.casefold(): key for key in translations}
        candidates = [locale, locale.split("-", 1)[0], "en-US", "en"]
        for candidate in candidates:
            original = normalized.get(candidate.casefold())
            if original is not None:
                return original, translations[original]
        fallback = sorted(translations)[0]
        return fallback, translations[fallback]

    @staticmethod
    def _example_reference(provider_key: str, item_id: str) -> str:
        digest = hashlib.sha256(f"{provider_key}\0{item_id}".encode()).hexdigest()[:24]
        return f"example_{digest}"

    @staticmethod
    def _combined_delivery(catalogs: list[_ResolvedCatalog]) -> DeliveryKind:
        deliveries = {catalog.delivery for catalog in catalogs}
        if "live" in deliveries:
            return "live"
        if "cache" in deliveries:
            return "cache"
        if "bundled" in deliveries:
            return "bundled"
        return "none"

    @staticmethod
    def _minimum_expiry(catalogs: list[_ResolvedCatalog]) -> datetime | None:
        expiries = [catalog.expires_at for catalog in catalogs if catalog.expires_at is not None]
        return min(expiries) if expiries else None

    @staticmethod
    def _revision(catalogs: list[_ResolvedCatalog], status: str) -> str:
        material = [status]
        material.extend(sorted({catalog.configuration_revision for catalog in catalogs}))
        material.extend(
            f"{catalog.catalog.provider_key}:{catalog.catalog.provider_version}:{int(catalog.catalog.enabled)}"
            for catalog in sorted(catalogs, key=lambda value: value.catalog.provider_key)
        )
        return hashlib.sha256("|".join(material).encode()).hexdigest()[:24]
