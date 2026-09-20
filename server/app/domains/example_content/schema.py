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

import re
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.model.user.work_role import WorkRoleKey

ExampleSurface = Literal["workspace", "automation"]
DeliveryStatus = Literal["ready", "disabled", "unavailable"]
DeliveryKind = Literal["live", "cache", "bundled", "none"]
ProviderPolicy = Literal["replace", "augment"]

WORK_ROLE_KEYS = frozenset(WorkRoleKey.__args__)
SLUG_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
LOCALE_PATTERN = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")


def _validate_plain_text(value: str, *, field_name: str) -> str:
    if any(ord(character) < 32 and character not in "\n\t" for character in value):
        raise ValueError(f"{field_name} contains unsupported control characters")
    return value


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LocalizedCategory(StrictModel):
    label: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=240)

    @field_validator("label", "description")
    @classmethod
    def validate_text(cls, value: str | None, info):
        return value if value is None else _validate_plain_text(value, field_name=info.field_name)


class ProviderCategory(StrictModel):
    key: str = Field(min_length=1, max_length=50)
    enabled: bool = True
    sort_order: int = Field(default=0, ge=-10_000, le=10_000)
    definition_key: str | None = Field(default=None, min_length=1, max_length=100)
    translations: dict[str, LocalizedCategory] = Field(min_length=1)

    @field_validator("key")
    @classmethod
    def validate_key(cls, value: str) -> str:
        if not SLUG_PATTERN.fullmatch(value):
            raise ValueError("category key must be a lowercase slug")
        return value

    @field_validator("translations")
    @classmethod
    def validate_locales(cls, value: dict[str, LocalizedCategory]):
        if any(not LOCALE_PATTERN.fullmatch(locale) for locale in value):
            raise ValueError("category translations contain an invalid locale")
        return value


class LocalizedExample(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=320)
    prompt: str = Field(min_length=1, max_length=8_000)
    automation_name: str | None = Field(default=None, max_length=120)
    automation_description: str | None = Field(default=None, max_length=500)

    @field_validator("title", "summary", "prompt", "automation_name", "automation_description")
    @classmethod
    def validate_text(cls, value: str | None, info):
        return value if value is None else _validate_plain_text(value, field_name=info.field_name)


class ExampleRequirements(StrictModel):
    connector_keys: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("connector_keys")
    @classmethod
    def validate_connector_keys(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("connector keys must be unique")
        if any(not SLUG_PATTERN.fullmatch(key) for key in value):
            raise ValueError("connector key must be a lowercase slug")
        return value


class ProviderExample(StrictModel):
    id: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    enabled: bool = True
    surfaces: list[ExampleSurface] = Field(min_length=1, max_length=2)
    role_keys: list[str] = Field(min_length=1, max_length=21)
    space_category_keys: list[str] = Field(min_length=1, max_length=51)
    priority: int = Field(default=0, ge=-10_000, le=10_000)
    translations: dict[str, LocalizedExample] = Field(min_length=1)
    attribution: str | None = Field(default=None, max_length=160)
    learn_more_url: str | None = Field(default=None, max_length=2_048)
    requirements: ExampleRequirements = Field(default_factory=ExampleRequirements)

    @field_validator("surfaces")
    @classmethod
    def validate_surfaces(cls, value: list[ExampleSurface]) -> list[ExampleSurface]:
        if len(value) != len(set(value)):
            raise ValueError("surfaces must be unique")
        return value

    @field_validator("role_keys")
    @classmethod
    def validate_role_keys(cls, value: list[str]) -> list[str]:
        if value == ["*"]:
            return value
        if "*" in value:
            raise ValueError("wildcard role cannot be mixed with concrete roles")
        if len(value) != len(set(value)) or any(role not in WORK_ROLE_KEYS for role in value):
            raise ValueError("role keys contain an unknown or duplicate role")
        return value

    @field_validator("space_category_keys")
    @classmethod
    def validate_category_keys(cls, value: list[str]) -> list[str]:
        if value == ["*"]:
            return value
        if "*" in value:
            raise ValueError("wildcard category cannot be mixed with concrete categories")
        if len(value) != len(set(value)) or any(not SLUG_PATTERN.fullmatch(key) for key in value):
            raise ValueError("category keys contain an invalid or duplicate key")
        return value

    @field_validator("translations")
    @classmethod
    def validate_locales(cls, value: dict[str, LocalizedExample]):
        if any(not LOCALE_PATTERN.fullmatch(locale) for locale in value):
            raise ValueError("example translations contain an invalid locale")
        return value

    @field_validator("attribution")
    @classmethod
    def validate_attribution(cls, value: str | None):
        return value if value is None else _validate_plain_text(value, field_name="attribution")

    @field_validator("learn_more_url")
    @classmethod
    def validate_learn_more_url(cls, value: str | None):
        if value is None:
            return None
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("learn_more_url must be an absolute HTTP(S) URL")
        return value


class ProviderCatalog(StrictModel):
    schema_version: Literal[1]
    provider_key: str = Field(min_length=1, max_length=80, pattern=r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
    provider_version: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    space_categories: list[ProviderCategory] = Field(default_factory=list, max_length=500)
    items: list[ProviderExample] = Field(default_factory=list, max_length=5_000)

    @model_validator(mode="after")
    def validate_references(self):
        category_keys = [category.key for category in self.space_categories]
        item_ids = [item.id for item in self.items]
        if len(category_keys) != len(set(category_keys)):
            raise ValueError("space category keys must be unique within a provider")
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("example ids must be unique within a provider")
        enabled_categories = {category.key for category in self.space_categories if category.enabled}
        for item in self.items:
            if item.space_category_keys == ["*"]:
                continue
            unknown = set(item.space_category_keys) - enabled_categories
            if unknown:
                raise ValueError(f"example {item.id} references unavailable categories: {sorted(unknown)}")
        return self


class ResolvedCategory(StrictModel):
    key: str
    label: str
    description: str | None = None
    sort_order: int
    resolved_locale: str


class ResolvedAutomationDefaults(StrictModel):
    name: str | None = None
    description: str | None = None


class ResolvedExample(StrictModel):
    example_ref: str
    title: str
    summary: str
    prompt: str
    resolved_locale: str
    attribution: str | None = None
    learn_more_url: str | None = None
    automation_defaults: ResolvedAutomationDefaults | None = None
    requirements: ExampleRequirements = Field(default_factory=ExampleRequirements)


class ExampleOptionsResponse(StrictModel):
    schema_version: Literal[1] = 1
    content_revision: str
    status: DeliveryStatus
    delivery: DeliveryKind
    expires_at: datetime | None
    space_categories: list[ResolvedCategory]


class ExampleRecommendationsResponse(StrictModel):
    schema_version: Literal[1] = 1
    content_revision: str
    status: DeliveryStatus
    delivery: DeliveryKind
    expires_at: datetime | None
    items: list[ResolvedExample]
