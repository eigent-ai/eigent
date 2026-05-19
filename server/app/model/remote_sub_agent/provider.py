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

from pydantic import BaseModel, model_validator
from sqlalchemy import Boolean, Column, text
from sqlmodel import JSON, Field

from app.model.abstract.model import AbstractModel, DefaultTimes


class RemoteSubAgentProvider(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    provider_name: str = Field(index=True)
    enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, server_default=text("false")),
    )
    api_key: str = ""
    endpoint_url: str = ""
    agent_name: str = ""
    model_name: str = ""
    config: dict | None = Field(default=None, sa_column=Column(JSON))


class RemoteSubAgentProviderIn(BaseModel):
    provider_name: str
    enabled: bool = False
    api_key: str = ""
    endpoint_url: str = ""
    agent_name: str = ""
    model_name: str = ""
    config: dict | None = None

    @model_validator(mode="after")
    def validate_provider_config(self):
        if not self.provider_name.strip():
            raise ValueError("Remote sub agent provider requires provider_name.")

        if (
            not self.api_key.strip()
            or not self.endpoint_url.strip()
            or not self.agent_name.strip()
        ):
            raise ValueError(
                "Remote sub agent provider requires api_key, endpoint_url, "
                "and agent_name."
            )
        return self


class RemoteSubAgentProviderOut(RemoteSubAgentProviderIn):
    id: int
    user_id: int
