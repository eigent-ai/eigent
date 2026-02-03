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
from pathlib import Path

from pydantic import BaseModel

from app.model.chat import Chat


class Env(BaseModel):
    # TODO: add more environment variables
    # TODO: allow specifying files in the directory
    files: list[str] = []
    browser_port: int = 9222


class Tests(BaseModel):
    verifier: list[str] = []


class BenchmarkData(BaseModel):
    name: str
    question: str
    env: Env = Env()
    _chat: Chat | None = None

    def to_chat(self, **model_kwargs) -> Chat:
        self._chat = Chat(
            task_id=f"benchmark_{self.name}",
            project_id=f"benchmark_{self.name}",
            email="benchmark@eigent.ai",
            question=self.question,
            browser_port=self.env.browser_port,
            **model_kwargs,
        )
        return self._chat

    def get_working_directory(self, **model_kwargs) -> str:
        chat = self._chat or self.to_chat(**model_kwargs)
        return chat.file_save_path()


class BenchmarkConfig(BaseModel):
    data: BenchmarkData
    tests: Tests = Tests()

    @classmethod
    def from_json(cls, path: str | Path) -> "BenchmarkConfig":
        with open(path) as f:
            return cls.model_validate(json.load(f))
