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

from app.service.task import TaskLock
from app.utils.agent_memory import (
    build_agent_memory_snapshot,
    build_memory_context,
    record_agent_memory_snapshot,
    serialize_agent_memory,
)


class FakeMemory:
    def get_context(self):
        return (
            [
                {
                    "role": "user",
                    "content": "Inspect the repository",
                    "tool_calls": [],
                },
                {
                    "role": "assistant",
                    "content": "I will inspect it.",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "function": {
                                "name": "shell_exec",
                                "arguments": '{"cmd": "pwd"}',
                            },
                        }
                    ],
                },
                {
                    "role": "tool",
                    "content": "/tmp/project",
                    "tool_call_id": "call_1",
                },
            ],
            0,
        )


class FakeAgent:
    agent_name = "single_agent"
    agent_id = "agent_1"
    memory = FakeMemory()


def test_serialize_agent_memory_includes_tool_calls_and_tool_results():
    messages = serialize_agent_memory(FakeAgent())

    assert messages[1]["tool_calls"][0]["function"]["name"] == "shell_exec"
    assert messages[1]["tool_calls"][0]["function"]["arguments"] == {
        "cmd": "pwd"
    }
    assert messages[2]["tool_call_id"] == "call_1"


def test_record_agent_memory_snapshot_on_task_lock():
    task_lock = TaskLock("project_1", asyncio.Queue(), {})

    snapshot = record_agent_memory_snapshot(
        task_lock,
        FakeAgent(),
        scope="single_agent",
        task_id="task_1",
        task_content="Inspect",
        task_result="Done",
    )

    assert snapshot is not None
    assert len(task_lock.agent_memory_history) == 1
    assert task_lock.agent_memory_history[0]["agent_name"] == "single_agent"


def test_build_memory_context_formats_recent_snapshots():
    task_lock = TaskLock("project_1", asyncio.Queue(), {})
    snapshot = build_agent_memory_snapshot(
        FakeAgent(),
        scope="single_agent",
        task_id="task_1",
        task_content="Inspect",
        task_result="Done",
    )
    task_lock.add_agent_memory_snapshot(snapshot)

    context = build_memory_context(task_lock)

    assert "Serialized Agent Memory" in context
    assert "single_agent" in context
    assert "assistant tool_calls: shell_exec" in context
