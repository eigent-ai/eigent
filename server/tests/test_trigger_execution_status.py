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

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.domains.trigger.service.trigger_crud_service import TriggerCrudService
from app.domains.trigger.service.trigger_service import TriggerService
from app.model.trigger.trigger_execution import TriggerExecutionUpdate
from app.shared.types.trigger_types import ExecutionStatus


class _RejectingSession:
    def __getattr__(self, name: str):
        raise AssertionError(f"terminal no-op must not access session.{name}")


class _ExecutionResult:
    def __init__(self, execution: SimpleNamespace) -> None:
        self.execution = execution

    def first(self) -> SimpleNamespace:
        return self.execution


class _TerminalExecutionSession(_RejectingSession):
    def __init__(self, execution: SimpleNamespace) -> None:
        self.execution = execution

    def exec(self, _statement: object) -> _ExecutionResult:
        return _ExecutionResult(self.execution)


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


def test_terminal_receipt_metadata_is_immutable_in_crud_update() -> None:
    completed_at = datetime(2026, 9, 7, tzinfo=UTC)
    execution = SimpleNamespace(
        execution_id="execution-completed",
        status=ExecutionStatus.completed,
        completed_at=completed_at,
        duration_seconds=12.0,
        output_data={"result": "accepted"},
    )

    result = TriggerCrudService.update_execution(
        "execution-completed",
        TriggerExecutionUpdate(
            status=ExecutionStatus.failed,
            completed_at=datetime(2026, 9, 8, tzinfo=UTC),
            duration_seconds=99.0,
            output_data={"result": "late"},
        ),
        user_id=1,
        s=_TerminalExecutionSession(execution),
    )

    assert result == {"success": True, "execution": execution}
    assert execution.completed_at == completed_at
    assert execution.duration_seconds == 12.0
    assert execution.output_data == {"result": "accepted"}
