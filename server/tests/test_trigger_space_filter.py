"""Exercise both list handlers against synthetic SQLite, without app startup."""

import ast
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

import pytest
from sqlmodel import SQLModel, Field, Session, create_engine, select, desc, and_
from sqlalchemy import or_


class TriggerRow(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: str
    project_id: str
    space_id: str | None = None
    trigger_type: str = "schedule"
    status: str = "active"
    created_at: int = 0


class ProjectRow(SQLModel, table=True):
    id: str = Field(primary_key=True)
    user_id: str
    space_id: str


class HistoryRow(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    project_id: str
    user_id: str
    space_id: str


@pytest.mark.parametrize("path", ["app/domains/trigger/api/trigger_controller.py"])
def test_list_space_preserves_owner_and_project_filters(path):
    source = ast.parse((Path(__file__).parents[1] / path).read_text())
    handler = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "list_triggers")
    handler.decorator_list = []
    handler.returns = None
    for arg in handler.args.args:
        arg.annotation = None
    handler.args.defaults = [ast.Constant(None) for _ in handler.args.defaults]

    def paginate(db, query):
        items = db.exec(query).all()
        return SimpleNamespace(items=items, total=len(items))

    namespace = dict(
        Trigger=TriggerRow,
        Project=ProjectRow,
        ChatHistory=HistoryRow,
        or_=or_,
        select=select,
        desc=desc,
        and_=and_,
        paginate=paginate,
        get_execution_counts=lambda *_: {},
        trigger_to_out=lambda row, count: row,
        TriggerCrudService=SimpleNamespace(get_execution_counts=lambda *_: {}, trigger_to_out=lambda row, count: row),
        logger=SimpleNamespace(debug=lambda *args, **kwargs: None),
    )
    exec(compile(ast.fix_missing_locations(ast.Module(body=[handler], type_ignores=[])), path, "exec"), namespace)
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        for owner, project, space in [
            ("owner", "a", "space"),
            ("owner", "b", "space"),
            ("owner", "c", "other"),
            ("foreign", "d", "space"),
            ("owner", "old", None),
        ]:
            db.add(TriggerRow(user_id=owner, project_id=project, space_id=space))
        db.add(ProjectRow(id="old", user_id="owner", space_id="space"))
        db.commit()

        def call(**filters):
            args = dict(
                trigger_type=None,
                status=None,
                project_id=None,
                space_id=None,
                auth=SimpleNamespace(id="owner", user=SimpleNamespace(id="owner")),
            )
            args["db_session"] = db
            args.update(filters)
            return {row.project_id for row in namespace["list_triggers"](**args).items}

        assert call(space_id="space") == {"a", "b", "old"}
        assert call(space_id="space", project_id="a") == {"a"}
        assert call(project_id="old") == {"old"}
        assert call() == {"a", "b", "c", "old"}
