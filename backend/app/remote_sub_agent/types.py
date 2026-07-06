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

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol

from app.remote_sub_agent.constants import DEFAULT_REMOTE_SUB_AGENT_PROVIDER


class RemoteSubAgentEventType(StrEnum):
    SESSION_UPDATED = "session_updated"
    OUTPUT_DELTA = "output_delta"
    THOUGHT_DELTA = "thought_delta"
    TOOL_EVENT = "tool_event"
    COMPLETED = "completed"
    FAILED = "failed"
    RAW_EVENT = "raw_event"


@dataclass(slots=True)
class RemoteSubAgentSession:
    session_id: str
    provider: str
    api_task_id: str
    remote_agent_name: str | None = None
    remote_interaction_id: str | None = None
    remote_environment_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RemoteSubAgentRequest:
    api_task_id: str
    prompt: str
    provider: str = DEFAULT_REMOTE_SUB_AGENT_PROVIDER
    remote_agent_name: str | None = None
    system_instruction: str | None = None
    reuse_session: bool = True
    stream: bool = False
    extra_body: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RemoteSubAgentEvent:
    event_type: RemoteSubAgentEventType
    content: str | None = None
    provider_event_id: str | None = None
    interaction_id: str | None = None
    environment_id: str | None = None
    status: str | None = None
    usage: dict[str, Any] | None = None
    raw: dict[str, Any] | None = None


@dataclass(slots=True)
class RemoteSubAgentRunResult:
    final_text: str
    session: RemoteSubAgentSession
    events: list[RemoteSubAgentEvent]
    usage: dict[str, Any] | None = None


class RemoteSubAgentProvider(Protocol):
    name: str

    async def run(
        self,
        request: RemoteSubAgentRequest,
        session: RemoteSubAgentSession,
    ) -> AsyncIterator[RemoteSubAgentEvent]: ...
