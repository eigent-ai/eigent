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
import platform

from camel.messages import BaseMessage
from camel.models import OpenAIAudioModels
from camel.toolkits import ToolkitMessageIntegration
from camel.types import ModelPlatformType

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import MULTI_MODAL_SYS_PROMPT
from app.agent.toolkit.audio_analysis_toolkit import AudioAnalysisToolkit
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.image_analysis_toolkit import ImageAnalysisToolkit

# TODO: Remove NoteTakingToolkit and use TerminalToolkit instead
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.toolkit.openai_image_toolkit import OpenAIImageToolkit
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.agent.toolkit.skill_toolkit import SkillToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.toolkit.video_download_toolkit import VideoDownloaderToolkit
from app.agent.utils import NOW_STR
from app.model.chat import Chat
from app.service.task import Agents
from app.utils.file_utils import get_working_directory


def multi_modal_agent(options: Chat):
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating multi-modal agent for project: {options.project_id} "
        f"in directory: {working_directory}"
    )

    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(
            options.project_id, Agents.multi_modal_agent
        ).send_message_to_user
    )
    video_download_toolkit = VideoDownloaderToolkit(
        options.project_id, working_directory=working_directory
    )
    video_download_toolkit = message_integration.register_toolkits(
        video_download_toolkit
    )
    image_analysis_toolkit = ImageAnalysisToolkit(options.project_id)
    image_analysis_toolkit = message_integration.register_toolkits(
        image_analysis_toolkit
    )

    terminal_toolkit = TerminalToolkit(
        options.project_id,
        agent_name=Agents.multi_modal_agent,
        working_directory=working_directory,
        safe_mode=True,
        clone_current_env=True,
    )
    terminal_toolkit = message_integration.register_toolkits(terminal_toolkit)

    note_toolkit = NoteTakingToolkit(
        options.project_id,
        Agents.multi_modal_agent,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)

    skill_toolkit = SkillToolkit(
        options.project_id,
        Agents.multi_modal_agent,
        working_directory=working_directory,
    )
    skill_toolkit = message_integration.register_toolkits(skill_toolkit)
    tools = [
        *video_download_toolkit.get_tools(),
        *image_analysis_toolkit.get_tools(),
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.multi_modal_agent
        ),
        *terminal_toolkit.get_tools(),
        *note_toolkit.get_tools(),
        *skill_toolkit.get_tools(),
    ]
    if options.is_cloud():
        # TODO: check llm has this model
        open_ai_image_toolkit = OpenAIImageToolkit(
            options.project_id,
            model="dall-e-3",
            response_format="b64_json",
            size="1024x1024",
            quality="standard",
            working_directory=working_directory,
            api_key=options.api_key,
            url=options.api_url,
        )
        open_ai_image_toolkit = message_integration.register_toolkits(
            open_ai_image_toolkit
        )
        tools = [
            *tools,
            *open_ai_image_toolkit.get_tools(),
        ]
    # Convert string model_platform to enum for comparison
    try:
        model_platform_enum = ModelPlatformType(options.model_platform.lower())
    except (ValueError, AttributeError):
        model_platform_enum = None

    if model_platform_enum == ModelPlatformType.OPENAI:
        audio_analysis_toolkit = AudioAnalysisToolkit(
            options.project_id,
            working_directory,
            OpenAIAudioModels(
                api_key=options.api_key,
                url=options.api_url,
            ),
        )
        audio_analysis_toolkit = message_integration.register_toolkits(
            audio_analysis_toolkit
        )
        tools.extend(audio_analysis_toolkit.get_tools())

    system_message = MULTI_MODAL_SYS_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
    )

    return agent_model(
        Agents.multi_modal_agent,
        BaseMessage.make_assistant_message(
            role_name="Multi Modal Agent",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            VideoDownloaderToolkit.toolkit_name(),
            AudioAnalysisToolkit.toolkit_name(),
            ImageAnalysisToolkit.toolkit_name(),
            OpenAIImageToolkit.toolkit_name(),
            HumanToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
            SearchToolkit.toolkit_name(),
            SkillToolkit.toolkit_name(),
        ],
    )
