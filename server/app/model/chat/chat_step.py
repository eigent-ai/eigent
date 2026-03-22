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
    timestamp: float | None = Field(default=None, nullable=True)

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
    timestamp: float | None = None


class ChatStepOut(BaseModel):
    id: int
    task_id: str
    step: str
    data: Any
    timestamp: float | None = None
