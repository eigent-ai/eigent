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

"""Versioned plain-data recording contracts, independent of desktop APIs."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

ACTIVE_STATES = frozenset({"starting", "recording", "stopping", "finalizing"})
TERMINAL_STATES = frozenset({"completed", "interrupted", "failed", "denied"})
CAPTURE_STATES = frozenset({"starting", "recording"})
MAX_CLIP_SECONDS = 60 * 60
SPACE_BUDGET_BYTES = 5 * 1024**3
FREE_SPACE_FLOOR = 256 * 1024**2
MAX_CHUNK_BYTES = 8 * 1024**2
LEASE_SECONDS = 15
FINALIZE_SECONDS = 60
GRANT_IDLE_SECONDS = 15 * 60


class RecordingError(Exception):
    def __init__(self, code: str, status: int = 409, **details: Any):
        super().__init__(code)
        self.code = code
        self.status = status
        self.details = details


@dataclass(frozen=True)
class RecordingScope:
    principal: str
    account: str
    space_id: str
    project_id: str
    task_id: str
    run_id: str
    attempt_id: str | None
    root: Path
    binding_version: str
    user_id: str | None = None


def public_record(record: dict) -> dict:
    result = {
        key: value
        for key, value in record.items()
        if key
        not in {
            "principal",
            "account",
            "root",
            "fingerprint",
            "binding_version",
            "grant_id",
            "idempotency_key",
        }
    }

    result["clips"] = [
        {
            **clip,
            "local_path": str(Path(record["root"]) / clip["relative_path"]),
        }
        for clip in record["clips"]
    ]
    return result
