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

import datetime
import json
import logging
from typing import Any

logger = logging.getLogger("agent_memory")


def _value(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _stringify_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    try:
        return json.dumps(content, ensure_ascii=False)
    except Exception:
        return str(content)


def serialize_tool_call(tool_call: Any) -> dict[str, Any]:
    function = _value(tool_call, "function", tool_call)
    arguments = _value(function, "arguments", {})
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError:
            arguments = {"raw": arguments}

    return {
        "id": _value(tool_call, "id"),
        "function": {
            "name": _value(function, "name", "unknown"),
            "arguments": arguments,
        },
    }


def serialize_message(message: Any) -> dict[str, Any]:
    tool_calls = _value(message, "tool_calls", None) or []
    result = {
        "role": _value(message, "role", "assistant"),
        "content": _stringify_content(_value(message, "content", "")),
        "tool_calls": [
            serialize_tool_call(tool_call) for tool_call in tool_calls
        ],
    }
    tool_call_id = _value(message, "tool_call_id", None)
    if tool_call_id is not None:
        result["tool_call_id"] = tool_call_id
    return result


def serialize_agent_memory(agent: Any) -> list[dict[str, Any]]:
    memory = getattr(agent, "memory", None)
    if memory is None or not hasattr(memory, "get_context"):
        return []

    try:
        messages, _ = memory.get_context()
    except Exception as e:
        logger.warning(
            "Failed to serialize agent memory",
            extra={
                "agent_name": getattr(agent, "agent_name", None),
                "error": str(e),
            },
        )
        return []

    return [serialize_message(message) for message in messages]


def build_agent_memory_snapshot(
    agent: Any,
    *,
    scope: str,
    task_id: str | None = None,
    task_content: str | None = None,
    task_result: str | None = None,
) -> dict[str, Any] | None:
    messages = serialize_agent_memory(agent)
    if not messages:
        return None

    return {
        "scope": scope,
        "task_id": task_id,
        "agent_name": getattr(agent, "agent_name", None)
        or getattr(agent, "role_name", None)
        or agent.__class__.__name__,
        "agent_id": getattr(agent, "agent_id", None),
        "task_content": task_content,
        "task_result": task_result,
        "messages": messages,
        "timestamp": datetime.datetime.now().isoformat(),
    }


def record_agent_memory_snapshot(
    task_lock: Any,
    agent: Any,
    *,
    scope: str,
    task_id: str | None = None,
    task_content: str | None = None,
    task_result: str | None = None,
) -> dict[str, Any] | None:
    snapshot = build_agent_memory_snapshot(
        agent,
        scope=scope,
        task_id=task_id,
        task_content=task_content,
        task_result=task_result,
    )
    if snapshot is None:
        return None

    add_snapshot = getattr(task_lock, "add_agent_memory_snapshot", None)
    if callable(add_snapshot):
        add_snapshot(snapshot)
    else:
        task_lock.agent_memory_history = getattr(
            task_lock, "agent_memory_history", []
        )
        task_lock.agent_memory_history.append(snapshot)
    return snapshot


def _iter_workforce_agents(workforce: Any):
    for attr, label in (
        ("coordinator_agent", "workforce_coordinator"),
        ("task_agent", "workforce_task_planner"),
        ("new_worker_agent", "workforce_new_worker"),
    ):
        agent = getattr(workforce, attr, None)
        if agent is not None:
            yield label, agent

    for child in getattr(workforce, "_children", []) or []:
        worker = getattr(child, "worker", None)
        if worker is not None:
            yield "workforce_worker_template", worker
        accumulator = getattr(child, "_conversation_accumulator", None)
        if accumulator is not None:
            yield "workforce_worker_accumulator", accumulator


def record_workforce_memory_snapshot(
    task_lock: Any,
    workforce: Any,
    *,
    task_id: str | None = None,
    task_content: str | None = None,
    task_result: str | None = None,
) -> list[dict[str, Any]]:
    snapshots = []
    for scope, agent in _iter_workforce_agents(workforce):
        snapshot = record_agent_memory_snapshot(
            task_lock,
            agent,
            scope=scope,
            task_id=task_id,
            task_content=task_content,
            task_result=task_result,
        )
        if snapshot is not None:
            snapshots.append(snapshot)
    return snapshots


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"... (truncated, total length: {len(text)} chars)"


def build_memory_context(
    task_lock: Any,
    *,
    max_snapshots: int = 3,
    max_messages_per_snapshot: int = 12,
    max_chars_per_message: int = 1200,
) -> str:
    snapshots = getattr(task_lock, "agent_memory_history", []) or []
    summary = getattr(task_lock, "memory_summary", "") or ""
    if not snapshots and not summary:
        return ""

    lines = ["=== Serialized Agent Memory ==="]
    if summary:
        lines.append("Memory Summary:")
        lines.append(_truncate(summary, max_chars_per_message * 2))

    for snapshot in snapshots[-max_snapshots:]:
        agent_name = snapshot.get("agent_name") or "agent"
        scope = snapshot.get("scope") or "agent"
        task_id = snapshot.get("task_id") or ""
        lines.append(f"[{scope}] {agent_name} task_id={task_id}".strip())

        messages = snapshot.get("messages") or []
        for message in messages[-max_messages_per_snapshot:]:
            role = message.get("role", "assistant")
            content = _truncate(
                message.get("content", ""), max_chars_per_message
            )
            tool_calls = message.get("tool_calls") or []
            if tool_calls:
                names = [
                    call.get("function", {}).get("name", "unknown")
                    for call in tool_calls
                ]
                lines.append(f"{role} tool_calls: {', '.join(names)}")
            if content:
                lines.append(f"{role}: {content}")

    lines.append("=== End Serialized Agent Memory ===")
    return "\n".join(lines) + "\n\n"


def estimate_memory_size(task_lock: Any) -> int:
    snapshots = getattr(task_lock, "agent_memory_history", []) or []
    summary = getattr(task_lock, "memory_summary", "") or ""
    total = len(summary)
    for snapshot in snapshots:
        total += len(snapshot.get("task_content") or "")
        total += len(snapshot.get("task_result") or "")
        for message in snapshot.get("messages") or []:
            total += len(message.get("content") or "")
            total += len(json.dumps(message.get("tool_calls") or []))
    return total
