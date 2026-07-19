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

from datetime import datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy_utils import ChoiceType
from sqlmodel import JSON, Column, Field, String

from app.model.abstract.model import AbstractModel, DefaultTimes
from app.shared.types.trigger_types import ListenerType, RequestType, TriggerStatus, TriggerType


class Trigger(AbstractModel, DefaultTimes, table=True):
    """Trigger model for automated task execution"""

    id: int = Field(default=None, primary_key=True)
    user_id: str = Field(index=True, description="User ID who owns this trigger")
    space_id: str | None = Field(default=None, index=True, description="Space ID this trigger belongs to")
    project_id: str = Field(index=True, description="Project ID this trigger belongs to")
    name: str = Field(max_length=100, description="Human readable name for the trigger")
    description: str = Field(default="", max_length=1000, description="Description of what this trigger does")

    # Trigger configuration
    trigger_type: TriggerType = Field(
        sa_column=Column(ChoiceType(TriggerType, String(50))),
        description="Type of trigger (schedule, webhook, slack_trigger)",
    )
    status: TriggerStatus = Field(
        default=TriggerStatus.inactive,
        sa_column=Column(ChoiceType(TriggerStatus, String(50))),
        description="Current status of the trigger",
    )

    # Webhook specific fields
    webhook_url: str | None = Field(
        default=None, sa_column=Column(String(1024)), description="Auto-generated webhook URL for webhook triggers"
    )
    webhook_method: RequestType | None = Field(
        default=None, sa_column=Column(ChoiceType(RequestType, String(50))), description="Http/s Request Type"
    )

    # Schedule specific fields
    custom_cron_expression: str | None = Field(
        default=None, sa_column=Column(String(100)), description="Custom cron expression for scheduled triggers"
    )

    # Listener configuration
    listener_type: ListenerType | None = Field(
        default=None,
        sa_column=Column(ChoiceType(ListenerType, String(50))),
        description="Type of listener (workforce, chat_agent)",
    )

    agent_model: str | None = Field(
        default=None, sa_column=Column(String(100)), description="Model to use for the agent"
    )

    # Task configuration
    task_prompt: str | None = Field(
        default=None, max_length=1500, description="Prompt template for tasks created by this trigger"
    )

    # Trigger-type specific configuration (validated based on trigger_type)
    config: dict | None = Field(
        default=None,
        sa_column=Column(JSON),
        description="Trigger-type specific configuration (e.g., SlackTriggerConfig)",
    )

    # Execution limits
    max_executions_per_hour: int | None = Field(default=None, description="Maximum executions allowed per hour")
    max_executions_per_day: int | None = Field(default=None, description="Maximum executions allowed per day")
    is_single_execution: bool = Field(default=False, description="Whether this trigger should only execute once")

    # Execution tracking
    last_executed_at: datetime | None = Field(default=None, description="Timestamp of last execution")
    next_run_at: datetime | None = Field(default=None, index=True, description="Timestamp of next scheduled execution")
    last_execution_status: str | None = Field(
        default=None, sa_column=Column(String(50)), description="Status of the last execution"
    )
    consecutive_failures: int = Field(default=0, description="Number of consecutive execution failures")
    auto_disabled_at: datetime | None = Field(
        default=None, description="Timestamp when trigger was auto-disabled due to max failures"
    )


class TriggerIn(BaseModel):
    """Input model for creating triggers"""

    name: str = Field(max_length=100)
    description: str = Field(default="", max_length=1000)
    space_id: str | None = None
    project_id: str
    trigger_type: TriggerType
    custom_cron_expression: str | None = None
    listener_type: ListenerType | None = None
    agent_model: str | None = None
    task_prompt: str | None = Field(default=None, max_length=1500)
    config: dict | None = None  # Trigger-type specific config
    max_executions_per_hour: int | None = None
    max_executions_per_day: int | None = None
    is_single_execution: bool = False
    webhook_method: RequestType | None = None


class TriggerUpdate(BaseModel):
    """Model for updating triggers"""

    name: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=1000)
    space_id: str | None = None
    status: TriggerStatus | None = None
    custom_cron_expression: str | None = None
    listener_type: ListenerType | None = None
    agent_model: str | None = None
    task_prompt: str | None = Field(default=None, max_length=1500)
    config: dict | None = None  # Trigger-type specific config
    max_executions_per_hour: int | None = None
    max_executions_per_day: int | None = None
    is_single_execution: bool | None = None
    webhook_method: RequestType | None = None


class TriggerOut(BaseModel):
    """Output model for trigger responses"""

    id: int
    user_id: str
    space_id: str | None = None
    project_id: str
    name: str
    description: str
    trigger_type: TriggerType
    status: TriggerStatus
    execution_count: int = 0
    webhook_url: str | None = None
    webhook_method: RequestType | None = None
    custom_cron_expression: str | None = None
    listener_type: ListenerType | None = None
    agent_model: str | None = None
    task_prompt: str | None = None
    config: dict | None = None  # Trigger-type specific config
    max_executions_per_hour: int | None = None
    max_executions_per_day: int | None = None
    is_single_execution: bool
    last_executed_at: datetime | None = None
    next_run_at: datetime | None = None
    last_execution_status: str | None = None
    consecutive_failures: int = 0
    auto_disabled_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TriggerConfigSchemaOut(BaseModel):
    """Output model for trigger config schema."""

    trigger_type: str
    has_config: bool
    schema_: dict[str, Any] | None = None

    class Config:
        populate_by_name = True
        json_schema_extra = {"properties": {"schema": {"$ref": "#/definitions/schema_"}}}
