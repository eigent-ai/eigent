from enum import Enum, IntEnum
from pydantic import BaseModel
from sqlalchemy import String
from sqlmodel import Field, Column, JSON, SQLModel, UniqueConstraint, Relationship, SmallInteger
from app.model.abstract.model import DefaultTimes, AbstractModel
from sqlalchemy.orm import Mapped
from typing import Optional
from sqlalchemy_utils import ChoiceType
from app.model.mcp.mcp import McpInfo, Mcp


class Status(IntEnum):
    enable = 1
    disable = 2


class McpType(IntEnum):
    Local = 1
    Remote = 2


class McpImportType(str, Enum):
    Local = "local"
    Remote = "remote"


class McpUser(AbstractModel, DefaultTimes, table=True):
    id: int | None = Field(default=None, primary_key=True)
    mcp_id: int = Field(default=0, foreign_key="mcp.id")
    user_id: int = Field(foreign_key="user.id")
    mcp_name: str = Field(sa_column=Column(String(128)))
    mcp_key: str = Field(sa_column=Column(String(128)))
    mcp_desc: str | None = Field(default=None, sa_column=Column(String(1024)))
    command: str | None = Field(default=None, sa_column=Column(String(1024)))
    args: str | None = Field(default=None, sa_column=Column(String(1024)))
    env: dict | None = Field(default=None, sa_column=Column(JSON))
    type: McpType = Field(default=McpType.Local, sa_column=Column(ChoiceType(McpType, SmallInteger())))
    status: Status = Field(default=Status.enable, sa_column=Column(ChoiceType(Status, SmallInteger())))
    server_url: str | None

    mcp: Mcp = Relationship(back_populates="mcp_user")


class McpUserIn(SQLModel):
    mcp_id: int
    env: Optional[dict] = None
    status: Status = Status.enable
    mcp_key: Optional[str] = None


class McpUserOut(SQLModel):
    id: int
    mcp_id: int
    mcp_name: str | None = None
    mcp_desc: str | None = None
    command: Optional[str] = None
    args: Optional[str] = None
    env: Optional[dict] = None
    status: int
    type: int
    server_url: Optional[str] = None
    mcp_key: str


class McpUserUpdate(BaseModel):
    mcp_name: str | None = None
    mcp_desc: str | None = None
    status: Optional[int] = None
    type: McpType | None = None
    env: Optional[dict] = None
    server_url: Optional[str] = None
    command: Optional[str] = None
    args: Optional[str] = None
    env: Optional[dict] = None
    mcp_key: Optional[str] = None


class McpUserImport(BaseModel):
    mcp_id: int = 0
    command: Optional[str] = None
    args: Optional[str] = None
    env: Optional[dict] = None
    status: int = Status.enable
    type: int = McpType.Local
    server_url: Optional[str] = None
    mcp_key: Optional[str] = None


class McpLocalImport(BaseModel):
    type: int = McpType.Local
    status: int = Status.enable
    command: Optional[str] = None
    args: Optional[str] = None
    env: Optional[dict] = None


class McpRemoteImport(BaseModel):
    type: int = McpType.Remote
    status: int = Status.enable
    server_url: Optional[str] = None
