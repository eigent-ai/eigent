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
from typing import Any, Dict, Optional
from sqlmodel import Field, Column, SmallInteger, JSON, String
from sqlalchemy_utils import ChoiceType
from pydantic import BaseModel
from app.model.abstract.model import AbstractModel, DefaultTimes
from app.type.trigger_types import TriggerType, TriggerStatus, ListenerType, RequestType


class Trigger(AbstractModel, DefaultTimes, table=True):
    """Trigger model for automated task execution"""
    
    id: int = Field(default=None, primary_key=True)
    user_id: str = Field(index=True, description="User ID who owns this trigger")
    project_id: str = Field(index=True, description="Project ID this trigger belongs to")
    name: str = Field(max_length=100, description="Human readable name for the trigger")
    description: str = Field(default="", max_length=1000, description="Description of what this trigger does")
    
    # Trigger configuration
    trigger_type: TriggerType = Field(
        sa_column=Column(ChoiceType(TriggerType, String(50))),
        description="Type of trigger (schedule, webhook, slack_trigger)"
    )
    status: TriggerStatus = Field(
        default=TriggerStatus.inactive,
        sa_column=Column(ChoiceType(TriggerStatus, String(50))),
        description="Current status of the trigger"
    )
    
    # Webhook specific fields
    webhook_url: Optional[str] = Field(
        default=None,
        sa_column=Column(String(1024)),
        description="Auto-generated webhook URL for webhook triggers"
    )
    webhook_method: Optional[RequestType] = Field(
        default=None,
        sa_column=Column(ChoiceType(RequestType, String(50))),
        description="Http/s Request Type"
    )
    
    # Schedule specific fields
    custom_cron_expression: Optional[str] = Field(
        default=None,
        sa_column=Column(String(100)),
        description="Custom cron expression for scheduled triggers"
    )
    
    # Listener configuration
    listener_type: Optional[ListenerType] = Field(
        default=None,
        sa_column=Column(ChoiceType(ListenerType, String(50))),
        description="Type of listener (workforce, chat_agent)"
    )
    
    agent_model: Optional[str] = Field(
        default=None,
        sa_column=Column(String(100)),
        description="Model to use for the agent"
    )
    
    # Task configuration
    task_prompt: Optional[str] = Field(
        default=None,
        max_length=1500,
        description="Prompt template for tasks created by this trigger"
    )
    
    # Trigger-type specific configuration (validated based on trigger_type)
    config: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description="Trigger-type specific configuration (e.g., SlackTriggerConfig)"
    )
    
    # Execution limits
    max_executions_per_hour: Optional[int] = Field(
        default=None,
        description="Maximum executions allowed per hour"
    )
    max_executions_per_day: Optional[int] = Field(
        default=None,
        description="Maximum executions allowed per day"
    )
    is_single_execution: bool = Field(
        default=False,
        description="Whether this trigger should only execute once"
    )
    
    # Execution tracking
    last_executed_at: Optional[datetime] = Field(
        default=None,
        description="Timestamp of last execution"
    )
    next_run_at: Optional[datetime] = Field(
        default=None,
        index=True,
        description="Timestamp of next scheduled execution"
    )
    last_execution_status: Optional[str] = Field(
        default=None,
        sa_column=Column(String(50)),
        description="Status of the last execution"
    )
    consecutive_failures: int = Field(
        default=0,
        description="Number of consecutive execution failures"
    )
    auto_disabled_at: Optional[datetime] = Field(
        default=None,
        description="Timestamp when trigger was auto-disabled due to max failures"
    )


class TriggerIn(BaseModel):
    """Input model for creating triggers"""
    name: str = Field(max_length=100)
    description: str = Field(default="", max_length=1000)
    project_id: str
    trigger_type: TriggerType
    custom_cron_expression: Optional[str] = None
    listener_type: Optional[ListenerType] = None
    agent_model: Optional[str] = None
    task_prompt: Optional[str] = Field(default=None, max_length=1500)
    config: Optional[dict] = None  # Trigger-type specific config
    max_executions_per_hour: Optional[int] = None
    max_executions_per_day: Optional[int] = None
    is_single_execution: bool = False
    webhook_method: Optional[RequestType] = None


class TriggerUpdate(BaseModel):
    """Model for updating triggers"""
    name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = Field(default=None, max_length=1000)
    status: Optional[TriggerStatus] = None
    custom_cron_expression: Optional[str] = None
    listener_type: Optional[ListenerType] = None
    agent_model: Optional[str] = None
    task_prompt: Optional[str] = Field(default=None, max_length=1500)
    config: Optional[dict] = None  # Trigger-type specific config
    max_executions_per_hour: Optional[int] = None
    max_executions_per_day: Optional[int] = None
    is_single_execution: Optional[bool] = None
    webhook_method: Optional[RequestType] = None


class TriggerOut(BaseModel):
    """Output model for trigger responses"""
    id: int
    user_id: str
    project_id: str
    name: str
    description: str
    trigger_type: TriggerType
    status: TriggerStatus
    execution_count: int = 0
    webhook_url: Optional[str] = None
    webhook_method: Optional[RequestType] = None
    custom_cron_expression: Optional[str] = None
    listener_type: Optional[ListenerType] = None
    agent_model: Optional[str] = None
    task_prompt: Optional[str] = None
    config: Optional[dict] = None  # Trigger-type specific config
    max_executions_per_hour: Optional[int] = None
    max_executions_per_day: Optional[int] = None
    is_single_execution: bool
    last_executed_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    last_execution_status: Optional[str] = None
    consecutive_failures: int = 0
    auto_disabled_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    

class TriggerConfigSchemaOut(BaseModel):
    """Output model for trigger config schema."""
    trigger_type: str
    has_config: bool
    schema_: Optional[Dict[str, Any]] = None
    
    class Config:   
        populate_by_name = True
        json_schema_extra = {
            "properties": {
                "schema": {"$ref": "#/definitions/schema_"}
            }
        }
