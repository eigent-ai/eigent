from datetime import datetime
from typing import Any
from sqlalchemy import delete
from sqlmodel import Field, SQLModel, Session, col, func, TIMESTAMP, select, text
from app.component import code
from sqlalchemy.sql.expression import ColumnExpressionArgument
from sqlalchemy.sql.base import ExecutableOption
from sqlalchemy.orm import declared_attr
from fastapi_babel import _
from app.exception.exception import UserException
from app.component.database import engine
from convert_case import snake_case
import logging

logger = logging.getLogger("abstract_model")


class AbstractModel(SQLModel):
    @declared_attr  # type: ignore
    def __tablename__(cls) -> str:
        return snake_case(cls.__name__)

    @classmethod
    def by(
        cls,
        *whereclause: ColumnExpressionArgument[bool] | bool,
        order_by: Any | None = None,
        limit: int | None = None,
        offset: int | None = None,
        options: ExecutableOption | list[ExecutableOption] | None = None,
        s: Session,
    ):
        logger.debug("Executing query by conditions", extra={
            "model_class": cls.__name__,
            "has_order_by": order_by is not None,
            "limit": limit,
            "offset": offset,
            "has_options": options is not None
        })
        stmt = select(cls).where(*whereclause)
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        if limit is not None:
            stmt = stmt.limit(limit)
        if offset is not None:
            stmt = stmt.offset(offset)
        if options is not None:
            stmt = stmt.options(*(options if isinstance(options, list) else [options]))
        return s.exec(stmt, execution_options={"prebuffer_rows": True})

    @classmethod
    def exists(
        cls,
        *whereclause: ColumnExpressionArgument[bool] | bool,
        s: Session,
    ) -> bool:
        logger.debug("Checking if record exists", extra={"model_class": cls.__name__})
        res = s.exec(select(func.count("*")).where(*whereclause)).first()
        result = res is not None and res > 0
        logger.debug("Record existence check result", extra={
            "model_class": cls.__name__,
            "exists": result,
            "count": res
        })
        return result

    @classmethod
    def count(
        cls,
        *whereclause: ColumnExpressionArgument[bool] | bool,
        s: Session,
    ) -> int:
        res = s.exec(select(func.count("*")).where(*whereclause)).first()
        return res if res is not None else 0

    @classmethod
    def exists_must(
        cls,
        *whereclause: ColumnExpressionArgument[bool] | bool,
        s: Session,
    ):
        if not cls.exists(*whereclause, s=s):
            raise UserException(code.not_found, _("There is no data that meets the conditions"))

    @classmethod
    def delete_by(
        cls,
        *whereclause: ColumnExpressionArgument[bool],
        s: Session,
    ):
        logger.info("Deleting records by conditions", extra={"model_class": cls.__name__})
        stmt = delete(cls).where(*whereclause)
        result = s.connection().execute(stmt)
        s.commit()
        logger.info("Records deleted", extra={
            "model_class": cls.__name__,
            "rows_affected": result.rowcount
        })

    def save(self, s: Session | None = None):
        model_id = getattr(self, 'id', None)
        is_new = model_id is None
        logger.info("Saving model", extra={
            "model_class": self.__class__.__name__,
            "model_id": model_id,
            "is_new_record": is_new
        })

        if s is None:
            with Session(engine, expire_on_commit=False) as s:
                s.add(self)
                s.commit()
        else:
            s.add(self)
            s.commit()

        logger.info("Model saved successfully", extra={
            "model_class": self.__class__.__name__,
            "model_id": getattr(self, 'id', None),
            "was_new_record": is_new
        })

    def delete(self, s: Session):
        model_id = getattr(self, 'id', None)
        is_soft_delete = isinstance(self, DefaultTimes)

        logger.info("Deleting model", extra={
            "model_class": self.__class__.__name__,
            "model_id": model_id,
            "is_soft_delete": is_soft_delete
        })

        if isinstance(self, DefaultTimes):
            self.deleted_at = datetime.now()
            self.save(s)
        else:
            s.delete(self)
            s.commit()

        logger.info("Model deleted successfully", extra={
            "model_class": self.__class__.__name__,
            "model_id": model_id,
            "was_soft_delete": is_soft_delete
        })

    def update_fields(self, update_dict: dict):
        for k, v in update_dict.items():
            setattr(self, k, v)


class DefaultTimes:
    deleted_at: datetime | None = Field(default=None)
    created_at: datetime | None = Field(
        # 兼容mysql，如果只有数据库的保存的话，保存后，created_at为None，无法立即调用
        default_factory=datetime.now,
        sa_type=TIMESTAMP,
        sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")},
    )
    updated_at: datetime | None = Field(
        default_factory=datetime.now,
        sa_type=TIMESTAMP,
        sa_column_kwargs={
            "server_default": text("CURRENT_TIMESTAMP"),
            "onupdate": func.now(),
        },
    )

    @classmethod
    def no_delete(cls):
        return col(cls.deleted_at).is_(None)
