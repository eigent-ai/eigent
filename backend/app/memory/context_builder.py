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

"""ProjectContextBuilder — assemble durable context for the agent (§8 design).

The runtime entry point is `build(...)` which returns an `AgentContextBundle`.
Callers usually do not consume the bundle directly; they call
`bundle.to_prompt(mode)` to get a string ready to splice into the system
prompt. Keeping rendering separate from data lets future callers (audit,
diagnostics, alternative model formats) reuse the same fetched payload.

Token budget is a rough char-based proxy: 1 token ~= 4 chars matches what
chatStore.ts uses on the frontend side. Section weights are tuned so the most
important continuity signal -- recent assistant/user turns -- gets the
majority share.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.memory.events import ConversationEvent, MemoryArtifact, MemoryFact
from app.memory.local_store import LocalMemoryStore

# Section weights when allocating a token budget. They sum to ~1.0 plus a
# small slack so the final assembled prompt rarely overshoots.
_HEADER_WEIGHT = 0.20  # space + project summary + facts overview
_RECENT_CONVO_WEIGHT = 0.65  # most recent conversation tail
_ARTIFACTS_WEIGHT = 0.10
_TODOS_WEIGHT = 0.05

# Hard caps to keep any one section from dominating regardless of budget.
_MAX_RECENT_CONVO_EVENTS = 24

ContextMode = Literal[
    "single_agent",
    "workforce_coordinator",
    "workforce_worker",
]


def _chars_for(budget_tokens: int, weight: float) -> int:
    return max(0, int(budget_tokens * 4 * weight))


def _truncate(text: str, max_chars: int, ellipsis: str = "...") -> str:
    if max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    return text[: max(0, max_chars - len(ellipsis))] + ellipsis


@dataclass
class AgentContextBundle:
    """Mode-agnostic context payload assembled from the local memory store."""

    space_name: str
    space_summary: str
    project_name: str
    project_summary: str
    recent_conversation: list[ConversationEvent] = field(default_factory=list)
    relevant_facts: list[MemoryFact] = field(default_factory=list)
    relevant_artifacts: list[MemoryArtifact] = field(default_factory=list)
    open_todos: list[str] = field(default_factory=list)
    current_run_instruction: str = ""

    def is_empty(self) -> bool:
        """True when the bundle has no durable signal to inject.

        Callers use this to decide whether to fall back to the legacy
        `project_context` bridge.
        """

        return (
            not self.space_summary
            and not self.project_summary
            and not self.recent_conversation
            and not self.relevant_facts
            and not self.relevant_artifacts
            and not self.open_todos
        )

    def to_prompt(self, mode: ContextMode) -> str:
        """Render the bundle into a string ready to splice into a system prompt."""

        if mode == "single_agent":
            return self._render_single_agent()
        if mode == "workforce_coordinator":
            return self._render_workforce_coordinator()
        if mode == "workforce_worker":
            return self._render_workforce_worker()
        return self._render_single_agent()

    # ----- Renderers -----

    def _render_single_agent(self) -> str:
        # §9 single agent profile: continuous narrative.
        sections: list[str] = []
        sections.append("=== Persisted Project Context ===")
        if self.space_name or self.space_summary:
            sections.append(
                _section("Space", self.space_name, self.space_summary)
            )
        if self.project_name or self.project_summary:
            sections.append(
                _section("Project", self.project_name, self.project_summary)
            )
        if self.relevant_facts:
            lines = ["Known facts:"]
            for fact in self.relevant_facts:
                lines.append(f"- {fact.text}")
            sections.append("\n".join(lines))
        if self.relevant_artifacts:
            lines = ["Relevant artifacts:"]
            for art in self.relevant_artifacts:
                lines.append(f"- {art.path} ({art.kind})")
            sections.append("\n".join(lines))
        if self.recent_conversation:
            lines = ["Recent conversation:"]
            for event in self.recent_conversation:
                tag = event.role.capitalize()
                lines.append(f"{tag}: {event.content}")
            sections.append("\n".join(lines))
        if self.open_todos:
            lines = ["Open todos:"]
            for todo in self.open_todos:
                lines.append(f"- {todo}")
            sections.append("\n".join(lines))
        if self.current_run_instruction:
            sections.append(
                _section("Current turn", "", self.current_run_instruction)
            )
        sections.append("=== End Persisted Project Context ===")
        return "\n\n".join(s for s in sections if s)

    def _render_workforce_coordinator(self) -> str:
        # §10 coordinator profile: planning view. Minimal first-cut --
        # full per-role split is a follow-up branch (M6+).
        return self._render_single_agent()

    def _render_workforce_worker(self) -> str:
        # §10 worker profile: only assignment + narrow facts. Skeleton until
        # the workforce milestone wires assignments through.
        sections: list[str] = ["=== Worker Assignment ==="]
        if self.current_run_instruction:
            sections.append(self.current_run_instruction)
        if self.relevant_artifacts:
            lines = ["Relevant artifacts:"]
            for art in self.relevant_artifacts:
                lines.append(f"- {art.path} ({art.kind})")
            sections.append("\n".join(lines))
        if self.relevant_facts:
            lines = ["Narrow facts:"]
            for fact in self.relevant_facts:
                lines.append(f"- {fact.text}")
            sections.append("\n".join(lines))
        sections.append("=== End Worker Assignment ===")
        return "\n\n".join(sections)


def _section(label: str, name: str, body: str) -> str:
    title = f"{label}: {name}".strip(": ").rstrip() if name else label
    body = body.strip()
    if not body:
        return ""
    return f"{title}\n{body}"


class ProjectContextBuilder:
    """Reads LocalMemoryStore + assembles a budgeted AgentContextBundle."""

    def __init__(self, store: LocalMemoryStore) -> None:
        self._store = store

    def build(
        self,
        *,
        user_key: str,
        space_id: str,
        project_id: str,
        run_id: str,
        mode: ContextMode,
        token_budget: int,
        current_user_prompt: str,
    ) -> AgentContextBundle:
        """Return a bundle sized to roughly `token_budget` tokens.

        `run_id` is accepted for future filtering (e.g. exclude the in-flight
        run's own user prompt from recent_conversation) but is otherwise
        informational in this milestone.
        """

        space = self._store.read_space(user_key, space_id)
        project = self._store.read_project(user_key, space_id, project_id)
        project_summary_raw = self._store.read_project_summary(
            user_key, space_id, project_id
        )
        facts_raw = self._store.read_facts(user_key, space_id, project_id)
        artifacts_raw = self._store.read_artifacts(
            user_key, space_id, project_id
        )
        recent_conv_raw = self._store.read_conversation_tail(
            user_key, space_id, project_id, limit=_MAX_RECENT_CONVO_EVENTS
        )

        # Drop debug_only / audit_only events from the context view -- only
        # `context`-visibility turns may show up in prompts.
        recent_conv_raw = [
            event
            for event in recent_conv_raw
            if event.visibility == "context"
            and event.run_id
            != run_id  # exclude the in-flight run's own prompt
        ]

        # Drop runtime-log artifacts; only context-eligible ones make it in.
        artifacts_in_context = [
            art for art in artifacts_raw if art.eligible_for_context
        ]

        header_budget = _chars_for(token_budget, _HEADER_WEIGHT)
        convo_budget = _chars_for(token_budget, _RECENT_CONVO_WEIGHT)
        artifacts_budget = _chars_for(token_budget, _ARTIFACTS_WEIGHT)
        todos_budget = _chars_for(token_budget, _TODOS_WEIGHT)

        # Header: split between space + project summary roughly evenly.
        space_summary = _truncate(
            "",  # space-level summary not authored yet in this milestone
            header_budget // 2,
        )
        project_summary = _truncate(project_summary_raw, header_budget // 2)

        # Recent conversation, fit newest-first.
        trimmed_recent = self._fit_conversation_to_budget(
            recent_conv_raw, convo_budget
        )

        # Facts: take top-confidence, char-trim by artifacts/todos budget.
        relevant_facts = self._top_facts(facts_raw, todos_budget)

        relevant_artifacts = self._top_artifacts(
            artifacts_in_context, artifacts_budget
        )

        bundle = AgentContextBundle(
            space_name=space.name if space is not None else space_id,
            space_summary=space_summary,
            project_name=project.name if project is not None else project_id,
            project_summary=project_summary,
            recent_conversation=trimmed_recent,
            relevant_facts=relevant_facts,
            relevant_artifacts=relevant_artifacts,
            open_todos=[],  # todos pipeline not in M3; reserved for follow-up
            current_run_instruction=current_user_prompt.strip(),
        )
        return bundle

    # ----- Section selectors -----

    @staticmethod
    def _fit_conversation_to_budget(
        events: list[ConversationEvent], char_budget: int
    ) -> list[ConversationEvent]:
        if char_budget <= 0 or not events:
            return []
        # Walk newest-first, keep events until budget exhausted, then flip
        # back so the prompt reads oldest-first.
        framing_overhead = 16  # "Role: " etc. framing per event in the prompt
        truncation_marker = "\n... [truncated to fit context budget]"
        kept: list[ConversationEvent] = []
        used = 0
        for event in reversed(events):
            cost = len(event.content) + framing_overhead
            remaining = char_budget - used
            if used + cost <= char_budget:
                kept.append(event)
                used += cost
                continue
            if kept:
                # Budget exhausted; older events are dropped.
                break
            # The single newest event is larger than the entire section
            # budget. Truncate it instead of injecting it whole, otherwise
            # one oversized final_result (HTML report, CSV dump) blows past
            # the prompt token budget the caller asked us to honor.
            allowed_content = (
                remaining - framing_overhead - len(truncation_marker)
            )
            if allowed_content <= 0:
                return []
            truncated = ConversationEvent(
                event_id=event.event_id,
                run_id=event.run_id,
                timestamp=event.timestamp,
                role=event.role,
                content=event.content[:allowed_content] + truncation_marker,
                source=event.source,
                visibility=event.visibility,
                hash=event.hash,
            )
            kept.append(truncated)
            break
        kept.reverse()
        return kept

    @staticmethod
    def _top_facts(
        facts: list[MemoryFact], char_budget: int
    ) -> list[MemoryFact]:
        if char_budget <= 0 or not facts:
            return []
        framing = 4  # "- " prefix + newline
        marker = "... [truncated]"
        ranked = sorted(facts, key=lambda f: f.confidence, reverse=True)
        kept: list[MemoryFact] = []
        used = 0
        for fact in ranked:
            cost = len(fact.text) + framing
            remaining = char_budget - used
            if used + cost <= char_budget:
                kept.append(fact)
                used += cost
                continue
            if kept:
                break
            # The top-ranked fact alone exceeds the budget. Truncate the text
            # in a copy rather than injecting the whole thing -- future
            # Memory Toolkit writers can produce arbitrarily long fact bodies.
            allowed = remaining - framing - len(marker)
            if allowed <= 0:
                return []
            from dataclasses import replace as _replace

            kept.append(_replace(fact, text=fact.text[:allowed] + marker))
            break
        return kept

    @staticmethod
    def _top_artifacts(
        artifacts: list[MemoryArtifact], char_budget: int
    ) -> list[MemoryArtifact]:
        if char_budget <= 0 or not artifacts:
            return []
        framing = 8  # "- " + " (kind)" overhead
        marker = "... [truncated]"
        # Most recent first; created_at is ISO string so lex sort works.
        ranked = sorted(artifacts, key=lambda a: a.created_at, reverse=True)
        kept: list[MemoryArtifact] = []
        used = 0
        for art in ranked:
            cost = len(art.path) + len(art.kind) + framing
            remaining = char_budget - used
            if used + cost <= char_budget:
                kept.append(art)
                used += cost
                continue
            if kept:
                break
            # Single oversized artifact path -- truncate the path so the
            # bundle never blows past the section budget even on pathological
            # inputs.
            allowed = remaining - framing - len(art.kind) - len(marker)
            if allowed <= 0:
                return []
            from dataclasses import replace as _replace

            kept.append(_replace(art, path=art.path[:allowed] + marker))
            break
        return kept
