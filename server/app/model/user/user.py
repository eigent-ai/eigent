from datetime import datetime, date
from enum import IntEnum
from sqlalchemy import Integer, SmallInteger, text
from sqlalchemy_utils import ChoiceType
from pydantic import BaseModel, EmailStr, field_validator
from sqlmodel import Field, Column
from app.model.abstract.model import AbstractModel, DefaultTimes
from typing import Optional
from app.component.encrypt import password_hash


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
    avatar: Optional[str] = ""
    username: Optional[str] = ""
    nickname: Optional[str] = ""
    fullname: Optional[str] = ""
    work_desc: Optional[str] = ""
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
    invite_code: Optional[str] = None

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
