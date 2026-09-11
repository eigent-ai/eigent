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

from __future__ import annotations

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.domains.space.service.deletion_service import SpaceDeletionService
from app.model.chat.chat_history import ChatHistory
from app.model.memory import ProjectMemory, SpaceMemory
from app.model.project import Project
from app.model.space import (
    Space,
    SpaceFileIndex,
    SpaceFileIndexOverlay,
    SpaceSourceType,
)
from app.model.trigger.trigger import Trigger
from app.model.trigger.trigger_execution import TriggerExecution


@pytest.fixture
def db_session():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(
        engine,
        tables=[
            Space.__table__,
            Project.__table__,
            ChatHistory.__table__,
            SpaceMemory.__table__,
            ProjectMemory.__table__,
            SpaceFileIndex.__table__,
            SpaceFileIndexOverlay.__table__,
            Trigger.__table__,
            TriggerExecution.__table__,
        ],
    )
    with Session(engine) as session:
        yield session


def _seed_space_project(db_session: Session, suffix: str = "one") -> tuple[str, str]:
    space_id = f"space-{suffix}"
    project_id = f"project-{suffix}"
    task_id = f"task-{suffix}"

    db_session.add(
        Space(
            id=space_id,
            user_id="1",
            name=f"Space {suffix}",
            source_type=SpaceSourceType.BLANK,
        )
    )
    db_session.add(
        Project(
            id=project_id,
            user_id="1",
            space_id=space_id,
            name=f"Project {suffix}",
        )
    )
    db_session.add(
        ChatHistory(
            user_id=1,
            task_id=task_id,
            project_id=project_id,
            space_id=space_id,
            run_id=task_id,
            question="test",
            language="en",
            model_platform="local",
            model_type="test",
            api_key="",
            api_url="http://localhost",
        )
    )
    db_session.add(
        SpaceMemory(
            user_id="1",
            space_id=space_id,
            key=f"space-memory-{suffix}",
        )
    )
    db_session.add(
        ProjectMemory(
            user_id="1",
            space_id=space_id,
            project_id=project_id,
            key=f"project-memory-{suffix}",
        )
    )
    db_session.add(
        SpaceFileIndex(
            space_id=space_id,
            path=f"src/{suffix}.rs",
        )
    )
    db_session.add(
        SpaceFileIndexOverlay(
            space_id=space_id,
            project_id=project_id,
            run_id=task_id,
            path=f"src/{suffix}.rs",
            status="modified",
        )
    )
    db_session.commit()
    return space_id, project_id


def test_delete_project_removes_durable_project_data_but_keeps_space(db_session):
    space_id, project_id = _seed_space_project(db_session)

    SpaceDeletionService.delete_project(
        project_id,
        1,
        db_session,
        space_id=space_id,
    )

    assert db_session.get(Project, project_id) is None
    assert db_session.exec(
        select(ChatHistory).where(ChatHistory.project_id == project_id)
    ).first() is None
    assert db_session.exec(
        select(ProjectMemory).where(ProjectMemory.project_id == project_id)
    ).first() is None
    assert db_session.exec(
        select(SpaceFileIndexOverlay).where(
            SpaceFileIndexOverlay.project_id == project_id
        )
    ).first() is None

    # Project deletion must not remove Space-scoped state.
    assert db_session.get(Space, space_id) is not None
    assert db_session.exec(
        select(SpaceMemory).where(SpaceMemory.space_id == space_id)
    ).first() is not None
    assert db_session.exec(
        select(SpaceFileIndex).where(SpaceFileIndex.space_id == space_id)
    ).first() is not None


def test_delete_space_cascades_projects_and_space_scoped_data(db_session):
    space_id, project_id = _seed_space_project(db_session, "cascade")

    SpaceDeletionService.delete_space(space_id, 1, db_session)

    assert db_session.get(Space, space_id) is None
    assert db_session.get(Project, project_id) is None
    assert db_session.exec(
        select(ChatHistory).where(ChatHistory.space_id == space_id)
    ).first() is None
    assert db_session.exec(
        select(ProjectMemory).where(ProjectMemory.space_id == space_id)
    ).first() is None
    assert db_session.exec(
        select(SpaceMemory).where(SpaceMemory.space_id == space_id)
    ).first() is None
    assert db_session.exec(
        select(SpaceFileIndexOverlay).where(
            SpaceFileIndexOverlay.space_id == space_id
        )
    ).first() is None
    assert db_session.exec(
        select(SpaceFileIndex).where(SpaceFileIndex.space_id == space_id)
    ).first() is None


def test_delete_project_rejects_project_owned_by_another_user(db_session):
    space_id, project_id = _seed_space_project(db_session, "ownership")

    with pytest.raises(ValueError, match="Project not found"):
        SpaceDeletionService.delete_project(
            project_id,
            2,
            db_session,
            space_id=space_id,
        )

    assert db_session.get(Project, project_id) is not None
