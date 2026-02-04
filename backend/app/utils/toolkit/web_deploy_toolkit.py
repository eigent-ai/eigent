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

import uuid
from typing import Any

from camel.toolkits import WebDeployToolkit as BaseWebDeployToolkit

from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit, listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseWebDeployToolkit)
class WebDeployToolkit(BaseWebDeployToolkit, AbstractToolkit):
    agent_name: str = Agents.developer_agent

    def __init__(
        self,
        api_task_id: str,
        timeout: float | None = None,
        add_branding_tag: bool = True,
        logo_path: str = "../../../../public/favicon.png",
        tag_text: str = "Created by Eigent",
        tag_url: str = "https://main.eigent.ai/",
        remote_server_ip: str | None = "space.eigent.ai",
        remote_server_port: int = 8080,
    ):
        self.api_task_id = api_task_id
        super().__init__(
            timeout,
            add_branding_tag,
            logo_path,
            tag_text,
            tag_url,
            remote_server_ip,
            remote_server_port,
        )

    @listen_toolkit(BaseWebDeployToolkit.deploy_html_content)
    def deploy_html_content(
        self,
        html_content: str | None = None,
        html_file_path: str | None = None,
        file_name: str = "index.html",
        port: int = 8080,
        domain: str | None = None,
        subdirectory: str | None = None,
    ) -> dict[str, Any]:
        subdirectory = str(uuid.uuid4())
        return super().deploy_html_content(
            html_content, html_file_path, file_name, port, domain, subdirectory
        )

    @listen_toolkit(BaseWebDeployToolkit.deploy_folder)
    def deploy_folder(
        self,
        folder_path: str,
        port: int = 8080,
        domain: str | None = None,
        subdirectory: str | None = None,
    ) -> dict[str, Any]:
        subdirectory = str(uuid.uuid4())
        return super().deploy_folder(folder_path, port, domain, subdirectory)
