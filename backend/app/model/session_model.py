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

"""Credential-free private Session pin carried by canonical admission input."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.workspace_config.models import ThinkingEffort


class SessionModelSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    model_category: Literal[
        "cloud", "custom", "local", "codex_subscription"
    ] = Field(alias="modelType")
    model_platform: str = Field(min_length=1, max_length=200)
    model_type: str = Field(min_length=1, max_length=512)
    cloud_model_type: str | None = Field(
        default=None, min_length=1, max_length=512
    )
    codex_model_type: str | None = Field(
        default=None, min_length=1, max_length=512
    )
    provider_id: int | None = Field(default=None, ge=1)
    model_ref: str | None = Field(
        default=None, min_length=1, max_length=1024, pattern=r"^provider://"
    )
    thinking_effort: ThinkingEffort | None = None

    @model_validator(mode="after")
    def require_binding_identity(self):
        if self.model_category == "cloud" and not self.cloud_model_type:
            raise ValueError("Cloud selection requires its catalog identity")
        if (
            self.model_category in {"custom", "local"}
            and self.provider_id is None
        ):
            raise ValueError(
                "Configured selection requires its private provider identity"
            )
        return self
