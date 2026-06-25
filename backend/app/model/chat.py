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
from typing import Any, Literal

from camel.types import ModelType, RoleType
from pydantic import BaseModel, Field, field_validator

from app.model.enums import DEFAULT_SUMMARY_PROMPT, Status  # noqa: F401
from app.model.model_platform import (
    NormalizedModelPlatform,
    NormalizedOptionalModelPlatform,
)
from app.remote_sub_agent.config import RemoteSubAgentConfig

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


class Chat(BaseModel):
    task_id: str
    project_id: str
    space_id: str | None = None
    run_id: str | None = None
    space_root_path: str | None = None
    workdir_mode: (
        Literal["worktree", "copy", "direct-write", "artifact-only"] | None
    ) = None
    question: str
    email: str
    attaches: list[str] = []
    model_platform: NormalizedModelPlatform
    model_type: str
    api_key: str
    # for cloud version, user don't need to set api_url
    api_url: str | None = None
    # Marker for subscription-auth providers (e.g. Codex). When set, the token
    # is NOT carried in api_key; the runtime resolves a fresh access token from
    # the desktop-local resolver instead. None => legacy api_key path (default,
    # no behavior change). See docs/models/codex-subscription-auth-review.md.
    auth_source: Literal["codex_subscription"] | None = None
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
    # User identifier for user-specific skill configurations
    user_id: str | int | None = None
    # Direct server API base URL (for example http://localhost:3001/api/v1)
    # used by standalone Brain to sync replay steps without Electron env injection.
    server_url: str | None = None
    session_mode: Literal["workforce", "single-agent"] = "workforce"
    toolkit_config: dict[str, Any] | None = None
    remote_sub_agent_config: RemoteSubAgentConfig | None = None
    # Durable Project context reconstructed from persisted runs after restart.
    # In-process follow-ups still prefer TaskLock.conversation_history.
    project_context: str | None = None

    @field_validator("model_type")
    @classmethod
    def check_model_type(cls, model_type: str):
        try:
            ModelType(model_type)
        except ValueError:
            # raise ValueError("Invalid model type")
            logger.debug("model_type is invalid")
        return model_type

    def skill_config_user_id(self) -> str | None:
        """Return the filesystem user_id used by skills-config.

        Prefer the canonical user-id-owned directory (`user_<id>`) and migrate
        the previous email-local-part config into it when possible.
        """
        legacy_user_id = re.sub(
            r'[\\/*?:"<>|\s]', "_", self.email.split("@")[0]
        ).strip(".")
        if self.user_id is not None and str(self.user_id).strip():
            sanitized_user_id = re.sub(
                r'[\\/*?:"<>|\s]', "_", str(self.user_id)
            ).strip(".")
            if sanitized_user_id:
                user_id = f"user_{sanitized_user_id}"
                try:
                    from app.service.skill_config_service import (
                        migrate_legacy_skill_config,
                    )

                    migrate_legacy_skill_config(user_id, legacy_user_id)
                except Exception as e:
                    logger.warning(
                        "Failed to migrate legacy skills config: %s", e
                    )
                return user_id
        return legacy_user_id or None

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
        if self.api_url is None:
            return False
        return any(
            marker in self.api_url
            for marker in ("eigent-proxy", "proxy.eigent.ai")
        )

    def file_save_path(self, path: str | None = None):
        legacy_owner_key = re.sub(
            r'[\\/*?:"<>|\s]', "_", self.email.split("@")[0]
        ).strip(".")
        if self.user_id is not None and str(self.user_id).strip():
            owner_key = "user_" + re.sub(
                r'[\\/*?:"<>|\s]', "_", str(self.user_id)
            ).strip(".")
        else:
            owner_key = legacy_owner_key
        run_id = self.run_id or self.task_id
        # Use project-based structure: project_{project_id}/task_{task_id}
        project_base = (
            Path.home()
            / "eigent"
            / owner_key
            / f"project_{self.project_id}"
            / f"task_{run_id}"
        )
        legacy_project_base = (
            Path.home()
            / "eigent"
            / legacy_owner_key
            / f"project_{self.project_id}"
            / f"task_{run_id}"
        )
        if (
            owner_key != legacy_owner_key
            and not project_base.exists()
            and legacy_project_base.exists()
        ):
            # Bridge old installs whose artifacts were written under
            # ~/eigent/{email_sanitized} before user_id-owned roots existed.
            project_base = legacy_project_base
        save_path = project_base / path if path is not None else project_base
        save_path.mkdir(parents=True, exist_ok=True)

        return str(save_path)


class SupplementChat(BaseModel):
    question: str
    task_id: str | None = None
    attaches: list[str] = []
    project_context: str | None = None


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

    model_platform: NormalizedOptionalModelPlatform = None
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
