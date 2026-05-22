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
import logging
from dataclasses import replace

from app.remote_sub_agent.policy import (
    RemoteSubAgentPolicy,
    build_default_policy,
)
from app.remote_sub_agent.session_store import (
    GLOBAL_REMOTE_SUB_AGENT_SESSIONS,
    RemoteSubAgentSessionStore,
)
from app.remote_sub_agent.types import (
    RemoteSubAgentEvent,
    RemoteSubAgentEventType,
    RemoteSubAgentProvider,
    RemoteSubAgentRequest,
    RemoteSubAgentRunResult,
)

logger = logging.getLogger(__name__)


class RemoteSubAgentRuntime:
    def __init__(
        self,
        provider: RemoteSubAgentProvider,
        policy: RemoteSubAgentPolicy | None = None,
        session_store: RemoteSubAgentSessionStore | None = None,
    ) -> None:
        self.provider = provider
        self.policy = policy or build_default_policy()
        self.session_store = session_store or GLOBAL_REMOTE_SUB_AGENT_SESSIONS

    async def run(
        self,
        request: RemoteSubAgentRequest,
        session_key: str | None = None,
    ) -> RemoteSubAgentRunResult:
        self.policy.ensure_enabled()
        self.policy.ensure_provider_allowed(self.provider.name)

        session = self.session_store.get_or_create(
            api_task_id=request.api_task_id,
            provider=self.provider.name,
            remote_agent_name=request.remote_agent_name,
            session_key=session_key,
        )
        if not request.reuse_session and (
            session.remote_interaction_id or session.remote_environment_id
        ):
            logger.info(
                "RemoteSubAgent existing session found; reusing it",
                extra={
                    "api_task_id": request.api_task_id,
                    "provider": self.provider.name,
                    "session_id": session.session_id,
                    "interaction_id": session.remote_interaction_id,
                    "environment_id": session.remote_environment_id,
                },
            )
            request = replace(request, reuse_session=True)

        output_chunks: list[str] = []
        events: list[RemoteSubAgentEvent] = []
        usage: dict | None = None

        try:
            async with asyncio.timeout(self.policy.max_wall_time_seconds):
                async for event in self.provider.run(request, session):
                    events.append(event)
                    if event.interaction_id:
                        session.remote_interaction_id = event.interaction_id
                    if event.environment_id:
                        session.remote_environment_id = event.environment_id
                    if event.usage:
                        usage = event.usage
                    if event.event_type is RemoteSubAgentEventType.FAILED:
                        detail = event.content or event.status or "unknown"
                        raise RuntimeError(
                            f"RemoteSubAgent provider failed: {detail}"
                        )
                    if (
                        event.event_type
                        is RemoteSubAgentEventType.OUTPUT_DELTA
                        and event.content
                    ):
                        output_chunks.append(event.content)
        except TimeoutError:
            logger.warning(
                "RemoteSubAgent run timed out",
                extra={
                    "api_task_id": request.api_task_id,
                    "provider": self.provider.name,
                },
            )
            raise
        finally:
            self.session_store.update(session)

        final_text = "".join(output_chunks).strip()
        if not final_text:
            final_text = self._last_completed_content(events)

        return RemoteSubAgentRunResult(
            final_text=final_text,
            session=session,
            events=events,
            usage=usage,
        )

    def _last_completed_content(
        self,
        events: list[RemoteSubAgentEvent],
    ) -> str:
        for event in reversed(events):
            if (
                event.event_type is RemoteSubAgentEventType.COMPLETED
                and event.content
            ):
                return event.content.strip()
        return ""
