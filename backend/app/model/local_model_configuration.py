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

"""The user's own model configurations, read from the desktop app.

The desktop app keeps each model configuration and its key on the user's
device. A request names a configuration by reference; this module resolves the
reference through the app's private loopback channel and keeps the values in
memory only. Nothing here writes a key to disk, to a log or to an error.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field

SAVED_VALUE_MARKER = "[saved on this device]"
RESOLVE_PATH = "/v1/model-configurations/resolve"
MAX_RESPONSE_BYTES = 1024 * 1024
_MAX_DEPTH = 8

LocalModelConfigurationErrorCode = Literal[
    "model_key_required",
    "model_configuration_missing",
    "model_key_endpoint_changed",
    "model_key_unavailable",
]

_MESSAGES: dict[str, str] = {
    "model_key_required": (
        "The key for this model is not saved on this device. "
        "Enter it again in Settings > Models."
    ),
    "model_configuration_missing": (
        "This model is no longer set up on this device. "
        "Choose another model or add it again in Settings > Models."
    ),
    "model_key_endpoint_changed": (
        "Enter the key again to use it with a different address."
    ),
    "model_key_unavailable": (
        "Model keys saved on this device could not be read. "
        "Restart the app and try again."
    ),
}


class ModelCredentialReference(BaseModel):
    """Names one configuration saved on this device. It carries no secret."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    account_scope: str = Field(pattern=r"^[a-f0-9]{64}$")
    credential_id: int = Field(ge=1, le=2**53 - 1)


class LocalModelConfigurationError(RuntimeError):
    """A saved configuration could not be used. Never carries a value."""

    def __init__(self, code: LocalModelConfigurationErrorCode) -> None:
        super().__init__(_MESSAGES[code])
        self.code = code


@dataclass(frozen=True)
class LocalModelConfiguration:
    """One resolved configuration. Lives in memory for the request only."""

    provider_name: str
    model_type: str
    endpoint_url: str
    api_key: str = field(repr=False)
    api_url: str = field(repr=False)
    config: dict[str, Any] = field(repr=False)

    @property
    def model_config_dict(self) -> dict[str, Any]:
        value = self.config.get("model_config_dict")
        return dict(value) if isinstance(value, dict) else {}

    @property
    def extra_params(self) -> dict[str, Any]:
        return {
            key: value
            for key, value in self.config.items()
            if key != "model_config_dict"
        }


def resolve_local_model_configuration(
    reference: ModelCredentialReference,
) -> LocalModelConfiguration:
    """Read one configuration, with its key, from the desktop app."""

    return _resolve(
        {
            "account_scope": reference.account_scope,
            "credential_id": reference.credential_id,
        },
        expected_id=reference.credential_id,
    )


def resolve_local_model_configuration_for_provider(
    account_scope: str, server_provider_id: int
) -> LocalModelConfiguration:
    """Read the configuration that mirrors one provider record of the account."""

    if (
        re.fullmatch(r"[a-f0-9]{64}", account_scope) is None
        or type(server_provider_id) is not int
        or server_provider_id < 1
    ):
        raise LocalModelConfigurationError("model_configuration_missing")
    return _resolve(
        {
            "account_scope": account_scope,
            "server_provider_id": server_provider_id,
        },
        expected_id=None,
    )


_ACCOUNT_SCOPES: dict[str, str] = {}
_MAX_ACCOUNT_SCOPES = 64


def remember_account_scope(owner: str, account_scope: str) -> None:
    """Note under which local scope the app keeps an account's models.

    `owner` names the signed-in account as this process identifies it. The
    scope is a digest that names the account on this device: it is not a
    secret and gives no access by itself. Both are kept in memory only.
    """

    if (
        not isinstance(owner, str)
        or not 0 < len(owner) <= 512
        or not isinstance(account_scope, str)
        or re.fullmatch(r"[a-f0-9]{64}", account_scope) is None
    ):
        return
    _ACCOUNT_SCOPES.pop(owner, None)
    while len(_ACCOUNT_SCOPES) >= _MAX_ACCOUNT_SCOPES:
        _ACCOUNT_SCOPES.pop(next(iter(_ACCOUNT_SCOPES)))
    _ACCOUNT_SCOPES[owner] = account_scope


def account_scope_for(owner: str) -> str | None:
    return _ACCOUNT_SCOPES.get(owner)


def same_model_host(left: str, right: str) -> bool:
    """Whether two addresses name the same scheme, host and port."""

    return _same_host(left, right)


def _resolve(
    payload: dict[str, Any], *, expected_id: int | None
) -> LocalModelConfiguration:
    from app.workspace_bundle.secrets import (
        WorkspaceSecretBroker,
        WorkspaceSecretBrokerError,
    )

    try:
        status, body = WorkspaceSecretBroker.from_environment().exchange(
            RESOLVE_PATH,
            payload,
            max_response_bytes=MAX_RESPONSE_BYTES,
        )
    except WorkspaceSecretBrokerError:
        raise LocalModelConfigurationError("model_key_unavailable") from None
    if status == 404:
        raise LocalModelConfigurationError("model_configuration_missing")
    if status == 409:
        raise LocalModelConfigurationError("model_key_required")
    configuration = body.get("configuration") if status == 200 else None
    if not isinstance(configuration, dict):
        raise LocalModelConfigurationError("model_key_unavailable")
    values = {
        name: configuration.get(name)
        for name in (
            "provider_name",
            "model_type",
            "endpoint_url",
            "api_key",
            "api_url",
        )
    }
    config = configuration.get("config")
    if (
        expected_id is not None and configuration.get("id") != expected_id
    ) or any(not isinstance(value, str) for value in values.values()):
        raise LocalModelConfigurationError("model_key_unavailable")
    return LocalModelConfiguration(
        config=config if isinstance(config, dict) else {},
        **values,
    )


def _same_host(left: str, right: str) -> bool:
    try:
        first, second = urlsplit(left.strip()), urlsplit(right.strip())
        return (
            bool(first.hostname)
            and first.scheme == second.scheme
            and first.hostname == second.hostname
            and first.port == second.port
        )
    except ValueError:
        return False


def _has_marker(value: Any, depth: int = 0) -> bool:
    if isinstance(value, str):
        return value == SAVED_VALUE_MARKER
    if isinstance(value, dict) and depth < _MAX_DEPTH:
        return any(_has_marker(item, depth + 1) for item in value.values())
    return False


def _fill_markers(value: Any, saved: Any, depth: int = 0) -> Any:
    """Replace each marker with the saved value at the same place."""

    if value == SAVED_VALUE_MARKER and isinstance(value, str):
        if isinstance(saved, str) and saved != SAVED_VALUE_MARKER:
            return saved
        raise LocalModelConfigurationError("model_key_required")
    if isinstance(value, dict) and depth < _MAX_DEPTH:
        saved_items = saved if isinstance(saved, dict) else {}
        return {
            key: _fill_markers(item, saved_items.get(key), depth + 1)
            for key, item in value.items()
        }
    return value


@dataclass(frozen=True)
class FilledModelValues:
    api_key: str | None = field(repr=False)
    url: str | None = field(repr=False)
    model_config_dict: dict[str, Any] | None = field(repr=False)
    extra_params: dict[str, Any] | None = field(repr=False)


def fill_saved_model_values(
    reference: ModelCredentialReference,
    *,
    api_key: str | None,
    url: str | None,
    model_config_dict: dict[str, Any] | None,
    extra_params: dict[str, Any] | None,
) -> FilledModelValues:
    """Complete values typed while a saved configuration is being edited.

    A missing key and every marker are filled from the saved configuration.
    Saved values are only used with the host they were saved for: an edit that
    points the configuration at another host has to bring every secret itself.
    """

    try:
        saved = resolve_local_model_configuration(reference)
    except LocalModelConfigurationError as exc:
        if exc.code != "model_key_required":
            raise
        # Nothing readable is saved: the request has to be complete itself.
        saved = None
    target = url
    if (
        saved is not None
        and url is not None
        and url.strip() == saved.endpoint_url.strip()
    ):
        target = saved.api_url
    key_missing = api_key is None or not api_key.strip()
    if (
        key_missing
        or _has_marker(model_config_dict)
        or _has_marker(extra_params)
    ):
        if saved is None:
            raise LocalModelConfigurationError("model_key_required")
        if target is not None and not _same_host(target, saved.api_url):
            raise LocalModelConfigurationError("model_key_endpoint_changed")
    if key_missing:
        # A configuration saved without a key stays without one.
        api_key = (saved.api_key if saved is not None else "") or None
    return FilledModelValues(
        api_key=api_key,
        url=target,
        model_config_dict=(
            None
            if model_config_dict is None
            else _fill_markers(
                model_config_dict,
                saved.model_config_dict if saved is not None else None,
            )
        ),
        extra_params=(
            None
            if extra_params is None
            else _fill_markers(
                extra_params,
                saved.extra_params if saved is not None else None,
            )
        ),
    )


def apply_local_model_configurations(chat: Any) -> bool:
    """Give a run the saved key of each configuration it references.

    The saved address, key and provider settings replace what the request
    carried for that model, so a key is only ever sent to the address it was
    saved with. Returns whether the task's own model used a saved
    configuration.
    """

    used = False
    reference = getattr(chat, "model_credential", None)
    if reference is not None:
        saved = resolve_local_model_configuration(reference)
        chat.api_key = saved.api_key
        chat.api_url = saved.api_url
        chat.model_config_dict = saved.model_config_dict
        chat.extra_params = saved.extra_params
        used = True
    for agent in getattr(chat, "new_agents", None) or ():
        custom = getattr(agent, "custom_model_config", None)
        agent_reference = getattr(custom, "model_credential", None)
        if custom is None or agent_reference is None:
            continue
        saved = resolve_local_model_configuration(agent_reference)
        custom.api_key = saved.api_key
        custom.api_url = saved.api_url
        custom.model_config_dict = saved.model_config_dict
        custom.extra_params = saved.extra_params
    return used
