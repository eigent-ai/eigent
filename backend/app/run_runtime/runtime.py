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

"""Lazy process-owned RunCoordinator runtime."""

from app.run_runtime.coordinator import RunCoordinator

_default_run_coordinator: RunCoordinator | None = None


def get_default_run_coordinator() -> RunCoordinator:
    global _default_run_coordinator
    if _default_run_coordinator is None:
        _default_run_coordinator = RunCoordinator()
    return _default_run_coordinator


async def close_default_run_coordinator() -> None:
    global _default_run_coordinator
    coordinator = _default_run_coordinator
    _default_run_coordinator = None
    if coordinator is not None:
        await coordinator.close()
