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

from datetime import datetime
from enum import IntEnum

from pydantic import BaseModel, EmailStr, computed_field
from pydash import chain
from sqlalchemy.orm import Mapped
from sqlalchemy_utils import ChoiceType
from sqlmodel import Column, Field, Relationship, SmallInteger

from app.model.abstract.model import AbstractModel, DefaultTimes
from app.model.user.admin_role import AdminRole
from app.model.user.role import Role, RoleOut


class Status(IntEnum):
    Normal = 1
    Disable = -1


class Admin(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    email: EmailStr
    password: str
    name: str
    user_id: int = 0
    status: int = Field(default=1, sa_column=Column(ChoiceType(Status, SmallInteger())))

    roles: Mapped[list[Role]] = Relationship(
        link_model=AdminRole,
        sa_relationship_kwargs={
            "primaryjoin": "Admin.id == AdminRole.admin_id",
            "secondaryjoin": "AdminRole.role_id == Role.id",
            # "collection_class": Collection,
        },
    )


class LoginByPasswordIn(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    token: str
    user_id: int
    permissions: list[str]


class AdminIn(BaseModel):
    email: EmailStr
    name: str
    status: Status


class AdminCreate(AdminIn):
    password: str


class AdminOut(BaseModel):
    id: int
    email: EmailStr
    name: str
    status: Status
    created_at: datetime
    roles: list[RoleOut]

    @computed_field(return_type=list[str])
    def permissions(self):
        return chain(self.roles).flat_map(lambda role: role.permissions).value()


class UpdatePassword(BaseModel):
    password: str
    new_password: str
    re_new_password: str


class SetPassword(BaseModel):
    password: str
