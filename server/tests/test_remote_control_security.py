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

import pytest
from fastapi import HTTPException


class FakeRedisClient:
    def __init__(self):
        self.counts: dict[str, int] = {}
        self.expiries: dict[str, int] = {}
        self.set_calls: list[tuple[str, str, int]] = []
        self.publish_calls: list[tuple[str, str]] = []

    def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    def expire(self, key: str, seconds: int) -> None:
        self.expiries[key] = seconds

    def eval(self, _script: str, _numkeys: int, key: str, seconds: int) -> int:
        count = self.incr(key)
        if count == 1:
            self.expire(key, seconds)
        return count

    async def set(self, key: str, value: str, ex: int) -> None:
        self.set_calls.append((key, value, ex))

    async def publish(self, channel: str, payload: str) -> None:
        self.publish_calls.append((channel, payload))

    async def aclose(self) -> None:
        return None


class FakeWebSocket:
    def __init__(self):
        self.sent: list[dict] = []
        self.close_code: int | None = None

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    async def close(self, code: int) -> None:
        self.close_code = code


@pytest.fixture(autouse=True)
def clear_remote_control_proxy_cache():
    from app.domains.remote_control.api import remote_control_controller as controller

    controller._trusted_proxy_entries.cache_clear()
    yield
    controller._trusted_proxy_entries.cache_clear()


def test_remote_control_env_int_defaults_and_bounds(monkeypatch):
    from app.domains.remote_control.api import remote_control_controller as controller

    monkeypatch.delenv("REMOTE_CONTROL_TEST_INT", raising=False)
    assert controller._env_int("REMOTE_CONTROL_TEST_INT", 12, min_value=5) == 12

    monkeypatch.setenv("REMOTE_CONTROL_TEST_INT", "3")
    assert controller._env_int("REMOTE_CONTROL_TEST_INT", 12, min_value=5) == 5

    monkeypatch.setenv("REMOTE_CONTROL_TEST_INT", "bad")
    assert controller._env_int("REMOTE_CONTROL_TEST_INT", 12, min_value=5) == 12


def test_legacy_remote_target_accepts_server_echoed_sess_id():
    from app.domains.remote_control.service.remote_control_service import RemoteControlService

    session = SimpleNamespace(
        current_brain_session_id=None,
        brain_session_id="sess_legacy",
        project_id="project_1",
        active_task_id="task_1",
    )

    assert RemoteControlService._is_legacy_target_request(
        session,
        {
            "target_project_id": "project_1",
            "target_task_id": "task_1",
            "target_brain_session_id": "sess_legacy",
        },
    )


def test_partial_legacy_remote_target_does_not_bypass_v2_validation():
    from app.domains.remote_control.service.remote_control_service import RemoteControlService

    session = SimpleNamespace(
        current_brain_session_id=None,
        brain_session_id="sess_legacy",
        project_id="project_1",
        active_task_id="task_1",
    )

    assert not RemoteControlService._is_legacy_target_request(
        session,
        {
            "target_project_id": None,
            "target_task_id": "task_1",
            "target_brain_session_id": None,
        },
    )


def test_switch_project_ack_publishes_desktop_target_ready(monkeypatch):
    from app.domains.remote_control.service.remote_control_service import (
        COMMAND_ACKNOWLEDGED,
        COMMAND_DELIVERED,
        SWITCH_PROJECT_VIEW,
        RemoteControlService,
    )

    command = SimpleNamespace(
        id="rc_cmd_1",
        session_id="rcs_1",
        type=SWITCH_PROJECT_VIEW,
        status=COMMAND_DELIVERED,
        error_code=None,
        error=None,
        result=None,
        space_id="space_1",
        target_project_id="project_1",
        target_task_id="task_1",
        target_brain_session_id="rc_brain_1",
    )
    published: list[tuple[str, str, dict]] = []

    class FakeDb:
        def get(self, _model, command_id):
            assert command_id == command.id
            return command

        def add(self, _obj):
            return None

        def commit(self):
            return None

        def refresh(self, _obj):
            return None

    monkeypatch.setattr(
        RemoteControlService,
        "publish_status",
        lambda session_id, event_type, payload: published.append(
            (session_id, event_type, payload)
        )
        or True,
    )

    RemoteControlService.mark_ack(command.id, COMMAND_ACKNOWLEDGED, None, None, FakeDb())

    assert command.status == COMMAND_ACKNOWLEDGED
    assert (
        "rcs_1",
        "desktop_target_ready",
        {
            "space_id": "space_1",
            "current_project_id": "project_1",
            "current_task_id": "task_1",
            "current_brain_session_id": "rc_brain_1",
            "command_id": "rc_cmd_1",
        },
    ) in published


def test_switch_project_failed_ack_publishes_desktop_target_failed(monkeypatch):
    from app.domains.remote_control.service.remote_control_service import (
        COMMAND_DELIVERED,
        COMMAND_FAILED,
        SWITCH_PROJECT_VIEW,
        RemoteControlService,
    )

    command = SimpleNamespace(
        id="rc_cmd_1",
        session_id="rcs_1",
        type=SWITCH_PROJECT_VIEW,
        status=COMMAND_DELIVERED,
        error_code=None,
        error=None,
        result=None,
        space_id="space_1",
        target_project_id="project_1",
        target_task_id="task_1",
        target_brain_session_id="rc_brain_1",
    )
    published: list[tuple[str, str, dict]] = []

    class FakeDb:
        def get(self, _model, command_id):
            assert command_id == command.id
            return command

        def add(self, _obj):
            return None

        def commit(self):
            return None

        def refresh(self, _obj):
            return None

    monkeypatch.setattr(
        RemoteControlService,
        "publish_status",
        lambda session_id, event_type, payload: published.append(
            (session_id, event_type, payload)
        )
        or True,
    )

    RemoteControlService.mark_ack(
        command.id,
        COMMAND_FAILED,
        "BRIDGE_TARGET_NOT_ACTIVE",
        "Desktop is not on the target project yet",
        FakeDb(),
    )

    assert command.status == COMMAND_FAILED
    assert any(
        event_type == "desktop_target_failed"
        and payload["error_code"] == "BRIDGE_TARGET_NOT_ACTIVE"
        and payload["current_project_id"] == "project_1"
        for _, event_type, payload in published
    )


def test_switch_project_failed_ack_restores_previous_target(monkeypatch):
    from app.domains.remote_control.service.remote_control_service import (
        COMMAND_DELIVERED,
        COMMAND_FAILED,
        SWITCH_PROJECT_VIEW,
        RemoteControlService,
    )

    command = SimpleNamespace(
        id="rc_cmd_1",
        session_id="rcs_1",
        type=SWITCH_PROJECT_VIEW,
        status=COMMAND_DELIVERED,
        error_code=None,
        error=None,
        result=None,
        space_id="space_1",
        target_project_id="project_b",
        target_task_id="task_b",
        target_brain_session_id="rc_brain_b",
        payload={
            "previous_project_id": "project_a",
            "previous_task_id": "task_a",
            "previous_history_id": "history_a",
            "previous_brain_session_id": "rc_brain_a",
        },
    )
    session = SimpleNamespace(
        id="rcs_1",
        current_project_id="project_b",
        current_task_id="task_b",
        current_history_id="history_b",
        current_brain_session_id="rc_brain_b",
        last_target_project_id="project_b",
        last_target_task_id="task_b",
        last_target_history_id="history_b",
        last_target_brain_session_id="rc_brain_b",
        project_id="project_b",
        active_task_id="task_b",
        brain_session_id="rc_brain_b",
    )
    published: list[tuple[str, str, dict]] = []

    class FakeDb:
        def get(self, _model, object_id):
            if object_id == command.id:
                return command
            if object_id == session.id:
                return session
            return None

        def add(self, _obj):
            return None

        def commit(self):
            return None

        def refresh(self, _obj):
            return None

    monkeypatch.setattr(
        RemoteControlService,
        "publish_status",
        lambda session_id, event_type, payload: published.append(
            (session_id, event_type, payload)
        )
        or True,
    )

    RemoteControlService.mark_ack(
        command.id,
        COMMAND_FAILED,
        "BRIDGE_TARGET_NOT_ACTIVE",
        "Desktop is not on the target project yet",
        FakeDb(),
    )

    assert session.current_project_id == "project_a"
    assert session.current_task_id == "task_a"
    assert session.current_history_id == "history_a"
    assert session.current_brain_session_id == "rc_brain_a"
    assert any(
        event_type == "desktop_target_failed"
        and payload["restored_project_id"] == "project_a"
        for _, event_type, payload in published
    )


def test_switch_project_failed_ack_does_not_restore_newer_task_target(monkeypatch):
    from app.domains.remote_control.service.remote_control_service import (
        COMMAND_DELIVERED,
        COMMAND_FAILED,
        SWITCH_PROJECT_VIEW,
        RemoteControlService,
    )

    command = SimpleNamespace(
        id="rc_cmd_1",
        session_id="rcs_1",
        type=SWITCH_PROJECT_VIEW,
        status=COMMAND_DELIVERED,
        error_code=None,
        error=None,
        result=None,
        space_id="space_1",
        target_project_id="project_b",
        target_task_id="task_b",
        target_brain_session_id="rc_brain_b",
        payload={
            "previous_project_id": "project_a",
            "previous_task_id": "task_a",
            "previous_history_id": "history_a",
            "previous_brain_session_id": "rc_brain_a",
        },
    )
    session = SimpleNamespace(
        id="rcs_1",
        current_project_id="project_b",
        current_task_id="task_c",
        current_history_id="history_c",
        current_brain_session_id="rc_brain_b",
        last_target_project_id="project_b",
        last_target_task_id="task_c",
        last_target_history_id="history_c",
        last_target_brain_session_id="rc_brain_b",
        project_id="project_b",
        active_task_id="task_c",
        brain_session_id="rc_brain_b",
    )

    class FakeDb:
        def get(self, _model, object_id):
            if object_id == command.id:
                return command
            if object_id == session.id:
                return session
            return None

        def add(self, _obj):
            return None

        def commit(self):
            return None

        def refresh(self, _obj):
            return None

    monkeypatch.setattr(
        RemoteControlService,
        "publish_status",
        lambda _session_id, _event_type, _payload: True,
    )

    RemoteControlService.mark_ack(
        command.id,
        COMMAND_FAILED,
        "BRIDGE_TARGET_NOT_ACTIVE",
        "Desktop is not on the target project yet",
        FakeDb(),
    )

    assert session.current_project_id == "project_b"
    assert session.current_task_id == "task_c"
    assert session.current_history_id == "history_c"
    assert session.current_brain_session_id == "rc_brain_b"


def test_late_switch_ack_after_timeout_does_not_publish_ready(monkeypatch):
    from app.domains.remote_control.service.remote_control_service import (
        COMMAND_ACKNOWLEDGED,
        COMMAND_FAILED,
        SWITCH_PROJECT_VIEW,
        RemoteControlService,
    )

    command = SimpleNamespace(
        id="rc_cmd_1",
        session_id="rcs_1",
        type=SWITCH_PROJECT_VIEW,
        status=COMMAND_FAILED,
        error_code="BRIDGE_TIMEOUT",
        error="Remote command delivery timed out",
        result=None,
        space_id="space_1",
        target_project_id="project_b",
        target_task_id="task_b",
        target_brain_session_id="rc_brain_b",
    )
    published: list[tuple[str, str, dict]] = []

    class FakeDb:
        def get(self, _model, command_id):
            assert command_id == command.id
            return command

    monkeypatch.setattr(
        RemoteControlService,
        "publish_status",
        lambda session_id, event_type, payload: published.append(
            (session_id, event_type, payload)
        )
        or True,
    )

    RemoteControlService.mark_ack(command.id, COMMAND_ACKNOWLEDGED, None, None, FakeDb())

    assert command.status == COMMAND_FAILED
    assert not any(event_type == "desktop_target_ready" for _, event_type, _ in published)


def test_get_session_controller_returns_session_response(monkeypatch):
    from app.domains.remote_control.api import remote_control_controller as controller

    db = SimpleNamespace()
    session = SimpleNamespace(user_id=123)
    expected = SimpleNamespace(session_id="rcs_test")

    def verify_link(session_id, token, user_id, db_session):
        assert session_id == "rcs_test"
        assert token == "link-token"
        assert user_id is None
        assert db_session is db
        return session

    def to_session_out(rc_session):
        assert rc_session is session
        return expected

    monkeypatch.setattr(controller.RemoteControlService, "verify_link", verify_link)
    monkeypatch.setattr(controller.RemoteControlService, "to_session_out", to_session_out)

    result = controller.get_session(
        "rcs_test",
        x_remote_control_token="link-token",
        db_session=db,
    )

    assert result is expected


def test_list_steps_controller_returns_service_response(monkeypatch):
    from app.domains.remote_control.api import remote_control_controller as controller
    from app.domains.remote_control.schema import RemoteControlStepsOut

    db = SimpleNamespace()
    session = SimpleNamespace(user_id=123)
    expected = RemoteControlStepsOut(items=[], has_more=False, next_since=5)

    def verify_link(session_id, token, user_id, db_session):
        assert session_id == "rcs_test"
        assert token == "link-token"
        assert user_id is None
        assert db_session is db
        return session

    def list_steps(session_id, user_id, project_id, since, limit, order, db_session):
        assert session_id == "rcs_test"
        assert user_id == 123
        assert project_id == "project_1"
        assert since == 5
        assert limit == 10
        assert order == "asc"
        assert db_session is db
        return expected

    monkeypatch.setattr(controller.RemoteControlService, "verify_link", verify_link)
    monkeypatch.setattr(controller.RemoteControlService, "list_steps", list_steps)

    result = controller.list_steps(
        "rcs_test",
        x_remote_control_token="link-token",
        project_id="project_1",
        since=5,
        limit=10,
        order="asc",
        db_session=db,
    )

    assert result is expected


@pytest.mark.asyncio
async def test_ws_reconnect_rate_limit_is_per_identifier(monkeypatch):
    from app.domains.remote_control.api import remote_control_controller as controller

    fake_client = FakeRedisClient()
    monkeypatch.setattr(
        controller,
        "get_redis_manager",
        lambda: SimpleNamespace(client=fake_client),
    )

    for _ in range(controller.WS_RECONNECT_RATE_LIMIT):
        await controller._enforce_ws_reconnect_rate_limit("events", "token-a")

    with pytest.raises(HTTPException) as exc_info:
        await controller._enforce_ws_reconnect_rate_limit("events", "token-a")

    assert exc_info.value.status_code == 429
    assert fake_client.expiries

    await controller._enforce_ws_reconnect_rate_limit("events", "token-b")


def test_remote_client_host_uses_forwarded_for_from_trusted_proxy(monkeypatch):
    from app.domains.remote_control.api import remote_control_controller as controller

    monkeypatch.setenv("REMOTE_CONTROL_TRUSTED_PROXY_HOSTS", "127.0.0.1")

    assert (
        controller._client_host_from_headers(
            {"x-forwarded-for": "203.0.113.10, 127.0.0.1"},
            "127.0.0.1",
        )
        == "203.0.113.10"
    )


def test_remote_client_host_ignores_forwarded_for_from_untrusted_peer(monkeypatch):
    from app.domains.remote_control.api import remote_control_controller as controller

    monkeypatch.setenv("REMOTE_CONTROL_TRUSTED_PROXY_HOSTS", "127.0.0.1")

    assert (
        controller._client_host_from_headers(
            {"x-forwarded-for": "203.0.113.10"},
            "198.51.100.2",
        )
        == "198.51.100.2"
    )


def test_remote_client_host_supports_trusted_proxy_cidr(monkeypatch):
    from app.domains.remote_control.api import remote_control_controller as controller

    monkeypatch.setenv("REMOTE_CONTROL_TRUSTED_PROXY_HOSTS", "10.0.0.0/8")

    assert (
        controller._client_host_from_headers(
            {"x-real-ip": "203.0.113.20"},
            "10.2.3.4",
        )
        == "203.0.113.20"
    )


@pytest.mark.asyncio
async def test_blacklist_pubsub_closes_matching_bridge():
    from app.domains.remote_control.api import remote_control_controller as controller
    from app.shared.auth.token_blacklist import BLACKLIST_PUBSUB_CHANNEL

    ws = FakeWebSocket()
    controller.bridge_websockets["desk_test"] = ws
    controller.bridge_token_jtis["desk_test"] = "jti_test"
    controller.bridge_websockets["desk_other"] = FakeWebSocket()
    controller.bridge_token_jtis["desk_other"] = "jti_other"

    try:
        await controller._handle_pubsub_message(
            BLACKLIST_PUBSUB_CHANNEL,
            {"type": "token_blacklisted", "jti": "jti_test"},
        )
    finally:
        controller.bridge_websockets.clear()
        controller.bridge_token_jtis.clear()

    assert ws.sent == [{"type": "revoke_bridge", "reason": "token_revoked"}]
    assert ws.close_code == 4401


@pytest.mark.asyncio
async def test_blacklist_token_publishes_revocation(monkeypatch):
    from app.shared.auth import token_blacklist

    fake_client = FakeRedisClient()
    monkeypatch.setattr(token_blacklist, "_get_redis", lambda: fake_client)

    await token_blacklist.blacklist_token("jti_test", 60)

    assert fake_client.set_calls == [("token:blacklist:jti_test", "1", 60)]
    assert fake_client.publish_calls
    channel, payload = fake_client.publish_calls[0]
    assert channel == token_blacklist.BLACKLIST_PUBSUB_CHANNEL
    assert '"jti": "jti_test"' in payload


@pytest.mark.asyncio
async def test_blacklist_token_publishes_to_session_redis_when_distinct(monkeypatch):
    from app.shared.auth import token_blacklist

    auth_client = FakeRedisClient()
    session_client = FakeRedisClient()
    monkeypatch.setattr(token_blacklist, "_get_redis", lambda: auth_client)
    monkeypatch.setattr(token_blacklist.aioredis, "from_url", lambda *args, **kwargs: session_client)
    monkeypatch.setenv("redis_url", "redis://localhost:6379/0")
    monkeypatch.setenv("SESSION_REDIS_URL", "redis://localhost:6379/1")

    await token_blacklist.blacklist_token("jti_test", 60)

    assert auth_client.publish_calls
    assert session_client.publish_calls
    assert session_client.publish_calls[0][0] == token_blacklist.BLACKLIST_PUBSUB_CHANNEL
