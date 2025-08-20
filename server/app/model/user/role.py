from datetime import datetime
from enum import Enum
from pydantic import BaseModel
from sqlmodel import Field, Column, SmallInteger, JSON
from app.model.abstract.model import AbstractModel, DefaultTimes
from sqlalchemy_utils import ChoiceType


class RoleType(int, Enum):
    System = 1
    Custom = 2


class Role(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    name: str
    description: str = ""
    type: RoleType = Field(default=RoleType.Custom.value, sa_column=Column(ChoiceType(RoleType, SmallInteger())))
    permissions: list[str] = Field(sa_column=Column(JSON))


class RoleIn(BaseModel):
    name: str
    description: str = ""
    permissions: list[str]


class RoleOut(BaseModel):
    id: int
    name: str
    description: str
    type: RoleType
    permissions: list[str]
    created_at: datetime
