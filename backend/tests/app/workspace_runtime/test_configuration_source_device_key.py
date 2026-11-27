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

"""The server confirms the pinned provider; the key comes from the device."""

from __future__ import annotations

import json

import httpx
import pytest

from app.model import local_model_configuration as local
from app.model.local_model_configuration import (
    LocalModelConfiguration,
    LocalModelConfigurationError,
)
from app.run_sync.cloud_sync import CloudSyncConfiguration
from app.workspace_runtime import configuration_source
from app.workspace_runtime.agent_configuration import (
    AgentConfigurationUnavailable,
)
from app.workspace_runtime.configuration_source import (
    AccountConfigurationSource,
    ConfigurationSnapshot,
)

SERVER = "https://authority.example.test"
DEVICE_KEY = "unit-test-device-key-0001"
SERVER_KEY = "unit-test-server-side-value"
PROVIDER_REF = "provider:31:" + "b" * 32
SNAPSHOT = {
    "account_owner_id": "1",
    "desktop_instance_id": "device",
    "device_credential_version": 1,
    "project_id": "session",
    "space_id": "space",
    "space_source_type": "blank",
    "session_mode": "single-agent",
    "space_root": "/synthetic/space",
    "thinking_effort": None,
    "provider": {
        "provider_ref": PROVIDER_REF,
        "model_platform": "openai",
        "model_type": "gpt-test",
        "api_url": "https://models.example.test/v1",
        "model_config_dict": {},
        "extra_params": {},
    },
}
CONTEXT = CloudSyncConfiguration(
    f"{SERVER}/api/v1/sync/events:ingest",
    "Bearer synthetic-account-secret",
    "device",
)


def _source(answer: dict, device_key=None, calls: list | None = None):
    async def server(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(
                (request.method, request.url.path, json.loads(request.content))
            )
        return httpx.Response(200, json=answer)

    return AccountConfigurationSource(
        SERVER,
        lambda: CONTEXT,
        transport=httpx.MockTransport(server),
        device_key=device_key,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "answer",
    [
        pytest.param(SNAPSHOT, id="server answers without a key"),
        pytest.param(
            {**SNAPSHOT, "api_key": SERVER_KEY},
            id="older server still answers with a key",
        ),
    ],
)
async def test_key_comes_from_the_device_never_from_the_server(answer):
    lookups: list[tuple] = []
    calls: list[tuple] = []

    def device_key(principal_ref, provider_id, api_url):
        lookups.append((principal_ref, provider_id, api_url))
        return DEVICE_KEY

    source = _source(answer, device_key, calls)
    snapshot = ConfigurationSnapshot.model_validate_json(json.dumps(SNAPSHOT))
    result, context = await source.resolve(snapshot)

    assert result.api_key.get_secret_value() == DEVICE_KEY
    assert SERVER_KEY not in repr(result)
    assert SERVER_KEY not in result.model_dump_json()
    assert context == CONTEXT
    assert result.provider == snapshot.provider
    # The server is asked to confirm the pinned provider, as before.
    assert calls == [
        (
            "POST",
            "/api/v1/sync/execution/projects/session/credentials:resolve",
            {
                "provider_ref": PROVIDER_REF,
                "space_id": "space",
                "session_mode": "single-agent",
            },
        )
    ]
    # The device is asked for the key of exactly that provider record.
    assert lookups == [
        (
            source.origin(snapshot).principal_ref,
            31,
            "https://models.example.test/v1",
        )
    ]


@pytest.mark.asyncio
async def test_no_key_on_the_device_means_no_run_and_no_value_in_the_error():
    def device_key(principal_ref, provider_id, api_url):
        raise LocalModelConfigurationError("model_key_required")

    source = _source({**SNAPSHOT, "api_key": SERVER_KEY}, device_key)
    snapshot = ConfigurationSnapshot.model_validate_json(json.dumps(SNAPSHOT))

    with pytest.raises(AgentConfigurationUnavailable) as caught:
        await source.resolve(snapshot)
    assert str(caught.value) == "authentication_or_configuration_required"
    assert caught.value.__cause__ is None
    assert SERVER_KEY not in str(caught.value)


def test_default_lookup_needs_a_known_account_and_the_saved_host(monkeypatch):
    monkeypatch.setattr(local, "_ACCOUNT_SCOPES", {})
    saved = LocalModelConfiguration(
        provider_name="openai",
        model_type="gpt-test",
        endpoint_url="https://models.example.test/v1",
        api_key=DEVICE_KEY,
        api_url="https://models.example.test/v1?sig=unit-test-signature",
        config={},
    )
    seen: list[tuple] = []

    def resolve(account_scope, server_provider_id):
        seen.append((account_scope, server_provider_id))
        return saved

    monkeypatch.setattr(
        local, "resolve_local_model_configuration_for_provider", resolve
    )
    lookup = configuration_source._device_model_key

    # The app has not said under which scope this account's models are saved.
    with pytest.raises(ValueError):
        lookup("account:x:1:device", 31, "https://models.example.test/v1")
    assert seen == []

    local.remember_account_scope("account:x:1:device", "a" * 64)
    assert (
        lookup("account:x:1:device", 31, "https://models.example.test/v1")
        == DEVICE_KEY
    )
    assert seen == [("a" * 64, 31)]

    # A key is never used with a host other than the one it was saved for.
    with pytest.raises(ValueError):
        lookup("account:x:1:device", 31, "https://elsewhere.example.test/v1")
    # Another account of this process has no scope and gets nothing.
    with pytest.raises(ValueError):
        lookup("account:x:2:device", 31, "https://models.example.test/v1")
