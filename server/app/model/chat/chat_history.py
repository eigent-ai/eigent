from sqlalchemy import Float, Integer
from sqlmodel import Field, SmallInteger, Column, JSON, String
from typing import Optional
from enum import IntEnum
from sqlalchemy_utils import ChoiceType
from app.model.abstract.model import AbstractModel, DefaultTimes
from pydantic import BaseModel


class ChatStatus(IntEnum):
    ongoing = 1
    done = 2


class ChatHistory(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    task_id: str = Field(index=True, unique=True)
    question: str
    language: str
    model_platform: str
    model_type: str
    api_key: str
    api_url: str = Field(sa_column=Column(String(500)))
    max_retries: int = Field(default=3)
    file_save_path: Optional[str] = None
    installed_mcp: str = Field(sa_type=JSON, default={})
    project_name: str = Field(default="", sa_column=Column(String(128)))
    summary: str = Field(default="", sa_column=Column(String(1024)))
    tokens: int = Field(default=0, sa_column=(Column(Integer, server_default="0")))
    spend: float = Field(default=0, sa_column=(Column(Float, server_default="0")))
    status: int = Field(default=1, sa_column=Column(ChoiceType(ChatStatus, SmallInteger())))


class ChatHistoryIn(BaseModel):
    task_id: str
    user_id: int | None = None
    question: str
    language: str
    model_platform: str
    model_type: str
    api_key: str | None = ""
    api_url: str | None = None
    max_retries: int = 3
    file_save_path: Optional[str] = None
    installed_mcp: Optional[str] = None
    project_name: str | None = None
    summary: str | None = None
    tokens: int = 0
    spend: float = 0
    status: int = ChatStatus.ongoing.value


class ChatHistoryOut(BaseModel):
    id: int
    task_id: str
    question: str
    language: str
    model_platform: str
    model_type: str
    api_key: Optional[str] = None
    api_url: Optional[str] = None
    max_retries: int
    file_save_path: Optional[str] = None
    installed_mcp: Optional[str] = None
    project_name: str | None = None
    summary: str | None = None
    tokens: int
    status: int


class ChatHistoryUpdate(BaseModel):
    project_name: str | None = None
    summary: str | None = None
    tokens: int | None = None
    status: int | None = None
