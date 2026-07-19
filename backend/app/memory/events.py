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

"""Memory schema dataclasses (§6 of space-project-memory-local-first-design).

All payloads are frozen and JSON-serializable via dataclasses.asdict. The
LocalMemoryStore round-trips by calling cls(**payload) on each read; for that
reason every dataclass keeps a flat shape (no nested dataclasses) and the
Literal fields are validated at construction only via type hints, not runtime
guards. The store treats any unrecognised payload as "schema drift" and either
ignores extra keys or raises -- see LocalMemoryStore for the policy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

SCHEMA_VERSION: int = 1

# ----- Event records (append-only lines in *.jsonl) -----


@dataclass(frozen=True)
class ConversationEvent:
    """One human/assistant/system turn appended to Project conversation.jsonl."""

    event_id: str
    run_id: str
    timestamp: str  # ISO 8601 UTC
    role: Literal["user", "assistant", "system"]
    content: str
    source: Literal["chat", "trigger", "improve", "imported"]
    visibility: Literal["context", "audit_only", "debug_only"]
    hash: str  # sha256:<hex>


@dataclass(frozen=True)
class ToolEvent:
    """One tool invocation appended to Run tool_events.jsonl."""

    event_id: str
    run_id: str
    timestamp: str
    tool_name: str
    arguments: dict[str, Any]
    result_summary: str
    visibility: Literal["context", "audit_only", "debug_only"]


# ----- Project / Space level records (small JSON files, full rewrite) -----


@dataclass(frozen=True)
class MemoryFact:
    fact_id: str
    text: str
    scope: Literal["space", "project"]
    source_event_ids: list[str]
    confidence: float
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class MemoryArtifact:
    artifact_id: str
    run_id: str
    path: str  # relative to project root (e.g. "task_<run_id>/report.html")
    kind: Literal[
        "html_report",
        "csv",
        "screenshot",
        "source_change",
        "runtime_log",
        "other",
    ]
    visible_to_user: bool
    eligible_for_context: bool
    hash: str  # sha256:<hex> or empty when unavailable
    created_at: str


@dataclass(frozen=True)
class RunStatus:
    run_id: str
    state: Literal["running", "done", "failed", "cancelled"]
    started_at: str
    ended_at: str | None
    last_error: str | None


# ----- Root JSON shapes (§6 of design doc) -----


@dataclass(frozen=True)
class SyncSettings:
    """Cloud sync settings (§12). Always written; defaults keep things local."""

    enabled: bool = False
    scope: Literal[
        "local_only", "metadata_only", "summary_only", "full_memory"
    ] = "local_only"


@dataclass(frozen=True)
class SpaceMemory:
    space_id: str
    user_id: str
    name: str
    source_type: Literal["folder", "blank", "legacy"]
    created_at: str
    updated_at: str
    root_fingerprint: str | None = None
    sync: SyncSettings = field(default_factory=SyncSettings)
    schema_version: int = SCHEMA_VERSION


@dataclass(frozen=True)
class ProjectMemory:
    project_id: str
    space_id: str
    name: str
    created_at: str
    updated_at: str
    mode: Literal["single_agent", "workforce"] | None = None
    last_run_id: str | None = None
    sync: SyncSettings = field(default_factory=SyncSettings)
    schema_version: int = SCHEMA_VERSION


@dataclass(frozen=True)
class RunMemory:
    """Per-run header. Tool events / conversation live in sibling *.jsonl files."""

    run_id: str
    project_id: str
    space_id: str
    mode: Literal["single_agent", "workforce"] | None
    user_prompt: str
    started_at: str
    schema_version: int = SCHEMA_VERSION
