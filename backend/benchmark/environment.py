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
import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv
from pydantic import BaseModel

from app.model.chat import Chat, McpServers

# Load benchmark env files (.env takes priority over .env.development)
_BENCHMARK_DIR = Path(__file__).resolve().parent
load_dotenv(_BENCHMARK_DIR / ".env")
load_dotenv(_BENCHMARK_DIR / ".env.development")


class Env(BaseModel):
    # TODO: add more environment variables
    # TODO: allow specifying files in the directory
    files: list[str] = []
    browser_port: int = 9222
    installed_mcp: McpServers = {"mcpServers": {}}
    env_file: str | None = None


class Tests(BaseModel):
    grader: list[str] = []
    checker: list[str] = []


class ModelKwargs(BaseModel):
    model_platform: str = os.environ.get("BENCHMARK_MODEL_PLATFORM", "openai")
    model_type: str = os.environ.get("BENCHMARK_MODEL_TYPE", "gpt-5.2")
    api_key: str | None = os.environ.get("BENCHMARK_API_KEY")
    api_url: str = os.environ.get(
        "BENCHMARK_API_URL", "https://api.openai.com/v1"
    )


class Metadata(BaseModel):
    difficulty: str = ""
    description: str = ""
    tags: list[str] = []


class BenchmarkData(BaseModel):
    name: str
    question: str
    env: Env = Env()
    _chat: Chat | None = None

    def to_chat(self, model_kwargs: ModelKwargs) -> Chat:
        installed_mcp = self.env.installed_mcp
        if self.env.env_file:
            env_vars = dotenv_values(self.env.env_file)
            for server_cfg in installed_mcp["mcpServers"].values():
                server_env = server_cfg.get("env", {})
                server_env.update(env_vars)
                server_cfg["env"] = server_env

        api_key = (
            model_kwargs.api_key
            or os.environ.get("BENCHMARK_API_KEY")
            or os.environ["OPENAI_API_KEY"]
        )

        self._chat = Chat(
            task_id=f"benchmark_{self.name}",
            project_id=f"benchmark_{self.name}",
            email="benchmark@eigent.ai",
            question=self.question,
            model_platform=model_kwargs.model_platform,
            model_type=model_kwargs.model_type,
            api_key=api_key,
            api_url=model_kwargs.api_url,
            browser_port=self.env.browser_port,
            installed_mcp=installed_mcp,
        )
        return self._chat

    def get_working_directory(self, model_kwargs: ModelKwargs) -> str:
        chat = self._chat or self.to_chat(model_kwargs)
        return chat.file_save_path()


class BenchmarkConfig(BaseModel):
    metadata: Metadata = Metadata()
    data: BenchmarkData
    model_kwargs: ModelKwargs = ModelKwargs()
    tests: Tests = Tests()

    @classmethod
    def from_json(cls, path: str | Path) -> "BenchmarkConfig":
        with open(path) as f:
            return cls.model_validate(json.load(f))
