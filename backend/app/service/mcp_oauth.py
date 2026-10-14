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

"""Resolve remote MCP credentials only at the in-memory connection boundary."""

from __future__ import annotations

import asyncio
import copy
import json
import logging
from urllib.parse import quote

from app.workspace_bundle.secrets import (
    WorkspaceSecretBroker,
    WorkspaceSecretBrokerError,
)


class _McpTransportLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # Third-party exceptions can embed complete configs or HTTP headers.
        # Keep our attributed, typed notices as the diagnostic boundary.
        if record.levelno >= logging.WARNING:
            record.msg = "MCP transport failed; see connector status"
            record.args = ()
            record.exc_info = None
            record.exc_text = None
        elif (
            "authorization" in record.getMessage().lower()
            or "bearer " in record.getMessage().lower()
        ):
            record.msg = "MCP transport diagnostic redacted"
            record.args = ()
        return True


for _logger_name in ("camel.toolkits.mcp_toolkit", "camel.utils.mcp_client"):
    logging.getLogger(_logger_name).addFilter(_McpTransportLogFilter())


async def connect_mcp_toolkit(toolkit) -> None:
    # CAMEL's aggregate connect error discards individual transport causes.
    # Capture each client's failure before aggregation, without persisting it.
    connect_client = getattr(toolkit, "_connect_single_client", None)
    auth_failed = False
    if connect_client is None:
        await toolkit.connect()
        return

    async def connect(index, client):
        nonlocal auth_failed
        try:
            return await connect_client(index, client)
        except Exception as exc:
            auth_failed |= is_mcp_auth_failure(exc)
            raise

    toolkit._connect_single_client = connect
    try:
        await toolkit.connect()
    except Exception:
        if auth_failed:
            # Carries only classification; headers never enter setup errors.
            raise McpAuthFailed() from None
        raise
    finally:
        toolkit._connect_single_client = connect_client


class McpAuthFailed(RuntimeError):
    status_code = 401


class McpOAuthRequired(RuntimeError):
    def __init__(self, name: str):
        self.name = name
        self.reason = "signin_required"
        super().__init__(f"mcp_oauth_required:{quote(name, safe='')}")


class McpOAuthUnavailable(RuntimeError):
    def __init__(self, name: str, reason: str):
        self.name = name
        self.reason = reason
        super().__init__(
            f"mcp_oauth_unavailable:{quote(name, safe='')}:{reason}"
        )


def apply_mcp_oauth(config: dict, *, account: str) -> dict:
    result = copy.deepcopy(config)
    for name, server in result.get("mcpServers", {}).items():
        connector_name = server.pop("_oauth_connector_name", name)
        auth = server.pop("auth", None)
        if auth is None:
            continue
        if (
            auth != {"type": "oauth"}
            or not server.get("url")
            or server.get("command")
        ):
            raise McpOAuthUnavailable(connector_name, "invalid_request")
        try:
            broker = WorkspaceSecretBroker.from_environment()
            # The same broker captures and removes process authority from the
            # environment before any agent or MCP subprocess can inherit it.
            response = broker.resolve_mcp_oauth(
                account=account, name=connector_name, url=server["url"]
            )
        except WorkspaceSecretBrokerError:
            raise McpOAuthUnavailable(
                connector_name, "broker_unavailable"
            ) from None
        reason = response.get("error")
        if reason == "signin_required":
            raise McpOAuthRequired(connector_name)
        if reason:
            if reason not in {
                "refresh_failed",
                "network",
                "encryption_unavailable",
                "invalid_request",
                "invalid_metadata",
            }:
                reason = "broker_unavailable"
            raise McpOAuthUnavailable(connector_name, reason)
        token = response.get("access_token")
        if (
            not isinstance(token, str)
            or not token
            or "\r" in token
            or "\n" in token
        ):
            raise McpOAuthUnavailable(connector_name, "broker_unavailable")
        headers = {
            key: value
            for key, value in server.get("headers", {}).items()
            if key.lower() != "authorization"
        }
        headers["Authorization"] = f"Bearer {token}"
        server["headers"] = headers
    return result


def is_mcp_auth_failure(error: BaseException) -> bool:
    """Inspect HTTP status without rendering exceptions containing credentials."""
    if getattr(getattr(error, "response", None), "status_code", None) == 401:
        return True
    if getattr(error, "status_code", None) == 401:
        return True
    nested = getattr(error, "exceptions", ())
    if any(is_mcp_auth_failure(item) for item in nested):
        return True
    cause = error.__cause__ or error.__context__
    if cause is not None and cause is not error and is_mcp_auth_failure(cause):
        return True
    # CAMEL wraps transport exceptions in RuntimeError in some versions.
    return "401" in str(error) and any(
        word in str(error).lower()
        for word in ("unauthorized", "status", "http")
    )


async def emit_mcp_notice(
    project_id: str | None, name: str, reason: str
) -> None:
    from app.service.task import ActionNoticeData, get_task_lock_if_exists

    task_lock = get_task_lock_if_exists(project_id) if project_id else None
    if task_lock is None:
        return
    await task_lock.put_queue(
        ActionNoticeData(
            process_task_id=project_id,
            data="mcp_connector_unavailable:"
            + json.dumps({"name": name, "reason": reason}, ensure_ascii=False),
            title="mcp_connector_unavailable",
            purpose="status",
            severity="warning",
        )
    )


async def prepare_mcp_oauth(
    config: dict,
    *,
    account: str,
    project_id: str | None,
    strict: bool,
) -> dict:
    result = {"mcpServers": {}}
    for name, server in config.get("mcpServers", {}).items():
        try:
            resolved = await asyncio.to_thread(
                apply_mcp_oauth,
                {"mcpServers": {name: server}},
                account=account,
            )
            result["mcpServers"].update(resolved["mcpServers"])
        except (McpOAuthRequired, McpOAuthUnavailable) as exc:
            if strict:
                from app.workspace_bundle.runtime import (
                    EnvironmentSetupRequiredError,
                )

                raise EnvironmentSetupRequiredError([str(exc)]) from None
            await emit_mcp_notice(project_id, exc.name, exc.reason)
    return result
