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

import json
import logging
import re
from pathlib import Path
from typing import Literal

from camel.types import ModelType, RoleType
from pydantic import BaseModel, Field, field_validator

from app.model.enums import DEFAULT_SUMMARY_PROMPT, Status  # noqa: F401

logger = logging.getLogger("chat_model")


class ChatHistory(BaseModel):
    role: RoleType
    content: str


class QuestionAnalysisResult(BaseModel):
    type: Literal["simple", "complex"] = Field(
        description="Whether this is a simple question or complex task"
    )
    answer: str | None = Field(
        default=None,
        description="Direct answer for simple questions."
        " None for complex tasks.",
    )


McpServers = dict[Literal["mcpServers"], dict[str, dict]]

PLATFORM_MAPPING = {
    "z.ai": "openai-compatible-model",
    "ModelArk": "openai-compatible-model",
}


class Chat(BaseModel):
    task_id: str
    project_id: str
    question: str
    email: str
    attaches: list[str] = []
    model_platform: str
    model_type: str
    api_key: str
    # for cloud version, user don't need to set api_url
    api_url: str | None = None
    language: str = "en"
    browser_port: int = 9222
    cdp_browsers: list[dict] = Field(default_factory=list)
    max_retries: int = 3
    allow_local_system: bool = False
    installed_mcp: McpServers = {"mcpServers": {}}
    bun_mirror: str = ""
    uvx_mirror: str = ""
    env_path: str | None = None
    summary_prompt: str = DEFAULT_SUMMARY_PROMPT
    new_agents: list["NewAgent"] = []
    # For provider-specific parameters like Azure
    extra_params: dict | None = None
    # User-specific search engine configurations
    # (e.g., GOOGLE_API_KEY, SEARCH_ENGINE_ID)
    search_config: dict[str, str] | None = None

    @field_validator("model_platform")
    @classmethod
    def map_model_platform(cls, v: str) -> str:
        return PLATFORM_MAPPING.get(v, v)

    @field_validator("model_type")
    @classmethod
    def check_model_type(cls, model_type: str):
        try:
            ModelType(model_type)
        except ValueError:
            # raise ValueError("Invalid model type")
            logger.debug("model_type is invalid")
        return model_type

    def get_bun_env(self) -> dict[str, str]:
        return (
            {"NPM_CONFIG_REGISTRY": self.bun_mirror} if self.bun_mirror else {}
        )

    def get_uvx_env(self) -> dict[str, str]:
        return (
            {
                "UV_DEFAULT_INDEX": self.uvx_mirror,
                "PIP_INDEX_URL": self.uvx_mirror,
            }
            if self.uvx_mirror
            else {}
        )

    def is_cloud(self):
        return self.api_url is not None and "44.247.171.124" in self.api_url

    def file_save_path(self, path: str | None = None):
        email = re.sub(r'[\\/*?:"<>|\s]', "_", self.email.split("@")[0]).strip(
            "."
        )
        # Use project-based structure: project_{project_id}/task_{task_id}
        save_path = (
            Path.home()
            / "eigent"
            / email
            / f"project_{self.project_id}"
            / f"task_{self.task_id}"
        )
        if path is not None:
            save_path = save_path / path
        save_path.mkdir(parents=True, exist_ok=True)

        return str(save_path)


class SupplementChat(BaseModel):
    question: str
    task_id: str | None = None
    attaches: list[str] = []


class HumanReply(BaseModel):
    agent: str
    reply: str


class TaskContent(BaseModel):
    id: str
    content: str


class UpdateData(BaseModel):
    task: list[TaskContent]


class AgentModelConfig(BaseModel):
    """Optional per-agent model configuration
    to override the default task model."""

    model_platform: str | None = None
    model_type: str | None = None
    api_key: str | None = None
    api_url: str | None = None
    extra_params: dict | None = None

    def has_custom_config(self) -> bool:
        """Check if any custom model configuration is set."""
        return any(
            [
                self.model_platform is not None,
                self.model_type is not None,
                self.api_key is not None,
                self.api_url is not None,
                self.extra_params is not None,
            ]
        )


class NewAgent(BaseModel):
    name: str
    description: str
    tools: list[str]
    mcp_tools: McpServers | None
    env_path: str | None = None
    custom_model_config: AgentModelConfig | None = None


class AddTaskRequest(BaseModel):
    content: str
    project_id: str | None = None
    task_id: str | None = None
    additional_info: dict | None = None
    insert_position: int = -1
    is_independent: bool = False


class RemoveTaskRequest(BaseModel):
    task_id: str


def sse_json(step: str, data):
    res_format = {"step": step, "data": data}
    return f"data: {json.dumps(res_format, ensure_ascii=False)}\n\n"
