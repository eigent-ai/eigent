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

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.component.environment import env
from app.remote_sub_agent.types import (
    RemoteSubAgentEvent,
    RemoteSubAgentEventType,
    RemoteSubAgentRequest,
    RemoteSubAgentSession,
)

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
_DEFAULT_AGENT = ""
_TERMINAL_SUCCESS_STATUSES = {"completed"}
_TERMINAL_FAILURE_STATUSES = {"failed", "cancelled", "expired", "incomplete"}
_UNSUPPORTED_ACTION_STATUSES = {"requires_action"}


class GeminiAgentsProvider:
    name = "gemini_agents"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        agent_name: str | None = None,
        timeout: float | None = None,
        poll_interval_seconds: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = (
            api_key
            if api_key is not None
            else env("GEMINI_API_KEY") or env("GOOGLE_API_KEY") or ""
        )
        self.base_url = (
            base_url
            or env("GEMINI_INTERACTIONS_BASE_URL")
            or env("GEMINI_AGENTS_BASE_URL")
            or _DEFAULT_BASE_URL
        ).rstrip("/")
        configured_agent_name = (
            agent_name
            if agent_name is not None
            else env("GEMINI_INTERACTIONS_AGENT") or env("GEMINI_AGENTS_AGENT")
        )
        self.agent_name = configured_agent_name or _DEFAULT_AGENT
        self._agent_name_is_configured = bool(configured_agent_name)
        self.timeout = timeout or float(
            env("GEMINI_INTERACTIONS_TIMEOUT_SECONDS", "300")
        )
        self.poll_interval_seconds = (
            poll_interval_seconds
            if poll_interval_seconds is not None
            else float(env("GEMINI_INTERACTIONS_POLL_INTERVAL_SECONDS", "5"))
        )
        self._transport = transport

    async def run(
        self,
        request: RemoteSubAgentRequest,
        session: RemoteSubAgentSession,
    ) -> AsyncIterator[RemoteSubAgentEvent]:
        body = self._build_request_body(request, session)
        if request.stream:
            async for event in self._stream_interaction(body):
                yield event
            return

        data = await self._create_interaction(body)
        for event in self._events_from_interaction(data):
            yield event

        if self._should_poll_background_interaction(body, data):
            async for event in self._poll_interaction(data["id"]):
                yield event

    async def validate_connection(self) -> dict[str, Any]:
        """Validate credentials and agent routing with a minimal interaction.

        The goal is to fail fast for bad API keys, base URLs, or agent ids
        before a real task is started. We only require the API to accept the
        interaction and return an id; the validation probe is intentionally not
        polled to completion.
        """
        body: dict[str, Any] = {
            "input": [
                {
                    "type": "text",
                    "text": "Connectivity check. Reply exactly OK.",
                }
            ],
            "stream": False,
            "background": True,
            "environment": {"enabled": True},
            "agent": self.agent_name,
        }
        try:
            return await self._create_interaction(body)
        except RuntimeError as exc:
            if not self._looks_like_background_unsupported(exc):
                raise
            fallback_body = dict(body)
            fallback_body.pop("background", None)
            return await self._create_interaction(fallback_body)

    async def _create_interaction(
        self,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        logger.info(
            "Gemini Agents interaction request: "
            "base_url=%s agent=%s stream=%s background=%s environment=%s "
            "has_previous_interaction_id=%s",
            self.base_url,
            body.get("agent"),
            body.get("stream"),
            body.get("background"),
            body.get("environment"),
            bool(body.get("previous_interaction_id")),
        )
        async with httpx.AsyncClient(
            timeout=self.timeout,
            transport=self._transport,
        ) as client:
            response = await client.post(
                f"{self.base_url}/interactions",
                headers=self._headers(),
                json=body,
            )
        self._raise_for_status(response)
        data = response.json()
        logger.info(
            "Gemini Agents interaction response: "
            "status_code=%s interaction_id=%s environment_id=%s status=%s "
            "outputs_count=%s has_usage=%s",
            response.status_code,
            data.get("id"),
            data.get("environment_id"),
            data.get("status"),
            len(data.get("outputs") or []),
            data.get("usage") is not None,
        )
        return data

    async def _get_interaction(self, interaction_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(
            timeout=self.timeout,
            transport=self._transport,
        ) as client:
            response = await client.get(
                f"{self.base_url}/interactions/{interaction_id}",
                headers=self._headers(),
            )
        self._raise_for_status(response)
        data = response.json()
        logger.info(
            "Gemini Agents interaction poll response: "
            "interaction_id=%s environment_id=%s status=%s outputs_count=%s "
            "has_usage=%s",
            interaction_id,
            data.get("environment_id"),
            data.get("status"),
            len(data.get("outputs") or []),
            data.get("usage") is not None,
        )
        return data

    async def _poll_interaction(
        self,
        interaction_id: str,
    ) -> AsyncIterator[RemoteSubAgentEvent]:
        while True:
            if self.poll_interval_seconds > 0:
                await asyncio.sleep(self.poll_interval_seconds)

            data = await self._get_interaction(interaction_id)
            for event in self._events_from_interaction(data):
                yield event

            status = self._status(data.get("status"))
            if self._is_terminal_status(status):
                return

    async def _stream_interaction(
        self,
        body: dict[str, Any],
    ) -> AsyncIterator[RemoteSubAgentEvent]:
        headers = {**self._headers(), "Accept": "text/event-stream"}
        logger.info(
            "Gemini Agents stream request: "
            "base_url=%s agent=%s background=%s has_previous_interaction_id=%s",
            self.base_url,
            body.get("agent"),
            body.get("background"),
            bool(body.get("previous_interaction_id")),
        )
        async with httpx.AsyncClient(
            timeout=self.timeout,
            transport=self._transport,
        ) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/interactions",
                headers=headers,
                json=body,
            ) as response:
                self._raise_for_status(response)
                async for line in response.aiter_lines():
                    async for event in self._events_from_sse_line(line):
                        yield event

    async def _events_from_sse_line(
        self,
        line: str,
    ) -> AsyncIterator[RemoteSubAgentEvent]:
        stripped = line.strip()
        if not stripped or not stripped.startswith("data:"):
            return

        payload = stripped.removeprefix("data:").strip()
        if payload == "[DONE]":
            return

        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            logger.debug("Ignoring non-json Gemini stream payload: %s", line)
            return

        for event in self._events_from_stream_payload(data):
            yield event

    def _build_request_body(
        self,
        request: RemoteSubAgentRequest,
        session: RemoteSubAgentSession,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "input": [{"type": "text", "text": request.prompt}],
            "stream": request.stream,
            "environment": self._environment_body(request, session),
        }

        agent_name = self.agent_name
        if request.remote_agent_name and not self._agent_name_is_configured:
            agent_name = request.remote_agent_name
        body["agent"] = agent_name
        if request.system_instruction:
            body["input"] = self._merge_system_instruction_into_input(
                request.system_instruction,
                request.prompt,
            )

        previous_interaction_id = (
            session.remote_interaction_id if request.reuse_session else None
        )
        if previous_interaction_id:
            body["previous_interaction_id"] = previous_interaction_id

        body.update(request.extra_body)
        return body

    def _environment_body(
        self,
        request: RemoteSubAgentRequest,
        session: RemoteSubAgentSession,
    ) -> dict[str, Any]:
        if request.reuse_session and session.remote_environment_id:
            return {"env_id": session.remote_environment_id}
        return {"enabled": True}

    def _merge_system_instruction_into_input(
        self,
        system_instruction: str,
        prompt: str,
    ) -> list[dict[str, str]]:
        return [
            {
                "type": "text",
                "text": (
                    "<system_instruction>\n"
                    f"{system_instruction.strip()}\n"
                    "</system_instruction>\n\n"
                    f"{prompt}"
                ),
            }
        ]

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise RuntimeError(
                "Gemini Agents provider requires an API key from the "
                "RemoteSubAgent configuration."
            )
        return {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }

    def _raise_for_status(self, response: httpx.Response) -> None:
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            body = response.text[:2000]
            raise RuntimeError(
                "Gemini Agents API request failed: "
                f"{response.status_code} {body}"
            ) from exc

    def _looks_like_background_unsupported(
        self,
        error: RuntimeError,
    ) -> bool:
        message = str(error).lower()
        return "background" in message and (
            "unsupported" in message
            or "not supported" in message
            or "unknown" in message
            or "invalid" in message
        )

    def _events_from_interaction(
        self,
        data: dict[str, Any],
    ) -> list[RemoteSubAgentEvent]:
        interaction_id = data.get("id")
        environment_id = data.get("environment_id")
        events: list[RemoteSubAgentEvent] = []
        if interaction_id:
            events.append(
                RemoteSubAgentEvent(
                    event_type=RemoteSubAgentEventType.SESSION_UPDATED,
                    interaction_id=interaction_id,
                    environment_id=environment_id,
                    status=data.get("status"),
                    raw=data,
                )
            )

        status = self._status(data.get("status"))
        if status in _TERMINAL_SUCCESS_STATUSES:
            events.append(
                RemoteSubAgentEvent(
                    event_type=RemoteSubAgentEventType.COMPLETED,
                    content=self._extract_outputs_text(data),
                    interaction_id=interaction_id,
                    environment_id=environment_id,
                    status=data.get("status"),
                    usage=data.get("usage"),
                    raw=data,
                )
            )
        elif status in _TERMINAL_FAILURE_STATUSES:
            events.append(
                RemoteSubAgentEvent(
                    event_type=RemoteSubAgentEventType.FAILED,
                    content=self._extract_failure_text(data),
                    interaction_id=interaction_id,
                    environment_id=environment_id,
                    status=data.get("status"),
                    usage=data.get("usage"),
                    raw=data,
                )
            )
        elif status in _UNSUPPORTED_ACTION_STATUSES:
            events.append(
                RemoteSubAgentEvent(
                    event_type=RemoteSubAgentEventType.FAILED,
                    content=(
                        "Gemini interaction requires client-side action, "
                        "which RemoteSubAgent does not support yet."
                    ),
                    interaction_id=interaction_id,
                    environment_id=environment_id,
                    status=data.get("status"),
                    raw=data,
                )
            )
        return events

    def _events_from_stream_payload(
        self,
        data: dict[str, Any],
    ) -> list[RemoteSubAgentEvent]:
        interaction_id = data.get("id") or data.get("interaction_id")
        environment_id = data.get("environment_id")
        event_id = data.get("event_id")
        status = data.get("status")
        event_type = data.get("event_type")

        if event_type in {"step.delta", "content.delta"}:
            delta = data.get("delta")
            content = self._extract_delta_text(delta)
            if content:
                return [
                    RemoteSubAgentEvent(
                        event_type=RemoteSubAgentEventType.OUTPUT_DELTA,
                        content=content,
                        provider_event_id=event_id,
                        interaction_id=interaction_id,
                        environment_id=environment_id,
                        status=status,
                        raw=data,
                    )
                ]

        if event_type == "thought_summary.delta":
            return [
                RemoteSubAgentEvent(
                    event_type=RemoteSubAgentEventType.THOUGHT_DELTA,
                    content=self._extract_delta_text(data.get("delta")),
                    provider_event_id=event_id,
                    interaction_id=interaction_id,
                    environment_id=environment_id,
                    status=status,
                    raw=data,
                )
            ]

        normalized_status = self._status(status)
        if self._is_terminal_status(normalized_status):
            return [
                RemoteSubAgentEvent(
                    event_type=self._terminal_event_type(normalized_status),
                    content=self._extract_outputs_text(data),
                    provider_event_id=event_id,
                    interaction_id=interaction_id,
                    environment_id=environment_id,
                    status=status,
                    usage=data.get("usage"),
                    raw=data,
                )
            ]

        if interaction_id:
            return [
                RemoteSubAgentEvent(
                    event_type=RemoteSubAgentEventType.SESSION_UPDATED,
                    provider_event_id=event_id,
                    interaction_id=interaction_id,
                    environment_id=environment_id,
                    status=status,
                    raw=data,
                )
            ]

        return [
            RemoteSubAgentEvent(
                event_type=RemoteSubAgentEventType.RAW_EVENT,
                provider_event_id=event_id,
                status=status,
                raw=data,
            )
        ]

    def _terminal_event_type(
        self,
        status: str | None,
    ) -> RemoteSubAgentEventType:
        if status in _TERMINAL_FAILURE_STATUSES:
            return RemoteSubAgentEventType.FAILED
        return RemoteSubAgentEventType.COMPLETED

    def _should_poll_background_interaction(
        self,
        _body: dict[str, Any],
        data: dict[str, Any],
    ) -> bool:
        status = self._status(data.get("status"))
        return (
            isinstance(data.get("id"), str)
            and not self._is_terminal_status(status)
            and status not in _UNSUPPORTED_ACTION_STATUSES
        )

    def _is_terminal_status(self, status: str | None) -> bool:
        return (
            status in _TERMINAL_SUCCESS_STATUSES
            or status in _TERMINAL_FAILURE_STATUSES
        )

    def _status(self, value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        return value.strip().lower()

    def _extract_failure_text(self, data: dict[str, Any]) -> str:
        error = data.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str):
                return message
        return self._extract_outputs_text(data) or str(data.get("status"))

    def _extract_outputs_text(self, data: dict[str, Any]) -> str:
        outputs = data.get("outputs") or []
        texts: list[str] = []
        for output in outputs:
            text = self._extract_delta_text(output)
            if text:
                texts.append(text)
        return "".join(texts)

    def _extract_delta_text(self, value: Any) -> str:
        if isinstance(value, str):
            return value
        if not isinstance(value, dict):
            return ""

        text = value.get("text")
        if isinstance(text, str):
            return text

        content = value.get("content")
        if isinstance(content, dict):
            return self._extract_delta_text(content)
        if isinstance(content, list):
            return "".join(self._extract_delta_text(item) for item in content)

        delta = value.get("delta")
        if isinstance(delta, dict):
            return self._extract_delta_text(delta)

        return ""
