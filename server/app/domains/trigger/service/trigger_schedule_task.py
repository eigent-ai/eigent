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

"""
Celery tasks for trigger scheduling: poll due triggers and check execution timeouts.
"""

import logging
from datetime import datetime, timezone

from celery import shared_task
from sqlmodel import select, or_

from app.core.database import session_make
from app.core.environment import env
from app.core.trigger_utils import MAX_DISPATCH_PER_TICK
from app.core.redis_utils import get_redis_manager
from app.model.trigger.trigger_execution import TriggerExecution
from app.model.trigger.trigger import Trigger
from app.shared.types.trigger_types import ExecutionStatus
from app.domains.trigger.service.trigger_schedule_service import TriggerScheduleService
from app.domains.trigger.service.trigger_service import TriggerService

EXECUTION_PENDING_TIMEOUT_SECONDS = int(env("EXECUTION_PENDING_TIMEOUT_SECONDS", "60"))
EXECUTION_RUNNING_TIMEOUT_SECONDS = int(env("EXECUTION_RUNNING_TIMEOUT_SECONDS", "600"))

logger = logging.getLogger("server_trigger_schedule_task")


@shared_task(queue="poll_trigger_schedules")
def poll_trigger_schedules() -> None:
    """Poll and execute scheduled triggers."""
    logger.info("Starting poll_trigger_schedules task")

    session = session_make()
    try:
        schedule_service = TriggerScheduleService(session)
        schedule_service.poll_and_execute_due_triggers(
            max_dispatch_per_tick=MAX_DISPATCH_PER_TICK
        )
    finally:
        session.close()


@shared_task(queue="check_execution_timeouts")
def check_execution_timeouts() -> None:
    """Check for timed-out pending and running executions."""
    logger.info("Starting check_execution_timeouts task", extra={
        "pending_timeout": EXECUTION_PENDING_TIMEOUT_SECONDS,
        "running_timeout": EXECUTION_RUNNING_TIMEOUT_SECONDS
    })

    session = session_make()
    redis_manager = get_redis_manager()
    trigger_service = TriggerService(session)

    try:
        now = datetime.now(timezone.utc)

        executions = session.exec(
            select(TriggerExecution).where(
                or_(
                    TriggerExecution.status == ExecutionStatus.pending,
                    TriggerExecution.status == ExecutionStatus.running
                )
            )
        ).all()

        timed_out_pending_count = 0
        timed_out_running_count = 0

        for execution in executions:
            is_pending = execution.status == ExecutionStatus.pending
            is_running = execution.status == ExecutionStatus.running

            if is_pending:
                reference_time = execution.created_at
                timeout_seconds = EXECUTION_PENDING_TIMEOUT_SECONDS
            else:
                reference_time = execution.started_at or execution.created_at
                timeout_seconds = EXECUTION_RUNNING_TIMEOUT_SECONDS

            if reference_time.tzinfo is None:
                reference_time = reference_time.replace(tzinfo=timezone.utc)
            time_elapsed = (now - reference_time).total_seconds()

            if time_elapsed > timeout_seconds:
                if is_pending:
                    new_status = ExecutionStatus.missed
                    error_message = f"Execution acknowledgment timeout ({timeout_seconds} seconds)"
                    timed_out_pending_count += 1
                else:
                    new_status = ExecutionStatus.failed
                    error_message = f"Execution running timeout ({timeout_seconds} seconds) - no completion received"
                    timed_out_running_count += 1

                trigger_service.update_execution_status(
                    execution=execution,
                    status=new_status,
                    error_message=error_message
                )

                try:
                    trigger = session.get(Trigger, execution.trigger_id)
                    if trigger and trigger.user_id:
                        user_session_ids = redis_manager.get_user_sessions(trigger.user_id)
                        for session_id in user_session_ids:
                            redis_manager.remove_pending_execution(session_id, execution.execution_id)
                except Exception as e:
                    logger.warning("Failed to remove execution from Redis", extra={
                        "execution_id": execution.execution_id,
                        "trigger_id": execution.trigger_id,
                        "error": str(e)
                    })

                logger.info("Execution timed out", extra={
                    "execution_id": execution.execution_id,
                    "trigger_id": execution.trigger_id,
                    "original_status": "pending" if is_pending else "running",
                    "new_status": new_status.value,
                    "time_elapsed": time_elapsed
                })

        total_timed_out = timed_out_pending_count + timed_out_running_count
        if total_timed_out > 0:
            logger.info("Marked executions as timed out", extra={
                "timed_out_pending_count": timed_out_pending_count,
                "timed_out_running_count": timed_out_running_count,
                "total_timed_out": total_timed_out
            })

    except Exception as e:
        logger.error("Error checking execution timeouts", extra={
            "error": str(e),
            "error_type": type(e).__name__
        }, exc_info=True)
        session.rollback()

    finally:
        session.close()
