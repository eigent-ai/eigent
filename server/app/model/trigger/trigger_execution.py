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

from pydantic import BaseModel
from sqlalchemy_utils import ChoiceType
from sqlmodel import JSON, Column, Field, Float, String

from app.model.abstract.model import AbstractModel, DefaultTimes
from app.shared.types.space_types import SkipReason
from app.shared.types.trigger_types import ExecutionStatus, ExecutionType


class TriggerExecution(AbstractModel, DefaultTimes, table=True):
    """Output model for execution records"""

    id: int = Field(default=None, primary_key=True)
    trigger_id: int = Field(
        foreign_key="trigger.id", index=True, description="ID of the trigger that created this execution"
    )
    execution_id: str = Field(unique=True, index=True, description="Unique execution identifier")

    execution_type: ExecutionType = Field(
        sa_column=Column(ChoiceType(ExecutionType, String(50))), description="Type of execution (scheduled, webhook)"
    )
    status: ExecutionStatus = Field(
        default=ExecutionStatus.pending,
        sa_column=Column(ChoiceType(ExecutionStatus, String(50))),
        description="Current status of the execution",
    )

    # Execution timing
    started_at: datetime | None = Field(default=None, description="Timestamp when execution started")
    completed_at: datetime | None = Field(default=None, description="Timestamp when execution completed")
    duration_seconds: float | None = Field(
        default=None, sa_column=Column(Float), description="Duration of execution in seconds"
    )

    # Execution data
    input_data: dict | None = Field(
        default=None, sa_column=Column(JSON), description="Input data that triggered the execution"
    )
    output_data: dict | None = Field(default=None, sa_column=Column(JSON), description="Output data from the execution")
    error_message: str | None = Field(default=None, description="Error message if execution failed")
    skip_reason: SkipReason | None = Field(
        default=None, sa_column=Column(JSON), description="Structured reason for skipped or guarded executions"
    )

    # Retry configuration
    attempts: int = Field(default=1, description="Current number of retry attempts")
    max_retries: int = Field(default=3, description="Maximum number of retry attempts")

    # Resource usage tracking
    tokens_used: int | None = Field(default=None, description="Number of tokens used during execution")
    tools_executed: dict | None = Field(
        default=None, sa_column=Column(JSON), description="Tools that were executed and their results"
    )


class TriggerExecutionIn(BaseModel):
    """Input model for creating trigger executions"""

    trigger_id: int
    execution_id: str
    execution_type: ExecutionType
    input_data: dict | None = None
    max_retries: int = 3


class TriggerExecutionUpdate(BaseModel):
    """Model for updating trigger executions"""

    status: ExecutionStatus | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_seconds: float | None = None
    output_data: dict | None = None
    error_message: str | None = None
    skip_reason: SkipReason | None = None
    attempts: int | None = None
    tokens_used: int | None = None
    tools_executed: dict | None = None


class TriggerExecutionOut(BaseModel):
    """Output model for execution records"""

    id: int
    trigger_id: int
    execution_id: str
    execution_type: ExecutionType
    status: ExecutionStatus
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_seconds: float | None = None
    input_data: dict | None = None
    output_data: dict | None = None
    error_message: str | None = None
    skip_reason: SkipReason | None = None
    attempts: int
    max_retries: int
    tokens_used: int | None = None
    tools_executed: dict | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
