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

"""C6 uses the real authenticated Space API and synthetic SQLite only."""

import pytest
from sqlmodel import Session, select

from app.domains.space.api.space_controller import router
from app.model.project import Project
from tests import test_execution_configuration

authority = test_execution_configuration.authority


def test_session_configuration_patch_is_saved_and_returned(authority):
    a = authority
    a.client.app.include_router(router)
    payload = {
        "mode": "single-agent",
        "metadata": {
            "modelSelection": {
                "modelType": "custom",
                "provider_id": a.provider.id,
                "model_platform": "openai",
                "model_type": "gpt-5",
            },
            "thinkingEffort": "high",
        },
    }
    response = a.client.patch("/spaces/space/projects/project", headers=a.headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["mode"] == "single-agent"
    metadata = response.json()["metadata"]
    revision = metadata["spaceModelAdmissionRevision"]
    assert isinstance(revision, str) and len(revision) == 32
    assert metadata == {**payload["metadata"], "spaceModelAdmissionRevision": revision}
    with Session(a.engine) as db:
        saved = db.get(Project, "project")
        assert saved.mode == "single-agent" and saved.metadata_json == metadata
    response = a.client.get("/sync/execution/projects/project/configuration", headers=a.headers)
    assert response.status_code == 200, response.text
    assert response.json()["thinking_effort"] == "high"
    assert response.json()["session_mode"] == "single-agent"
    assert response.json()["space_source_type"] == "blank"
    bad = a.client.patch("/spaces/space/projects/project", headers=a.headers, json={"mode": "unsupported"})
    assert bad.status_code == 404
    with Session(a.engine) as db:
        assert db.get(Project, "project").mode == "single-agent"


def test_lost_create_ack_reuses_exact_creation_and_rejects_collision(authority):
    a = authority
    a.client.app.include_router(router)
    payload = {
        "id": "c6-session",
        "name": "Synthetic",
        "mode": "single-agent",
        "metadata": {"thinkingEffort": "medium"},
    }
    first = a.client.post("/spaces/space/projects", headers=a.headers, json=payload)
    assert first.status_code == 200, first.text
    assert a.client.post("/spaces/space/projects", headers=a.headers, json=payload).json() == first.json()
    assert (
        a.client.post("/spaces/space/projects", headers=a.headers, json={**payload, "name": "different"}).status_code
        == 404
    )
    with Session(a.engine) as db:
        assert len(db.exec(select(Project).where(Project.id == "c6-session")).all()) == 1


def test_original_creation_receipt_survives_mutable_settings_and_name(authority):
    from app.model.project.project import PROJECT_CREATION_INTENT_KEY

    a = authority
    a.client.app.include_router(router)
    payload = {
        "id": "receipt-session",
        "name": "Original draft",
        "mode": "single-agent",
        "metadata": {"thinkingEffort": "high"},
    }
    first = a.client.post("/spaces/space/projects", headers=a.headers, json=payload)
    assert first.status_code == 200, first.text
    assert PROJECT_CREATION_INTENT_KEY not in first.json()["metadata"]
    change = {"name": "Renamed Session", "status": "archived", "metadata": {"thinkingEffort": "low"}}
    updated = a.client.patch("/spaces/space/projects/receipt-session", headers=a.headers, json=change)
    assert updated.status_code == 200, updated.text
    # An ACK retry returns the current owned row without resetting its settings.
    retry = a.client.post("/spaces/space/projects", headers=a.headers, json=payload)
    assert retry.status_code == 200, retry.text
    assert retry.json() == updated.json()
    with Session(a.engine) as db:
        row = db.get(Project, "receipt-session")
        assert row.metadata_json[PROJECT_CREATION_INTENT_KEY]
        assert row.name == "Renamed Session" and row.metadata_json["thinkingEffort"] == "low"
    for metadata in ({PROJECT_CREATION_INTENT_KEY: "forged"}, {PROJECT_CREATION_INTENT_KEY: None}):
        assert (
            a.client.patch(
                "/spaces/space/projects/receipt-session", headers=a.headers, json={"metadata": metadata}
            ).status_code
            == 404
        )
        assert (
            a.client.post(
                "/spaces/space/projects", headers=a.headers, json={**payload, "metadata": metadata}
            ).status_code
            == 404
        )
    assert (
        a.client.post(
            "/spaces/space/projects", headers=a.headers, json={**payload, "name": "Changed creation"}
        ).status_code
        == 404
    )


def test_creation_receipt_cannot_recover_another_owner_or_space(authority):
    from app.model.space import Space
    from app.shared.auth import user_auth

    a = authority
    a.client.app.include_router(router)
    payload = {"id": "owned-receipt", "name": "draft", "mode": "single-agent"}
    assert a.client.post("/spaces/space/projects", headers=a.headers, json=payload).status_code == 200
    with Session(a.engine) as db:
        db.add(Space(id="second-space", user_id="1", name="Second"))
        db.add(Space(id="alien-space", user_id="2", name="Alien"))
        db.commit()
    alien = {**a.headers, "Authorization": "Bearer " + user_auth.create_access_token(2)}
    assert a.client.post("/spaces/second-space/projects", headers=a.headers, json=payload).status_code == 404
    assert a.client.post("/spaces/alien-space/projects", headers=alien, json=payload).status_code == 404
    assert (
        a.client.post(
            "/spaces/space/projects", headers=a.headers, json={**payload, "space_id": "second-space"}
        ).status_code
        == 404
    )
    with Session(a.engine) as db:
        row = db.get(Project, payload["id"])
        assert row.space_id == "space" and row.user_id == "1"


def test_concurrent_identical_creates_converge_through_authenticated_api(authority):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from app.core.database import session

    a = authority
    a.client.app.include_router(router)
    barrier = Barrier(2)

    class RacingSession(Session):
        def get(self, entity, ident, *args, **kwargs):
            result = super().get(entity, ident, *args, **kwargs)
            if entity is Project and ident == "concurrent-session" and result is None:
                barrier.wait(timeout=5)
            return result

    def database():
        with RacingSession(a.engine) as db:
            yield db

    a.client.app.dependency_overrides[session] = database
    payload = {"id": "concurrent-session", "name": "draft", "mode": "single-agent"}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda _: a.client.post("/spaces/space/projects", headers=a.headers, json=payload), range(2))
        )
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    with Session(a.engine) as db:
        assert len(db.exec(select(Project).where(Project.id == payload["id"])).all()) == 1


def test_concurrent_different_creations_reject_the_losing_intent(authority):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from app.core.database import session

    a = authority
    a.client.app.include_router(router)
    barrier = Barrier(2)

    class RacingSession(Session):
        def get(self, entity, ident, *args, **kwargs):
            result = super().get(entity, ident, *args, **kwargs)
            if entity is Project and ident == "conflicting-session" and result is None:
                barrier.wait(timeout=5)
            return result

    def database():
        with RacingSession(a.engine) as db:
            yield db

    a.client.app.dependency_overrides[session] = database

    def create(name):
        return a.client.post(
            "/spaces/space/projects",
            headers=a.headers,
            json={"id": "conflicting-session", "name": name, "mode": "single-agent"},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(create, ["First", "Second"]))
    assert sorted(response.status_code for response in responses) == [200, 404]
    winner = next(response.json() for response in responses if response.status_code == 200)
    with Session(a.engine) as db:
        assert db.get(Project, "conflicting-session").name == winner["name"]


def test_unrelated_integrity_errors_are_not_recovered(authority, monkeypatch):
    import sqlite3

    import pytest
    from sqlalchemy.exc import IntegrityError

    from app.domains.space.service.space_service import SpaceService
    from app.model.project import ProjectIn

    for code, message in [
        (2067, "UNIQUE constraint failed: project.name"),
        (787, "FOREIGN KEY constraint failed"),
        (1299, "NOT NULL constraint failed: project.user_id"),
    ]:
        original = sqlite3.IntegrityError(message)
        original.sqlite_errorcode = code
        failure = IntegrityError("synthetic statement", {}, original)
        with Session(authority.engine) as db:

            def fail():
                raise failure

            monkeypatch.setattr(db, "commit", fail)
            with pytest.raises(IntegrityError) as caught:
                SpaceService.create_project(
                    "space", ProjectIn(id="no-recovery", name="draft", mode="single-agent"), 1, db
                )
            assert caught.value is failure
    with Session(authority.engine) as db:
        assert db.get(Project, "no-recovery") is None


@pytest.mark.parametrize("constraint", ["project_pkey", "uix_project_user_id_id", "unrelated_unique"])
def test_postgres_identity_diagnostics_are_narrowly_recognized_without_remote_database(authority, constraint):
    from types import SimpleNamespace

    from sqlalchemy.exc import IntegrityError

    from app.domains.space.service.space_service import SpaceService
    from app.model.project import ProjectIn

    class SyntheticPostgresError(Exception):
        sqlstate = "23505"
        diag = SimpleNamespace(constraint_name=constraint)

    class CollisionSession(Session):
        winner = None

        def commit(self):
            self.winner = next(row for row in self.new if isinstance(row, Project)).model_copy(deep=True)
            raise IntegrityError("synthetic insert", {}, SyntheticPostgresError())

        def get(self, entity, ident, *args, **kwargs):
            if entity is Project and self.winner is not None:
                return self.winner
            return super().get(entity, ident, *args, **kwargs)

    with CollisionSession(authority.engine) as db:
        payload = ProjectIn(id="diagnostic-session", name="draft", mode="single-agent")
        if constraint == "unrelated_unique":
            with pytest.raises(IntegrityError):
                SpaceService.create_project("space", payload, 1, db)
        else:
            recovered = SpaceService.create_project("space", payload, 1, db)
            assert recovered is db.winner and recovered.user_id == "1" and recovered.space_id == "space"
