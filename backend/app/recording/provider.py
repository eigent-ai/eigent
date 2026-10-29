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

"""A leased optional capture port. No Electron or Hands dependency."""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from typing import Protocol

from .models import GRANT_IDLE_SECONDS, LEASE_SECONDS, RecordingError


class RecordingProvider(Protocol):
    def available(self) -> bool: ...
    def authorize(self, account: str) -> str: ...
    def check_grant(self, grant_id: str, account: str) -> None: ...


@dataclass
class DesktopProvider:
    instance: str
    generation: str
    token: str
    spool_root: str
    formats: tuple[str, ...] = ("video/mp4",)
    last_seen: float = field(default_factory=time.time)
    grants: dict[str, tuple[str, float]] = field(default_factory=dict)
    stream_id: str | None = None

    def available(self) -> bool:
        return time.time() - self.last_seen < LEASE_SECONDS

    def authorize(self, account: str) -> str:
        grant = secrets.token_urlsafe(32)
        self.grants[grant] = (account, time.time() + GRANT_IDLE_SECONDS)
        return grant

    def check_grant(self, grant_id: str, account: str) -> None:
        grant = self.grants.get(grant_id)
        if not grant or grant[0] != account or grant[1] < time.time():
            raise RecordingError("permission_required", 412)
        self.grants[grant_id] = (account, time.time() + GRANT_IDLE_SECONDS)


class UnavailableProvider:
    def available(self) -> bool:
        return False

    def authorize(self, account: str) -> str:
        raise RecordingError("provider_unavailable", 503)

    def check_grant(self, grant_id: str, account: str) -> None:
        raise RecordingError("provider_unavailable", 503)
