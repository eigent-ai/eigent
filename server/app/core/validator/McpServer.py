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


from pydantic import BaseModel, ValidationError


class McpServerItem(BaseModel):
    command: str
    args: list[str]
    env: dict[str, str] | None = None


class McpServersModel(BaseModel):
    mcpServers: dict[str, McpServerItem]


class McpRemoteServer(BaseModel):
    server_name: str
    server_url: str


def validate_mcp_servers(data: dict):
    try:
        model = McpServersModel.model_validate(data)
        return True, model
    except ValidationError as e:
        return False, e.errors()


def validate_mcp_remote_servers(data: dict):
    try:
        model = McpRemoteServer.model_validate(data)
        return True, model
    except ValidationError as e:
        return False, e.errors()
