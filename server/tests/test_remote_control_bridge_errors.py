from __future__ import annotations

import asyncio
import os

os.environ.setdefault("database_url", "sqlite:///test.db")
os.environ.setdefault("secret_key", "test-secret")
os.environ.setdefault("redis_url", "redis://localhost:6379/0")
os.environ.setdefault("celery_broker_url", "redis://localhost:6379/0")
os.environ.setdefault("celery_result_url", "redis://localhost:6379/0")

from fastapi import HTTPException

from app.domains.remote_control.api.remote_control_controller import (
    _send_bridge_http_error,
)


class FakeWebSocket:
    def __init__(self) -> None:
        self.messages: list[dict] = []
        self.close_codes: list[int] = []

    async def send_json(self, message: dict) -> None:
        self.messages.append(message)

    async def close(self, code: int) -> None:
        self.close_codes.append(code)


def test_bridge_auth_expiry_is_distinct() -> None:
    websocket = FakeWebSocket()

    asyncio.run(
        _send_bridge_http_error(
            websocket,
            HTTPException(status_code=401, detail="Token has expired"),
        )
    )

    assert websocket.messages == [{"type": "auth_expired", "message": "Token has expired"}]
    assert websocket.close_codes == [4401]


def test_bridge_policy_error_is_not_retryable() -> None:
    websocket = FakeWebSocket()

    asyncio.run(
        _send_bridge_http_error(
            websocket,
            HTTPException(
                status_code=409,
                detail={
                    "code": "device_owner_mismatch",
                    "message": "Desktop device belongs to another user",
                },
            ),
        )
    )

    assert websocket.messages[0]["retryable"] is False
    assert websocket.messages[0]["code"] == "device_owner_mismatch"
    assert websocket.close_codes == [1008]


def test_bridge_server_failure_remains_retryable() -> None:
    websocket = FakeWebSocket()

    asyncio.run(
        _send_bridge_http_error(
            websocket,
            HTTPException(status_code=503, detail="Database temporarily unavailable"),
        )
    )

    assert websocket.messages[0]["retryable"] is True
    assert websocket.close_codes == [1011]
