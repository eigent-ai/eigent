from datetime import datetime
from pydantic import BaseModel, EmailStr, computed_field
from pydash import chain
from sqlmodel import Field, Column, Relationship, SmallInteger
from sqlalchemy.orm import Mapped
from sqlalchemy_utils import ChoiceType
from app.model.abstract.model import AbstractModel, DefaultTimes
from enum import IntEnum
from app.model.user.role import Role, RoleOut
from app.model.user.admin_role import AdminRole


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
