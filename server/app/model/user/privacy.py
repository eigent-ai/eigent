from datetime import datetime
from enum import IntEnum
from sqlalchemy import JSON, SmallInteger
from sqlalchemy_utils import ChoiceType
from pydantic import BaseModel, EmailStr
from sqlmodel import Field, Column
from app.model.abstract.model import AbstractModel, DefaultTimes


class UserPrivacy(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(unique=True, foreign_key="user.id")
    pricacy_setting: dict = Field(default="{}", sa_column=Column(JSON))


class UserPrivacySettings(BaseModel):
    take_screenshot: bool | None = False
    access_local_software: bool | None = False
    access_your_address: bool | None = False
    password_storage: bool | None = False

    @classmethod
    def default_settings(cls) -> dict:
        return cls().model_dump()
