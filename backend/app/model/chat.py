from enum import Enum
import json
from pathlib import Path
import re
from typing import Literal
from pydantic import BaseModel, Field, field_validator
from camel.types import ModelType, RoleType
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("chat_model")


class Status(str, Enum):
    confirming = "confirming"
    confirmed = "confirmed"
    processing = "processing"
    done = "done"


class ChatHistory(BaseModel):
    role: RoleType
    content: str


class QuestionAnalysisResult(BaseModel):
    type: Literal["simple", "complex"] = Field(
        description="Whether this is a simple question or complex task"
    )
    answer: str | None = Field(
        default=None,
        description="Direct answer for simple questions. None for complex tasks."
    )


McpServers = dict[Literal["mcpServers"], dict[str, dict]]


class Chat(BaseModel):
    task_id: str
    project_id: str
    question: str
    email: str
    attaches: list[str] = []
    model_platform: str
    model_type: str
    api_key: str
    api_url: str | None = None  # for cloud version, user don't need to set api_url
    language: str = "en"
    browser_port: int = 9222
    max_retries: int = 3
    allow_local_system: bool = False
    installed_mcp: McpServers = {"mcpServers": {}}
    bun_mirror: str = ""
    uvx_mirror: str = ""
    env_path: str | None = None
    summary_prompt: str = (
        "After completing the task, please generate a summary of the entire task completion. "
        "The summary must be enclosed in <summary></summary> tags and include:\n"
        "1. A confirmation of task completion, referencing the original goal.\n"
        "2. A high-level overview of the work performed and the final outcome.\n"
        "3. A bulleted list of key results or accomplishments.\n"
        "Adopt a confident and professional tone."
    )
    new_agents: list["NewAgent"] = []
    extra_params: dict | None = None  # For provider-specific parameters like Azure

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
        return {"NPM_CONFIG_REGISTRY": self.bun_mirror} if self.bun_mirror else {}

    def get_uvx_env(self) -> dict[str, str]:
        return {"UV_DEFAULT_INDEX": self.uvx_mirror, "PIP_INDEX_URL": self.uvx_mirror} if self.uvx_mirror else {}

    def is_cloud(self):
        return self.api_url is not None and "44.247.171.124" in self.api_url

    def file_save_path(self, path: str | None = None):
        email = re.sub(r'[\\/*?:"<>|\s]', "_", self.email.split("@")[0]).strip(".")
        # Use project-based structure: project_{project_id}/task_{task_id}
        save_path = Path.home() / "eigent" / email / f"project_{self.project_id}" / f"task_{self.task_id}"
        if path is not None:
            save_path = save_path / path
        save_path.mkdir(parents=True, exist_ok=True)

        return str(save_path)


class SupplementChat(BaseModel):
    question: str
    task_id: str | None = None


class HumanReply(BaseModel):
    agent: str
    reply: str


class TaskContent(BaseModel):
    id: str
    content: str


class UpdateData(BaseModel):
    task: list[TaskContent]


class NewAgent(BaseModel):
    name: str
    description: str
    tools: list[str]
    mcp_tools: McpServers | None
    env_path: str | None = None


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
