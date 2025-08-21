from enum import IntEnum

from pydantic import BaseModel
from app.model.abstract.model import AbstractModel, DefaultTimes
from sqlalchemy_utils import ChoiceType
from sqlmodel import Field, Column, String, TEXT, SmallInteger


class Status(IntEnum):
    in_use = 1
    deprecated = 2
    no_use = 3


class McpEnv(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    mcp_id: int = Field(foreign_key="mcp.id")
    env_name: str = Field(default="", sa_column=Column(String(128)))
    env_description: str = Field(default="", sa_column=Column(TEXT))
    env_key: str = Field(sa_column=Column(String(128)))
    env_default_value: str = Field(default="", sa_column=Column(String(1024)))
    env_required: int = Field(default=1, sa_column=Column(SmallInteger))
    status: Status = Field(default=Status.in_use, sa_column=Column(ChoiceType(Status, SmallInteger())))


class McpEnvOut(BaseModel):
    id: int
    mcp_id: int
    env_name: str
    env_description: str
    env_key: str
    env_default_value: str
    env_required: int
