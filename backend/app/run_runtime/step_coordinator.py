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

"""Code-owned authored Step lifecycle over the append-only RunJournal."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Literal

from app.run_journal.models import CommittedRunEvent, RunEventDraft
from app.run_journal.semantic_events import (
    StepSemanticPhase,
    StepSemanticStatus,
    display_safe_semantic_text,
    semantic_step_event_fields,
)
from app.run_journal.store import SQLiteRunJournal

StepStatus = Literal[
    "pending",
    "running",
    "blocked",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
]
StepOwnerKind = Literal["single_agent", "subagent", "workforce", "system"]
StepSource = Literal["plan", "subagent", "workforce"]

TERMINAL_STEP_STATUSES = frozenset({"completed", "failed", "cancelled"})

current_step_id: ContextVar[str | None] = ContextVar(
    "current_step_id", default=None
)


@contextmanager
def step_scope(step_id: str | None) -> Iterator[str | None]:
    token = current_step_id.set(step_id)
    try:
        yield step_id
    finally:
        current_step_id.reset(token)


def get_current_step_id() -> str | None:
    return current_step_id.get()


@dataclass(frozen=True)
class PlanStepInput:
    plan_item_id: str
    title: str
    active_form: str
    status: Literal["pending", "in_progress", "completed"]
    ordinal: int


@dataclass(frozen=True)
class StepSnapshot:
    step_id: str
    plan_id: str
    plan_item_id: str
    parent_step_id: str | None
    title: str
    summary: str | None
    status: StepStatus
    ordinal: int
    agent_id: str | None
    owner_kind: StepOwnerKind
    source: StepSource
    attempt_id: str | None
    last_sequence: int


class InvalidStepTransitionError(RuntimeError):
    pass


def stable_step_id(run_id: str, plan_item_id: str) -> str:
    digest = hashlib.sha256(f"{run_id}:{plan_item_id}".encode()).hexdigest()
    return f"stp_{digest[:24]}"


def step_event_draft(
    *,
    run_id: str,
    attempt_id: str | None,
    step_id: str,
    plan_item_id: str,
    title: str,
    summary: str | None,
    ordinal: int,
    agent_id: str | None,
    event: str,
    status: StepStatus,
    parent_step_id: str | None = None,
    reason_code: str | None = None,
    evidence_refs: Sequence[Mapping[str, str]] = (),
    provenance_source: str = "run_step_coordinator",
    authored_by: Literal["agent", "system"] = "agent",
    owner_kind: StepOwnerKind = "single_agent",
    source: StepSource = "plan",
) -> RunEventDraft:
    """Build one bounded, display-safe authored Step lifecycle event."""

    phase: StepSemanticPhase = {
        "created": "requested",
        "started": "started",
        "progress": "progress",
        "blocked": "blocked",
        "resumed": "resumed",
        "completed": "completed",
        "failed": "failed",
        "cancelled": "cancelled",
        "interrupted": "interrupted",
    }[event]  # type: ignore[assignment]
    semantic_status: StepSemanticStatus = status  # type: ignore[assignment]
    safe_title = display_safe_semantic_text(title, limit=160) or "Task step"
    safe_summary = display_safe_semantic_text(summary, limit=240) or None
    step = {
        "step_id": step_id,
        "plan_id": f"plan:{run_id}",
        "plan_item_id": plan_item_id,
        "parent_step_id": parent_step_id,
        "title": safe_title,
        "summary": safe_summary,
        "status": status,
        "ordinal": ordinal,
        "visibility": "summary",
        "owner": {"kind": owner_kind, "agent_id": agent_id},
        "source": source,
        "authored_by": authored_by,
    }
    bounded_evidence = [
        {
            "kind": display_safe_semantic_text(ref.get("kind"), limit=40),
            "id": display_safe_semantic_text(ref.get("id"), limit=200),
        }
        for ref in evidence_refs[:20]
        if ref.get("kind") and ref.get("id")
    ]
    payload: dict[str, Any] = {
        "step_schema_version": 1,
        "step": step,
        "attempt_id": attempt_id,
        "reason_code": reason_code,
        "evidence_refs": bounded_evidence,
    }
    payload.update(
        semantic_step_event_fields(
            step_id=step_id,
            phase=phase,
            status=semantic_status,
            source=provenance_source,
            actor_type="system" if authored_by == "system" else "agent",
            actor_id=agent_id,
            correlation={
                "attempt_id": attempt_id,
                "plan_item_id": plan_item_id,
                "parent_step_id": parent_step_id,
            },
        )
    )
    identity = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    digest = hashlib.sha256(identity.encode()).hexdigest()[:16]
    return RunEventDraft(
        event_id=f"step:{step_id}:{event}:{digest}",
        event_type=f"step.{event}",
        payload=payload,
    )


def _event_status(event_type: str, payload: dict[str, Any]) -> StepStatus:
    step = payload.get("step")
    if isinstance(step, dict):
        value = str(step.get("status") or "").strip().lower()
        if value in {
            "pending",
            "running",
            "blocked",
            "completed",
            "failed",
            "cancelled",
            "interrupted",
        }:
            return value  # type: ignore[return-value]
    suffix = event_type.removeprefix("step.")
    return {
        "created": "pending",
        "started": "running",
        "resumed": "running",
        "blocked": "blocked",
        "completed": "completed",
        "failed": "failed",
        "cancelled": "cancelled",
        "interrupted": "interrupted",
    }.get(suffix, "pending")  # type: ignore[return-value]


class RunStepCoordinator:
    """Validate and commit authored Step facts without a second truth store."""

    def __init__(self, journal: SQLiteRunJournal) -> None:
        self._journal = journal

    def replay(self, run_id: str) -> dict[str, StepSnapshot]:
        snapshots: dict[str, StepSnapshot] = {}
        for event in self._journal.list_events(
            run_id, event_type_prefix="step."
        ):
            payload = event.payload
            raw = payload.get("step")
            if not isinstance(raw, dict):
                continue
            step_id = str(raw.get("step_id") or "").strip()
            plan_item_id = str(raw.get("plan_item_id") or "").strip()
            if not step_id or not plan_item_id:
                continue
            owner = raw.get("owner")
            owner = owner if isinstance(owner, dict) else {}
            owner_kind = str(owner.get("kind") or "single_agent")
            if owner_kind not in {
                "single_agent",
                "subagent",
                "workforce",
                "system",
            }:
                owner_kind = "single_agent"
            source = str(raw.get("source") or "plan")
            if source not in {"plan", "subagent", "workforce"}:
                source = "plan"
            snapshots[step_id] = StepSnapshot(
                step_id=step_id,
                plan_id=str(raw.get("plan_id") or f"plan:{run_id}"),
                plan_item_id=plan_item_id,
                parent_step_id=(
                    str(raw["parent_step_id"])
                    if raw.get("parent_step_id")
                    else None
                ),
                title=str(raw.get("title") or "Task step"),
                summary=(str(raw["summary"]) if raw.get("summary") else None),
                status=_event_status(event.event_type, payload),
                ordinal=int(raw.get("ordinal") or 0),
                agent_id=(
                    str(owner["agent_id"]) if owner.get("agent_id") else None
                ),
                owner_kind=owner_kind,  # type: ignore[arg-type]
                source=source,  # type: ignore[arg-type]
                attempt_id=(
                    str(payload["attempt_id"])
                    if payload.get("attempt_id")
                    else None
                ),
                last_sequence=event.sequence,
            )
        return snapshots

    def current_running_step_id(
        self, run_id: str, *, agent_id: str | None = None
    ) -> str | None:
        running = [
            step
            for step in self.replay(run_id).values()
            if step.status == "running"
        ]
        if agent_id is None:
            return running[0].step_id if len(running) == 1 else None

        exact = [step for step in running if step.agent_id == agent_id]
        if len(exact) == 1:
            return exact[0].step_id
        if len(exact) > 1:
            return None

        unowned = [step for step in running if step.agent_id is None]
        return unowned[0].step_id if len(unowned) == 1 else None

    def record_progress(
        self,
        *,
        project_id: str,
        run_id: str,
        plan_item_id: str,
        summary: str,
        agent_id: str | None,
    ) -> CommittedRunEvent:
        """Append one bounded authored progress update to a running Step."""

        run = self._journal.get_run(run_id)
        if run is None:
            raise InvalidStepTransitionError(f"run {run_id!r} does not exist")
        snapshot = next(
            (
                step
                for step in self.replay(run_id).values()
                if step.plan_item_id == plan_item_id
            ),
            None,
        )
        if snapshot is None:
            raise InvalidStepTransitionError(
                f"plan item {plan_item_id!r} has no authored Step"
            )
        if snapshot.status != "running":
            raise InvalidStepTransitionError(
                f"step {snapshot.step_id!r} cannot record progress while "
                f"{snapshot.status!r}"
            )
        return self._journal.append_event(
            run_id,
            self._draft(
                run_id=run_id,
                attempt_id=run.active_attempt_id,
                step_id=snapshot.step_id,
                plan_item_id=snapshot.plan_item_id,
                title=snapshot.title,
                summary=summary,
                ordinal=snapshot.ordinal,
                agent_id=agent_id or snapshot.agent_id,
                event="progress",
                status="running",
            ),
            expected_project_id=project_id,
        )

    def create_child_step(
        self,
        *,
        project_id: str,
        run_id: str,
        parent_step_id: str | None,
        task_identity: str,
        title: str,
        agent_id: str | None,
        start: bool = True,
        owner_kind: StepOwnerKind = "subagent",
        source: StepSource = "subagent",
    ) -> str:
        """Create the Step owned by one delegated subtask."""

        run = self._journal.get_run(run_id)
        if run is None:
            raise InvalidStepTransitionError(f"run {run_id!r} does not exist")
        plan_item_id = f"subtask:{task_identity}"
        step_id = stable_step_id(run_id, plan_item_id)
        snapshots = self.replay(run_id)
        existing = snapshots.get(step_id)
        if existing is not None:
            return existing.step_id
        parent: StepSnapshot | None = None
        if parent_step_id:
            parent = snapshots.get(parent_step_id)
            if parent is None:
                raise InvalidStepTransitionError(
                    f"parent step {parent_step_id!r} does not exist"
                )
            if parent.status in TERMINAL_STEP_STATUSES:
                raise InvalidStepTransitionError(
                    f"parent step {parent_step_id!r} is already terminal"
                )
        child_ordinal = (
            parent.ordinal
            if parent is not None
            else max((step.ordinal for step in snapshots.values()), default=0)
            + 1
        )
        safe_title = display_safe_semantic_text(title, limit=160) or (
            "Delegated sub-agent task"
        )
        drafts = [
            step_event_draft(
                run_id=run_id,
                attempt_id=run.active_attempt_id,
                step_id=step_id,
                plan_item_id=plan_item_id,
                parent_step_id=parent_step_id,
                title=safe_title,
                summary=None,
                ordinal=child_ordinal,
                agent_id=agent_id,
                event="created",
                status="pending",
                provenance_source=(
                    "workforce_dispatch"
                    if owner_kind == "workforce"
                    else "subagent_dispatch"
                ),
                owner_kind=owner_kind,
                source=source,
            )
        ]
        if start:
            drafts.append(
                step_event_draft(
                    run_id=run_id,
                    attempt_id=run.active_attempt_id,
                    step_id=step_id,
                    plan_item_id=plan_item_id,
                    parent_step_id=parent_step_id,
                    title=safe_title,
                    summary="Delegated work started.",
                    ordinal=child_ordinal,
                    agent_id=agent_id,
                    event="started",
                    status="running",
                    provenance_source=(
                        "workforce_dispatch"
                        if owner_kind == "workforce"
                        else "subagent_dispatch"
                    ),
                    owner_kind=owner_kind,
                    source=source,
                )
            )
        self._journal.append_events(
            run_id,
            drafts,
            expected_project_id=project_id,
        )
        return step_id

    def start_child_step(
        self,
        *,
        project_id: str,
        run_id: str,
        step_id: str,
    ) -> CommittedRunEvent | None:
        """Mark delegated work running only after dispatch is durable."""

        run = self._journal.get_run(run_id)
        if run is None:
            raise InvalidStepTransitionError(f"run {run_id!r} does not exist")
        snapshot = self.replay(run_id).get(step_id)
        if snapshot is None:
            raise InvalidStepTransitionError(
                f"step {step_id!r} does not exist"
            )
        if snapshot.status == "running":
            return None
        if snapshot.status in TERMINAL_STEP_STATUSES:
            return None
        transition = {
            "pending": ("started", "running"),
            "blocked": ("resumed", "running"),
            "interrupted": ("resumed", "running"),
        }.get(snapshot.status)
        if transition is None:
            raise InvalidStepTransitionError(
                f"child step {step_id!r} cannot start from {snapshot.status!r}"
            )
        event, status = transition
        return self._journal.append_event(
            run_id,
            step_event_draft(
                run_id=run_id,
                attempt_id=run.active_attempt_id,
                step_id=snapshot.step_id,
                plan_item_id=snapshot.plan_item_id,
                parent_step_id=snapshot.parent_step_id,
                title=snapshot.title,
                summary="Delegated work started.",
                ordinal=snapshot.ordinal,
                agent_id=snapshot.agent_id,
                event=event,
                status=status,  # type: ignore[arg-type]
                provenance_source=(
                    "workforce_dispatch"
                    if snapshot.owner_kind == "workforce"
                    else "subagent_dispatch"
                ),
                owner_kind=snapshot.owner_kind,
                source=snapshot.source,
            ),
            expected_project_id=project_id,
        )

    def finish_child_step(
        self,
        *,
        project_id: str,
        run_id: str,
        step_id: str,
        outcome: Literal[
            "completed", "failed", "cancelled", "outcome_unknown"
        ],
        summary: str | None,
    ) -> CommittedRunEvent | None:
        """Close or block a delegated child Step from its tool outcome."""

        run = self._journal.get_run(run_id)
        if run is None:
            raise InvalidStepTransitionError(f"run {run_id!r} does not exist")
        snapshot = self.replay(run_id).get(step_id)
        if snapshot is None:
            raise InvalidStepTransitionError(
                f"step {step_id!r} does not exist"
            )
        if snapshot.status in TERMINAL_STEP_STATUSES:
            return None
        event, status, reason = {
            "completed": ("completed", "completed", None),
            "failed": ("failed", "failed", "subagent_failed"),
            "cancelled": ("cancelled", "cancelled", "subagent_cancelled"),
            "outcome_unknown": (
                "blocked",
                "blocked",
                "subagent_outcome_unknown",
            ),
        }[outcome]
        if event == "blocked" and snapshot.status == "blocked":
            return None
        if snapshot.status not in {"pending", "running", "blocked"}:
            raise InvalidStepTransitionError(
                f"child step {step_id!r} cannot finish from "
                f"{snapshot.status!r}"
            )
        drafts = [
            step_event_draft(
                run_id=run_id,
                attempt_id=run.active_attempt_id,
                step_id=snapshot.step_id,
                plan_item_id=snapshot.plan_item_id,
                parent_step_id=snapshot.parent_step_id,
                title=snapshot.title,
                summary=summary,
                ordinal=snapshot.ordinal,
                agent_id=snapshot.agent_id,
                event=event,
                status=status,  # type: ignore[arg-type]
                reason_code=reason,
                provenance_source=(
                    "workforce_dispatch"
                    if snapshot.owner_kind == "workforce"
                    else "subagent_dispatch"
                ),
                owner_kind=snapshot.owner_kind,
                source=snapshot.source,
            )
        ]
        if (
            outcome in {"failed", "outcome_unknown"}
            and snapshot.parent_step_id
        ):
            parent = self.replay(run_id).get(snapshot.parent_step_id)
            if parent is not None and parent.status == "running":
                drafts.append(
                    step_event_draft(
                        run_id=run_id,
                        attempt_id=run.active_attempt_id,
                        step_id=parent.step_id,
                        plan_item_id=parent.plan_item_id,
                        parent_step_id=parent.parent_step_id,
                        title=parent.title,
                        summary="Delegated sub-agent needs attention.",
                        ordinal=parent.ordinal,
                        agent_id=parent.agent_id,
                        event="blocked",
                        status="blocked",
                        reason_code=(
                            "child_step_failed"
                            if outcome == "failed"
                            else "child_step_outcome_unknown"
                        ),
                        provenance_source=(
                            "workforce_dispatch"
                            if parent.owner_kind == "workforce"
                            else "subagent_dispatch"
                        ),
                        authored_by="system",
                        owner_kind=parent.owner_kind,
                        source=parent.source,
                    )
                )
        committed = self._journal.append_events(
            run_id,
            drafts,
            expected_project_id=project_id,
        )
        return committed[0]

    def reconcile_plan(
        self,
        *,
        project_id: str,
        run_id: str,
        agent_id: str | None,
        items: Sequence[PlanStepInput],
    ) -> list[CommittedRunEvent]:
        run = self._journal.get_run(run_id)
        if run is None:
            return []
        previous = self.replay(run_id)
        by_plan_item = {step.plan_item_id: step for step in previous.values()}
        desired_ids = {item.plan_item_id for item in items}
        drafts: list[RunEventDraft] = []

        for item in items:
            prior = by_plan_item.get(item.plan_item_id)
            step_id = (
                prior.step_id
                if prior
                else stable_step_id(run_id, item.plan_item_id)
            )
            desired = {
                "pending": "pending",
                "in_progress": "running",
                "completed": "completed",
            }[item.status]
            safe_title = (
                display_safe_semantic_text(item.title, limit=160)
                or "Task step"
            )
            safe_active = display_safe_semantic_text(
                item.active_form, limit=240
            )

            if prior is None:
                drafts.append(
                    self._draft(
                        run_id=run_id,
                        attempt_id=run.active_attempt_id,
                        step_id=step_id,
                        plan_item_id=item.plan_item_id,
                        title=safe_title,
                        summary=None,
                        ordinal=item.ordinal,
                        agent_id=agent_id,
                        event="created",
                        status="pending",
                    )
                )
                prior_status: StepStatus = "pending"
            else:
                prior_status = prior.status
                if (
                    prior_status in TERMINAL_STEP_STATUSES
                    and desired != prior_status
                ):
                    raise InvalidStepTransitionError(
                        f"step {step_id!r} cannot move from {prior_status!r} to {desired!r}"
                    )

            if prior_status == "running" and desired == "pending":
                drafts.append(
                    self._draft(
                        run_id=run_id,
                        attempt_id=run.active_attempt_id,
                        step_id=step_id,
                        plan_item_id=item.plan_item_id,
                        title=safe_title,
                        summary="Paused after the plan was reprioritized.",
                        ordinal=item.ordinal,
                        agent_id=agent_id,
                        event="interrupted",
                        status="interrupted",
                        reason_code="plan_reprioritized",
                    )
                )
                continue

            transition = self._transition(prior_status, desired)
            if transition:
                event, status = transition
                drafts.append(
                    self._draft(
                        run_id=run_id,
                        attempt_id=run.active_attempt_id,
                        step_id=step_id,
                        plan_item_id=item.plan_item_id,
                        title=safe_title,
                        summary=(
                            prior.summary
                            if status == "completed" and prior
                            else safe_active or None
                        ),
                        ordinal=item.ordinal,
                        agent_id=agent_id,
                        event=event,
                        status=status,
                    )
                )
            elif (
                prior
                and prior.status not in TERMINAL_STEP_STATUSES
                and (
                    prior.title != safe_title or prior.ordinal != item.ordinal
                )
            ):
                drafts.append(
                    self._draft(
                        run_id=run_id,
                        attempt_id=run.active_attempt_id,
                        step_id=step_id,
                        plan_item_id=item.plan_item_id,
                        title=safe_title,
                        summary=safe_active or None,
                        ordinal=item.ordinal,
                        agent_id=agent_id,
                        event="progress",
                        status=prior.status,
                    )
                )

        for prior in previous.values():
            if (
                prior.source == "plan"
                and prior.plan_item_id not in desired_ids
                and prior.status not in TERMINAL_STEP_STATUSES
            ):
                drafts.append(
                    self._draft(
                        run_id=run_id,
                        attempt_id=run.active_attempt_id,
                        step_id=prior.step_id,
                        plan_item_id=prior.plan_item_id,
                        title=prior.title,
                        summary="Removed from the active plan.",
                        ordinal=prior.ordinal,
                        agent_id=prior.agent_id,
                        event="cancelled",
                        status="cancelled",
                        reason_code="plan_item_removed",
                    )
                )

        if not drafts:
            return []
        return self._journal.append_events(
            run_id,
            drafts,
            expected_project_id=project_id,
        )

    @staticmethod
    def _transition(
        previous: StepStatus, desired: StepStatus
    ) -> tuple[str, StepStatus] | None:
        if previous == desired:
            return None
        if previous == "interrupted" and desired == "pending":
            return None
        if previous == "pending" and desired == "running":
            return ("started", "running")
        if previous == "pending" and desired == "completed":
            # The caller inserts only one event here; completed-from-pending is
            # still a valid concise lifecycle for an atomic plan update.
            return ("completed", "completed")
        if previous in {"blocked", "interrupted"} and desired == "running":
            return ("resumed", "running")
        if (
            previous in {"running", "blocked", "interrupted"}
            and desired == "completed"
        ):
            return ("completed", "completed")
        raise InvalidStepTransitionError(
            f"step cannot move from {previous!r} to {desired!r}"
        )

    @staticmethod
    def _draft(
        *,
        run_id: str,
        attempt_id: str | None,
        step_id: str,
        plan_item_id: str,
        title: str,
        summary: str | None,
        ordinal: int,
        agent_id: str | None,
        event: str,
        status: StepStatus,
        reason_code: str | None = None,
    ) -> RunEventDraft:
        return step_event_draft(
            run_id=run_id,
            attempt_id=attempt_id,
            step_id=step_id,
            plan_item_id=plan_item_id,
            title=title,
            summary=summary,
            ordinal=ordinal,
            agent_id=agent_id,
            event=event,
            status=status,
            reason_code=reason_code,
        )
