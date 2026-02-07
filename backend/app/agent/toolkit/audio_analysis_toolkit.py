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

import os

from camel.models import BaseAudioModel, BaseModelBackend
from camel.toolkits import AudioAnalysisToolkit as BaseAudioAnalysisToolkit

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit


@auto_listen_toolkit(BaseAudioAnalysisToolkit)
class AudioAnalysisToolkit(BaseAudioAnalysisToolkit, AbstractToolkit):
    agent_name: str = Agents.multi_modal_agent

    def __init__(
        self,
        api_task_id: str,
        cache_dir: str | None = None,
        transcribe_model: BaseAudioModel | None = None,
        audio_reasoning_model: BaseModelBackend | None = None,
        timeout: float | None = None,
    ):
        if cache_dir is None:
            cache_dir = env(
                "file_save_path", os.path.expanduser("~/.eigent/tmp/")
            )
        super().__init__(
            cache_dir, transcribe_model, audio_reasoning_model, timeout
        )
        self.api_task_id = api_task_id
