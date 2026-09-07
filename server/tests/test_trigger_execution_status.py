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
from sqlmodel import Session, SQLModel, create_engine, select

from app.domains.trigger.service.trigger_crud_service import TriggerCrudService
from app.domains.trigger.service.trigger_service import TriggerService
from app.model.trigger.trigger import Trigger
from app.model.trigger.trigger_execution import (
    TriggerExecution,
    TriggerExecutionUpdate,
)
from app.shared.types.trigger_types import (
    ExecutionStatus,
    ExecutionType,
    TriggerStatus,
    TriggerType,
)


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


def test_timeout_transition_refreshes_stale_execution_before_write(
    tmp_path,
) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'trigger-race.db'}")
    SQLModel.metadata.create_all(
        engine,
        tables=[Trigger.__table__, TriggerExecution.__table__],
    )
    with Session(engine) as setup:
        trigger = Trigger(
            user_id="1",
            project_id="project-1",
            name="Scheduled task",
            trigger_type=TriggerType.schedule,
            status=TriggerStatus.active,
        )
        setup.add(trigger)
        setup.flush()
        setup.add(
            TriggerExecution(
                trigger_id=trigger.id,
                execution_id="execution-race",
                execution_type=ExecutionType.scheduled,
                status=ExecutionStatus.running,
                started_at=datetime(2026, 9, 7, tzinfo=UTC),
            )
        )
        setup.commit()

    with Session(engine) as stale_session, Session(engine) as terminal_session:
        stale_execution = stale_session.exec(
            select(TriggerExecution).where(
                TriggerExecution.execution_id == "execution-race"
            )
        ).one()
        assert stale_execution.status == ExecutionStatus.running

        terminal_execution = terminal_session.exec(
            select(TriggerExecution).where(
                TriggerExecution.execution_id == "execution-race"
            )
        ).one()
        TriggerService(terminal_session).update_execution_status(
            terminal_execution,
            ExecutionStatus.completed,
            output_data={"result": "accepted"},
        )

        refreshed, transitioned = TriggerService(
            stale_session
        ).transition_execution_status_by_id(
            "execution-race",
            ExecutionStatus.failed,
            expected_statuses={ExecutionStatus.running},
            error_message="running timeout",
        )

        assert transitioned is False
        assert refreshed is not None
        assert refreshed.status == ExecutionStatus.completed
        assert refreshed.output_data == {"result": "accepted"}

    with Session(engine) as verify:
        persisted = verify.exec(
            select(TriggerExecution).where(
                TriggerExecution.execution_id == "execution-race"
            )
        ).one()
        assert persisted.status == ExecutionStatus.completed
        assert persisted.error_message is None
        assert persisted.output_data == {"result": "accepted"}
