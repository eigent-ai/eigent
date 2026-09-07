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

from types import SimpleNamespace

import pytest

from app.domains.trigger.service.trigger_service import TriggerService
from app.shared.types.trigger_types import ExecutionStatus


class _RejectingSession:
    def __getattr__(self, name: str):
        raise AssertionError(f"terminal no-op must not access session.{name}")


def _service() -> TriggerService:
    service = object.__new__(TriggerService)
    service.session = _RejectingSession()
    return service


@pytest.mark.parametrize(
    "terminal_status",
    [
        ExecutionStatus.completed,
        ExecutionStatus.failed,
        ExecutionStatus.cancelled,
        ExecutionStatus.missed,
    ],
)
def test_terminal_execution_cannot_regress_to_running(
    terminal_status: ExecutionStatus,
) -> None:
    execution = SimpleNamespace(
        execution_id="execution-terminal",
        status=terminal_status,
    )

    result = _service().update_execution_status(
        execution,
        ExecutionStatus.running,
    )

    assert result is execution
    assert execution.status == terminal_status


def test_first_terminal_execution_outcome_wins() -> None:
    execution = SimpleNamespace(
        execution_id="execution-completed",
        status=ExecutionStatus.completed,
    )

    _service().update_execution_status(execution, ExecutionStatus.failed)

    assert execution.status == ExecutionStatus.completed
