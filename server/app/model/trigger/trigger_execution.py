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
from typing import Optional
from sqlmodel import Field, Column, SmallInteger, JSON, String, Float
from sqlalchemy_utils import ChoiceType
from pydantic import BaseModel
from app.model.abstract.model import AbstractModel, DefaultTimes
from app.type.trigger_types import ExecutionType, ExecutionStatus


class TriggerExecution(AbstractModel, DefaultTimes, table=True):
    """Output model for execution records"""
    
    id: int = Field(default=None, primary_key=True)
    trigger_id: int = Field(foreign_key="trigger.id", index=True, description="ID of the trigger that created this execution")
    execution_id: str = Field(unique=True, index=True, description="Unique execution identifier")
    
    execution_type: ExecutionType = Field(
        sa_column=Column(ChoiceType(ExecutionType, String(50))),
        description="Type of execution (scheduled, webhook)"
    )
    status: ExecutionStatus = Field(
        default=ExecutionStatus.pending,
        sa_column=Column(ChoiceType(ExecutionStatus, String(50))),
        description="Current status of the execution"
    )
    
    # Execution timing
    started_at: Optional[datetime] = Field(
        default=None,
        description="Timestamp when execution started"
    )
    completed_at: Optional[datetime] = Field(
        default=None,
        description="Timestamp when execution completed"
    )
    duration_seconds: Optional[float] = Field(
        default=None,
        sa_column=Column(Float),
        description="Duration of execution in seconds"
    )
    
    # Execution data
    input_data: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description="Input data that triggered the execution"
    )
    output_data: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description="Output data from the execution"
    )
    error_message: Optional[str] = Field(
        default=None,
        description="Error message if execution failed"
    )
    
    # Retry configuration
    attempts: int = Field(
        default=1,
        description="Current number of retry attempts"
    )
    max_retries: int = Field(
        default=3,
        description="Maximum number of retry attempts"
    )
    
    # Resource usage tracking
    tokens_used: Optional[int] = Field(
        default=None,
        description="Number of tokens used during execution"
    )
    tools_executed: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description="Tools that were executed and their results"
    )


class TriggerExecutionIn(BaseModel):
    """Input model for creating trigger executions"""
    trigger_id: int
    execution_id: str
    execution_type: ExecutionType
    input_data: Optional[dict] = None
    max_retries: int = 3


class TriggerExecutionUpdate(BaseModel):
    """Model for updating trigger executions"""
    status: Optional[ExecutionStatus] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    output_data: Optional[dict] = None
    error_message: Optional[str] = None
    attempts: Optional[int] = None
    tokens_used: Optional[int] = None
    tools_executed: Optional[dict] = None


class TriggerExecutionOut(BaseModel):
    """Output model for execution records"""
    id: int
    trigger_id: int
    execution_id: str
    execution_type: ExecutionType
    status: ExecutionStatus
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    input_data: Optional[dict] = None
    output_data: Optional[dict] = None
    error_message: Optional[str] = None
    attempts: int
    max_retries: int
    tokens_used: Optional[int] = None
    tools_executed: Optional[dict] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None