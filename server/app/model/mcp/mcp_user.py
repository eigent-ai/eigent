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

from enum import Enum, IntEnum

from pydantic import BaseModel
from sqlalchemy import String
from sqlalchemy_utils import ChoiceType
from sqlmodel import JSON, Column, Field, Relationship, SmallInteger, SQLModel

from app.model.abstract.model import AbstractModel, DefaultTimes
from app.model.mcp.mcp import Mcp


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
    env: dict | None = None
    status: Status = Status.enable
    mcp_key: str | None = None


class McpUserOut(SQLModel):
    id: int
    mcp_id: int
    mcp_name: str | None = None
    mcp_desc: str | None = None
    command: str | None = None
    args: str | None = None
    env: dict | None = None
    status: int
    type: int
    server_url: str | None = None
    mcp_key: str


class McpUserUpdate(BaseModel):
    mcp_name: str | None = None
    mcp_desc: str | None = None
    status: int | None = None
    type: McpType | None = None
    env: dict | None = None
    server_url: str | None = None
    command: str | None = None
    args: str | None = None
    mcp_key: str | None = None


class McpUserImport(BaseModel):
    mcp_id: int = 0
    command: str | None = None
    args: str | None = None
    env: dict | None = None
    status: int = Status.enable
    type: int = McpType.Local
    server_url: str | None = None
    mcp_key: str | None = None


class McpLocalImport(BaseModel):
    type: int = McpType.Local
    status: int = Status.enable
    command: str | None = None
    args: str | None = None
    env: dict | None = None


class McpRemoteImport(BaseModel):
    type: int = McpType.Remote
    status: int = Status.enable
    server_url: str | None = None
