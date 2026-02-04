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

from datetime import date, datetime
from enum import IntEnum

from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import Integer, SmallInteger, text
from sqlalchemy_utils import ChoiceType
from sqlmodel import Column, Field

from app.component.encrypt import password_hash
from app.model.abstract.model import AbstractModel, DefaultTimes


class Status(IntEnum):
    Normal = 1
    Block = -1


class User(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    stack_id: str | None = Field(default=None, unique=True, max_length=255)
    username: str | None = Field(default=None, unique=True, max_length=128)
    email: EmailStr = Field(unique=True, max_length=128)
    password: str | None = Field(default=None, max_length=256)
    avatar: str = Field(default="", max_length=256)
    nickname: str = Field(default="", max_length=64)
    fullname: str = Field(default="", max_length=128)
    work_desc: str = Field(default="", max_length=255)
    credits: int = Field(default=0, description="credits", sa_column=Column(Integer, server_default=text("0")))
    last_daily_credit_date: date | None = Field(default=None, description="Last date daily credits were granted")
    last_monthly_credit_date: date | None = Field(default=None, description="Last month monthly credits were granted")
    inviter_user_id: int | None = Field(default=None, foreign_key="user.id", description="Inviter user ID")
    status: Status = Field(default=Status.Normal.value, sa_column=Column(ChoiceType(Status, SmallInteger())))


class UserProfile(BaseModel):
    fullname: str = ""
    nickname: str = ""
    work_desc: str = ""


class LoginByPasswordIn(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    token: str
    email: EmailStr


class UserIn(BaseModel):
    username: str


class UserCreate(UserIn):
    password: str


class UserOut(BaseModel):
    email: EmailStr
    avatar: str | None = ""
    username: str | None = ""
    nickname: str | None = ""
    fullname: str | None = ""
    work_desc: str | None = ""
    credits: int
    status: Status
    created_at: datetime


class UpdatePassword(BaseModel):
    password: str
    new_password: str
    re_new_password: str


class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    invite_code: str | None = None

    @field_validator("password", mode="before")
    def password_strength(cls, v):
        # At least 8 chars, must contain letters and numbers
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        if not any(c.isdigit() for c in v) or not any(c.isalpha() for c in v):
            raise ValueError("Password must contain both letters and numbers")
        return v

    @field_validator("password", mode="after")
    def password_hash(cls, v):
        return password_hash(v)
