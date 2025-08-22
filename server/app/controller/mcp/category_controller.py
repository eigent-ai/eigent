from typing import Annotated
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, col, select

from app.component.database import session
from app.model.mcp.category import Category, CategoryOut


router = APIRouter(prefix="/mcp", tags=["Mcp Category"])


@router.get("/categories", name="category list", response_model=list[CategoryOut])
def gets(session: Session = Depends(session)):
    stmt = select(Category).where(Category.no_delete()).order_by(col(Category.priority).asc())
    return session.exec(stmt)
