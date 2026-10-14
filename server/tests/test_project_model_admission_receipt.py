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

"""Receipt cleanup ordering through real HTTP, SpaceService and isolated SQLite."""

import asyncio
import contextvars
import threading
from types import SimpleNamespace

import httpx
import pytest
from app.core.database import session as database_session
from app.domains.space.api.space_controller import router
from app.model.project import Project
from app.model.space import Space
from app.shared.auth import auth_must
from fastapi import FastAPI, Request
from sqlalchemy import event
from sqlmodel import Session, create_engine

OLD = "never-sent-run"
NEW = "unknown-ack-run"
CLEANUP = {
    "metadata": {"spaceModelAdmissionRunId": None},
    "expected_model_admission_run_id": OLD,
}
NEW_RECEIPT = {"metadata": {"spaceModelAdmissionRunId": NEW}}
MANUAL = {"modelType": "cloud", "cloud_model_type": "manual"}
ENDPOINT = "/spaces/space-a/projects/project-a"


@pytest.fixture
def fixture(tmp_path):
    engine = create_engine(
        "sqlite:///" + str(tmp_path / "receipt.sqlite3"),
        connect_args={"check_same_thread": False, "timeout": 5},
    )
    Space.__table__.create(engine)
    Project.__table__.create(engine)
    with Session(engine) as db:
        for space_id, user_id in [("space-a", "7"), ("space-b", "7"), ("space-other", "8")]:
            db.add(Space(id=space_id, user_id=user_id, name="Synthetic Space"))
        db.add(
            Project(
                id="project-a",
                space_id="space-a",
                user_id="7",
                name="Synthetic Session",
                metadata_json={"spaceModelAdmissionRunId": OLD, "unrelated": {"keep": True}},
            )
        )
        db.commit()

    app = FastAPI()
    app.include_router(router)

    def fixture_session():
        with Session(engine) as db:
            yield db

    def fixture_auth(request: Request):
        return SimpleNamespace(id=int(request.headers.get("x-fixture-user", "7")))

    app.dependency_overrides[database_session] = fixture_session
    app.dependency_overrides[auth_must] = fixture_auth
    try:
        yield app, engine
    finally:
        engine.dispose()


async def patch(client, body, endpoint=ENDPOINT, **kwargs):
    if "model_admission_revision" in body:
        endpoint += "/model-admission/transition"
    elif "expected_model_admission_run_id" in body:
        endpoint += "/model-admission"
    return await client.patch(endpoint, json=body, **kwargs)


def metadata(engine):
    with Session(engine) as db:
        return db.get(Project, "project-a").metadata_json


def test_both_successful_patch_orders_retain_the_new_receipt(fixture):
    app, engine = fixture

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid"
        ) as client:
            for reverse in [False, True]:
                await patch(client, {"metadata": {"spaceModelAdmissionRunId": OLD}})
                for body in [NEW_RECEIPT, CLEANUP] if reverse else [CLEANUP, NEW_RECEIPT]:
                    response = await patch(client, body)
                    assert response.status_code == 200, response.text
                    assert "expected_model_admission_run_id" not in response.json()
                assert metadata(engine) == {"spaceModelAdmissionRunId": NEW, "unrelated": {"keep": True}}

    asyncio.run(exercise())


@pytest.mark.parametrize("failure", ["lost-response", "error-response", "failed-before-commit"])
def test_uncertain_cleanup_retry_cannot_clear_a_later_receipt(fixture, failure):
    app, engine = fixture
    first = True

    async def uncertain_response(scope, receive, send):
        nonlocal first
        if first:
            first = False
            if failure != "failed-before-commit":

                async def discard(message):
                    pass

                await app(scope, receive, discard)
            if failure == "lost-response":
                raise httpx.ReadError("Synthetic response lost after commit")
            await send({"type": "http.response.start", "status": 503, "headers": []})
            await send({"type": "http.response.body", "body": b"Synthetic failure"})
            return
        await app(scope, receive, send)

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=uncertain_response), base_url="http://fixture.invalid"
        ) as client:
            if failure == "lost-response":
                with pytest.raises(httpx.ReadError):
                    await patch(client, CLEANUP)
            else:
                assert (await patch(client, CLEANUP)).status_code == 503
            assert (await patch(client, NEW_RECEIPT)).status_code == 200
            for _ in range(2):
                assert (await patch(client, CLEANUP)).status_code == 200
            assert metadata(engine)["spaceModelAdmissionRunId"] == NEW
            # A legitimate later cleanup can still release that exact Run.
            response = await patch(client, {**CLEANUP, "expected_model_admission_run_id": NEW})
            assert response.status_code == 200
            assert metadata(engine) == {"spaceModelAdmissionRunId": None, "unrelated": {"keep": True}}

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "body",
    [
        {"metadata": {"modelSelection": MANUAL, "spaceModelAdmissionRunId": None}},
        {"metadata": {"modelSelection": MANUAL}},
        {"metadata": {"other": [1, 2]}},
    ],
)
def test_cleanup_preserves_manual_model_and_other_metadata(fixture, body):
    app, engine = fixture

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid"
        ) as client:
            assert (await patch(client, body)).status_code == 200
            assert (await patch(client, CLEANUP)).status_code == 200
            actual = metadata(engine)
            for key, value in body["metadata"].items():
                assert actual[key] == value
            assert actual["unrelated"] == {"keep": True}

    asyncio.run(exercise())


@pytest.mark.parametrize("space,user", [("space-a", "8"), ("space-b", "7"), ("space-other", "8")])
def test_cleanup_is_scoped_to_account_and_space(fixture, space, user):
    app, engine = fixture

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid"
        ) as client:
            response = await patch(
                client, CLEANUP, endpoint=f"/spaces/{space}/projects/project-a", headers={"x-fixture-user": user}
            )
            assert response.status_code == 404
            assert metadata(engine)["spaceModelAdmissionRunId"] == OLD

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "extra",
    [
        {"metadata": {"spaceModelAdmissionRunId": NEW}},
        {"metadata": {"spaceModelAdmissionRunId": None, "modelSelection": MANUAL}},
        {"name": "Changed"},
        {"expected_model_admission_run_id": ""},
    ],
)
def test_conditional_cleanup_cannot_smuggle_other_updates(fixture, extra):
    app, engine = fixture

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid"
        ) as client:
            response = await patch(client, {**CLEANUP, **extra})
            assert response.status_code == 422
            assert metadata(engine)["spaceModelAdmissionRunId"] == OLD

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "first_body,second_body,expected",
    [
        (CLEANUP, NEW_RECEIPT, {"spaceModelAdmissionRunId": NEW}),
        (NEW_RECEIPT, CLEANUP, {"spaceModelAdmissionRunId": NEW}),
        ({"metadata": {"other": "retained"}}, CLEANUP, {"spaceModelAdmissionRunId": None, "other": "retained"}),
        (
            {"metadata": {"modelSelection": MANUAL}},
            CLEANUP,
            {"spaceModelAdmissionRunId": OLD, "modelSelection": MANUAL},
        ),
    ],
)
def test_concurrent_transactions_serialize_the_metadata_read_and_write(fixture, first_body, second_body, expected):
    app, engine = fixture
    request_label = contextvars.ContextVar("receipt-request", default="")
    first_has_read = threading.Event()
    second_attempted_write = threading.Event()
    release_first = threading.Event()
    paused = False

    async def label_requests(scope, receive, send):
        label = dict(scope["headers"]).get(b"x-order", b"").decode()
        token = request_label.set(label)
        try:
            await app(scope, receive, send)
        finally:
            request_label.reset(token)

    def before_write(connection, cursor, statement, parameters, context, executemany):
        if request_label.get() == "second" and statement.startswith("UPDATE project"):
            second_attempted_write.set()

    def after_read(connection, cursor, statement, parameters, context, executemany):
        nonlocal paused
        if not paused and request_label.get() == "first" and "FROM project" in statement:
            paused = True
            first_has_read.set()
            assert release_first.wait(5), "Fixture failed to release the first transaction"

    event.listen(engine, "before_cursor_execute", before_write)
    event.listen(engine, "after_cursor_execute", after_read)

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=label_requests), base_url="http://fixture.invalid"
        ) as client:
            first = asyncio.create_task(patch(client, first_body, headers={"x-order": "first"}))
            try:
                assert await asyncio.to_thread(first_has_read.wait, 5)
                second = asyncio.create_task(patch(client, second_body, headers={"x-order": "second"}))
                assert await asyncio.to_thread(second_attempted_write.wait, 5)
                assert not second.done()
            finally:
                release_first.set()
            responses = await asyncio.gather(first, second)
            assert [response.status_code for response in responses] == [200, 200]
            actual = metadata(engine)
            expected_metadata = {"unrelated": {"keep": True}, **expected}
            if "modelSelection" in expected:
                revision = actual["spaceModelAdmissionRevision"]
                assert isinstance(revision, str) and len(revision) == 32
                expected_metadata["spaceModelAdmissionRevision"] = revision
            assert actual == expected_metadata

    try:
        asyncio.run(exercise())
    finally:
        release_first.set()
        event.remove(engine, "before_cursor_execute", before_write)
        event.remove(engine, "after_cursor_execute", after_read)


def test_cleanup_endpoint_requires_an_explicit_owner(fixture):
    app, engine = fixture

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid"
        ) as client:
            response = await client.patch(
                ENDPOINT + "/model-admission", json={"metadata": {"spaceModelAdmissionRunId": None}}
            )
            assert response.status_code == 422
            assert metadata(engine)["spaceModelAdmissionRunId"] == OLD

    asyncio.run(exercise())


def test_legacy_project_updates_keep_their_existing_merge_behavior(fixture):
    app, engine = fixture

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid"
        ) as client:
            response = await patch(
                client, {"name": "  Manual name  ", "description": "Updated", "metadata": {"legacy": True}}
            )
            assert response.status_code == 200
            assert response.json()["name"] == "Manual name"
            assert response.json()["description"] == "Updated"
            assert metadata(engine) == {
                "spaceModelAdmissionRunId": OLD,
                "unrelated": {"keep": True},
                "legacy": True,
                "nameSource": "manual",
            }

    asyncio.run(exercise())


def test_cleanup_refreshes_a_previously_loaded_project_after_acquiring_the_lock(fixture):
    from app.domains.space.service.space_service import SpaceService
    from app.model.project import ProjectUpdate

    app, engine = fixture
    with Session(engine) as old_session:
        cached = old_session.get(Project, "project-a")
        assert cached.metadata_json["spaceModelAdmissionRunId"] == OLD

        async def write_new_receipt():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid"
            ) as client:
                assert (await patch(client, NEW_RECEIPT)).status_code == 200

        asyncio.run(write_new_receipt())
        result = SpaceService.update_project("space-a", "project-a", ProjectUpdate(**CLEANUP), 7, old_session)
        assert result.metadata_json["spaceModelAdmissionRunId"] == NEW
        assert metadata(engine)["spaceModelAdmissionRunId"] == NEW


@pytest.mark.parametrize("new_space,new_user", [("space-b", "7"), ("space-other", "8")])
def test_already_dispatched_cleanup_cannot_follow_a_changed_owner(fixture, new_space, new_user):
    app, engine = fixture
    dispatched = asyncio.Event()
    release = asyncio.Event()

    async def delivery_gate(scope, receive, send):
        if scope["path"].endswith("/model-admission"):
            dispatched.set()
            await release.wait()
        await app(scope, receive, send)

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=delivery_gate), base_url="http://fixture.invalid"
        ) as client:
            old = asyncio.create_task(patch(client, CLEANUP))
            await asyncio.wait_for(dispatched.wait(), 5)
            with Session(engine) as db:
                project = db.get(Project, "project-a")
                project.space_id = new_space
                project.user_id = new_user
                db.add(project)
                db.commit()
            newer = await patch(
                client,
                NEW_RECEIPT,
                endpoint=f"/spaces/{new_space}/projects/project-a",
                headers={"x-fixture-user": new_user},
            )
            assert newer.status_code == 200
            release.set()
            assert (await asyncio.wait_for(old, 5)).status_code == 404
            assert metadata(engine)["spaceModelAdmissionRunId"] == NEW

    asyncio.run(exercise())


def test_lost_new_receipt_response_and_both_old_cleanups_preserve_a_later_run(fixture):
    app, engine = fixture
    first = True

    async def lose_first_response(scope, receive, send):
        nonlocal first
        if first:
            first = False

            async def discard(message):
                pass

            await app(scope, receive, discard)
            raise httpx.ReadError("Synthetic new receipt response lost after commit")
        await app(scope, receive, send)

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=lose_first_response), base_url="http://fixture.invalid"
        ) as client:
            with pytest.raises(httpx.ReadError):
                await patch(client, NEW_RECEIPT)
            assert metadata(engine)["spaceModelAdmissionRunId"] == NEW
            assert (await patch(client, {"metadata": {"spaceModelAdmissionRunId": "later-run"}})).status_code == 200
            for run_id in [NEW, OLD, NEW]:
                assert (await patch(client, {**CLEANUP, "expected_model_admission_run_id": run_id})).status_code == 200
            assert metadata(engine)["spaceModelAdmissionRunId"] == "later-run"

    asyncio.run(exercise())


def transition(run_id, revision, expected_run_id=None, expected_revision=None):
    return {
        "metadata": {"spaceModelAdmissionRunId": run_id},
        "expected_model_admission_run_id": expected_run_id,
        "expected_model_admission_revision": expected_revision,
        "model_admission_revision": revision,
    }


async def apply_transition(client, body):
    response = await client.patch(ENDPOINT + "/model-admission/transition", json=body)
    assert response.status_code == 200, response.text
    return response.json()["metadata"]


@pytest.mark.parametrize("failure_timing", ["before-commit", "after-commit"])
@pytest.mark.parametrize("cleanup_timing", ["before-new-owner", "after-new-owner"])
@pytest.mark.parametrize("later_run", ["later-run", OLD])
def test_versioned_assignment_cleanup_and_aba_matrix(fixture, failure_timing, cleanup_timing, later_run):
    app, engine = fixture
    entered = asyncio.Event()
    release = asyncio.Event()
    assign_a = transition(OLD, "a")
    clear_a = transition(None, "clear-a", OLD, "a")
    assign_b = transition(NEW, "b", None, "clear-a")

    async def gate(scope, receive, send):
        if dict(scope.get("headers", [])).get(b"x-old-assignment") == b"hold":
            entered.set()
            await release.wait()
        await app(scope, receive, send)

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=gate), base_url="http://fixture.invalid"
        ) as client:
            await client.patch(ENDPOINT, json={"metadata": {"spaceModelAdmissionRunId": None}})
            old = asyncio.create_task(
                client.patch(
                    ENDPOINT + "/model-admission/transition", json=assign_a, headers={"x-old-assignment": "hold"}
                )
            )
            await asyncio.wait_for(entered.wait(), 5)
            if failure_timing == "after-commit":
                release.set()
                assert (await old).status_code == 200
            # The client has already been told its A write failed. The original
            # upstream ASGI task remains alive in the before-commit case.
            if cleanup_timing == "before-new-owner":
                state = await apply_transition(client, clear_a)
                if state.get("spaceModelAdmissionRevision") != "clear-a":
                    state = await apply_transition(
                        client,
                        transition(
                            None,
                            "clear-a",
                            state.get("spaceModelAdmissionRunId"),
                            state.get("spaceModelAdmissionRevision"),
                        ),
                    )
                assert state["spaceModelAdmissionRunId"] is None
            state = await apply_transition(client, assign_b)
            if state.get("spaceModelAdmissionRevision") != "b":
                assert state.get("spaceModelAdmissionRunId") in [None, OLD]
                state = await apply_transition(
                    client,
                    transition(
                        NEW, "b", state.get("spaceModelAdmissionRunId"), state.get("spaceModelAdmissionRevision")
                    ),
                )
            assert state["spaceModelAdmissionRunId"] == NEW
            release.set()
            assert (await old).status_code == 200
            # Delayed original and duplicate old operations cannot restore A.
            for body in [clear_a, assign_a, clear_a]:
                state = await apply_transition(client, body)
                assert state["spaceModelAdmissionRunId"] == NEW
                assert state["spaceModelAdmissionRevision"] == "b"
            clear_b = transition(None, "clear-b", NEW, "b")
            state = await apply_transition(client, clear_b)
            assert state["spaceModelAdmissionRunId"] is None
            for body in [assign_a, assign_b, clear_a, clear_b]:
                state = await apply_transition(client, body)
                assert state["spaceModelAdmissionRunId"] is None
                assert state["spaceModelAdmissionRevision"] == "clear-b"
            state = await apply_transition(client, transition(later_run, "later", None, "clear-b"))
            for body in [assign_a, assign_b, clear_a, clear_b]:
                state = await apply_transition(client, body)
                assert state["spaceModelAdmissionRunId"] == later_run
                assert state["spaceModelAdmissionRevision"] == "later"
            assert metadata(engine) == {
                "spaceModelAdmissionRunId": later_run,
                "spaceModelAdmissionRevision": "later",
                "unrelated": {"keep": True},
            }

    try:
        asyncio.run(exercise())
    finally:
        release.set()


def test_versioned_unknown_owner_and_manual_pin_are_preserved(fixture):
    app, engine = fixture

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid"
        ) as client:
            body = transition(NEW, "new", OLD)
            state = await apply_transition(client, body)
            assert state["spaceModelAdmissionRunId"] == NEW
            assert await apply_transition(client, body) == state  # Lost ACK / exact duplicate.
            legacy = await client.patch(ENDPOINT, json={"metadata": {"spaceModelAdmissionRunId": OLD}})
            assert legacy.status_code == 409
            assert (await patch(client, {**CLEANUP, "expected_model_admission_run_id": NEW})).status_code == 200
            assert metadata(engine) == state
            pin = await client.patch(
                ENDPOINT, json={"metadata": {"modelSelection": MANUAL, "spaceModelAdmissionRunId": None}}
            )
            assert pin.status_code == 200
            pinned = metadata(engine)
            assert pinned["modelSelection"] == MANUAL
            assert pinned["spaceModelAdmissionRevision"] != "new"
            assert await apply_transition(client, transition(OLD, "obsolete", NEW, "new")) == pinned
            # A later unpin also changes generation; even empty -> empty is not
            # the old snapshot on which an in-flight assignment was authorized.
            unpin = await client.patch(ENDPOINT, json={"metadata": {"modelSelection": None}})
            assert unpin.status_code == 200
            cleared = metadata(engine)
            assert cleared["spaceModelAdmissionRevision"] != pinned["spaceModelAdmissionRevision"]
            assert (
                await apply_transition(client, transition(OLD, "obsolete", None, pinned["spaceModelAdmissionRevision"]))
                == cleared
            )
            fresh = transition("fresh", "fresh-version", None, cleared["spaceModelAdmissionRevision"])
            assert (await apply_transition(client, fresh))["spaceModelAdmissionRunId"] == "fresh"
            assert metadata(engine)["unrelated"] == {"keep": True}

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "extra",
    [
        {"model_admission_revision": ""},
        {"model_admission_revision": None},
        {"expected_model_admission_revision": "same", "model_admission_revision": "same"},
        {"metadata": {"spaceModelAdmissionRunId": NEW, "other": "forbidden"}},
        {"metadata": {"spaceModelAdmissionRunId": 42}},
        {"name": "forbidden"},
    ],
)
def test_versioned_transition_requires_complete_exclusive_state(fixture, extra):
    app, engine = fixture

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid"
        ) as client:
            response = await client.patch(
                ENDPOINT + "/model-admission/transition", json={**transition(NEW, "new", OLD), **extra}
            )
            assert response.status_code == 422
            assert metadata(engine)["spaceModelAdmissionRunId"] == OLD

    asyncio.run(exercise())


def test_concurrent_versioned_assignments_have_only_one_owner(fixture):
    app, engine = fixture

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid"
        ) as client:
            first, second = await asyncio.gather(
                apply_transition(client, transition("first", "first-version", OLD)),
                apply_transition(client, transition("second", "second-version", OLD)),
            )
            actual = metadata(engine)
            assert actual["spaceModelAdmissionRunId"] in ["first", "second"]
            assert first == second == actual

    asyncio.run(exercise())
