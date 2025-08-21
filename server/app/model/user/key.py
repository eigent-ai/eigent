from enum import IntEnum, StrEnum
from typing import Optional
from pydantic import BaseModel, computed_field
from sqlmodel import Field, Column, SmallInteger
from sqlalchemy_utils import ChoiceType
from app.component.environment import env_not_empty
from app.model.abstract.model import AbstractModel, DefaultTimes


class ModelType(StrEnum):
    gpt4_1 = "gpt-4.1"
    gpt4_mini = "gpt-4.1-mini"
    gemini_2_5_pro = "gemini/gemini-2.5-pro"
    gemini_2_5_flash = "gemini-2.5-flash"


class KeyStatus(IntEnum):
    active = 1
    disabled = -1


class Key(AbstractModel, DefaultTimes, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    value: str = Field(max_length=255, index=True)
    inner_key: str = Field(default="", max_length=255)  # litellm内部存储的key
    status: KeyStatus = Field(sa_column=Column(ChoiceType(KeyStatus, SmallInteger())))


class KeyOut(BaseModel):
    warning_code: Optional[str] = None
    warning_text: Optional[str] = None
    value: str

    @computed_field(return_type=str)
    def api_url(self):
        return env_not_empty("litellm_url")
