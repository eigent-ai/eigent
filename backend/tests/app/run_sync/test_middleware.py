import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.run_sync import middleware, runtime


@pytest.mark.asyncio
async def test_authorized_traffic_uses_process_owned_desktop_identity(
    monkeypatch,
):
    configure = Mock(return_value=True)
    monkeypatch.setattr(
        middleware, "configure_default_cloud_sync_worker", configure
    )
    response = object()
    call_next = AsyncMock(return_value=response)
    request = SimpleNamespace(headers={"authorization": "Bearer cloud-token"})

    result = await middleware.cloud_sync_configuration_middleware(
        request, call_next
    )

    assert result is response
    configure.assert_called_once_with(
        server_url=None,
        authorization="Bearer cloud-token",
        desktop_instance_id=None,
    )
    call_next.assert_awaited_once_with(request)


@pytest.mark.asyncio
async def test_unauthorized_traffic_does_not_configure_cloud_sync(monkeypatch):
    configure = Mock()
    monkeypatch.setattr(
        middleware, "configure_default_cloud_sync_worker", configure
    )
    call_next = AsyncMock(return_value=object())
    request = SimpleNamespace(headers={})

    await middleware.cloud_sync_configuration_middleware(request, call_next)

    configure.assert_not_called()


@pytest.mark.asyncio
async def test_runtime_falls_back_to_process_owned_desktop_identity(
    monkeypatch,
):
    event_worker = SimpleNamespace(configure=Mock())
    command_worker = SimpleNamespace(configure=Mock())
    monkeypatch.setattr(runtime, "_default_worker", event_worker)
    monkeypatch.setattr(runtime, "_default_command_worker", command_worker)
    monkeypatch.setattr(runtime, "_worker_loop", asyncio.get_running_loop())
    monkeypatch.setattr(
        runtime,
        "env",
        lambda key, default="": (
            "desk_process_owned_identity"
            if key == "EIGENT_DESKTOP_INSTANCE_ID"
            else default
        ),
    )

    configured = runtime.configure_default_cloud_sync_worker(
        server_url="https://cloud.example.test",
        authorization="Bearer cloud-token",
        desktop_instance_id=None,
    )

    assert configured is True
    configuration = event_worker.configure.call_args.args[0]
    assert configuration.desktop_instance_id == "desk_process_owned_identity"
    command_worker.configure.assert_called_once_with(configuration)
