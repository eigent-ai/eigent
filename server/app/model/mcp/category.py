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

from typing import ClassVar
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Field, select
from sqlalchemy.orm import Mapped, query_expression
from app.model.abstract.model import AbstractModel, DefaultTimes


class Category(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    name: str = Field(default="", max_length=64)
    description: str = Field(default="", max_length=128)
    priority: int = Field(default=100)

    mcp_num: ClassVar[Mapped[int | None]] = query_expression()

    @staticmethod
    def expr_mcp_num():
        from app.model.mcp.mcp import Mcp

        return select(func.count("*")).where(Category.id == Mcp.category_id).scalar_subquery()


class CategoryOut(BaseModel):
    id: int
    name: str
    description: str
    priority: int

    mcp_num: int | None


class CategoryIn(BaseModel):
    name: str
    description: str
    priority: int
