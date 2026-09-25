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

"""Production construction for the registered private-file Workforce profile."""

from app.agent.agent_model import agent_model
from app.service.task import Agents
from app.utils.managed_workforce import ManagedFileWorker, ManagedWorkforce
from app.workspace_runtime.agent_adapter import ManagedAgentExecution


def construct_managed_workforce(options, execution):
    execution.authorize()
    root = execution.runtime.binding.workspace.local_root
    constraint = (
        f"Work only in the private workspace {root}. "
        "Only the supplied read_file/write_to_file tools are available. "
        "No terminal, browser, MCP, external delegation, skills or human interaction. "
        "Use existing parent directories; coordinate dependencies before reading another worker's output."
    )

    def create(name, role, files=False):
        resources = execution.create_resources()
        tools = (
            ManagedAgentExecution(
                execution.runtime, resources, options.project_id
            )
            .assemble(options)
            .tools
            if files
            else []
        )
        agent = agent_model(
            name,
            role + "\n" + constraint,
            options,
            tools,
            managed_resources=resources,
        )
        agent.process_task_id = options.task_id
        execution.agents.append(agent)
        return agent

    coordinator = create(
        Agents.coordinator_agent,
        "Coordinate only the two declared file workers.",
    )
    planner = create(
        Agents.task_agent,
        "Decompose the requested private-file task into at most 16 concrete tasks.",
    )
    workers = [
        ManagedFileWorker(
            description,
            create(name, description, files=True),
            execution,
        )
        for name, description in (
            (
                "managed_file_author",
                "File author: read and write UTF-8 files using the supplied tools.",
            ),
            (
                "managed_file_editor",
                "File editor: read, verify and revise UTF-8 files using the supplied tools.",
            ),
        )
    ]
    return ManagedWorkforce(options, execution, coordinator, planner, workers)
