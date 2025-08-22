from pydantic import BaseModel
from sqlmodel import Field
from app.model.abstract.model import AbstractModel


class AdminRole(AbstractModel, table=True):
    admin_id: int = Field(primary_key=True)
    role_id: int = Field(primary_key=True)


class AdminRoleIn(BaseModel):
    admin_id: int
    role_ids: list[int]
