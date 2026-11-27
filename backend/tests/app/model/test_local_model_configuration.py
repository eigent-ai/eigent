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

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from pydantic import ValidationError

from app.model import local_model_configuration as local
from app.model.chat import AgentModelConfig, Chat, NewAgent
from app.model.local_model_configuration import (
    SAVED_VALUE_MARKER,
    LocalModelConfigurationError,
    ModelCredentialReference,
    apply_local_model_configurations,
    fill_saved_model_values,
    resolve_local_model_configuration,
    resolve_local_model_configuration_for_provider,
)
from app.workspace_bundle import secrets as broker_client

SCOPE = "a" * 64
CAPABILITY = "c" * 43
KEY = "unit-test-model-key-0001"
REFERENCE = ModelCredentialReference(account_scope=SCOPE, credential_id=7)

SAVED = {
    "id": 7,
    "provider_name": "openai",
    "model_type": "gpt-test",
    "endpoint_url": "https://models.example.test/v1",
    "api_key": KEY,
    "api_url": "https://models.example.test/v1?sig=unit-test-signature",
    "config": {
        "api_version": "2026-01-01",
        "aws_secret_access_key": "unit-test-secret-value",
        "model_config_dict": {
            "temperature": 0.2,
            "extra_headers": {"X-Api-Key": "unit-test-header-value"},
        },
    },
}


class _Desktop:
    """Stands in for the desktop app's private loopback channel."""

    def __init__(self, monkeypatch, answers):
        self.requests: list[dict] = []
        answers = list(answers)
        desktop = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                desktop.requests.append(
                    {
                        "path": self.path,
                        "authorization": self.headers.get("Authorization"),
                        "body": json.loads(self.rfile.read(length)),
                    }
                )
                status, body = answers.pop(0)
                encoded = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, format, *args):
                return

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(
            target=self.server.serve_forever, daemon=True
        )
        self.thread.start()
        monkeypatch.setattr(
            broker_client,
            "_BROKER_ENDPOINT",
            f"http://127.0.0.1:{self.server.server_port}",
        )
        monkeypatch.setattr(broker_client, "_BROKER_CAPABILITY", CAPABILITY)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


@pytest.fixture
def desktop(monkeypatch):
    opened: list[_Desktop] = []

    def open_(*answers):
        instance = _Desktop(monkeypatch, answers)
        opened.append(instance)
        return instance

    yield open_
    for instance in opened:
        instance.close()


def _chat(**overrides) -> Chat:
    return Chat(
        **{
            "task_id": "task-1",
            "project_id": "project-1",
            "question": "hello",
            "email": "person@example.test",
            "model_platform": "openai",
            "model_type": "gpt-test",
            "api_key": "",
            **overrides,
        }
    )


def test_reference_carries_no_secret_and_rejects_unknown_fields():
    assert REFERENCE.model_dump() == {
        "account_scope": SCOPE,
        "credential_id": 7,
    }
    with pytest.raises(ValidationError):
        ModelCredentialReference(account_scope="short", credential_id=7)
    with pytest.raises(ValidationError):
        ModelCredentialReference(account_scope=SCOPE, credential_id=0)
    with pytest.raises(ValidationError):
        ModelCredentialReference(
            account_scope=SCOPE, credential_id=7, api_key=KEY
        )


def test_resolves_through_the_private_channel_without_echoing_the_key(
    desktop,
):
    channel = desktop((200, {"configuration": SAVED}))
    saved = resolve_local_model_configuration(REFERENCE)

    assert channel.requests == [
        {
            "path": "/v1/model-configurations/resolve",
            "authorization": f"Bearer {CAPABILITY}",
            "body": {"account_scope": SCOPE, "credential_id": 7},
        }
    ]
    assert saved.api_key == KEY
    assert saved.api_url.endswith("sig=unit-test-signature")
    assert saved.extra_params == {
        "api_version": "2026-01-01",
        "aws_secret_access_key": "unit-test-secret-value",
    }
    assert saved.model_config_dict["temperature"] == 0.2
    for secret in (KEY, "unit-test-signature", "unit-test-secret-value"):
        assert secret not in repr(saved)


@pytest.mark.parametrize(
    ("status", "body", "code"),
    [
        (404, {"error_code": "not_found"}, "model_configuration_missing"),
        (409, {"error_code": "key_required"}, "model_key_required"),
        (500, {"error_code": "storage_failed"}, "model_key_unavailable"),
        (200, {"configuration": {**SAVED, "id": 8}}, "model_key_unavailable"),
        (
            200,
            {"configuration": {**SAVED, "api_key": None}},
            "model_key_unavailable",
        ),
        (200, {"unexpected": True}, "model_key_unavailable"),
    ],
)
def test_failures_are_named_by_code_and_never_carry_a_value(
    desktop, status, body, code
):
    desktop((status, body))
    with pytest.raises(LocalModelConfigurationError) as caught:
        resolve_local_model_configuration(REFERENCE)

    assert caught.value.code == code
    assert KEY not in str(caught.value)
    assert caught.value.__cause__ is None


def test_reports_unavailable_when_the_desktop_channel_is_absent(monkeypatch):
    monkeypatch.setattr(broker_client, "_BROKER_ENDPOINT", "")
    monkeypatch.setattr(broker_client, "_BROKER_CAPABILITY", "")
    with pytest.raises(LocalModelConfigurationError) as caught:
        resolve_local_model_configuration(REFERENCE)

    assert caught.value.code == "model_key_unavailable"


def test_run_takes_key_address_and_settings_from_the_saved_configuration(
    desktop,
):
    channel = desktop((200, {"configuration": SAVED}))
    chat = _chat(
        model_credential=REFERENCE,
        api_url="https://other-host.example.test/v1",
        extra_params={"aws_secret_access_key": SAVED_VALUE_MARKER},
        model_config_dict={"temperature": 1.5},
    )

    assert apply_local_model_configurations(chat) is True
    assert chat.api_key == KEY
    # The key only ever goes to the address it was saved with.
    assert chat.api_url == SAVED["api_url"]
    assert (
        chat.extra_params["aws_secret_access_key"] == "unit-test-secret-value"
    )
    assert chat.model_config_dict == SAVED["config"]["model_config_dict"]
    assert len(channel.requests) == 1


def test_run_without_a_reference_is_left_untouched(desktop):
    channel = desktop()
    chat = _chat(
        api_key="cloud-issued-value", api_url="https://x.example.test"
    )

    assert apply_local_model_configurations(chat) is False
    assert chat.api_key == "cloud-issued-value"
    assert channel.requests == []


def test_each_agent_resolves_its_own_saved_configuration(desktop):
    other = {**SAVED, "id": 9, "api_key": "unit-test-agent-key-0002"}
    channel = desktop((200, {"configuration": other}))
    agent = NewAgent(
        name="researcher",
        description="",
        tools=[],
        mcp_tools=None,
        custom_model_config=AgentModelConfig(
            model_platform="openai",
            model_type="gpt-test",
            model_credential=ModelCredentialReference(
                account_scope=SCOPE, credential_id=9
            ),
        ),
    )
    plain = NewAgent(name="writer", description="", tools=[], mcp_tools=None)
    chat = _chat(api_key="cloud-issued-value", new_agents=[agent, plain])

    assert apply_local_model_configurations(chat) is False
    assert chat.api_key == "cloud-issued-value"
    assert agent.custom_model_config.api_key == "unit-test-agent-key-0002"
    assert agent.custom_model_config.api_url == SAVED["api_url"]
    assert channel.requests[0]["body"]["credential_id"] == 9


def test_a_missing_key_stops_the_run_before_it_starts(desktop):
    desktop((409, {"error_code": "key_required"}))
    chat = _chat(model_credential=REFERENCE)

    with pytest.raises(LocalModelConfigurationError) as caught:
        apply_local_model_configurations(chat)
    assert caught.value.code == "model_key_required"
    assert chat.api_key == ""


def test_editing_fills_the_saved_key_and_markers_for_the_same_host(desktop):
    desktop((200, {"configuration": SAVED}))
    filled = fill_saved_model_values(
        REFERENCE,
        api_key=None,
        url="https://models.example.test/v1",
        model_config_dict={
            "temperature": 0.9,
            "extra_headers": {"X-Api-Key": SAVED_VALUE_MARKER},
        },
        extra_params={
            "api_version": "2026-02-02",
            "aws_secret_access_key": SAVED_VALUE_MARKER,
        },
    )

    assert filled.api_key == KEY
    # The unchanged visible address stands for the full saved address.
    assert filled.url == SAVED["api_url"]
    assert filled.model_config_dict == {
        "temperature": 0.9,
        "extra_headers": {"X-Api-Key": "unit-test-header-value"},
    }
    assert filled.extra_params == {
        "api_version": "2026-02-02",
        "aws_secret_access_key": "unit-test-secret-value",
    }
    assert KEY not in repr(filled)


def test_editing_keeps_a_newly_typed_key(desktop):
    desktop((200, {"configuration": SAVED}))
    filled = fill_saved_model_values(
        REFERENCE,
        api_key="unit-test-new-key-0003",
        url="https://elsewhere.example.test/v1",
        model_config_dict=None,
        extra_params=None,
    )

    assert filled.api_key == "unit-test-new-key-0003"
    assert filled.url == "https://elsewhere.example.test/v1"


@pytest.mark.parametrize(
    "url",
    [
        "https://elsewhere.example.test/v1",
        "http://models.example.test/v1",
        "https://models.example.test:8443/v1",
    ],
)
def test_saved_key_is_never_sent_to_another_host(desktop, url):
    desktop((200, {"configuration": SAVED}))
    with pytest.raises(LocalModelConfigurationError) as caught:
        fill_saved_model_values(
            REFERENCE,
            api_key="",
            url=url,
            model_config_dict=None,
            extra_params=None,
        )

    assert caught.value.code == "model_key_endpoint_changed"


def test_saved_settings_are_never_sent_to_another_host_either(desktop):
    desktop((200, {"configuration": SAVED}))
    with pytest.raises(LocalModelConfigurationError) as caught:
        fill_saved_model_values(
            REFERENCE,
            api_key="unit-test-new-key-0003",
            url="https://elsewhere.example.test/v1",
            model_config_dict={
                "extra_headers": {"X-Api-Key": SAVED_VALUE_MARKER}
            },
            extra_params=None,
        )

    assert caught.value.code == "model_key_endpoint_changed"


def test_marker_without_a_saved_value_asks_for_the_key(desktop):
    desktop((200, {"configuration": SAVED}))
    with pytest.raises(LocalModelConfigurationError) as caught:
        fill_saved_model_values(
            REFERENCE,
            api_key=None,
            url=SAVED["endpoint_url"],
            model_config_dict=None,
            extra_params={"aws_session_token": SAVED_VALUE_MARKER},
        )

    assert caught.value.code == "model_key_required"


def test_editing_an_unreadable_configuration_needs_a_complete_request(desktop):
    desktop(
        (409, {"error_code": "key_required"}),
        (409, {"error_code": "key_required"}),
    )
    filled = fill_saved_model_values(
        REFERENCE,
        api_key="unit-test-new-key-0003",
        url=SAVED["endpoint_url"],
        model_config_dict={"temperature": 0.1},
        extra_params=None,
    )

    assert filled.api_key == "unit-test-new-key-0003"
    assert filled.url == SAVED["endpoint_url"]
    with pytest.raises(LocalModelConfigurationError) as caught:
        fill_saved_model_values(
            REFERENCE,
            api_key=None,
            url=SAVED["endpoint_url"],
            model_config_dict=None,
            extra_params=None,
        )
    assert caught.value.code == "model_key_required"


def test_configuration_without_a_key_stays_without_one(desktop):
    desktop((200, {"configuration": {**SAVED, "api_key": ""}}))
    filled = fill_saved_model_values(
        REFERENCE,
        api_key=None,
        url=SAVED["endpoint_url"],
        model_config_dict=None,
        extra_params=None,
    )

    assert filled.api_key is None


def test_resolves_by_the_account_provider_record(desktop):
    channel = desktop((200, {"configuration": SAVED}))
    saved = resolve_local_model_configuration_for_provider(SCOPE, 31)

    assert saved.api_key == KEY
    assert channel.requests[0]["body"] == {
        "account_scope": SCOPE,
        "server_provider_id": 31,
    }
    with pytest.raises(LocalModelConfigurationError):
        resolve_local_model_configuration_for_provider("not-a-scope", 31)
    with pytest.raises(LocalModelConfigurationError):
        resolve_local_model_configuration_for_provider(SCOPE, 0)


def test_account_scope_notes_are_bounded_and_validated(monkeypatch):
    monkeypatch.setattr(local, "_ACCOUNT_SCOPES", {})
    local.remember_account_scope("account:one", "not-a-digest")
    assert local.account_scope_for("account:one") is None

    local.remember_account_scope("account:one", SCOPE)
    assert local.account_scope_for("account:one") == SCOPE
    for index in range(local._MAX_ACCOUNT_SCOPES + 5):
        local.remember_account_scope(f"account:{index}", "b" * 64)
    assert len(local._ACCOUNT_SCOPES) == local._MAX_ACCOUNT_SCOPES
    assert local.account_scope_for("account:one") is None
