from enum import IntEnum
from typing import List
from pydantic import BaseModel
from sqlalchemy import Column, SmallInteger, String
from sqlalchemy.orm import Mapped
from sqlmodel import Field, Relationship, JSON
from sqlalchemy_utils import ChoiceType
from app.model.abstract.model import AbstractModel, DefaultTimes
from app.model.mcp.mcp_env import McpEnv, McpEnvOut
from app.type.pydantic import HttpUrlStr
from app.model.mcp.category import Category, CategoryOut
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.model.mcp.mcp_user import McpUser


class Status(IntEnum):
    Online = 1
    Offline = -1


class McpType(IntEnum):
    Local = 1
    Remote = 2


class Mcp(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    category_id: int = Field(foreign_key="category.id")
    name: str
    key: str = Field(sa_column=Column(String(128)))
    description: str = ""
    home_page: str = Field(default="", sa_column=Column(String(1024)))
    type: McpType = Field(default=McpType.Local, sa_column=Column(ChoiceType(McpType, SmallInteger())))
    status: Status = Field(default=Status.Online, sa_column=Column(ChoiceType(Status, SmallInteger())))
    sort: int = Field(default=0, sa_column=Column(SmallInteger))
    server_name: str = Field(default="", sa_column=Column(String(128)))
    install_command: dict = Field(default="{}", sa_column=Column(JSON))
    """{
        "command": "uvx",
        "args": ["mcp-server-everything-search"],
        "env": {
        "EVERYTHING_SDK_PATH": "path/to/Everything-SDK/dll/Everything64.dll"
        }
    }"""

    category: Mapped[Category] = Relationship()
    envs: Mapped[list[McpEnv]] = Relationship()
    # user_env: Mapped[McpUser] = Relationship()

    mcp_user: List["McpUser"] = Relationship(back_populates="mcp")


class McpIn(BaseModel):
    category_id: int
    name: str
    key: str
    description: str
    home_page: HttpUrlStr
    type: McpType
    status: Status
    install_command: dict


class McpOut(McpIn):
    id: int
    category: CategoryOut | None = None
    # envs: list[McpEnvOut] = []


class McpInfo(BaseModel):
    id: int
    name: str
    key: str
