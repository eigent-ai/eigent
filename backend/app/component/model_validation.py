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

from camel.agents import ChatAgent
from camel.models import ModelFactory


def get_website_content(url: str) -> str:
    r"""Gets the content of a website.

    Args:
        url (str): The URL of the website.

    Returns:
        str: The content of the website.
    """
    return "Tool execution completed successfully for https://www.camel-ai.org, Website Content: Welcome to CAMEL AI!"


def create_agent(
    model_platform: str,
    model_type: str,
    api_key: str = None,
    url: str = None,
    model_config_dict: dict = None,
    **kwargs,
) -> ChatAgent:
    platform = model_platform
    mtype = model_type
    if mtype is None:
        raise ValueError(f"Invalid model_type: {model_type}")
    if platform is None:
        raise ValueError(f"Invalid model_platform: {model_platform}")
    model = ModelFactory.create(
        model_platform=platform,
        model_type=mtype,
        api_key=api_key,
        url=url,
        timeout=60,  # 1 minute for validation
        model_config_dict=model_config_dict,
        **kwargs,
    )
    agent = ChatAgent(
        system_message="You are a helpful assistant that must use the tool get_website_content to get the content of a website.",
        model=model,
        tools=[get_website_content],
        step_timeout=1800,  # 30 minutes
    )
    return agent
