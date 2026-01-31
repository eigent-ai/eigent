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

from sqlmodel import SQLModel, Field, Column
from sqlalchemy import JSON


class Plan(SQLModel, table=True):
    id: int = Field(default=None, primary_key=True)
    plan_key: str = Field(index=True, unique=True, description="Unique plan key")
    name: str = Field(index=True, unique=True, description="Plan name")
    price_month: float = Field(default=0, description="Monthly price")
    price_year: float = Field(default=0, description="Yearly price")
    daily_credits: int = Field(default=0, description="Daily credits")
    monthly_credits: int = Field(default=0, description="Monthly credits")
    storage_limit: int = Field(default=0, description="Cloud storage space (MB)")
    description: str = Field(default="", description="Plan description")
    is_active: bool = Field(default=True, description="Is the plan active")
    extra_config: dict = Field(default_factory=dict, sa_column=Column(JSON), description="Flexible extra config")
