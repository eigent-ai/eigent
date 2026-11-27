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

"""Model provider routes keep metadata only: no key comes in, is stored, or goes out.

Real routes, a real SQLite database and the real validation. Every value named
SECRET or OLD is made up for these tests.
"""

import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi_pagination import add_pagination
from loguru import logger
from sqlalchemy import insert, text
from sqlalchemy.dialects import postgresql
from sqlmodel import Session, create_engine, select

from app.core.database import session
from app.domains.model_provider.api import provider_controller
from app.domains.model_provider.service import provider_service
from app.domains.model_provider.service.provider_service import ProviderService
from app.model.chat.chat_history import ChatHistory
from app.model.provider.metadata import parse_model_provider_write
from app.model.provider.provider import ModelProviderOut, Provider
from app.shared.auth import auth_must

# A value a client must never be able to store, and that must never come back.
SECRET = "made-up-value-that-must-not-appear"
# Values an older client stored in a row before keys moved to the device.
OLD_KEY = "made-up-old-stored-key"
OLD_LOGIN = "made-up-old-login-part"
OLD_ACCESS = "made-up-old-access-value"
OLD_HEADER = "made-up-old-header-value"
OLD_VALUES = (OLD_KEY, OLD_LOGIN, OLD_ACCESS, OLD_HEADER)

VALID = {
    "provider_name": "openai",
    "model_type": "gpt-5",
    "endpoint_url": "https://api.example.test/v1",
    "config": {"timeout": 30, "model_config_dict": {"temperature": 0.2}},
    "is_valid": 2,
}
ANSWER_FIELDS = {
    "id",
    "provider_name",
    "model_type",
    "endpoint_url",
    "config",
    "is_valid",
    "prefer",
    "execution_revision",
}
# Public API text: released desktop versions show it to the user.
RETIRED_TEXT = (
    "This version of Eigent can no longer save model provider settings. "
    "Update Eigent to the latest version to keep using your own models."
)


@pytest.fixture
def api(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + str(tmp_path / "providers.sqlite"), connect_args={"check_same_thread": False})
    Provider.__table__.create(engine)
    monkeypatch.setattr(provider_service, "session_make", lambda: Session(engine))
    # The translation middleware is not mounted in this small app.
    monkeypatch.setattr(provider_controller, "_", lambda message: message)
    caller = SimpleNamespace(id=1)

    def database():
        with Session(engine) as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[session] = database
    app.dependency_overrides[auth_must] = lambda: caller
    app.include_router(provider_controller.router)
    add_pagination(app)

    lines: list[str] = []
    sink = logger.add(lambda message: lines.append(f"{message}{message.record['extra']!r}"), level="DEBUG")
    with TestClient(app) as client:
        yield SimpleNamespace(engine=engine, client=client, caller=caller, lines=lines)
    logger.remove(sink)
    engine.dispose()


def rows(api, columns="id, user_id, provider_name, model_type, api_key, endpoint_url, encrypted_config, prefer"):
    with api.engine.connect() as connection:
        return [dict(row._mapping) for row in connection.execute(text(f"SELECT {columns} FROM provider ORDER BY id"))]


def create(api, **changes):
    response = api.client.post("/model-providers", json={**VALID, **changes})
    assert response.status_code == 200, response.text
    return response.json()


def older_client_row(api, user_id=1) -> int:
    """A row as an older client saved it: key, login in the address, cloud access values."""
    provider = ProviderService.create(user_id, parse_model_provider_write(VALID))["provider"]
    with api.engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE provider SET api_key=:key, endpoint_url=:url, encrypted_config=:config, is_vaild=2 WHERE id=:id"
            ),
            {
                "id": provider.id,
                "key": OLD_KEY,
                "url": f"https://user:{OLD_LOGIN}@api.example.test/v1",
                "config": json.dumps(
                    {
                        "aws_access_key_id": OLD_ACCESS,
                        "aws_secret_access_key": OLD_ACCESS,
                        "region_name": "us-east-1",
                        "model_config_dict": {"temperature": 0.3, "extra_headers": {"Authorization": OLD_HEADER}},
                    }
                ),
            },
        )
    return provider.id


def assert_nothing_old(api, *responses):
    for response in responses:
        for value in OLD_VALUES:
            assert value not in response.text, response.request.url
    assert not [line for line in api.lines if any(value in line for value in OLD_VALUES)]


def test_create_stores_metadata_only(api):
    created = create(api)
    assert set(created) == ANSWER_FIELDS
    assert created["config"] == {"timeout": 30, "model_config_dict": {"temperature": 0.2}}
    assert created["is_valid"] == 2 and created["prefer"] is False
    assert len(created["execution_revision"]) == 32

    (row,) = rows(api)
    # The old column is still required by the table; a new row leaves it empty.
    assert row["api_key"] == ""
    assert row["user_id"] == 1
    assert json.loads(row["encrypted_config"]) == created["config"]
    assert api.client.get(f"/model-providers/{created['id']}").json() == created


def test_boolean_validity_and_missing_optional_fields_are_accepted(api):
    created = create(api, is_valid=True, endpoint_url="", config=None)
    assert created["is_valid"] == 2 and created["endpoint_url"] == "" and created["config"] == {}
    response = api.client.post("/model-providers", json={"provider_name": "ollama", "model_type": ""})
    assert response.status_code == 200 and response.json()["is_valid"] == 1


@pytest.mark.parametrize(
    "body,fields",
    [
        ({**VALID, "api_key": SECRET}, ["api_key"]),
        ({**VALID, "encrypted_config": {"aws_secret_access_key": SECRET}}, ["encrypted_config"]),
        ({**VALID, "config": {"aws_secret_access_key": SECRET}}, ["config.aws_secret_access_key"]),
        ({**VALID, "config": {"default_headers": {"Authorization": SECRET}}}, ["config.default_headers"]),
        (
            {**VALID, "config": {"model_config_dict": {"extra_headers": {"Authorization": SECRET}}}},
            ["config.model_config_dict.extra_headers"],
        ),
        # A field name chosen by the client is not repeated either.
        ({**VALID, SECRET: "x"}, ["unknown_field"]),
        ({**VALID, "config": {SECRET: "x"}}, ["config.unknown_field"]),
        ({**VALID, "endpoint_url": f"https://user:{SECRET}@api.example.test/v1"}, ["endpoint_url"]),
        ({**VALID, "endpoint_url": f"https://api.example.test/v1?key={SECRET}"}, ["endpoint_url"]),
        ({**VALID, "endpoint_url": f"https://api.example.test/v1#{SECRET}"}, ["endpoint_url"]),
        ({**VALID, "endpoint_url": f"ftp://api.example.test/{SECRET}"}, ["endpoint_url"]),
        ({**VALID, "model_type": "sk-" + SECRET}, ["model_type"]),
        ({**VALID, "model_type": "Bearer " + SECRET}, ["model_type"]),
        ({**VALID, "config": {"region_name": "AKIA" + "X" * 16}}, ["config.region_name"]),
        ({**VALID, "config": {"model_config_dict": {"temperature": SECRET}}}, ["config.model_config_dict.temperature"]),
        ({**VALID, "config": {"timeout": True}}, ["config.timeout"]),
        ({**VALID, "provider_name": SECRET + " with spaces"}, ["provider_name"]),
        ({"model_type": "gpt-5", "api_key": SECRET}, ["api_key", "provider_name"]),
        ([SECRET], ["body"]),
    ],
)
def test_a_write_with_a_secret_is_refused_and_nothing_is_stored(api, body, fields):
    existing = create(api)
    for response in (
        api.client.post("/model-providers", json=body),
        api.client.put(f"/model-providers/{existing['id']}", json=body),
    ):
        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert detail["code"] == "invalid_model_provider"
        assert detail["fields"] == fields
        assert SECRET not in response.text
    assert not [line for line in api.lines if SECRET in line]
    # Nothing was added and the existing row was not changed.
    assert len(rows(api)) == 1
    assert SECRET not in json.dumps(rows(api))
    assert api.client.get(f"/model-providers/{existing['id']}").json() == existing


@pytest.mark.parametrize("content", [b"api_key=" + SECRET.encode(), b"{" + SECRET.encode(), b"x" * (16 * 1024 + 1)])
def test_a_body_that_is_not_a_small_json_object_is_refused_without_an_echo(api, content):
    response = api.client.post("/model-providers", content=content, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()["detail"]["fields"] == ["body"]
    assert SECRET not in response.text
    assert rows(api) == []


def test_update_replaces_metadata_and_keeps_the_default_flag(api):
    provider_id = older_client_row(api)
    assert api.client.post("/model-providers/prefer", json={"provider_id": provider_id}).json() == {"success": True}

    updated = api.client.put(f"/model-providers/{provider_id}", json={**VALID, "model_type": "gpt-4o", "config": {}})
    assert updated.status_code == 200, updated.text
    assert updated.json()["model_type"] == "gpt-4o"
    assert updated.json()["prefer"] is True
    assert updated.json()["config"] == {}
    assert_nothing_old(api, updated)
    # The settings an older client saved are replaced by the new, plain ones.
    assert json.loads(rows(api)[0]["encrypted_config"]) == {}


def test_rows_of_older_clients_are_listed_without_their_secrets(api):
    provider_id = older_client_row(api)
    listed = api.client.get("/model-providers")
    one = api.client.get(f"/model-providers/{provider_id}")
    catalog = api.client.get("/provider-models")
    invalidated = api.client.patch(f"/model-providers/{provider_id}/invalidate")
    preferred = api.client.post("/model-providers/prefer", json={"provider_id": provider_id})
    assert [r.status_code for r in (listed, one, catalog, invalidated, preferred)] == [200] * 5
    assert_nothing_old(api, listed, one, catalog, invalidated, preferred)

    (item,) = listed.json()["items"]
    assert set(item) == ANSWER_FIELDS
    # An address with a login part is not passed through; plain settings are.
    assert item["endpoint_url"] == ""
    assert item["config"] == {"region_name": "us-east-1", "model_config_dict": {"temperature": 0.3}}
    assert one.json()["id"] == provider_id


def test_list_filters_and_pages(api):
    first = create(api)
    second = create(api, provider_name="ollama", model_type="local_model", endpoint_url="http://localhost:11434/v1")
    api.client.post("/model-providers/prefer", json={"provider_id": second["id"]})

    page = api.client.get("/model-providers", params={"page": 1, "size": 1}).json()
    assert page["total"] == 2 and len(page["items"]) == 1
    assert [item["id"] for item in api.client.get("/model-providers", params={"prefer": True}).json()["items"]] == [
        second["id"]
    ]
    assert [item["id"] for item in api.client.get("/model-providers", params={"keyword": "open"}).json()["items"]] == [
        first["id"]
    ]
    # "%" and "_" in a keyword are plain characters, not wildcards.
    assert api.client.get("/model-providers", params={"keyword": "%"}).json()["items"] == []


def test_another_users_provider_is_not_found_and_keeps_its_default(api):
    provider_id = create(api)["id"]
    api.client.post("/model-providers/prefer", json={"provider_id": provider_id})
    api.caller.id = 2
    assert api.client.get("/model-providers").json()["items"] == []
    for response in (
        api.client.get(f"/model-providers/{provider_id}"),
        api.client.put(f"/model-providers/{provider_id}", json=VALID),
        api.client.delete(f"/model-providers/{provider_id}"),
        api.client.patch(f"/model-providers/{provider_id}/invalidate"),
        api.client.post("/model-providers/prefer", json={"provider_id": provider_id}),
    ):
        assert response.status_code == 404, response.text
        assert response.json() == {"detail": "Provider not found"}
    (row,) = rows(api)
    assert row["user_id"] == 1 and bool(row["prefer"]) is True


def test_an_unknown_default_leaves_the_current_default(api):
    provider_id = create(api)["id"]
    api.client.post("/model-providers/prefer", json={"provider_id": provider_id})
    assert api.client.post("/model-providers/prefer", json={"provider_id": provider_id + 100}).status_code == 404
    assert api.client.get(f"/model-providers/{provider_id}").json()["prefer"] is True


def test_delete_and_invalidate(api):
    provider_id = create(api)["id"]
    assert api.client.patch(f"/model-providers/{provider_id}/invalidate").json() == {"success": True}
    assert api.client.get(f"/model-providers/{provider_id}").json()["is_valid"] == 1
    assert api.client.delete(f"/model-providers/{provider_id}").status_code == 204
    assert api.client.get(f"/model-providers/{provider_id}").status_code == 404
    assert api.client.delete(f"/model-providers/{provider_id}").status_code == 404


# --- Routes that released desktop versions still call ---------------------


@pytest.mark.parametrize("params", [{}, {"prefer": True}, {"page": 1, "size": 100}, {"keyword": "openai"}])
def test_retired_list_is_always_empty(api, params):
    older_client_row(api)
    create(api)
    response = api.client.get("/providers", params=params)
    assert response.status_code == 200
    # The shape older versions read: "items" of a page. Empty, so they report
    # "no model provider is configured" instead of starting a run without a key.
    assert response.json() == {"items": [], "total": 0, "page": 1, "size": params.get("size", 50), "pages": 0}
    assert_nothing_old(api, response)


def test_retired_detail_is_not_found(api):
    provider_id = older_client_row(api)
    response = api.client.get("/provider", params={"id": provider_id})
    assert response.status_code == 404 and response.json() == {"detail": "Provider not found"}
    assert_nothing_old(api, response)


def test_retired_writes_are_refused_with_a_clear_text_and_store_nothing(api):
    provider_id = older_client_row(api)
    before = rows(api)
    # What a released desktop version sends when the user saves a model.
    old_body = {
        "provider_name": "openai",
        "model_type": "gpt-5",
        "api_key": SECRET,
        "endpoint_url": "https://api.example.test/v1",
        "encrypted_config": {"aws_secret_access_key": SECRET},
        "is_valid": 2,
        "prefer": False,
    }
    responses = [
        api.client.post("/provider", json=old_body),
        api.client.put(f"/provider/{provider_id}", json=old_body),
        # The body is never read, so a broken one gets the same answer.
        api.client.post("/provider", content=b"{" + SECRET.encode(), headers={"Content-Type": "application/json"}),
    ]
    for response in responses:
        # Not a 200 with {code, text}: older versions would take that as success.
        assert response.status_code == 410
        assert response.json() == {"detail": RETIRED_TEXT}
        assert SECRET not in response.text
    assert rows(api) == before
    assert not [line for line in api.lines if SECRET in line]
    assert_nothing_old(api, *responses)


def test_routes_without_a_secret_keep_their_old_paths(api):
    provider_id = create(api)["id"]
    assert api.client.post("/provider/prefer", json={"provider_id": provider_id}).json() == {"success": True}
    assert api.client.patch(f"/provider/{provider_id}/invalidate").json() == {"success": True}
    assert api.client.delete(f"/provider/{provider_id}").status_code == 204
    assert rows(api, "deleted_at")[0]["deleted_at"] is not None


# --- The old column cannot be reached from code ----------------------------


@pytest.mark.parametrize("model", [Provider, ChatHistory])
def test_the_old_key_column_is_not_part_of_the_model(model):
    assert "api_key" not in model.model_fields
    assert not hasattr(model, "api_key")
    assert "api_key" not in {attribute.key for attribute in model.__mapper__.column_attrs}
    # No ORM query selects it, on either database.
    assert "api_key" not in str(select(model).compile(dialect=postgresql.dialect()))
    assert "api_key" not in str(select(model))
    # The table still has it (required, until it is dropped), and an insert
    # that does not name it fills it with an empty value.
    column = model.__table__.c.api_key
    assert column.nullable is False and column.default.arg == ""
    statement = insert(model.__table__).values(user_id=1).compile(dialect=postgresql.dialect())
    assert "api_key" in statement.params and "%(api_key)s" in str(statement)


def test_the_answer_model_has_no_field_for_a_key():
    assert set(ModelProviderOut.model_fields) == ANSWER_FIELDS
    assert "api_key" not in str(ProviderService.owned(1).compile(dialect=postgresql.dialect()))
