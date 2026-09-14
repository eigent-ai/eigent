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

from types import SimpleNamespace

from app.domains.chat.api.history_controller import (
    _clamp_chat_history_string_fields,
    _drop_stale_ongoing_status,
)
from app.model.chat.chat_history import ChatHistory, ChatStatus


def test_clamp_chat_history_string_fields_uses_column_limits():
    data = {
        "project_name": "p" * 200,
        "summary": "s" * 1100,
        "tokens": 42,
    }

    _clamp_chat_history_string_fields(data)

    assert len(data["project_name"]) == ChatHistory.project_name.type.length
    assert len(data["summary"]) == ChatHistory.summary.type.length
    assert data["tokens"] == 42


def test_drop_stale_ongoing_status_preserves_done_history():
    history = SimpleNamespace(status=ChatStatus.done)
    update_data = {"status": ChatStatus.ongoing.value, "tokens": 12}

    _drop_stale_ongoing_status(history, update_data)

    assert "status" not in update_data
    assert update_data["tokens"] == 12


def test_drop_stale_ongoing_status_keeps_forward_progress():
    history = SimpleNamespace(status=ChatStatus.ongoing)
    update_data = {"status": ChatStatus.done.value}

    _drop_stale_ongoing_status(history, update_data)

    assert update_data["status"] == ChatStatus.done.value


def test_automatic_names_preserve_session_identity_and_manual_placeholder_names():
    from sqlmodel import Session, create_engine
    from app.model.project import Project
    from app.domains.chat.api.history_controller import _sync_project_display_name

    engine = create_engine("sqlite://")
    Project.__table__.create(engine)
    with Session(engine) as session:
        project = Project(id="name-test", user_id="20", space_id="space", name="New project")
        session.add(project)
        session.commit()
        for title in ["Original request", "Follow-up title", "Stopped task title"]:
            _sync_project_display_name(session, user_id=20, project_id=project.id, project_name=title)
            session.commit()
        session.refresh(project)
        assert project.name == "Original request"
        assert project.metadata_json["nameSource"] == "initial"

        _sync_project_display_name(session, user_id=20, project_id=project.id, project_name="New project", explicit_rename=True)
        session.commit()
        _sync_project_display_name(session, user_id=20, project_id=project.id, project_name="Delayed summary")
        session.commit()
        session.expire_all()
        assert session.get(Project, project.id).name == "New project"
        assert project.metadata_json["nameSource"] == "manual"


def test_delayed_initial_name_cannot_overwrite_a_concurrent_manual_rename():
    from datetime import datetime, timedelta
    from sqlalchemy import update
    from sqlmodel import Session, create_engine
    from app.model.project import Project
    from app.domains.space.service.space_service import SpaceService

    engine = create_engine("sqlite://")
    Project.__table__.create(engine)
    with Session(engine, expire_on_commit=False) as session:
        project = Project(id="race-test", user_id="20", space_id="space", name="New project")
        session.add(project)
        session.commit()
        # Keep the stale ORM object while simulating a rename committed by another request.
        session.execute(update(Project).where(Project.id == project.id).values(
            name="My chosen name", metadata_json={"nameSource": "manual"},
            updated_at=datetime.now() + timedelta(seconds=1)
        ).execution_options(synchronize_session=False))
        session.commit()
        SpaceService.initialize_project_name(project, "Late initial title", session)
        session.commit()
        session.refresh(project)
        assert project.name == "My chosen name"
        assert project.metadata_json["nameSource"] == "manual"
