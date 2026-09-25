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

"""Use the existing server/account/device credential channel, in memory only."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Literal
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from app.run_sync.cloud_sync import CloudSyncConfiguration
from app.workspace_config.models import canonical_digest

from .agent_configuration import AgentConfigurationUnavailable
from .service import ExecutionForbidden, ExecutionOrigin


class Identity(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, strict=True, hide_input_in_errors=True
    )
    account_owner_id: str = Field(pattern=r"^[1-9][0-9]{0,18}$")
    desktop_instance_id: str = Field(
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"
    )
    device_credential_version: int = Field(ge=1)


class ProviderSnapshot(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, strict=True, hide_input_in_errors=True
    )
    provider_ref: str = Field(
        pattern=r"^provider:[1-9][0-9]{0,18}:[0-9a-f]{32}$"
    )
    model_platform: Literal["openai"]
    model_type: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    api_url: str = Field(max_length=512)
    model_config_dict: dict
    extra_params: dict


class ConfigurationSnapshot(Identity):
    project_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    space_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    space_source_type: Literal["blank", "folder", "legacy"] | None = None
    session_mode: Literal["single-agent", "workforce"]
    space_root: str = Field(min_length=1, max_length=4096)
    thinking_effort: (
        Literal["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
        | None
    )
    provider: ProviderSnapshot


class CredentialResolution(ConfigurationSnapshot):
    api_key: SecretStr = Field(repr=False)


def server_authority(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"https", "http"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or (
            parsed.scheme == "http"
            and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
        )
        or parsed.path.rstrip("/") not in {"", "/api", "/api/v1"}
    ):
        raise AgentConfigurationUnavailable("server_authority_invalid")
    return f"{parsed.scheme}://{parsed.netloc}/api/v1"


class AccountConfigurationSource:
    def __init__(
        self,
        server_url: str,
        configuration: Callable[[], CloudSyncConfiguration | None],
        *,
        transport=None,
    ):
        self.authority = server_authority(server_url)
        self.authority_ref = "authority:" + canonical_digest(self.authority)
        self.configuration = configuration
        self.transport = transport
        self._last_identity = None

    def current(self):
        configuration = self.configuration()
        if (
            not isinstance(configuration, CloudSyncConfiguration)
            or configuration.endpoint_url
            != self.authority + "/sync/events:ingest"
            or not configuration.authorization.strip()
        ):
            raise AgentConfigurationUnavailable("authentication_required")
        return configuration

    def origin(self, identity: Identity):
        # No bearer token or verifiable digest of a secret is included.
        return ExecutionOrigin(
            f"account:{self.authority_ref.removeprefix('authority:')}:{identity.account_owner_id}:{identity.desktop_instance_id}"
        )

    async def _request(self, path, schema, *, body=None):
        configuration = self.current()
        try:
            async with (
                asyncio.timeout(5),
                httpx.AsyncClient(
                    trust_env=False,
                    follow_redirects=False,
                    timeout=5,
                    transport=self.transport,
                ) as client,
            ):
                async with client.stream(
                    "GET" if body is None else "POST",
                    self.authority + "/sync/execution" + path,
                    headers={
                        "Authorization": configuration.authorization,
                        "X-Desktop-Instance-ID": configuration.desktop_instance_id,
                    },
                    json=body,
                ) as response:
                    if response.status_code != 200:
                        raise ValueError("configuration request rejected")
                    raw = bytearray()
                    async for chunk in response.aiter_bytes():
                        raw.extend(chunk)
                        if len(raw) > 1024 * 1024:
                            raise ValueError(
                                "configuration response exceeds limit"
                            )
                    result = schema.model_validate_json(raw)
            if (
                self.current() != configuration
                or result.desktop_instance_id
                != configuration.desktop_instance_id
            ):
                raise ValueError(
                    "account configuration changed during request"
                )
            self._last_identity = (self.origin(result), configuration)
            return result, configuration
        except Exception:
            # Never retain/echo response bodies, HTTP exception repr, key/token
            # or Pydantic input in an error, status record or log.
            raise AgentConfigurationUnavailable(
                "authentication_or_configuration_required"
            ) from None

    def authorize_control(self, origin):
        """Control a previously owned intent even when its model is revoked."""
        try:
            return self._last_identity == (origin, self.current())
        except AgentConfigurationUnavailable:
            return False

    async def authenticated_origin(self, principal):
        identity, _ = await self._request("/identity", Identity)
        if (
            principal.kind == "brain_user"
            and principal.user_id != identity.account_owner_id
        ):
            raise ExecutionForbidden("account identity differs")
        if principal.kind not in {"brain_user", "desktop_renderer"}:
            raise ExecutionForbidden("unsupported execution origin")
        return self.origin(identity)

    async def read(self, project_id):
        return await self._request(
            f"/projects/{project_id}/configuration", ConfigurationSnapshot
        )

    async def resolve(self, snapshot: ConfigurationSnapshot):
        result, configuration = await self._request(
            f"/projects/{snapshot.project_id}/credentials:resolve",
            CredentialResolution,
            body={
                "provider_ref": snapshot.provider.provider_ref,
                "space_id": snapshot.space_id,
                "session_mode": snapshot.session_mode,
            },
        )
        return result, configuration
