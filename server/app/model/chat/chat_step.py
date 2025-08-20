from sqlmodel import SQLModel, Field, JSON
from app.model.abstract.model import AbstractModel, DefaultTimes
from pydantic import BaseModel
from typing import Any
from pydantic import field_validator
import json


class ChatStep(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    task_id: str = Field(index=True)
    step: str
    data: str = Field(sa_type=JSON)

    @field_validator("data", mode="before")
    @classmethod
    def serialize_data(cls, v):
        if isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False)
        return v

    @field_validator("data", mode="after")
    @classmethod
    def deserialize_data(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return v
        return v


class ChatStepIn(BaseModel):
    task_id: str
    step: str
    data: Any


class ChatStepOut(BaseModel):
    id: int
    task_id: str
    step: str
    data: Any
