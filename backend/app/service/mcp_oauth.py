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
import re
from urllib.parse import quote

from app.workspace_bundle.secrets import (
    WorkspaceSecretBroker,
    WorkspaceSecretBrokerError,
)

_CREDENTIAL_MARKERS = ("authorization", "bearer ")
_exception_formatter = logging.Formatter()


class _McpTransportLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # Third-party messages and exceptions can embed complete configs or
        # HTTP headers. Redact only records that carry credential material so
        # unrelated connector failures keep their diagnostics.
        text = record.getMessage()
        if record.exc_info:
            text += _exception_formatter.formatException(record.exc_info)
        elif record.exc_text:
            text += record.exc_text
        if any(marker in text.lower() for marker in _CREDENTIAL_MARKERS):
            record.msg = (
                "MCP transport failed; see connector status"
                if record.levelno >= logging.WARNING
                else "MCP transport diagnostic redacted"
            )
            record.args = ()
            record.exc_info = None
            record.exc_text = None
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


async def connect_mcp_toolkits(toolkits) -> list[BaseException | None]:
    """Connect independent toolkits concurrently, returning each failure."""
    results = await asyncio.gather(
        *(connect_mcp_toolkit(toolkit) for toolkit in toolkits),
        return_exceptions=True,
    )
    for result in results:
        if isinstance(result, asyncio.CancelledError):
            raise result
    return [
        result if isinstance(result, BaseException) else None
        for result in results
    ]


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


def mcp_connector_name(name: str, server: object) -> str:
    """Return the connector identity a notice or sign-in should refer to."""
    if isinstance(server, dict):
        connector_name = server.get("_oauth_connector_name")
        if isinstance(connector_name, str) and connector_name:
            return connector_name
    return name


def apply_mcp_oauth(config: dict, *, account: str) -> dict:
    result = copy.deepcopy(config)
    for name, server in result.get("mcpServers", {}).items():
        connector_name = mcp_connector_name(name, server)
        server.pop("_oauth_connector_name", None)
        auth = server.pop("auth", None)
        if auth is None:
            continue
        configured_headers = server.get("headers") or {}
        if (
            auth != {"type": "oauth"}
            or not server.get("url")
            or server.get("command")
            or not isinstance(configured_headers, dict)
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
            for key, value in configured_headers.items()
            if str(key).lower() != "authorization"
        }
        headers["Authorization"] = f"Bearer {token}"
        server["headers"] = headers
    return result


_HTTP_401_MESSAGE = re.compile(
    r"(?<![\w.:/-])401\s+unauthorized\b"
    r"|\bstatus(?:[\s_-]?code)?\s*[:=]?\s*401(?![\w.])",
    re.IGNORECASE,
)


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
    # CAMEL wraps transport exceptions in RuntimeError in some versions. Match
    # only an HTTP 401 status, not any URL, port or identifier containing 401.
    return _HTTP_401_MESSAGE.search(str(error)) is not None


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
            continue
        except (McpOAuthRequired, McpOAuthUnavailable) as exc:
            failure = exc
        except Exception:
            # A malformed entry must not abort the other connectors. The
            # exception text may echo the config, so keep only its identity.
            failure = McpOAuthUnavailable(
                mcp_connector_name(name, server), "invalid_request"
            )
        if strict:
            from app.workspace_bundle.runtime import (
                EnvironmentSetupRequiredError,
            )

            raise EnvironmentSetupRequiredError([str(failure)]) from None
        await emit_mcp_notice(project_id, failure.name, failure.reason)
    return result
