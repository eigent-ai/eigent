from enum import IntEnum
from typing import Optional
from pydantic import BaseModel
from sqlalchemy import Boolean, Column, SmallInteger
from sqlalchemy.orm import Mapped
from sqlmodel import Field, JSON
from sqlalchemy_utils import ChoiceType
from sqlalchemy import text
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
    is_vaild: VaildStatus = Field(
        default=VaildStatus.not_valid,
        sa_column=Column(ChoiceType(VaildStatus, SmallInteger()), server_default=text("1")),
    )


class ProviderIn(BaseModel):
    provider_name: str
    model_type: str
    api_key: str
    endpoint_url: str
    encrypted_config: dict | None = None
    is_vaild: VaildStatus = VaildStatus.not_valid
    prefer: bool = False


class ProviderPreferIn(BaseModel):
    provider_id: int


class ProviderOut(ProviderIn):
    id: int
    user_id: int
    prefer: bool
    model_type: Optional[str] = None
