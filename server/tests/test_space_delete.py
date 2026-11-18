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

"""Space deletion through real HTTP, SpaceService and SQLite with foreign keys on."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session, create_engine, select

from app.core.database import session as database_session
from app.domains.space.api.space_controller import router
from app.model.chat.chat_history import ChatHistory
from app.model.memory import ProjectMemory, SpaceMemory
from app.model.project import Project
from app.model.remote_control import DesktopDevice, ProjectExecutionRoute
from app.model.space import Space, SpaceFileIndex, SpaceFileIndexOverlay
from app.model.trigger.trigger import Trigger
from app.model.trigger.trigger_execution import TriggerExecution
from app.shared.auth import auth_must
from app.shared.types.trigger_types import ExecutionType, TriggerType

TABLES = [
    Space,
    Project,
    SpaceMemory,
    ProjectMemory,
    SpaceFileIndex,
    SpaceFileIndexOverlay,
    DesktopDevice,
    ProjectExecutionRoute,
    Trigger,
    TriggerExecution,
    ChatHistory,
]


@pytest.fixture
def fixture(tmp_path):
    engine = create_engine(
        "sqlite:///" + str(tmp_path / "space-delete.sqlite3"),
        connect_args={"check_same_thread": False, "timeout": 5},
    )

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    for model in TABLES:
        model.__table__.create(engine)
    with Session(engine) as db:
        db.add(Space(id="space-a", user_id="7", name="Synthetic Space"))
        db.add(Space(id="space-b", user_id="7", name="Other Space"))
        db.flush()
        db.add(Project(id="project-b", space_id="space-b", user_id="7", name="Other Session"))
        db.commit()

    app = FastAPI()
    app.include_router(router)

    def fixture_session():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[database_session] = fixture_session
    app.dependency_overrides[auth_must] = lambda: SimpleNamespace(id=7)
    try:
        yield TestClient(app), engine
    finally:
        engine.dispose()


def _add_session(engine, project_id, *, status, space_id="space-a"):
    with Session(engine) as db:
        db.add(Project(id=project_id, space_id=space_id, user_id="7", name=project_id, status=status))
        db.commit()


def _add_dependents(engine, project_id, space_id="space-a"):
    with Session(engine) as db:
        if db.get(DesktopDevice, "desk-1") is None:
            db.add(DesktopDevice(id="desk-1", user_id=7))
            db.flush()
        db.add(ProjectExecutionRoute(project_id=project_id, user_id=7, target_device_id="desk-1"))
        db.add(SpaceMemory(user_id="7", space_id=space_id, key=f"space-{project_id}"))
        db.add(ProjectMemory(user_id="7", space_id=space_id, project_id=project_id, key="note"))
        db.add(SpaceFileIndex(space_id=space_id, path=f"{project_id}.md"))
        db.add(
            SpaceFileIndexOverlay(
                space_id=space_id,
                project_id=project_id,
                run_id="run-1",
                path=f"{project_id}.md",
                status="added",
            )
        )
        trigger = Trigger(
            user_id="7",
            space_id=space_id,
            project_id=project_id,
            name="Daily report",
            trigger_type=TriggerType.schedule,
        )
        db.add(trigger)
        db.flush()
        db.add(
            TriggerExecution(
                trigger_id=trigger.id,
                execution_id=f"execution-{project_id}",
                execution_type=ExecutionType.scheduled,
            )
        )
        db.add(
            ChatHistory(
                user_id=7,
                task_id=f"task-{project_id}",
                project_id=project_id,
                space_id=space_id,
                question="Synthetic question",
                language="en",
                model_platform="synthetic",
                model_type="synthetic",
                api_key="",
                api_url="",
            )
        )
        db.commit()


def _ids(engine, model):
    with Session(engine) as db:
        return sorted(row.id if hasattr(row, "id") else row.project_id for row in db.exec(select(model)).all())


def test_space_whose_sessions_were_deleted_can_be_deleted(fixture):
    client, engine = fixture
    _add_session(engine, "project-a1", status="archived")
    _add_session(engine, "project-a2", status="archived")
    _add_dependents(engine, "project-a1")

    response = client.delete("/spaces/space-a")

    assert response.status_code == 204, response.text
    assert _ids(engine, Space) == ["space-b"]
    assert _ids(engine, Project) == ["project-b"]
    for model in [
        SpaceMemory,
        ProjectMemory,
        SpaceFileIndex,
        SpaceFileIndexOverlay,
        ProjectExecutionRoute,
        Trigger,
        TriggerExecution,
        ChatHistory,
    ]:
        assert _ids(engine, model) == []


def test_space_with_a_live_session_is_still_refused(fixture):
    client, engine = fixture
    _add_session(engine, "project-a1", status="archived")
    _add_session(engine, "project-live", status="active")

    response = client.delete("/spaces/space-a")

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "space_has_projects"
    assert detail["project_count"] == 1
    assert [project["id"] for project in detail["projects"]] == ["project-live"]
    assert _ids(engine, Space) == ["space-a", "space-b"]
    assert _ids(engine, Project) == ["project-a1", "project-b", "project-live"]


def test_empty_space_with_space_scoped_rows_can_be_deleted(fixture):
    client, engine = fixture
    with Session(engine) as db:
        db.add(SpaceMemory(user_id="7", space_id="space-a", key="shared"))
        db.add(SpaceFileIndex(space_id="space-a", path="README.md"))
        db.commit()

    response = client.delete("/spaces/space-a")

    assert response.status_code == 204, response.text
    assert _ids(engine, Space) == ["space-b"]
    assert _ids(engine, SpaceMemory) == []
    assert _ids(engine, SpaceFileIndex) == []


def test_deleting_a_space_keeps_other_spaces_rows(fixture):
    client, engine = fixture
    _add_dependents(engine, "project-b", space_id="space-b")
    _add_session(engine, "project-a1", status="archived")

    response = client.delete("/spaces/space-a")

    assert response.status_code == 204, response.text
    assert _ids(engine, Project) == ["project-b"]
    assert _ids(engine, ProjectExecutionRoute) == ["project-b"]
    assert len(_ids(engine, SpaceFileIndexOverlay)) == 1
    assert len(_ids(engine, ProjectMemory)) == 1
    for model in [Trigger, TriggerExecution, ChatHistory]:
        assert len(_ids(engine, model)) == 1


def test_space_with_a_deleted_promoted_session_can_be_deleted(fixture):
    client, engine = fixture
    # The Session started in space-b and was promoted into space-a, so its
    # memory and pending changes still carry space-b.
    _add_session(engine, "project-promoted", status="archived", space_id="space-b")
    with Session(engine) as db:
        db.add(ProjectMemory(user_id="7", space_id="space-b", project_id="project-promoted", key="note"))
        db.add(
            SpaceFileIndexOverlay(
                space_id="space-b",
                project_id="project-promoted",
                run_id="run-1",
                path="notes.md",
                status="added",
            )
        )
        db.get(Project, "project-promoted").space_id = "space-a"
        db.commit()

    response = client.delete("/spaces/space-a")

    assert response.status_code == 204, response.text
    assert _ids(engine, Space) == ["space-b"]
    assert _ids(engine, Project) == ["project-b"]
    assert _ids(engine, ProjectMemory) == []
    assert _ids(engine, SpaceFileIndexOverlay) == []


def test_live_session_promoted_out_of_the_space_keeps_its_rows(fixture):
    client, engine = fixture
    # The Session was promoted from space-a into space-b and is still live.
    _add_session(engine, "project-moved", status="active", space_id="space-b")
    _add_dependents(engine, "project-moved", space_id="space-a")

    response = client.delete("/spaces/space-a")

    assert response.status_code == 204, response.text
    assert _ids(engine, Space) == ["space-b"]
    assert _ids(engine, Project) == ["project-b", "project-moved"]
    with Session(engine) as db:
        for model in (ChatHistory, Trigger, ProjectMemory):
            rows = db.exec(select(model).where(model.project_id == "project-moved")).all()
            assert [row.space_id for row in rows] == ["space-b"], model.__tablename__
    assert len(_ids(engine, TriggerExecution)) == 1
    assert _ids(engine, ProjectExecutionRoute) == ["project-moved"]
    for model in (SpaceMemory, SpaceFileIndex, SpaceFileIndexOverlay):
        assert _ids(engine, model) == [], model.__tablename__


def test_unknown_space_is_not_found(fixture):
    client, _engine = fixture
    assert client.delete("/spaces/space-missing").status_code == 404
