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

"""BytePlus ModelArk Managed Agents provider.

ModelArk keeps a long-lived session per agent and environment. One hand-off
is one turn in that session:

1. Open ``GET /sessions/{id}/events/stream`` and wait for the ``: ready``
   comment. The stream does not replay events, so nothing is sent before it.
2. Send ``user.message`` with ``POST /sessions/{id}/events``.
3. Read events until ``session.status_idle``. Only ``stop_reason.type ==
   "end_turn"`` is a normal end; every other end state fails the hand-off.

If the stream drops, a new stream is opened first and the gap is filled from
``GET /sessions/{id}/events``, skipping events already handled.
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

from app.remote_sub_agent.types import (
    RemoteSubAgentEvent,
    RemoteSubAgentEventType,
    RemoteSubAgentRequest,
    RemoteSubAgentSession,
)

logger = logging.getLogger(__name__)

DEFAULT_MODELARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3"
_DEFAULT_TIMEOUT_SECONDS = 60.0
_INTERRUPT_TIMEOUT_SECONDS = 10.0
_MAX_STREAM_RECONNECTS = 3
_MAX_HISTORY_PAGES = 50
_SESSION_AGENT_KEY = "modelark_agent_id"
_ENDED_SESSION_STATUSES = {"terminated", "failed"}
_BUSY_SESSION_STATUSES = {"running", "rescheduling"}
_TOOL_USE_EVENTS = {
    "agent.tool_use",
    "agent.mcp_tool_use",
    "agent.custom_tool_use",
}
_TOOL_RESULT_EVENTS = {"agent.tool_result", "agent.mcp_tool_result"}
_REQUIRES_ACTION_MESSAGE = (
    "The ModelArk agent is waiting for a tool approval, which Eigent cannot "
    "answer. In the ModelArk console, set this agent's tool permission "
    "policy to always allow, then try again."
)


class _StreamClosedError(Exception):
    """The event stream ended before it was ready or before the turn ended."""


@dataclass(slots=True)
class _TurnState:
    session_id: str
    seen_event_ids: set[str] = field(default_factory=set)
    message_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    has_usage: bool = False
    last_error: str | None = None
    user_event_id: str | None = None
    sent_at: datetime | None = None
    done: bool = False

    def usage(self) -> dict[str, int] | None:
        if not self.has_usage:
            return None
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.input_tokens + self.output_tokens,
        }


class ModelArkAgentsProvider:
    name = "modelark_agents"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        agent_id: str | None = None,
        environment_id: str | None = None,
        timeout: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = (api_key or "").strip()
        self.base_url = (base_url or DEFAULT_MODELARK_BASE_URL).rstrip("/")
        self.agent_id = (agent_id or "").strip()
        self.environment_id = (environment_id or "").strip()
        self.timeout = timeout or _DEFAULT_TIMEOUT_SECONDS
        self._transport = transport

    async def run(
        self,
        request: RemoteSubAgentRequest,
        session: RemoteSubAgentSession,
    ) -> AsyncIterator[RemoteSubAgentEvent]:
        self._ensure_configured()
        async with self._client() as client:
            session_id, status = await self._resolve_session(
                client, request, session
            )
            yield RemoteSubAgentEvent(
                event_type=RemoteSubAgentEventType.SESSION_UPDATED,
                interaction_id=session_id,
                environment_id=self.environment_id,
                status=status,
            )

            state = _TurnState(session_id=session_id)
            try:
                async for event in self._run_turn(
                    client,
                    state,
                    self._build_prompt(request),
                    interrupt_first=status in _BUSY_SESSION_STATUSES,
                ):
                    yield event
            except asyncio.CancelledError:
                # The hand-off timed out or was stopped. Stop the remote turn
                # too, so it does not keep running and the next hand-off finds
                # the session idle.
                if state.sent_at is not None and not state.done:
                    await self._interrupt_quietly(client, session_id)
                raise

    async def validate_connection(self) -> dict[str, Any]:
        """Check the API key, agent ID and environment ID.

        Only reads the agent and the environment, so no model run is started
        and nothing is billed.
        """
        self._ensure_configured()
        async with self._client() as client:
            agent = await self._get_resource(
                client, f"/agents/{self.agent_id}", "agent", self.agent_id
            )
            environment = await self._get_resource(
                client,
                f"/environments/{self.environment_id}",
                "environment",
                self.environment_id,
            )
        return {
            "id": agent.get("id") or self.agent_id,
            "environment_id": environment.get("id") or self.environment_id,
            "status": environment.get("status") or agent.get("status"),
        }

    async def _resolve_session(
        self,
        client: httpx.AsyncClient,
        request: RemoteSubAgentRequest,
        session: RemoteSubAgentSession,
    ) -> tuple[str, str | None]:
        existing_id = session.remote_interaction_id
        if (
            request.reuse_session
            and existing_id
            and session.metadata.get(_SESSION_AGENT_KEY) == self.agent_id
            and session.remote_environment_id == self.environment_id
        ):
            data = await self._get_session(client, existing_id)
            status = _status(data.get("status")) if data else None
            if data is not None and status not in _ENDED_SESSION_STATUSES:
                logger.info(
                    "ModelArk session reused: session_id=%s status=%s",
                    existing_id,
                    status,
                )
                return existing_id, status
            logger.info(
                "ModelArk session cannot be reused; creating a new one: "
                "session_id=%s status=%s",
                existing_id,
                status,
            )

        data = await self._request_json(
            client,
            "POST",
            "/sessions",
            json={
                "agent": self.agent_id,
                "environment_id": self.environment_id,
                "title": "Eigent sub-agent task",
            },
        )
        session_id = data.get("id")
        if not isinstance(session_id, str) or not session_id:
            raise RuntimeError(
                "ModelArk Managed Agents API did not return a session id."
            )
        session.metadata[_SESSION_AGENT_KEY] = self.agent_id
        logger.info(
            "ModelArk session created: session_id=%s status=%s",
            session_id,
            data.get("status"),
        )
        return session_id, _status(data.get("status"))

    async def _run_turn(
        self,
        client: httpx.AsyncClient,
        state: _TurnState,
        prompt: str,
        *,
        interrupt_first: bool,
    ) -> AsyncIterator[RemoteSubAgentEvent]:
        reconnects = 0
        while True:
            try:
                async with self._open_stream(client, state.session_id) as (
                    payloads
                ):
                    if state.sent_at is None:
                        if interrupt_first:
                            await self._interrupt_and_wait(
                                client, state.session_id, payloads
                            )
                        await self._send_message(client, state, prompt)
                    else:
                        for data in await self._list_events_since_send(
                            client, state
                        ):
                            for event in self._map_event(data, state):
                                yield event
                            if state.done:
                                return

                    async for data in payloads:
                        for event in self._map_event(data, state):
                            yield event
                        if state.done:
                            return
            except (httpx.TransportError, _StreamClosedError) as exc:
                if state.sent_at is None:
                    raise RuntimeError(
                        f"Could not open the ModelArk event stream: {exc}"
                    ) from exc
                logger.warning(
                    "ModelArk event stream dropped: session_id=%s error=%s",
                    state.session_id,
                    type(exc).__name__,
                )

            reconnects += 1
            if reconnects > _MAX_STREAM_RECONNECTS:
                yield self._failed(
                    state,
                    "Lost the connection to the ModelArk event stream "
                    "before the agent finished.",
                )
                return
            logger.info(
                "ModelArk event stream reconnecting: session_id=%s attempt=%s",
                state.session_id,
                reconnects,
            )

    @asynccontextmanager
    async def _open_stream(
        self,
        client: httpx.AsyncClient,
        session_id: str,
    ) -> AsyncIterator[AsyncIterator[dict[str, Any]]]:
        async with client.stream(
            "GET",
            f"{self.base_url}/sessions/{session_id}/events/stream",
            headers={**self._headers(), "Accept": "text/event-stream"},
            # Agents can work for minutes between events; the runtime's wall
            # time limit bounds the whole hand-off instead.
            timeout=httpx.Timeout(self.timeout, read=None),
        ) as response:
            if response.is_error:
                await response.aread()
                self._raise_for_status(response)
            lines = response.aiter_lines()
            async for line in lines:
                if line.strip() == ": ready":
                    break
            else:
                raise _StreamClosedError("stream closed before it was ready")
            yield _sse_payloads(lines)

    async def _send_message(
        self,
        client: httpx.AsyncClient,
        state: _TurnState,
        prompt: str,
    ) -> None:
        state.sent_at = datetime.now(UTC)
        data = await self._request_json(
            client,
            "POST",
            f"/sessions/{state.session_id}/events",
            json={
                "events": [
                    {
                        "type": "user.message",
                        "content": [{"type": "text", "text": prompt}],
                    }
                ]
            },
        )
        accepted = data.get("data")
        if isinstance(accepted, list) and accepted:
            first = accepted[0]
            if isinstance(first, dict) and isinstance(first.get("id"), str):
                state.user_event_id = first["id"]
                state.seen_event_ids.add(first["id"])

    async def _interrupt_and_wait(
        self,
        client: httpx.AsyncClient,
        session_id: str,
        payloads: AsyncIterator[dict[str, Any]],
    ) -> None:
        """Stop a turn left running by an earlier hand-off.

        Its events would otherwise be read as this turn's events.
        """
        logger.info(
            "ModelArk session busy; interrupting the previous turn: "
            "session_id=%s",
            session_id,
        )
        await self._request_json(
            client,
            "POST",
            f"/sessions/{session_id}/events",
            json={"events": [{"type": "user.interrupt"}]},
        )
        # The stream is already open, so an idle event that arrives after
        # this check is still read below.
        current = await self._get_session(client, session_id)
        if current is not None and _status(current.get("status")) == "idle":
            return
        async for data in payloads:
            event_type = data.get("type")
            if event_type == "session.status_idle":
                return
            if event_type in {"session.status_terminated", "session.deleted"}:
                raise RuntimeError(
                    "The ModelArk session ended while stopping its previous "
                    "turn. Try again to start a new session."
                )
        raise _StreamClosedError("stream closed while waiting for idle")

    async def _interrupt_quietly(
        self,
        client: httpx.AsyncClient,
        session_id: str,
    ) -> None:
        try:
            await asyncio.wait_for(
                self._request_json(
                    client,
                    "POST",
                    f"/sessions/{session_id}/events",
                    json={"events": [{"type": "user.interrupt"}]},
                ),
                timeout=_INTERRUPT_TIMEOUT_SECONDS,
            )
        except Exception as exc:  # best effort while unwinding
            logger.warning(
                "ModelArk interrupt failed: session_id=%s error=%s",
                session_id,
                type(exc).__name__,
            )

    async def _list_events_since_send(
        self,
        client: httpx.AsyncClient,
        state: _TurnState,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"order": "asc"}
        if state.user_event_id:
            params["after"] = state.user_event_id
        elif state.sent_at is not None:
            params["created_after"] = state.sent_at.isoformat()

        events: list[dict[str, Any]] = []
        for _ in range(_MAX_HISTORY_PAGES):
            data = await self._request_json(
                client,
                "GET",
                f"/sessions/{state.session_id}/events",
                params=params,
            )
            page = data.get("data")
            if isinstance(page, list):
                events.extend(item for item in page if isinstance(item, dict))
            next_page = data.get("next_page")
            if not next_page:
                break
            params = {**params, "page": next_page}
        return events

    def _map_event(
        self,
        data: dict[str, Any],
        state: _TurnState,
    ) -> list[RemoteSubAgentEvent]:
        event_id = data.get("id")
        if isinstance(event_id, str):
            if event_id in state.seen_event_ids:
                return []
            state.seen_event_ids.add(event_id)
        else:
            event_id = None

        event_type = data.get("type")
        common = {
            "provider_event_id": event_id,
            "interaction_id": state.session_id,
            "raw": data,
        }

        if event_type == "agent.message":
            text = _content_text(data.get("content"))
            if not text:
                return []
            # One turn can hold several messages, such as notes before a tool
            # call and the final answer. Keep them apart in the joined output.
            prefix = "\n\n" if state.message_count else ""
            state.message_count += 1
            return [
                RemoteSubAgentEvent(
                    event_type=RemoteSubAgentEventType.OUTPUT_DELTA,
                    content=f"{prefix}{text}",
                    **common,
                )
            ]

        if event_type == "agent.thinking":
            return [
                RemoteSubAgentEvent(
                    event_type=RemoteSubAgentEventType.THOUGHT_DELTA,
                    content=_content_text(data.get("content")),
                    **common,
                )
            ]

        if event_type in _TOOL_USE_EVENTS:
            name = data.get("name") or "tool"
            server = data.get("mcp_server_name")
            return [
                RemoteSubAgentEvent(
                    event_type=RemoteSubAgentEventType.TOOL_EVENT,
                    content=f"{server}.{name}" if server else str(name),
                    status="tool_use",
                    **common,
                )
            ]

        if event_type in _TOOL_RESULT_EVENTS:
            return [
                RemoteSubAgentEvent(
                    event_type=RemoteSubAgentEventType.TOOL_EVENT,
                    status="tool_error"
                    if data.get("is_error")
                    else "tool_result",
                    **common,
                )
            ]

        if event_type == "span.model_request_end":
            model_usage = data.get("model_usage")
            if isinstance(model_usage, dict):
                state.has_usage = True
                state.input_tokens += _int(model_usage.get("input_tokens"))
                state.output_tokens += _int(model_usage.get("output_tokens"))

        if event_type == "session.error":
            error = (
                data.get("error")
                if isinstance(data.get("error"), dict)
                else {}
            )
            message = error.get("message") or error.get("type") or "unknown"
            state.last_error = str(message)
            retry_status = error.get("retry_status")
            retry_type = (
                retry_status.get("type")
                if isinstance(retry_status, dict)
                else None
            )
            # "retrying" recovers on its own and "exhausted" is followed by
            # an idle event; only "terminal" ends the session here.
            if retry_type == "terminal":
                return [
                    self._failed(
                        state,
                        f"The ModelArk session stopped with an error: {message}",
                        raw=data,
                        provider_event_id=event_id,
                    )
                ]

        if event_type == "session.status_idle":
            stop_reason = data.get("stop_reason")
            reason = (
                stop_reason.get("type")
                if isinstance(stop_reason, dict)
                else None
            )
            if reason == "end_turn":
                state.done = True
                return [
                    RemoteSubAgentEvent(
                        event_type=RemoteSubAgentEventType.COMPLETED,
                        status=reason,
                        usage=state.usage(),
                        **common,
                    )
                ]
            if reason == "requires_action":
                detail = _REQUIRES_ACTION_MESSAGE
            elif reason == "retries_exhausted":
                detail = "The ModelArk agent stopped after its retries ran out"
                detail += f": {state.last_error}" if state.last_error else "."
            else:
                detail = (
                    "The ModelArk agent stopped without finishing its turn "
                    f"(stop reason: {reason or 'missing'})."
                )
            return [
                self._failed(
                    state, detail, raw=data, provider_event_id=event_id
                )
            ]

        if event_type in {"session.status_terminated", "session.deleted"}:
            ended = "deleted" if event_type == "session.deleted" else "ended"
            return [
                self._failed(
                    state,
                    f"The ModelArk session was {ended} before the agent "
                    "finished.",
                    raw=data,
                    provider_event_id=event_id,
                )
            ]

        return [
            RemoteSubAgentEvent(
                event_type=RemoteSubAgentEventType.RAW_EVENT,
                status=event_type if isinstance(event_type, str) else None,
                **common,
            )
        ]

    def _failed(
        self,
        state: _TurnState,
        message: str,
        *,
        raw: dict[str, Any] | None = None,
        provider_event_id: str | None = None,
    ) -> RemoteSubAgentEvent:
        state.done = True
        return RemoteSubAgentEvent(
            event_type=RemoteSubAgentEventType.FAILED,
            content=message,
            provider_event_id=provider_event_id,
            interaction_id=state.session_id,
            status="failed",
            usage=state.usage(),
            raw=raw,
        )

    def _build_prompt(self, request: RemoteSubAgentRequest) -> str:
        # A ModelArk system.message is appended to the session for good, so a
        # per-hand-off instruction travels with the message instead.
        if not request.system_instruction:
            return request.prompt
        return (
            "<system_instruction>\n"
            f"{request.system_instruction.strip()}\n"
            "</system_instruction>\n\n"
            f"{request.prompt}"
        )

    async def _get_session(
        self,
        client: httpx.AsyncClient,
        session_id: str,
    ) -> dict[str, Any] | None:
        response = await client.get(
            f"{self.base_url}/sessions/{session_id}",
            headers=self._headers(),
        )
        if response.status_code == 404:
            return None
        self._raise_for_status(response)
        return _json_object(response)

    async def _get_resource(
        self,
        client: httpx.AsyncClient,
        path: str,
        label: str,
        resource_id: str,
    ) -> dict[str, Any]:
        response = await client.get(
            f"{self.base_url}{path}", headers=self._headers()
        )
        if response.status_code == 404:
            raise RuntimeError(
                f"ModelArk {label} '{resource_id}' was not found. Check the "
                f"{label} ID and the API host region."
            )
        self._raise_for_status(response)
        return _json_object(response)

    async def _request_json(
        self,
        client: httpx.AsyncClient,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = await client.request(
            method,
            f"{self.base_url}{path}",
            headers=self._headers(),
            json=json,
            params=params,
        )
        self._raise_for_status(response)
        return _json_object(response)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=self.timeout,
            transport=self._transport,
        )

    def _ensure_configured(self) -> None:
        missing = [
            label
            for label, value in (
                ("API key", self.api_key),
                ("agent ID", self.agent_id),
                ("environment ID", self.environment_id),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(
                "ModelArk Managed Agents provider requires "
                f"{', '.join(missing)} from the RemoteSubAgent configuration."
            )

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    def _raise_for_status(self, response: httpx.Response) -> None:
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            body = response.text[:2000]
            raise RuntimeError(
                "ModelArk Managed Agents API request failed: "
                f"{response.status_code} {body}"
            ) from exc


async def _sse_payloads(
    lines: AsyncIterator[str],
) -> AsyncIterator[dict[str, Any]]:
    """Yield the JSON object of each SSE event; skip comments and [DONE]."""
    data_lines: list[str] = []
    async for line in lines:
        if line == "":
            payload = _parse_sse_data(data_lines)
            data_lines = []
            if payload is not None:
                yield payload
            continue
        if line.startswith(":"):
            continue
        if line.startswith("data:"):
            data_lines.append(line[5:].removeprefix(" "))
    payload = _parse_sse_data(data_lines)
    if payload is not None:
        yield payload


def _parse_sse_data(data_lines: list[str]) -> dict[str, Any] | None:
    if not data_lines:
        return None
    raw = "\n".join(data_lines).strip()
    if not raw or raw == "[DONE]":
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        logger.debug("Ignoring non-JSON ModelArk stream payload")
        return None
    return payload if isinstance(payload, dict) else None


def _json_object(response: httpx.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(
            "ModelArk Managed Agents API returned a response that is not JSON."
        ) from exc
    return data if isinstance(data, dict) else {}


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "".join(
        block["text"]
        for block in content
        if isinstance(block, dict)
        and block.get("type", "text") == "text"
        and isinstance(block.get("text"), str)
    )


def _status(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip().lower() or None


def _int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
