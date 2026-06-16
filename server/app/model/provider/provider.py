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
from typing import Optional

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
    model_type: Optional[str] = None
