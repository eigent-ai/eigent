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

from typing import Literal

from camel.toolkits import (
    CodeExecutionToolkit as BaseCodeExecutionToolkit,
    FunctionTool,
)

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit


@auto_listen_toolkit(BaseCodeExecutionToolkit)
class CodeExecutionToolkit(BaseCodeExecutionToolkit, AbstractToolkit):
    agent_name: str = Agents.developer_agent

    def __init__(
        self,
        api_task_id: str,
        sandbox: Literal[
            "internal_python", "jupyter", "docker", "subprocess", "e2b"
        ] = "subprocess",
        verbose: bool = False,
        unsafe_mode: bool = False,
        import_white_list: list[str] | None = None,
        require_confirm: bool = False,
        timeout: float | None = None,
    ) -> None:
        self.api_task_id = api_task_id
        super().__init__(
            sandbox,
            verbose,
            unsafe_mode,
            import_white_list,
            require_confirm,
            timeout,
        )

    def get_tools(self) -> list[FunctionTool]:
        return [
            FunctionTool(self.execute_code),
        ]
