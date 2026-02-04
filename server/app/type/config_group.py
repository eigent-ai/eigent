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

from enum import Enum


class ConfigGroup(str, Enum):
    WHATSAPP = "WhatsApp"
    TWITTER = "X(Twitter)"
    LINKEDIN = "LinkedIn"
    REDDIT = "Reddit"
    SLACK = "Slack"
    LARK = "Lark"
    NOTION = "Notion"
    GOOGLE_SUITE = "GoogleSuite"
    DISCORD = "Discord"
    SEARCH = "Search"
    AUDIO_ANALYSIS = "Audio Analysis"
    CODE_EXECUTION = "Code Execution"
    CRAW4AI = "Craw4ai"
    DALLE = "Dalle"
    EDGEONE_PAGES_MCP = "Edgeone Pages MCP"
    EXCEL = "Excel"
    FILE_WRITE = "File Write"
    GITHUB = "Github"
    GOOGLE_CALENDAR = "Google Calendar"
    GOOGLE_DRIVE_MCP = "Google Drive MCP"
    GOOGLE_GMAIL_MCP = "Google Gmail"
    IMAGE_ANALYSIS = "Image Analysis"
    MCP_SEARCH = "MCP Search"
    PPTX = "PPTX"
    TERMINAL = "Terminal"

    @classmethod
    def get_all_values(cls) -> list[str]:
        return [group.value for group in cls]

    @classmethod
    def is_valid_group(cls, group: str) -> bool:
        try:
            cls(group)
            return True
        except ValueError:
            return False
