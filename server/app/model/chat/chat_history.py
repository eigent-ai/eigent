from sqlalchemy import Float, Integer
from sqlmodel import Field, SmallInteger, Column, JSON, String
from typing import Optional
from enum import IntEnum
from datetime import datetime
from sqlalchemy_utils import ChoiceType
from app.model.abstract.model import AbstractModel, DefaultTimes
from pydantic import BaseModel, model_validator


class ChatStatus(IntEnum):
    ongoing = 1
    done = 2


class ChatHistory(AbstractModel, DefaultTimes, table=True):
    """
    Chat history model with timestamp tracking.
    
    Inherits from DefaultTimes which provides:
    - created_at: timestamp when record is created (auto-populated)
    - updated_at: timestamp when record is last modified (auto-updated)
    - deleted_at: timestamp for soft deletion (nullable)
    
    For legacy records without timestamps, sorting falls back to id ordering.
    """
    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    task_id: str = Field(index=True, unique=True)
    project_id: str = Field(index=True, unique=False, nullable=True)
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
    project_id: str | None = None
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
    project_id: str | None = None
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
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @model_validator(mode="after")
    def fill_project_id_from_task_id(self):
        """Fill project_id from task_id when project_id is None"""
        if self.project_id is None:
            self.project_id = self.task_id
        return self
    
    @model_validator(mode="after") 
    def handle_legacy_timestamps(self):
        """Handle legacy records that might not have timestamp fields"""
        # For old records without timestamps, we rely on database-level defaults
        # The sorting in the controller will handle ordering appropriately
        return self


class ChatHistoryUpdate(BaseModel):
    project_name: str | None = None
    summary: str | None = None
    tokens: int | None = None
    status: int | None = None
    project_id: str | None = None
