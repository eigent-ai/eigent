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

"""A task's history never holds, copies or returns a model provider key.

Every value named SECRET or OLD is made up for these tests.
"""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from fastapi_pagination import add_pagination
from loguru import logger
from sqlalchemy import event, text
from sqlmodel import Session, SQLModel, create_engine

from app.core.database import session
from app.domains.chat.api import history_controller
from app.domains.model_provider.service import provider_service
from app.domains.model_provider.service.provider_service import ProviderService
from app.domains.remote_control.service.remote_control_service import RemoteControlService
from app.model.chat.chat_history import ChatHistory, ChatHistoryIn, ChatHistoryOut
from app.model.project import Project
from app.model.provider.metadata import parse_model_provider_write, public_address
from app.model.provider.provider import Provider
from app.model.space import Space
from app.model.trigger.trigger import Trigger
from app.model.user.key import Key
from app.shared.auth import auth_must

SECRET = "made-up-value-that-must-not-appear"
OLD_KEY = "made-up-old-stored-key"
OLD_LOGIN = "made-up-old-login-part"
OLD_VALUES = (OLD_KEY, OLD_LOGIN)


@pytest.fixture
def api(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + str(tmp_path / "history.sqlite"), connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(
        engine, tables=[model.__table__ for model in (ChatHistory, Trigger, Key, Space, Project, Provider)]
    )
    monkeypatch.setattr(provider_service, "session_make", lambda: Session(engine))

    # Every statement the code under test runs. Statements of the test itself
    # go through raw() and are left out.
    statements: list[str] = []
    own = {"active": False}

    def record(_connection, _cursor, statement, _parameters, _context, _many):
        if not own["active"]:
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)

    def raw(sql, **parameters):
        own["active"] = True
        try:
            with engine.begin() as connection:
                result = connection.execute(text(sql), parameters)
                return [dict(row._mapping) for row in result] if result.returns_rows else []
        finally:
            own["active"] = False

    def database():
        with Session(engine) as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[session] = database
    app.dependency_overrides[auth_must] = lambda: SimpleNamespace(id=1)
    app.include_router(history_controller.router)
    add_pagination(app)

    lines: list[str] = []
    sink = logger.add(lambda message: lines.append(f"{message}{message.record['extra']!r}"), level="DEBUG")
    with TestClient(app) as client:
        yield SimpleNamespace(engine=engine, client=client, raw=raw, statements=statements, lines=lines)
    logger.remove(sink)
    engine.dispose()


def saved_by_an_older_client(api, task_id="old-task", project_id="old-project") -> int:
    """A history row with a key copy and an address with a login part, as older clients left it."""
    with Session(api.engine) as db:
        row = ChatHistory(
            user_id=1,
            task_id=task_id,
            project_id=project_id,
            question="q",
            language="en",
            model_platform="openai",
            model_type="gpt-5",
            api_url="",
            installed_mcp="{}",
        )
        db.add(row)
        db.commit()
        history_id = row.id
    api.raw(
        "UPDATE chat_history SET api_key=:key, api_url=:url WHERE id=:id",
        id=history_id,
        key=OLD_KEY,
        url=f"https://user:{OLD_LOGIN}@api.example.test/v1?token={OLD_LOGIN}",
    )
    return history_id


def assert_the_old_column_is_only_ever_filled_empty(api):
    reads = [s for s in api.statements if "api_key" in s and not s.lstrip().upper().startswith("INSERT")]
    assert not reads, reads


def test_request_and_answer_models_have_no_key_field():
    assert "api_key" not in ChatHistoryIn.model_fields
    assert "api_key" not in ChatHistoryOut.model_fields
    data = ChatHistoryIn(
        task_id="t",
        question="q",
        language="en",
        model_platform="openai",
        model_type="gpt-5",
        api_key=SECRET,
        api_url=f"https://user:{SECRET}@api.example.test/v1?key={SECRET}#{SECRET}",
    )
    assert SECRET not in data.model_dump_json()
    assert data.api_url == "https://api.example.test/v1"


@pytest.mark.parametrize(
    "value,kept",
    [
        ("cloud", "cloud"),
        ("", ""),
        ("https://api.example.test/v1", "https://api.example.test/v1"),
        ("http://localhost:11434/v1", "http://localhost:11434/v1"),
        (f"https://user:{SECRET}@api.example.test:8443/v1", "https://api.example.test:8443/v1"),
        (f"https://api.example.test/v1?api_key={SECRET}", "https://api.example.test/v1"),
        (f"https://api.example.test/sk-{SECRET}/v1", "https://api.example.test"),
        ("sk-" + SECRET, ""),
        ("Bearer " + SECRET, ""),
        (None, ""),
    ],
)
def test_an_address_is_kept_as_a_label_without_secret_parts(value, kept):
    assert public_address(value) == kept


def test_saving_history_drops_a_key_an_older_client_sends(api):
    response = api.client.post(
        "/chat/history",
        json={
            "task_id": "task-1",
            "question": "q",
            "language": "en",
            "model_platform": "openai",
            "model_type": "gpt-5",
            "api_key": SECRET,
            "api_url": f"https://user:{SECRET}@api.example.test/v1?token={SECRET}",
            "installed_mcp": "{}",
        },
    )
    assert response.status_code == 200, response.text
    assert "api_key" not in response.json()
    assert response.json()["api_url"] == "https://api.example.test/v1"
    assert SECRET not in response.text

    (row,) = api.raw("SELECT * FROM chat_history")
    assert row["api_key"] == ""
    assert SECRET not in repr(row)
    assert not [line for line in api.lines if SECRET in line]
    assert_the_old_column_is_only_ever_filled_empty(api)


def test_a_cloud_run_keeps_its_billing_marker(api):
    response = api.client.post(
        "/chat/history",
        json={
            "task_id": "task-cloud",
            "question": "q",
            "language": "en",
            "model_platform": "openai",
            "model_type": "gpt-5",
            "api_url": "cloud",
            "installed_mcp": "{}",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["api_url"] == "cloud"
    assert api.raw("SELECT api_url FROM chat_history")[0]["api_url"] == "cloud"


def test_history_saved_by_older_clients_is_returned_without_the_key(api):
    history_id = saved_by_an_older_client(api)
    responses = [
        api.client.get("/chat/histories"),
        api.client.get("/chat/histories/grouped"),
        api.client.get("/chat/histories/grouped/old-project"),
        api.client.put(f"/chat/history/{history_id}", json={"summary": "done"}),
    ]
    for response in responses:
        assert response.status_code == 200, response.text
        assert "api_key" not in response.text
        for value in OLD_VALUES:
            assert value not in response.text
    assert responses[0].json()["items"][0]["api_url"] == "https://api.example.test/v1"
    assert responses[1].json()["projects"][0]["tasks"][0]["api_url"] == "https://api.example.test/v1"
    assert not [line for line in api.lines if any(value in line for value in OLD_VALUES)]
    assert_the_old_column_is_only_ever_filled_empty(api)


def remote_task(api, task_id, target_task_id=None) -> dict:
    with Session(api.engine) as db:
        RemoteControlService._create_history_for_command(
            1, "space", "remote-project", target_task_id, SimpleNamespace(payload={"content": "hello"}), task_id, db
        )
        db.commit()
    (row,) = api.raw("SELECT * FROM chat_history WHERE task_id=:task", task=task_id)
    return row


def test_a_remote_task_takes_labels_from_the_default_provider_and_no_key(api):
    provider = ProviderService.create(
        1,
        parse_model_provider_write(
            {"provider_name": "openai", "model_type": "gpt-5", "endpoint_url": "https://api.example.test/v1"}
        ),
    )["provider"]
    assert ProviderService.set_prefer(provider.id, 1)["success"]
    # The provider row as an older client left it.
    api.raw(
        "UPDATE provider SET api_key=:key, endpoint_url=:url",
        key=OLD_KEY,
        url=f"https://user:{OLD_LOGIN}@api.example.test/v1",
    )

    row = remote_task(api, "remote-1")
    assert row["api_key"] == ""
    assert (row["model_platform"], row["model_type"]) == ("openai", "gpt-5")
    assert row["api_url"] == "https://api.example.test/v1"
    assert not any(value in repr(row) for value in OLD_VALUES)
    assert_the_old_column_is_only_ever_filled_empty(api)


def test_a_remote_task_does_not_copy_the_key_of_an_older_history_row(api):
    saved_by_an_older_client(api, task_id="older", project_id="remote-project")
    for task_id, target in (("remote-2", None), ("remote-3", "older")):
        row = remote_task(api, task_id, target)
        assert row["api_key"] == ""
        assert row["api_url"] == "https://api.example.test/v1"
        assert not any(value in repr(row) for value in OLD_VALUES)
    assert_the_old_column_is_only_ever_filled_empty(api)


def test_a_remote_task_still_needs_a_default_provider_when_there_is_no_history(api):
    with Session(api.engine) as db, pytest.raises(HTTPException) as refused:
        RemoteControlService._create_history_for_command(
            1, "space", "remote-project", None, SimpleNamespace(payload={}), "remote-4", db
        )
    assert refused.value.status_code == 400
    assert refused.value.detail == {"code": "REMOTE_MODEL_PROVIDER_REQUIRED"}
