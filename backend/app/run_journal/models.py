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

"""Typed records for the Desktop-owned SQLite RunJournal."""

from __future__ import annotations

import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    project_id: str
    status: str
    version: int
    active_attempt_id: str | None
    deadline_at: float | None
    timeout_policy_version: str
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class RunEventDraft:
    event_type: str
    payload: Mapping[str, Any]
    legacy_step: str | None = None
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: float = field(default_factory=time.time)


@dataclass(frozen=True)
class CommittedRunEvent:
    event_id: str
    run_id: str
    sequence: int
    event_type: str
    payload: dict[str, Any]
    legacy_step: str | None
    created_at: float
    run_version: int


@dataclass(frozen=True)
class RunEventSyncOutboxRecord:
    event_id: str
    run_id: str
    run_sequence: int
    status: str
    attempt_count: int
    next_attempt_at: float
    last_error: str | None
    created_at: float
    updated_at: float
