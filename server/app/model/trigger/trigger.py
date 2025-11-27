from datetime import datetime
from typing import Optional
from sqlmodel import Field, Column, SmallInteger, JSON, String, Float
from sqlalchemy_utils import ChoiceType
from pydantic import BaseModel
from app.model.abstract.model import AbstractModel, DefaultTimes
from app.type.trigger_types import TriggerType, TriggerStatus, ListenerType


class Trigger(AbstractModel, DefaultTimes, table=True):
    """Trigger model for automated task execution"""
    
    id: int = Field(default=None, primary_key=True)
    user_id: str = Field(index=True, description="User ID who owns this trigger")
    name: str = Field(description="Human readable name for the trigger")
    description: str = Field(default="", description="Description of what this trigger does")
    
    # Trigger configuration
    trigger_type: TriggerType = Field(
        sa_column=Column(ChoiceType(TriggerType, String(50))),
        description="Type of trigger (schedule, webhook, slack_trigger)"
    )
    status: TriggerStatus = Field(
        default=TriggerStatus.inactive,
        sa_column=Column(ChoiceType(TriggerStatus, SmallInteger())),
        description="Current status of the trigger"
    )
    
    # Webhook specific fields
    webhook_url: Optional[str] = Field(
        default=None,
        sa_column=Column(String(1024)),
        description="Auto-generated webhook URL for webhook triggers"
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
    
    # Agent configuration
    system_message: Optional[str] = Field(
        default=None,
        description="System message for the agent"
    )
    agent_model: Optional[str] = Field(
        default=None,
        sa_column=Column(String(100)),
        description="Model to use for the agent"
    )
    
    # Task configuration
    task_prompt: Optional[str] = Field(
        default=None,
        description="Prompt template for tasks created by this trigger"
    )
    custom_task: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description="Custom task configuration"
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
    last_execution_status: Optional[str] = Field(
        default=None,
        sa_column=Column(String(50)),
        description="Status of the last execution"
    )
    execution_count: int = Field(
        default=0,
        description="Total number of executions"
    )
    error_count: int = Field(
        default=0,
        description="Total number of failed executions"
    )


class TriggerIn(BaseModel):
    """Input model for creating triggers"""
    name: str
    description: str = ""
    trigger_type: TriggerType
    custom_cron_expression: Optional[str] = None
    listener_type: Optional[ListenerType] = None
    system_message: Optional[str] = None
    agent_model: Optional[str] = None
    task_prompt: Optional[str] = None
    custom_task: Optional[dict] = None
    max_executions_per_hour: Optional[int] = None
    max_executions_per_day: Optional[int] = None
    is_single_execution: bool = False


class TriggerUpdate(BaseModel):
    """Model for updating triggers"""
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TriggerStatus] = None
    custom_cron_expression: Optional[str] = None
    listener_type: Optional[ListenerType] = None
    system_message: Optional[str] = None
    agent_model: Optional[str] = None
    task_prompt: Optional[str] = None
    custom_task: Optional[dict] = None
    max_executions_per_hour: Optional[int] = None
    max_executions_per_day: Optional[int] = None
    is_single_execution: Optional[bool] = None


class TriggerOut(BaseModel):
    """Output model for trigger responses"""
    id: int
    user_id: str
    name: str
    description: str
    trigger_type: TriggerType
    status: TriggerStatus
    webhook_url: Optional[str] = None
    custom_cron_expression: Optional[str] = None
    listener_type: Optional[ListenerType] = None
    system_message: Optional[str] = None
    agent_model: Optional[str] = None
    task_prompt: Optional[str] = None
    custom_task: Optional[dict] = None
    max_executions_per_hour: Optional[int] = None
    max_executions_per_day: Optional[int] = None
    is_single_execution: bool
    last_executed_at: Optional[datetime] = None
    last_execution_status: Optional[str] = None
    execution_count: int
    error_count: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None