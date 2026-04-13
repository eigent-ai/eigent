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

"""TriggerCrudService: trigger CRUD + execution business logic."""

from datetime import datetime, timezone
from uuid import uuid4
from typing import Optional

from loguru import logger
from pydantic import ValidationError
from sqlmodel import Session, select, and_
from sqlalchemy import func

from app.model.trigger.trigger import Trigger, TriggerIn, TriggerOut, TriggerUpdate
from app.model.trigger.trigger_execution import TriggerExecution, TriggerExecutionIn, TriggerExecutionUpdate
from app.shared.types.trigger_types import ExecutionStatus, ExecutionType
from app.model.trigger.app_configs import (
    get_config_schema,
    validate_config,
    has_config,
    validate_activation,
    ActivationError,
)
from app.model.trigger.app_configs.config_registry import requires_authentication
from app.model.chat.chat_history import ChatHistory
from app.shared.types.trigger_types import TriggerType, TriggerStatus
from app.core.redis_utils import get_redis_manager
from app.domains.trigger.service.trigger_schedule_service import TriggerScheduleService
from app.domains.trigger.service.trigger_service import TriggerService


ACTIVE_STATUSES = (TriggerStatus.active, TriggerStatus.pending_verification)
MAX_ACTIVE_PER_USER = 25
MAX_ACTIVE_PER_PROJECT = 5


class TriggerCrudService:
    """Trigger CRUD business logic - static methods, caller-managed session."""

    @staticmethod
    def get_active_trigger_counts(s: Session, user_id: str, project_id: str | None = None) -> tuple[int, int]:
        """Return (user_active_count, project_active_count) for active/pending triggers."""
        user_count = s.exec(
            select(func.count(Trigger.id)).where(
                and_(
                    Trigger.user_id == user_id,
                    Trigger.status.in_(ACTIVE_STATUSES),
                )
            )
        ).one()

        project_count = 0
        if project_id:
            project_count = s.exec(
                select(func.count(Trigger.id)).where(
                    and_(
                        Trigger.user_id == user_id,
                        Trigger.project_id == project_id,
                        Trigger.status.in_(ACTIVE_STATUSES),
                    )
                )
            ).one()

        return user_count, project_count

    @staticmethod
    def get_execution_counts(s: Session, trigger_ids: list[int]) -> dict[int, int]:
        """Get execution counts for multiple triggers in a single query."""
        if not trigger_ids:
            return {}
        result = s.exec(
            select(TriggerExecution.trigger_id, func.count(TriggerExecution.id))
            .where(TriggerExecution.trigger_id.in_(trigger_ids))
            .group_by(TriggerExecution.trigger_id)
        ).all()
        return {trigger_id: count for trigger_id, count in result}

    @staticmethod
    def trigger_to_out(trigger: Trigger, execution_count: int = 0) -> TriggerOut:
        """Convert Trigger model to TriggerOut with execution count."""
        return TriggerOut(
            id=trigger.id,
            user_id=trigger.user_id,
            project_id=trigger.project_id,
            name=trigger.name,
            description=trigger.description,
            trigger_type=trigger.trigger_type,
            status=trigger.status,
            execution_count=execution_count,
            webhook_url=trigger.webhook_url,
            webhook_method=trigger.webhook_method,
            custom_cron_expression=trigger.custom_cron_expression,
            listener_type=trigger.listener_type,
            agent_model=trigger.agent_model,
            task_prompt=trigger.task_prompt,
            config=trigger.config,
            max_executions_per_hour=trigger.max_executions_per_hour,
            max_executions_per_day=trigger.max_executions_per_day,
            is_single_execution=trigger.is_single_execution,
            last_executed_at=trigger.last_executed_at,
            next_run_at=trigger.next_run_at,
            last_execution_status=trigger.last_execution_status,
            created_at=trigger.created_at,
            updated_at=trigger.updated_at,
        )

    @staticmethod
    def _ensure_project_chat_history(data: TriggerIn, user_id: int, s: Session) -> None:
        """Create placeholder ChatHistory for a new project if it doesn't exist, and notify via WebSocket."""
        if not data.project_id:
            return

        existing_chat = s.exec(
            select(ChatHistory).where(ChatHistory.project_id == data.project_id)
        ).first()
        if existing_chat:
            return

        chat_history = ChatHistory(
            user_id=user_id,
            task_id=data.project_id,
            project_id=data.project_id,
            question=f"Project created via trigger: {data.name}",
            language="en",
            model_platform=data.agent_model or "none",
            model_type=data.agent_model or "none",
            installed_mcp="none",
            api_key="",
            api_url="",
            max_retries=3,
            project_name=data.name,
            summary=data.description or "",
            tokens=0,
            spend=0,
            status=2,
        )
        s.add(chat_history)
        s.commit()
        s.refresh(chat_history)

        logger.info("Chat history created for new project", extra={
            "user_id": user_id,
            "project_id": data.project_id,
            "chat_history_id": chat_history.id,
        })

        # WebSocket notification (best effort)
        try:
            redis_manager = get_redis_manager()
            redis_manager.publish_execution_event({
                "type": "project_created",
                "project_id": data.project_id,
                "project_name": data.name,
                "chat_history_id": chat_history.id,
                "trigger_name": data.name,
                "user_id": str(user_id),
                "created_at": chat_history.created_at.isoformat() if chat_history.created_at else None,
            })
        except Exception as e:
            logger.warning("Failed to send WebSocket notification for new project", extra={
                "user_id": user_id,
                "project_id": data.project_id,
                "error": str(e),
            })

    @staticmethod
    def _validate_trigger_config(trigger_type: TriggerType, config: dict | None) -> None:
        """Validate trigger-type specific config. Raises HTTPException-compatible ValueError on failure."""
        if config and has_config(trigger_type):
            try:
                validate_config(trigger_type, config)
            except ValidationError as e:
                raise ValueError(f"Invalid config for {trigger_type.value}: {e.errors()}")

    @staticmethod
    def _determine_initial_status(
        data: TriggerIn, user_id: int, s: Session
    ) -> TriggerStatus:
        """Determine initial trigger status based on auth requirements and concurrency limits."""
        # Desired status from auth requirements
        if has_config(data.trigger_type) and data.config and requires_authentication(data.trigger_type, data.config):
            desired_status = TriggerStatus.pending_verification
        else:
            desired_status = TriggerStatus.active

        # Check concurrency limits
        user_active, project_active = TriggerCrudService.get_active_trigger_counts(
            s, str(user_id), data.project_id
        )
        if user_active >= MAX_ACTIVE_PER_USER or (
            data.project_id and project_active >= MAX_ACTIVE_PER_PROJECT
        ):
            logger.info(
                "Active trigger limit reached — new trigger created as inactive",
                extra={
                    "user_id": user_id,
                    "project_id": data.project_id,
                    "user_active": user_active,
                    "project_active": project_active,
                },
            )
            return TriggerStatus.inactive

        return desired_status

    @staticmethod
    def create(data: TriggerIn, user_id: int, s: Session) -> dict:
        """
        Create a new trigger with all business rules.
        Returns {"success": True, "trigger_out": TriggerOut} or {"success": False, "error": str, "status_code": int}.
        """
        # 1. Ensure project ChatHistory exists
        TriggerCrudService._ensure_project_chat_history(data, user_id, s)

        # 2. Generate webhook URL
        webhook_url = None
        if data.trigger_type in (TriggerType.webhook, TriggerType.slack_trigger):
            webhook_url = f"/v1/webhook/trigger/{uuid4()}"

        # 3. Validate config
        try:
            TriggerCrudService._validate_trigger_config(data.trigger_type, data.config)
        except ValueError as e:
            return {"success": False, "error": str(e), "status_code": 400}

        # 4. Determine initial status
        initial_status = TriggerCrudService._determine_initial_status(data, user_id, s)

        # 5. Create trigger
        trigger_data = data.model_dump()
        trigger_data["user_id"] = str(user_id)
        trigger_data["webhook_url"] = webhook_url
        trigger_data["status"] = initial_status

        trigger = Trigger(**trigger_data)
        s.add(trigger)
        s.commit()
        s.refresh(trigger)

        # 6. Calculate next_run_at for scheduled triggers
        if trigger.trigger_type == TriggerType.schedule and trigger.custom_cron_expression:
            schedule_service = TriggerScheduleService(s)
            trigger.next_run_at = schedule_service.calculate_next_run_at(trigger)
            s.add(trigger)
            s.commit()
            s.refresh(trigger)

        logger.info("Trigger created", extra={
            "user_id": user_id,
            "trigger_id": trigger.id,
            "trigger_type": data.trigger_type.value,
            "next_run_at": trigger.next_run_at.isoformat() if trigger.next_run_at else None,
        })

        return {"success": True, "trigger_out": TriggerCrudService.trigger_to_out(trigger, 0)}

    @staticmethod
    def update(trigger_id: int, data: TriggerUpdate, user_id: int, s: Session) -> dict:
        """
        Update a trigger with config validation and schedule recalculation.
        Returns {"success": True, "trigger_out": TriggerOut} or {"success": False, "error": str, "status_code": int}.
        """
        trigger = s.exec(
            select(Trigger).where(and_(Trigger.id == trigger_id, Trigger.user_id == str(user_id)))
        ).first()
        if not trigger:
            return {"success": False, "error": "Trigger not found", "status_code": 404}

        update_data = data.model_dump(exclude_unset=True)

        # Validate config if being updated
        if "config" in update_data and update_data["config"] is not None:
            try:
                TriggerCrudService._validate_trigger_config(trigger.trigger_type, update_data["config"])
            except ValueError as e:
                return {"success": False, "error": str(e), "status_code": 400}

        for key, value in update_data.items():
            setattr(trigger, key, value)

        # Recalculate next_run_at if cron expression or status changed for scheduled triggers
        if trigger.trigger_type == TriggerType.schedule:
            if "custom_cron_expression" in update_data or "status" in update_data:
                if trigger.status == TriggerStatus.active and trigger.custom_cron_expression:
                    schedule_service = TriggerScheduleService(s)
                    trigger.next_run_at = schedule_service.calculate_next_run_at(trigger)

        s.add(trigger)
        s.commit()
        s.refresh(trigger)

        counts = TriggerCrudService.get_execution_counts(s, [trigger_id])
        execution_count = counts.get(trigger_id, 0)

        logger.info("Trigger updated", extra={
            "user_id": user_id,
            "trigger_id": trigger_id,
            "fields_updated": list(update_data.keys()),
            "next_run_at": trigger.next_run_at.isoformat() if trigger.next_run_at else None,
        })

        return {"success": True, "trigger_out": TriggerCrudService.trigger_to_out(trigger, execution_count)}

    @staticmethod
    def activate(trigger_id: int, user_id: int, s: Session) -> dict:
        """
        Activate a trigger with limit checks, auth requirements, and activation validation.
        Returns {"success": True, "trigger_out": TriggerOut}
            or {"success": False, "error": str/dict, "status_code": int}.
        """
        trigger = s.exec(
            select(Trigger).where(and_(Trigger.id == trigger_id, Trigger.user_id == str(user_id)))
        ).first()
        if not trigger:
            return {"success": False, "error": "Trigger not found", "status_code": 404}

        # 1. Check concurrency limits
        user_active, project_active = TriggerCrudService.get_active_trigger_counts(
            s, str(user_id), trigger.project_id
        )
        if user_active >= MAX_ACTIVE_PER_USER:
            return {
                "success": False,
                "error": f"Maximum number of concurrent active triggers ({MAX_ACTIVE_PER_USER}) reached for this user",
                "status_code": 400,
            }
        if trigger.project_id and project_active >= MAX_ACTIVE_PER_PROJECT:
            return {
                "success": False,
                "error": f"Maximum number of concurrent active triggers ({MAX_ACTIVE_PER_PROJECT}) reached for this project",
                "status_code": 400,
            }

        # 2. Check if authentication is required — go straight to pending_verification
        if has_config(trigger.trigger_type) and requires_authentication(trigger.trigger_type, trigger.config):
            trigger.status = TriggerStatus.pending_verification
            s.add(trigger)
            s.commit()
            s.refresh(trigger)
            return {
                "success": False,
                "error": {
                    "message": "Authentication required for this trigger type",
                    "missing_requirements": ["authentication"],
                    "trigger_type": trigger.trigger_type.value,
                },
                "status_code": 401,
            }

        # 3. Validate activation requirements (non-auth triggers)
        if has_config(trigger.trigger_type):
            try:
                validate_activation(
                    trigger_type=trigger.trigger_type,
                    config_data=trigger.config,
                    user_id=int(user_id),
                    session=s,
                )
            except ActivationError as e:
                return {
                    "success": False,
                    "error": {
                        "message": e.message,
                        "missing_requirements": e.missing_requirements,
                        "trigger_type": trigger.trigger_type.value,
                    },
                    "status_code": 400,
                }

        # 4. Activate
        trigger.status = TriggerStatus.active
        s.add(trigger)
        s.commit()
        s.refresh(trigger)

        counts = TriggerCrudService.get_execution_counts(s, [trigger_id])
        execution_count = counts.get(trigger_id, 0)

        logger.info("Trigger activated", extra={
            "user_id": user_id,
            "trigger_id": trigger_id,
            "status": trigger.status.value,
        })

        return {"success": True, "trigger_out": TriggerCrudService.trigger_to_out(trigger, execution_count)}

    @staticmethod
    def deactivate(trigger_id: int, user_id: int, s: Session) -> dict:
        """
        Deactivate a trigger.
        Returns {"success": True, "trigger_out": TriggerOut} or {"success": False, ...}.
        """
        trigger = s.exec(
            select(Trigger).where(and_(Trigger.id == trigger_id, Trigger.user_id == str(user_id)))
        ).first()
        if not trigger:
            return {"success": False, "error": "Trigger not found", "status_code": 404}

        trigger.status = TriggerStatus.inactive
        s.add(trigger)
        s.commit()
        s.refresh(trigger)

        counts = TriggerCrudService.get_execution_counts(s, [trigger_id])
        execution_count = counts.get(trigger_id, 0)

        logger.info("Trigger deactivated", extra={
            "user_id": user_id,
            "trigger_id": trigger_id,
        })

        return {"success": True, "trigger_out": TriggerCrudService.trigger_to_out(trigger, execution_count)}

    # ---- Execution CRUD ----

    @staticmethod
    def _publish_execution_event(event_type: str, execution: TriggerExecution, trigger: Trigger, user_id: int, extra: dict | None = None) -> None:
        """Publish execution event to Redis pub/sub (best effort)."""
        try:
            payload = {
                "type": event_type,
                "execution_id": execution.execution_id,
                "trigger_id": trigger.id,
                "trigger_type": trigger.trigger_type.value if trigger.trigger_type else "unknown",
                "task_prompt": trigger.task_prompt,
                "status": execution.status.value,
                "input_data": execution.input_data,
                "execution_type": execution.execution_type.value,
                "user_id": str(user_id),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "project_id": str(trigger.project_id),
            }
            if extra:
                payload.update(extra)
            get_redis_manager().publish_execution_event(payload)
        except Exception as e:
            logger.warning("Failed to publish execution event", extra={"execution_id": execution.execution_id, "error": str(e)})

    @staticmethod
    def create_execution(data: TriggerExecutionIn, user_id: int, s: Session) -> dict:
        """
        Create a trigger execution: verify ownership, create record, update trigger timestamp, publish event.
        Returns {"success": True, "execution": TriggerExecution} or {"success": False, ...}.
        """
        trigger = s.exec(
            select(Trigger).where(and_(Trigger.id == data.trigger_id, Trigger.user_id == str(user_id)))
        ).first()
        if not trigger:
            return {"success": False, "error": "Trigger not found", "status_code": 404}

        execution = TriggerExecution(**data.model_dump())
        s.add(execution)
        s.commit()
        s.refresh(execution)

        # Update trigger timestamp
        trigger.last_executed_at = datetime.now(timezone.utc)
        s.add(trigger)
        s.commit()

        logger.info("Trigger execution created", extra={
            "user_id": user_id,
            "trigger_id": data.trigger_id,
            "execution_id": execution.execution_id,
            "execution_type": data.execution_type.value,
        })

        TriggerCrudService._publish_execution_event("execution_created", execution, trigger, user_id)

        return {"success": True, "execution": execution}

    @staticmethod
    def update_execution(execution_id: str, data: TriggerExecutionUpdate, user_id: int, s: Session) -> dict:
        """
        Update a trigger execution: ownership check, status via TriggerService, duration calc, publish event.
        Returns {"success": True, "execution": TriggerExecution} or {"success": False, ...}.
        """
        execution = s.exec(
            select(TriggerExecution)
            .join(Trigger)
            .where(and_(TriggerExecution.execution_id == execution_id, Trigger.user_id == str(user_id)))
        ).first()
        if not execution:
            return {"success": False, "error": "Execution not found", "status_code": 404}

        update_data = data.model_dump(exclude_unset=True)

        # Delegate status update to TriggerService for proper failure tracking
        if "status" in update_data:
            trigger_service = TriggerService(s)
            status_value = ExecutionStatus(update_data["status"]) if isinstance(update_data["status"], str) else update_data["status"]
            trigger_service.update_execution_status(
                execution=execution,
                status=status_value,
                output_data=update_data.get("output_data"),
                error_message=update_data.get("error_message"),
                tokens_used=update_data.get("tokens_used"),
                tools_executed=update_data.get("tools_executed"),
            )
            for key in ["status", "output_data", "error_message", "tokens_used", "tools_executed"]:
                update_data.pop(key, None)

        # Update remaining fields + auto-calculate duration
        if update_data:
            if ("started_at" in update_data or "completed_at" in update_data) and execution.started_at:
                completed_at = update_data.get("completed_at") or execution.completed_at
                if completed_at:
                    started_at = execution.started_at
                    if started_at.tzinfo is None:
                        started_at = started_at.replace(tzinfo=timezone.utc)
                    if completed_at.tzinfo is None:
                        completed_at = completed_at.replace(tzinfo=timezone.utc)
                    update_data["duration_seconds"] = (completed_at - started_at).total_seconds()

            for key, value in update_data.items():
                setattr(execution, key, value)
            s.add(execution)
            s.commit()

        s.refresh(execution)

        # Publish event
        trigger = s.get(Trigger, execution.trigger_id)
        logger.info("Execution updated", extra={
            "user_id": user_id,
            "execution_id": execution_id,
            "fields_updated": list(data.model_dump(exclude_unset=True).keys()),
        })

        if trigger:
            TriggerCrudService._publish_execution_event(
                "execution_updated", execution, trigger, user_id,
                extra={"updated_fields": list(update_data.keys())},
            )

        return {"success": True, "execution": execution}

    @staticmethod
    def retry_execution(execution_id: str, user_id: int, s: Session) -> dict:
        """
        Retry a failed execution: validate status, create new execution, publish event.
        Returns {"success": True, "execution": TriggerExecution} or {"success": False, ...}.
        """
        execution = s.exec(
            select(TriggerExecution)
            .join(Trigger)
            .where(and_(TriggerExecution.execution_id == execution_id, Trigger.user_id == str(user_id)))
        ).first()
        if not execution:
            return {"success": False, "error": "Execution not found", "status_code": 404}

        if execution.status != ExecutionStatus.failed:
            return {"success": False, "error": "Only failed executions can be retried", "status_code": 400}

        if execution.attempts >= execution.max_retries:
            return {"success": False, "error": "Maximum retry attempts exceeded", "status_code": 400}

        new_execution = TriggerExecution(
            trigger_id=execution.trigger_id,
            execution_id=str(uuid4()),
            execution_type=execution.execution_type,
            input_data=execution.input_data,
            attempts=execution.attempts + 1,
            max_retries=execution.max_retries,
        )
        s.add(new_execution)
        s.commit()
        s.refresh(new_execution)

        trigger = s.get(Trigger, execution.trigger_id)

        logger.info("Execution retry created", extra={
            "user_id": user_id,
            "original_execution_id": execution_id,
            "new_execution_id": new_execution.execution_id,
            "attempts": new_execution.attempts,
        })

        if trigger:
            TriggerCrudService._publish_execution_event("execution_created", new_execution, trigger, user_id)

        return {"success": True, "execution": new_execution}
