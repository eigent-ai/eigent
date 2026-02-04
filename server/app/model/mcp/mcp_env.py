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

from pydantic import BaseModel
from sqlalchemy_utils import ChoiceType
from sqlmodel import TEXT, Column, Field, SmallInteger, String

from app.model.abstract.model import AbstractModel, DefaultTimes


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
