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

from pydantic import BaseModel
from sqlalchemy import Boolean, Column, SmallInteger, String, event, text
from sqlalchemy_utils import ChoiceType
from sqlmodel import JSON, Field

from app.model.abstract.model import AbstractModel, DefaultTimes
from app.model.provider.execution_revision import after_create
from app.model.provider.metadata import (
    ModelProviderConfig,
    ModelProviderWrite,
    stored_config,
    stored_endpoint_url,
    stored_model_type,
    stored_provider_name,
)


class VaildStatus(IntEnum):
    not_valid = 1
    is_valid = 2


class Provider(AbstractModel, DefaultTimes, table=True):
    """Non-secret description of a model provider a user has set up.

    The provider's key and every other secret part of its configuration stay on
    the user's device. This server never receives them.
    """

    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    provider_name: str
    model_type: str
    # Assigned by database triggers. It is random, never a hash of a key/token.
    execution_revision: str = Field(default="", sa_column=Column(String(32), nullable=False, server_default=text("''")))
    endpoint_url: str = ""
    # Plain settings from the allow-list in app.model.provider.metadata. The
    # column name is historical: the content is not encrypted and not secret.
    encrypted_config: dict | None = Field(default=None, sa_column=Column(JSON))
    prefer: bool = Field(default=False, sa_column=Column(Boolean, server_default=text("false")))
    is_valid: VaildStatus = Field(
        default=VaildStatus.not_valid,
        sa_column=Column("is_vaild", ChoiceType(VaildStatus, SmallInteger()), server_default=text("1")),
    )


# The table still has a required "api_key" column from the time when keys were
# sent to this server. It is kept out of the model on purpose: no query selects
# it and no code can read or write it. New rows get an empty value. The column
# is removed in a later migration.
Provider.__table__.append_column(Column("api_key", String, nullable=False, default=""))


class ProviderPreferIn(BaseModel):
    provider_id: int


class ModelProviderOut(BaseModel):
    """The only shape in which a provider row leaves this server."""

    id: int
    provider_name: str
    model_type: str
    endpoint_url: str
    config: ModelProviderConfig
    is_valid: VaildStatus
    prefer: bool
    execution_revision: str

    @classmethod
    def from_row(cls, row: Provider) -> "ModelProviderOut":
        # Rows written by older clients can hold values that are refused today.
        # Such a value is returned empty instead of being passed through.
        return cls(
            id=row.id,
            provider_name=stored_provider_name(row.provider_name),
            model_type=stored_model_type(row.model_type),
            endpoint_url=stored_endpoint_url(row.endpoint_url),
            config=stored_config(row.encrypted_config),
            is_valid=row.is_valid,
            prefer=bool(row.prefer),
            execution_revision=row.execution_revision or "",
        )


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
        provider_name = stored_provider_name(provider_name)
        platform = stored_provider_name(configured_model_platform) or provider_name
        model_type = stored_model_type(configured_model_type) or stored_model_type(model_type)
        local = provider_name in {"ollama", "vllm", "sglang", "lmstudio", "llama.cpp"}
        return cls(
            category="local" if local else "custom",
            model_platform=platform,
            model_type=model_type,
            available=bool(model_type) and is_valid == VaildStatus.is_valid,
        )


__all__ = [
    "ModelProviderConfig",
    "ModelProviderOut",
    "ModelProviderWrite",
    "Provider",
    "ProviderModelMetadata",
    "ProviderPreferIn",
    "VaildStatus",
]

event.listen(Provider.__table__, "after_create", after_create)
