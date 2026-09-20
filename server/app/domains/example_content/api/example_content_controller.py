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

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.environment import env
from app.domains.example_content.bundled import bundled_catalog
from app.domains.example_content.provider import (
    HttpCatalogProvider,
    ProviderRegistration,
    StaticProviderRegistry,
)
from app.domains.example_content.resolver import ExampleContentResolver
from app.domains.example_content.schema import (
    ExampleOptionsResponse,
    ExampleRecommendationsResponse,
    ExampleSurface,
    ProviderPolicy,
)
from app.model.user.user import WorkRoleKey
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth

router = APIRouter(tags=["Example content"])


def _first_env(*keys: str) -> str | None:
    for key in keys:
        value = env(key)
        if value:
            return value
    return None


def _env_bool(key: str, default: bool) -> bool:
    value = env(key)
    if value is None:
        return default
    return value.strip().casefold() in {"1", "true", "yes", "on"}


def _provider_timeout_seconds() -> float:
    raw = _first_env("EXAMPLE_CONTENT_PROVIDER_TIMEOUT_SECONDS", "example_content_provider_timeout_seconds") or "5"
    try:
        return min(30.0, max(0.1, float(raw)))
    except ValueError:
        return 5.0


@lru_cache(maxsize=1)
def get_example_content_resolver() -> ExampleContentResolver:
    policy_value = (
        _first_env("EXAMPLE_CONTENT_PROVIDER_POLICY", "example_content_provider_policy") or "augment"
    ).casefold()
    policy: ProviderPolicy = "replace" if policy_value == "replace" else "augment"
    timeout_seconds = _provider_timeout_seconds()
    provider = HttpCatalogProvider(
        provider_key="eigent-default",
        catalog_url=_first_env("EXAMPLE_CONTENT_DEFAULT_CATALOG_URL", "example_content_default_catalog_url"),
        bearer_token=_first_env("EXAMPLE_CONTENT_DEFAULT_BEARER_TOKEN", "example_content_default_bearer_token"),
        timeout_seconds=timeout_seconds,
    )
    registry = StaticProviderRegistry(
        [ProviderRegistration(provider=provider)],
        policy=policy,
        configuration_revision=_first_env(
            "EXAMPLE_CONTENT_PROVIDER_CONFIGURATION_REVISION",
            "example_content_provider_configuration_revision",
        )
        or "default-v1",
    )
    return ExampleContentResolver(
        registry=registry,
        bundled_fallback=bundled_catalog(),
        enabled=_env_bool("EXAMPLE_CONTENT_SERVER_ENABLED", True),
        provider_timeout_seconds=timeout_seconds,
    )


LocaleQuery = Annotated[str, Query(min_length=2, max_length=35, pattern=r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")]
CategoryQuery = Annotated[
    str | None,
    Query(min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"),
]


@router.get("/example-prompt-options", response_model=ExampleOptionsResponse)
async def get_example_prompt_options(
    locale: LocaleQuery = "en-US",
    auth: V1UserAuth = Depends(auth_must),
    resolver: ExampleContentResolver = Depends(get_example_content_resolver),
):
    return await resolver.get_options(scope_key=str(auth.id), locale=locale)


@router.get("/example-prompts", response_model=ExampleRecommendationsResponse)
async def get_example_prompts(
    surface: ExampleSurface,
    role_key: WorkRoleKey | None = None,
    space_category_key: CategoryQuery = None,
    locale: LocaleQuery = "en-US",
    limit: Annotated[int, Query(ge=1, le=12)] = 3,
    auth: V1UserAuth = Depends(auth_must),
    resolver: ExampleContentResolver = Depends(get_example_content_resolver),
):
    return await resolver.get_recommendations(
        scope_key=str(auth.id),
        surface=surface,
        role_key=role_key,
        space_category_key=space_category_key,
        locale=locale,
        limit=limit,
    )
