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

from enum import IntEnum
from typing import Literal

from pydantic import AliasChoices, BaseModel, Field as PydanticField, field_validator
from sqlalchemy import Boolean, Column, SmallInteger, text
from sqlalchemy_utils import ChoiceType
from sqlmodel import JSON, Field

from app.model.abstract.model import AbstractModel, DefaultTimes


class VaildStatus(IntEnum):
    not_valid = 1
    is_valid = 2


class Provider(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    provider_name: str
    model_type: str
    api_key: str
    endpoint_url: str = ""
    encrypted_config: dict | None = Field(default=None, sa_column=Column(JSON))
    prefer: bool = Field(default=False, sa_column=Column(Boolean, server_default=text("false")))
    is_valid: VaildStatus = Field(
        default=VaildStatus.not_valid,
        sa_column=Column("is_vaild", ChoiceType(VaildStatus, SmallInteger()), server_default=text("1")),
    )


class ProviderIn(BaseModel):
    provider_name: str
    model_type: str
    api_key: str
    endpoint_url: str
    encrypted_config: dict | None = None
    is_valid: VaildStatus = PydanticField(
        default=VaildStatus.not_valid,
        validation_alias=AliasChoices("is_valid", "is_vaild"),
    )
    prefer: bool = False

    @field_validator("is_valid", mode="before")
    @classmethod
    def normalize_is_valid(cls, value):
        if isinstance(value, bool):
            return VaildStatus.is_valid if value else VaildStatus.not_valid
        return value


class ProviderPreferIn(BaseModel):
    provider_id: int


class ProviderOut(ProviderIn):
    id: int
    user_id: int
    prefer: bool
    model_type: str | None = None


class ProviderModelMetadata(BaseModel):
    """Account-scoped catalog projection; never includes a local binding or secret."""

    category: Literal["custom", "local"]
    model_platform: str
    model_type: str
    available: bool

    @classmethod
    def from_projection(
        cls,
        provider_name: str,
        model_type: str,
        is_valid: VaildStatus,
        configured_model_platform: str | None,
        configured_model_type: str | None,
    ) -> "ProviderModelMetadata":
        """Accept only projected scalars, so discovery never needs a Provider row."""
        platform = configured_model_platform or provider_name
        model_type = configured_model_type or model_type
        local = provider_name in {"ollama", "vllm", "sglang", "lmstudio", "llama.cpp"}
        return cls(
            category="local" if local else "custom",
            model_platform=platform,
            model_type=model_type,
            available=bool(model_type) and is_valid == VaildStatus.is_valid,
        )
