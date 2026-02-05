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

import httpx

from benchmark.environment import BenchmarkData, ModelKwargs


class BenchmarkClient:
    """Client for running benchmarks against the Eigent API."""

    def __init__(
        self,
        *,
        base_url: str = "http://localhost:5001",
        timeout: int = 600,
        auto_reply_human: str | None = "yes, proceed",
        verbose: bool = False,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.auto_reply_human = auto_reply_human
        self.verbose = verbose
        self.client = httpx.AsyncClient(timeout=timeout)

    async def run(
        self,
        data: BenchmarkData,
        model_kwargs: ModelKwargs | None = None,
        verbose: bool | None = None,
    ) -> list[dict]:
        """Run a single benchmark and return all events."""
        chat = data.to_chat(model_kwargs or ModelKwargs())
        payload = chat.model_dump()

        should_print = verbose if verbose is not None else self.verbose
        events = []
        task_started = False
        last_step = None

        async with self.client.stream(
            "POST", f"{self.base_url}/chat", json=payload
        ) as response:
            response.raise_for_status()

            async for line in response.aiter_lines():
                if not line.strip() or not line.startswith("data: "):
                    continue

                try:
                    event = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue

                events.append(event)
                step = event.get("step")
                if should_print:
                    last_step = self._print_event(event, last_step)

                if step == "to_sub_tasks" and not task_started:
                    task_started = True
                    asyncio.create_task(self._start_task(chat.project_id))

                if step == "ask" and self.auto_reply_human:
                    agent = event.get("data", {}).get("agent", "")
                    if agent:
                        asyncio.create_task(
                            self._human_reply(chat.project_id, agent)
                        )

                if step == "end":
                    break

        return events

    # Steps that stream token-by-token and should be grouped on one line
    _STREAMING_STEPS = {"decompose_text", "agent_step_text"}

    @staticmethod
    def _print_event(event: dict, last_step: str | None) -> str:
        """Print event, grouping streaming tokens on the same line.
        Returns the current step for tracking."""
        step = event.get("step", "")
        data = event.get("data", "")
        if isinstance(data, dict):
            content = data.get("content", "")
        else:
            content = str(data)

        if step in BenchmarkClient._STREAMING_STEPS:
            if last_step != step:
                # New streaming group — print label then content inline
                if last_step in BenchmarkClient._STREAMING_STEPS:
                    print(flush=True)  # close previous streaming line
                print(f"[{step}] {content}", end="", flush=True)
            else:
                print(content, end="", flush=True)
        else:
            if last_step in BenchmarkClient._STREAMING_STEPS:
                print(flush=True)  # close previous streaming line
            print(f"[{step}] {content[:200]}", flush=True)

        return step

    async def _start_task(self, project_id: str):
        """Start workforce task execution after planning."""
        url = f"{self.base_url}/task/{project_id}/start"
        response = await self.client.post(url)
        response.raise_for_status()

    async def _human_reply(self, project_id: str, agent: str):
        """Auto-reply to agent questions."""
        url = f"{self.base_url}/chat/{project_id}/human-reply"
        payload = {"agent": agent, "reply": self.auto_reply_human}
        response = await self.client.post(url, json=payload)
        response.raise_for_status()

    async def close(self):
        await self.client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
