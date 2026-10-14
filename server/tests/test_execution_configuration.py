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

"""Real JWT/device/Provider/database paths with synthetic SQLite and no Redis I/O."""

import importlib.util
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session, create_engine

from app.core.database import session
from app.domains.model_provider.api.execution_controller import router
from app.domains.model_provider.service import provider_service
from app.domains.model_provider.service.provider_service import ProviderService
from app.domains.remote_control.api.command_control_controller import router as device_router
from app.model.project import Project
from app.model.provider.provider import Provider, ProviderIn, ProviderOut, VaildStatus
from app.model.remote_control.command_control import DesktopDevice
from app.model.space import Space
from app.model.user.user import User
from app.shared.auth import user_auth
from app.shared.exception import TokenException


@pytest.fixture
def authority(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + str(tmp_path / "authority.sqlite"), connect_args={"check_same_thread": False})
    for model in (User, Space, Project, Provider, DesktopDevice):
        model.__table__.create(engine)
    with Session(engine) as db:
        db.add(User(id=1, email="one@example.test"))
        db.add(User(id=2, email="two@example.test"))
        db.add(Space(id="space", user_id="1", name="Synthetic", root_path=str(tmp_path)))
        db.add(Project(id="project", user_id="1", space_id="space", name="Synthetic", mode="single-agent"))
        db.commit()

    async def blacklist(_jti):
        return False

    monkeypatch.setattr(user_auth, "is_blacklisted", blacklist)
    monkeypatch.setattr(provider_service, "session_make", lambda: Session(engine))

    def database():
        with Session(engine) as db:
            yield db

    app = FastAPI()
    app.dependency_overrides[session] = database
    app.include_router(device_router)
    app.include_router(router)

    @app.exception_handler(TokenException)
    async def rejected(_request, _exception):
        return JSONResponse(status_code=401, content={"code": "authentication_required"})

    provider = ProviderService.create(
        1,
        ProviderIn(
            provider_name="openai",
            model_type="gpt-5",
            api_key="synthetic-provider-secret",
            endpoint_url="https://api.openai.com/v1",
            is_valid=VaildStatus.is_valid,
            prefer=True,
        ).model_dump(),
    )["provider"]
    with TestClient(app) as client:
        headers = {"Authorization": "Bearer " + user_auth.create_access_token(1), "X-Desktop-Instance-ID": "device"}
        assert client.post("/sync/devices/register", headers=headers, json={}).status_code == 200
        yield SimpleNamespace(engine=engine, client=client, headers=headers, provider=provider)
    engine.dispose()


def reference(authority):
    response = authority.client.get("/sync/execution/projects/project/configuration", headers=authority.headers)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    assert "synthetic-provider-secret" not in response.text
    config = response.json()
    return {
        "provider_ref": config["provider"]["provider_ref"],
        "space_id": config["space_id"],
        "session_mode": config["session_mode"],
    }


def resolve(authority, ref):
    return authority.client.post(
        "/sync/execution/projects/project/credentials:resolve", headers=authority.headers, json=ref
    )


def test_existing_auth_and_exact_reference(authority):
    ref = reference(authority)
    result = resolve(authority, ref)
    assert result.status_code == 200, result.text
    assert result.json()["api_key"] == "synthetic-provider-secret"
    assert result.headers["cache-control"] == "no-store"
    # Legacy DTO remains compatible and never acquires the revision field.
    assert "execution_revision" not in ProviderOut.model_fields
    assert authority.client.get("/sync/execution/identity").status_code == 401
    alien = dict(authority.headers, Authorization="Bearer " + user_auth.create_access_token(2))
    assert authority.client.get("/sync/execution/identity", headers=alien).status_code in (403, 404)
    with Session(authority.engine) as db:
        device = db.get(DesktopDevice, "device")
        device.revoked_at = datetime.now(UTC)
        db.add(device)
        db.commit()
    assert resolve(authority, ref).status_code in (403, 404, 409)


@pytest.mark.parametrize("mutation", ["update", "invalidate", "delete", "raw", "orm", "owner"])
def test_every_provider_writer_invalidates_old_reference(authority, mutation):
    ref = reference(authority)
    identity = authority.provider.id
    if mutation == "update":
        ProviderService.update(identity, 1, {"api_key": "synthetic-rotated-secret"})
    elif mutation == "invalidate":
        ProviderService.invalidate(identity, 1)
    elif mutation == "delete":
        ProviderService.delete(identity, 1)
    else:
        with Session(authority.engine) as db:
            if mutation == "raw":
                db.execute(text("UPDATE provider SET encrypted_config='{}' WHERE id=:id"), {"id": identity})
            else:
                provider = db.get(Provider, identity)
                if mutation == "owner":
                    provider.user_id = 2
                else:
                    provider.model_type = "gpt-4o"
                db.add(provider)
            db.commit()
    with Session(authority.engine) as db:
        assert db.get(Provider, identity).execution_revision != ref["provider_ref"].split(":")[-1]
    assert resolve(authority, ref).status_code == 409


def test_preference_rollback_and_concurrent_writers(authority):
    ref = reference(authority)
    ProviderService.set_prefer(authority.provider.id, 1)
    assert reference(authority) == ref
    with Session(authority.engine) as db:
        db.execute(text("UPDATE provider SET api_key='rolled-back'"))
        changed = db.execute(text("SELECT execution_revision FROM provider")).scalar_one()
        assert changed != ref["provider_ref"].split(":")[-1]
        db.rollback()
    assert resolve(authority, ref).status_code == 200

    def write(index):
        with authority.engine.begin() as connection:
            connection.execute(text("UPDATE provider SET api_key=:key"), {"key": "synthetic-" + str(index)})
            return connection.execute(text("SELECT execution_revision FROM provider")).scalar_one()

    with ThreadPoolExecutor(max_workers=2) as pool:
        revisions = list(pool.map(write, range(4)))
    assert len(set(revisions)) == 4
    assert all(re.fullmatch("[0-9a-f]{32}", value) for value in revisions)
    assert resolve(authority, ref).status_code == 409


@pytest.mark.parametrize(
    "field,value", [("user_id", "2"), ("space_id", "other"), ("mode", "workforce"), ("status", "archived")]
)
def test_membership_and_mode_are_revalidated(authority, field, value):
    ref = reference(authority)
    with Session(authority.engine) as db:
        project = db.get(Project, "project")
        setattr(project, field, value)
        db.add(project)
        db.commit()
    assert resolve(authority, ref).status_code == 409


def test_current_intent_cannot_replace_exact_provider(authority):
    ref = reference(authority)
    with Session(authority.engine) as db:
        project = db.get(Project, "project")
        project.metadata_json = {
            "modelSelection": {"modelType": "custom", "provider_id": 999},
            "thinkingEffort": "high",
        }
        db.add(project)
        db.commit()
    assert resolve(authority, ref).json()["provider"]["provider_ref"] == ref["provider_ref"]
    assert (
        authority.client.get("/sync/execution/projects/project/configuration", headers=authority.headers).status_code
        == 409
    )


@pytest.mark.parametrize(
    "config",
    [
        {"api_key": "input-secret"},
        {"model_config_dict": {"n": True}},
        {"api_mode": "responses"},
        {"model_config_dict": {"headers": {"Authorization": "input-secret"}}},
    ],
)
def test_unsupported_configuration_and_input_do_not_echo_secrets(authority, config):
    ref = reference(authority)
    invalid = resolve(authority, dict(ref, api_key="input-secret"))
    assert invalid.status_code == 422 and "input-secret" not in invalid.text
    ProviderService.update(authority.provider.id, 1, {"encrypted_config": config})
    result = authority.client.get("/sync/execution/projects/project/configuration", headers=authority.headers)
    assert result.status_code == 409 and "input-secret" not in result.text


def test_upgrade_existing_rows_downgrade_and_old_insert(tmp_path):
    engine = create_engine("sqlite:///" + str(tmp_path / "migration.sqlite"))
    path = Path(__file__).parents[1] / "alembic/versions/2026_09_21_1200-provider_execution_revision.py"
    spec = importlib.util.spec_from_file_location("execution_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE provider (id INTEGER PRIMARY KEY, user_id INTEGER, provider_name TEXT, model_type TEXT, api_key TEXT, endpoint_url TEXT, encrypted_config TEXT, is_vaild INTEGER, deleted_at TEXT)"
            )
        )
        connection.execute(
            text("INSERT INTO provider (id,api_key) VALUES (1,'same-synthetic-secret'),(2,'same-synthetic-secret')")
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            revisions = connection.execute(text("SELECT execution_revision FROM provider")).scalars().all()
            assert len(set(revisions)) == 2 and all(re.fullmatch("[0-9a-f]{32}", value) for value in revisions)
            connection.execute(text("INSERT INTO provider (id,api_key) VALUES (3,'same-synthetic-secret')"))
            assert (
                connection.execute(text("SELECT execution_revision FROM provider WHERE id=3")).scalar_one()
                not in revisions
            )
            migration.downgrade()
            assert "execution_revision" not in {
                row[1] for row in connection.execute(text("PRAGMA table_info(provider)"))
            }
    engine.dispose()
