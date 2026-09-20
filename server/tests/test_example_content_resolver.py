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
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.domains.example_content.bundled import bundled_catalog
from app.domains.example_content.provider import ProviderContext, ProviderSet, ProviderUnavailable
from app.domains.example_content.resolver import (
    CategoryDefinitionConflict,
    ExampleContentResolver,
    ProviderRegistration,
)
from app.domains.example_content.schema import ProviderCatalog


def _item(
    item_id: str,
    *,
    roles: list[str],
    categories: list[str],
    priority: int = 0,
    title: str | None = None,
):
    return {
        "id": item_id,
        "surfaces": ["workspace", "automation"],
        "role_keys": roles,
        "space_category_keys": categories,
        "priority": priority,
        "translations": {
            "en": {
                "title": title or item_id,
                "summary": f"Summary for {item_id}",
                "prompt": f"Prompt for {item_id}",
            }
        },
    }


def _catalog(
    provider_key: str = "provider-one",
    *,
    version: str = "1",
    enabled: bool = True,
    items: list[dict] | None = None,
    definition_key: str = "shared-meaning",
):
    return ProviderCatalog.model_validate(
        {
            "schema_version": 1,
            "provider_key": provider_key,
            "provider_version": version,
            "enabled": enabled,
            "space_categories": [
                {
                    "key": "finance",
                    "enabled": True,
                    "sort_order": 10,
                    "definition_key": definition_key,
                    "translations": {
                        "en": {"label": "Finance"},
                        "fr": {"label": "Finance FR"},
                    },
                }
            ],
            "items": items or [],
        }
    )


class _Provider:
    def __init__(self, key: str, responses):
        self._key = key
        self.responses = list(responses)
        self.calls = 0

    @property
    def provider_key(self):
        return self._key

    async def load_catalog(self, context: ProviderContext):
        assert context.scope_key
        self.calls += 1
        response = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if isinstance(response, Exception):
            raise response
        return response


class _Clock:
    def __init__(self):
        self.value = datetime(2026, 9, 20, tzinfo=UTC)

    def __call__(self):
        return self.value

    def advance(self, delta: timedelta):
        self.value += delta


class _ScopeRegistry:
    def __init__(self, selections: dict[str, ProviderSet]):
        self.selections = selections

    async def provider_set(self, context: ProviderContext):
        return self.selections[context.scope_key]


class _SlowProvider:
    provider_key = "slow-provider"

    async def load_catalog(self, context: ProviderContext):
        del context
        await asyncio.sleep(0.05)
        return _catalog("slow-provider")


@pytest.mark.asyncio
async def test_matching_uses_category_first_fallback_tiers_and_priority():
    catalog = _catalog(
        items=[
            _item("wildcard", roles=["*"], categories=["*"], priority=999),
            _item("role", roles=["engineering"], categories=["*"], priority=10),
            _item("category", roles=["*"], categories=["finance"], priority=10),
            _item("exact-low", roles=["engineering"], categories=["finance"], priority=10),
            _item("exact-high", roles=["engineering"], categories=["finance"], priority=20),
        ]
    )
    resolver = ExampleContentResolver([ProviderRegistration(_Provider("provider-one", [catalog]))])

    result = await resolver.get_recommendations(
        scope_key="account-1",
        surface="workspace",
        role_key="engineering",
        space_category_key="finance",
        locale="en-US",
        limit=5,
    )

    assert result.status == "ready"
    assert [item.title for item in result.items] == [
        "exact-high",
        "exact-low",
        "category",
        "role",
        "wildcard",
    ]


@pytest.mark.asyncio
async def test_missing_preferences_only_match_wildcards():
    catalog = _catalog(
        items=[
            _item("exact", roles=["engineering"], categories=["finance"]),
            _item("wildcard", roles=["*"], categories=["*"]),
        ]
    )
    resolver = ExampleContentResolver([ProviderRegistration(_Provider("provider-one", [catalog]))])

    result = await resolver.get_recommendations(
        scope_key="account-1",
        surface="workspace",
        role_key=None,
        space_category_key=None,
        locale="en",
        limit=3,
    )

    assert [item.title for item in result.items] == ["wildcard"]


@pytest.mark.asyncio
async def test_provider_local_id_collisions_have_distinct_opaque_references():
    one = _catalog("provider-one", items=[_item("same-id", roles=["*"], categories=["*"])])
    two = _catalog("provider-two", items=[_item("same-id", roles=["*"], categories=["*"])])
    resolver = ExampleContentResolver(
        [
            ProviderRegistration(_Provider("provider-one", [one]), precedence=10),
            ProviderRegistration(_Provider("provider-two", [two]), precedence=5),
        ]
    )

    result = await resolver.get_recommendations(
        scope_key="account-1",
        surface="workspace",
        role_key=None,
        space_category_key=None,
        locale="en",
        limit=3,
    )

    assert len(result.items) == 2
    assert len({item.example_ref for item in result.items}) == 2
    assert all(reference.startswith("example_") for reference in (item.example_ref for item in result.items))


@pytest.mark.asyncio
async def test_replace_policy_uses_only_the_highest_precedence_provider():
    high = _catalog("provider-high", items=[_item("high", roles=["*"], categories=["*"])])
    low = _catalog("provider-low", items=[_item("low", roles=["*"], categories=["*"])])
    low_provider = _Provider("provider-low", [low])
    resolver = ExampleContentResolver(
        [
            ProviderRegistration(_Provider("provider-high", [high]), precedence=100),
            ProviderRegistration(low_provider, precedence=10),
        ],
        policy="replace",
    )

    result = await resolver.get_recommendations(
        scope_key="account-1", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )

    assert [item.title for item in result.items] == ["high"]
    assert low_provider.calls == 0


@pytest.mark.asyncio
async def test_registry_can_switch_account_provider_without_changing_response_contract():
    default = _catalog("eigent-default", items=[_item("default", roles=["*"], categories=["*"])])
    enterprise = _catalog("enterprise", items=[_item("managed", roles=["*"], categories=["*"])])
    registry = _ScopeRegistry(
        {
            "personal": ProviderSet(
                registrations=(ProviderRegistration(_Provider("eigent-default", [default])),),
                policy="augment",
                configuration_revision="personal-v1",
            ),
            "organisation": ProviderSet(
                registrations=(ProviderRegistration(_Provider("enterprise", [enterprise])),),
                policy="replace",
                configuration_revision="organisation-v3",
            ),
        }
    )
    resolver = ExampleContentResolver(registry=registry)

    personal = await resolver.get_recommendations(
        scope_key="personal", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )
    organisation = await resolver.get_recommendations(
        scope_key="organisation", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )

    assert [item.title for item in personal.items] == ["default"]
    assert [item.title for item in organisation.items] == ["managed"]
    assert personal.content_revision != organisation.content_revision


@pytest.mark.asyncio
async def test_transport_failure_uses_bundled_fallback_when_no_cache_exists():
    resolver = ExampleContentResolver(
        [ProviderRegistration(_Provider("provider-one", [ProviderUnavailable("offline")]))],
        bundled_fallback=bundled_catalog(),
    )

    result = await resolver.get_recommendations(
        scope_key="account-1", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )

    assert result.status == "ready"
    assert result.delivery == "bundled"
    assert len(result.items) == 3


@pytest.mark.asyncio
async def test_provider_timeout_is_bounded_and_uses_transport_fallback():
    resolver = ExampleContentResolver(
        [ProviderRegistration(_SlowProvider())],
        bundled_fallback=bundled_catalog(),
        provider_timeout_seconds=0.001,
    )

    result = await resolver.get_recommendations(
        scope_key="account-1", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )

    assert result.delivery == "bundled"


@pytest.mark.asyncio
async def test_successful_refresh_withdraws_old_items_instead_of_restoring_them():
    clock = _Clock()
    provider = _Provider(
        "provider-one",
        [
            _catalog(version="1", items=[_item("withdrawn", roles=["*"], categories=["*"])]),
            _catalog(version="2", items=[]),
        ],
    )
    resolver = ExampleContentResolver(
        [ProviderRegistration(provider)],
        bundled_fallback=bundled_catalog(),
        refresh_after=timedelta(minutes=5),
        now=clock,
    )
    initial = await resolver.get_recommendations(
        scope_key="account-1", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )
    clock.advance(timedelta(minutes=6))
    refreshed = await resolver.get_recommendations(
        scope_key="account-1", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )

    assert [item.title for item in initial.items] == ["withdrawn"]
    assert refreshed.status == "ready"
    assert refreshed.delivery == "live"
    assert refreshed.items == []


@pytest.mark.asyncio
async def test_transport_failure_uses_valid_cache_then_discards_expired_cache():
    clock = _Clock()
    provider = _Provider(
        "provider-one",
        [_catalog(items=[_item("live", roles=["*"], categories=["*"])]), ProviderUnavailable("offline")],
    )
    resolver = ExampleContentResolver(
        [ProviderRegistration(provider)],
        bundled_fallback=None,
        refresh_after=timedelta(minutes=5),
        maximum_age=timedelta(hours=1),
        now=clock,
    )
    first = await resolver.get_recommendations(
        scope_key="account-1", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )
    clock.advance(timedelta(minutes=6))
    cached = await resolver.get_recommendations(
        scope_key="account-1", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )
    clock.advance(timedelta(hours=2))
    expired = await resolver.get_recommendations(
        scope_key="account-1", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )

    assert first.delivery == "live"
    assert cached.delivery == "cache"
    assert expired.status == "unavailable"
    assert expired.items == []


@pytest.mark.asyncio
async def test_successful_empty_and_disabled_results_suppress_bundled_fallback():
    empty = _catalog(items=[])
    disabled = _catalog(enabled=False)
    empty_resolver = ExampleContentResolver(
        [ProviderRegistration(_Provider("provider-one", [empty]))], bundled_fallback=bundled_catalog()
    )
    disabled_resolver = ExampleContentResolver(
        [ProviderRegistration(_Provider("provider-one", [disabled]))], bundled_fallback=bundled_catalog()
    )

    empty_result = await empty_resolver.get_recommendations(
        scope_key="account-1", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )
    disabled_result = await disabled_resolver.get_recommendations(
        scope_key="account-1", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )

    assert empty_result.status == "ready" and empty_result.items == []
    assert disabled_result.status == "disabled" and disabled_result.items == []


@pytest.mark.asyncio
async def test_disabled_state_survives_outage_and_can_later_be_reenabled():
    clock = _Clock()
    disabled = _catalog(enabled=False)
    enabled = _catalog(version="2", items=[_item("restored", roles=["*"], categories=["*"])])
    provider = _Provider("provider-one", [disabled, ProviderUnavailable("offline"), enabled])
    resolver = ExampleContentResolver(
        [ProviderRegistration(provider)],
        bundled_fallback=bundled_catalog(),
        refresh_after=timedelta(minutes=5),
        now=clock,
    )

    first = await resolver.get_options(scope_key="account-1", locale="en")
    clock.advance(timedelta(minutes=6))
    outage = await resolver.get_options(scope_key="account-1", locale="en")
    clock.advance(timedelta(minutes=6))
    restored = await resolver.get_recommendations(
        scope_key="account-1", surface="workspace", role_key=None, space_category_key=None, locale="en", limit=3
    )

    assert first.status == "disabled"
    assert outage.status == "disabled"
    assert restored.status == "ready"
    assert [item.title for item in restored.items] == ["restored"]


@pytest.mark.asyncio
async def test_augment_merges_localized_categories_by_precedence():
    high = _catalog("provider-high")
    high.space_categories[0].translations["en"].label = "Money"
    low = _catalog("provider-low")
    resolver = ExampleContentResolver(
        [
            ProviderRegistration(_Provider("provider-high", [high]), precedence=100),
            ProviderRegistration(_Provider("provider-low", [low]), precedence=10),
        ],
        policy="augment",
    )

    result = await resolver.get_options(scope_key="account-1", locale="fr-FR")

    assert result.space_categories[0].label == "Finance FR"
    assert result.space_categories[0].resolved_locale == "fr"


@pytest.mark.asyncio
async def test_augment_rejects_incompatible_category_definitions():
    high = _catalog("provider-high", definition_key="finance-domain")
    low = _catalog("provider-low", definition_key="personal-budget")
    resolver = ExampleContentResolver(
        [
            ProviderRegistration(_Provider("provider-high", [high]), precedence=100),
            ProviderRegistration(_Provider("provider-low", [low]), precedence=10),
        ]
    )

    with pytest.raises(CategoryDefinitionConflict):
        await resolver.get_options(scope_key="account-1", locale="en")


def test_catalog_rejects_wildcard_mixing_and_unknown_categories():
    with pytest.raises(ValidationError):
        _catalog(items=[_item("mixed", roles=["*", "engineering"], categories=["*"])])
    with pytest.raises(ValidationError):
        _catalog(items=[_item("unknown", roles=["engineering"], categories=["not-published"])])
