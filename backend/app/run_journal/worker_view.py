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
"""Read-only worker views over one Run's committed events.

A Workforce Run stores every worker's activity in one event log. This module
answers two questions without new records:

* which workers took part in the Run, and what each is doing now
  (``summarize_run_agents``);
* which events belong to one worker (``filter_events_for_agent``).

Events name their worker in different ways. Agent turn and assignment events
carry ``agent_id`` / ``assignee_id``. Tool calls only carry the worker's name
and the task it was processing. Approvals and questions only carry the step
they block. The index below links those together.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol


class _Event(Protocol):
    sequence: int
    event_type: str
    payload: dict[str, Any]
    created_at: float


_AGENT_TURN_STATUS = {
    "agent.started": "running",
    "agent.completed": "completed",
    "agent.failed": "failed",
    "agent.cancelled": "cancelled",
    "agent.updated": "running",
}
_REQUEST_EVENT_TYPES = frozenset(
    {"approval.requested", "interaction.requested"}
)
_REQUEST_PREFIXES = ("approval.", "interaction.")


def _text(value: Any) -> str:
    return str(value).strip() if isinstance(value, (str, int)) else ""


def _semantic(payload: dict[str, Any]) -> dict[str, Any]:
    semantic = payload.get("semantic")
    return semantic if isinstance(semantic, dict) else {}


def _actor(payload: dict[str, Any]) -> dict[str, Any]:
    actor = _semantic(payload).get("actor")
    return actor if isinstance(actor, dict) else {}


def _correlation(payload: dict[str, Any]) -> dict[str, Any]:
    correlation = _semantic(payload).get("correlation")
    return correlation if isinstance(correlation, dict) else {}


def _direct_agent_ids(payload: dict[str, Any]) -> set[str]:
    """Agent ids an event names directly."""

    ids = {
        _text(payload.get("agent_id")),
        _text(payload.get("assignee_id")),
        _text(_actor(payload).get("id")),
    }
    ids.discard("")
    return ids


def _task_ids(payload: dict[str, Any]) -> set[str]:
    ids = {
        _text(payload.get("process_task_id")),
        _text(payload.get("task_id")),
        _text(_correlation(payload).get("task_id")),
    }
    ids.discard("")
    return ids


def _request_id(event: _Event) -> str:
    payload = event.payload
    return _text(payload.get("approval_id")) or _text(
        payload.get("interaction_id")
    )


def _request_links(payload: dict[str, Any]) -> set[str]:
    """Step and tool-call ids an approval or question refers to."""

    links = {
        _text(payload.get("step_id")),
        _text(payload.get("tool_call_id")),
    }
    request = payload.get("request")
    if isinstance(request, dict):
        links.add(_text(request.get("tool_call_id")))
        links.add(_text(request.get("step_id")))
    links.discard("")
    return links


@dataclass
class _Worker:
    agent_id: str
    name: str = ""
    first_sequence: int = 0
    last_sequence: int = 0
    first_at: float = 0.0
    last_at: float = 0.0
    status: str = "idle"
    current_task: str = ""
    task_ids: set[str] = field(default_factory=set)
    step_ids: set[str] = field(default_factory=set)
    open_requests: set[str] = field(default_factory=set)
    event_count: int = 0
    tool_call_count: int = 0
    task_count: int = 0

    def touch(self, event: _Event) -> None:
        if not self.first_sequence:
            self.first_sequence = event.sequence
            self.first_at = event.created_at
        self.last_sequence = event.sequence
        self.last_at = event.created_at
        self.event_count += 1


class _WorkerIndex:
    """Two-pass index: learn who each worker is, then attribute events."""

    def __init__(self, events: Sequence[_Event]) -> None:
        self.workers: dict[str, _Worker] = {}
        self._learn_identities(events)
        self._unique_names = self._names_used_once()
        self._attribute(events)

    def _worker(self, agent_id: str) -> _Worker:
        worker = self.workers.get(agent_id)
        if worker is None:
            worker = _Worker(agent_id=agent_id)
            self.workers[agent_id] = worker
        return worker

    def _learn_identities(self, events: Sequence[_Event]) -> None:
        for event in events:
            payload = event.payload
            event_type = event.event_type
            if event_type == "agent.registered" or event_type in (
                _AGENT_TURN_STATUS
            ):
                agent_id = _text(payload.get("agent_id")) or _text(
                    _actor(payload).get("id")
                )
                if not agent_id:
                    continue
                worker = self._worker(agent_id)
                name = _text(payload.get("agent_name")) or _text(
                    _actor(payload).get("name")
                )
                if name:
                    worker.name = name
                task_id = _text(payload.get("process_task_id"))
                if task_id:
                    worker.task_ids.add(task_id)
            elif event_type.startswith("subtask.") and _text(
                payload.get("assignee_id")
            ):
                worker = self._worker(_text(payload["assignee_id"]))
                task_id = _text(payload.get("task_id"))
                if task_id:
                    worker.task_ids.add(task_id)

    def _names_used_once(self) -> dict[str, str]:
        counts: dict[str, int] = {}
        for worker in self.workers.values():
            if worker.name:
                counts[worker.name] = counts.get(worker.name, 0) + 1
        return {
            worker.name: worker.agent_id
            for worker in self.workers.values()
            if worker.name and counts[worker.name] == 1
        }

    def owners(self, event: _Event) -> set[str]:
        """Agent ids this event belongs to (empty for coordinator events)."""

        payload = event.payload
        owners = {
            agent_id
            for agent_id in _direct_agent_ids(payload)
            if agent_id in self.workers
        }
        if owners:
            return owners
        tasks = _task_ids(payload)
        if tasks:
            owners = {
                worker.agent_id
                for worker in self.workers.values()
                if worker.task_ids & tasks
            }
            if owners:
                return owners
        name = _text(payload.get("agent_name")) or _text(
            _actor(payload).get("name")
        )
        if name in self._unique_names:
            return {self._unique_names[name]}
        if event.event_type.startswith(_REQUEST_PREFIXES):
            links = _request_links(payload)
            requested_by = _text(payload.get("requested_by"))
            return {
                worker.agent_id
                for worker in self.workers.values()
                if (links and worker.step_ids & links)
                or (requested_by and requested_by == worker.agent_id)
            }
        return set()

    def _attribute(self, events: Sequence[_Event]) -> None:
        self.event_owners: dict[int, set[str]] = {}
        request_owners: dict[str, set[str]] = {}
        for event in events:
            payload = event.payload
            event_type = event.event_type
            owners = self.owners(event)
            if event_type.startswith(_REQUEST_PREFIXES) and not owners:
                owners = request_owners.get(_request_id(event), set())
            self.event_owners[event.sequence] = owners
            for agent_id in owners:
                worker = self.workers[agent_id]
                if event_type == "agent.registered":
                    # Registration is not work: it must not set the order
                    # or the "last active" time of a worker.
                    continue
                worker.touch(event)
                self._update_worker(worker, event, payload)
            if event_type in _REQUEST_EVENT_TYPES and owners:
                request_owners[_request_id(event)] = owners

    @staticmethod
    def _update_worker(
        worker: _Worker, event: _Event, payload: dict[str, Any]
    ) -> None:
        event_type = event.event_type
        if event_type in _AGENT_TURN_STATUS:
            worker.status = _AGENT_TURN_STATUS[event_type]
            if event_type == "agent.started":
                prompt = _text(payload.get("display_input"))
                if prompt and not worker.current_task:
                    worker.current_task = prompt
        elif event_type.startswith("subtask.") and _text(
            payload.get("assignee_id")
        ):
            worker.task_count += 1
            title = _text(payload.get("display_title"))
            if title:
                worker.current_task = title
        elif event_type.startswith("tool."):
            step_id = _text(payload.get("step_id"))
            if step_id:
                worker.step_ids.add(step_id)
            tool_call_id = _text(payload.get("tool_call_id"))
            if tool_call_id:
                worker.step_ids.add(tool_call_id)
            if event_type in {"tool.prepared", "tool.dispatched"}:
                worker.tool_call_count += 1
        elif event_type in _REQUEST_EVENT_TYPES:
            request_id = _request_id(event)
            if request_id:
                worker.open_requests.add(request_id)
        elif event_type.startswith(_REQUEST_PREFIXES):
            worker.open_requests.discard(_request_id(event))


def summarize_run_agents(events: Iterable[_Event]) -> list[dict[str, Any]]:
    """Workers of one Run, in the order they were first given work."""

    index = _WorkerIndex(list(events))
    workers = sorted(
        index.workers.values(),
        key=lambda worker: (
            worker.first_sequence == 0,
            worker.first_sequence,
            worker.agent_id,
        ),
    )
    return [
        {
            "agent_id": worker.agent_id,
            "name": worker.name,
            "status": "waiting" if worker.open_requests else worker.status,
            "current_task": worker.current_task,
            "first_sequence": worker.first_sequence,
            "last_sequence": worker.last_sequence,
            "first_event_at": worker.first_at or None,
            "last_event_at": worker.last_at or None,
            "counts": {
                "events": worker.event_count,
                "tasks": worker.task_count,
                "tool_calls": worker.tool_call_count,
                "pending_requests": len(worker.open_requests),
            },
        }
        for worker in workers
    ]


def filter_events_for_agent(
    events: Iterable[_Event], agent_id: str
) -> list[Any]:
    """Events of one worker, including the hand-offs to and from it.

    An unknown ``agent_id`` returns an empty list.
    """

    ordered = list(events)
    index = _WorkerIndex(ordered)
    if agent_id not in index.workers:
        return []
    return [
        event
        for event in ordered
        if agent_id in index.event_owners.get(event.sequence, set())
    ]
