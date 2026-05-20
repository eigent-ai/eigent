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

import pytest

from app.remote_sub_agent.policy import RemoteSubAgentPolicy
from app.remote_sub_agent.runtime import RemoteSubAgentRuntime
from app.remote_sub_agent.session_store import RemoteSubAgentSessionStore
from app.remote_sub_agent.types import (
    RemoteSubAgentEvent,
    RemoteSubAgentEventType,
    RemoteSubAgentRequest,
    RemoteSubAgentSession,
)

pytestmark = pytest.mark.unit


class FakeProvider:
    name = "fake_provider"

    async def run(
        self,
        request: RemoteSubAgentRequest,
        session: RemoteSubAgentSession,
    ):
        yield RemoteSubAgentEvent(
            event_type=RemoteSubAgentEventType.SESSION_UPDATED,
            interaction_id="remote-1",
            environment_id="env-1",
        )
        yield RemoteSubAgentEvent(
            event_type=RemoteSubAgentEventType.OUTPUT_DELTA,
            content="hello ",
        )
        yield RemoteSubAgentEvent(
            event_type=RemoteSubAgentEventType.OUTPUT_DELTA,
            content="world",
        )
        yield RemoteSubAgentEvent(
            event_type=RemoteSubAgentEventType.COMPLETED,
            usage={"total_tokens": 3},
        )


class RecordingProvider:
    name = "fake_provider"

    def __init__(self):
        self.reuse_values: list[bool] = []

    async def run(
        self,
        request: RemoteSubAgentRequest,
        session: RemoteSubAgentSession,
    ):
        self.reuse_values.append(request.reuse_session)
        yield RemoteSubAgentEvent(
            event_type=RemoteSubAgentEventType.SESSION_UPDATED,
            interaction_id=f"remote-{len(self.reuse_values)}",
            environment_id=f"env-{len(self.reuse_values)}",
        )
        yield RemoteSubAgentEvent(
            event_type=RemoteSubAgentEventType.COMPLETED,
            content="done",
        )


@pytest.mark.asyncio
async def test_runtime_collects_output_and_updates_session():
    runtime = RemoteSubAgentRuntime(
        provider=FakeProvider(),
        policy=RemoteSubAgentPolicy(
            enabled=True,
            allowed_providers=("fake_provider",),
        ),
        session_store=RemoteSubAgentSessionStore(),
    )
    request = RemoteSubAgentRequest(
        api_task_id="task-1",
        provider="fake_provider",
        prompt="do it",
    )

    result = await runtime.run(request)

    assert result.final_text == "hello world"
    assert result.session.remote_interaction_id == "remote-1"
    assert result.session.remote_environment_id == "env-1"
    assert result.usage == {"total_tokens": 3}


@pytest.mark.asyncio
async def test_runtime_reuses_existing_remote_session_on_followup():
    provider = RecordingProvider()
    runtime = RemoteSubAgentRuntime(
        provider=provider,
        policy=RemoteSubAgentPolicy(
            enabled=True,
            allowed_providers=("fake_provider",),
        ),
        session_store=RemoteSubAgentSessionStore(),
    )

    await runtime.run(
        RemoteSubAgentRequest(
            api_task_id="task-1",
            provider="fake_provider",
            prompt="first",
            reuse_session=False,
        )
    )
    await runtime.run(
        RemoteSubAgentRequest(
            api_task_id="task-1",
            provider="fake_provider",
            prompt="format previous result",
            reuse_session=False,
        )
    )

    assert provider.reuse_values == [False, True]
