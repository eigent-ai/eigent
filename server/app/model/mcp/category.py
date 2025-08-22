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
