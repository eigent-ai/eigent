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

from sqlmodel import Field, SQLModel, UniqueConstraint

from app.model.abstract.model import AbstractModel, DefaultTimes
from app.type.config_group import ConfigGroup


class Config(AbstractModel, DefaultTimes, table=True):
    __table_args__ = (UniqueConstraint("user_id", "config_name", name="uix_user_id_config_name"),)
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(nullable=False, index=True)
    config_name: str = Field(nullable=False)
    config_value: str = Field(nullable=False, default=None)
    config_group: str = Field(nullable=False, index=True)


class ConfigCreate(SQLModel):
    config_name: str
    config_value: str
    config_group: ConfigGroup


class ConfigUpdate(SQLModel):
    config_name: str
    config_value: str
    config_group: ConfigGroup


class ConfigOut(SQLModel):
    id: int
    user_id: int
    config_name: str
    config_value: str
    config_group: ConfigGroup


class ConfigInfo:
    configs: dict = {
        # "model_platform": {"env_vars": ["api_key"]},
        # ConfigGroup.GOOGLE_SUITE.value: {
        #     "env_vars": [],
        #     "toolkit": "",
        # },
        ConfigGroup.SLACK.value: {
            "env_vars": ["SLACK_BOT_TOKEN"],
            "toolkit": "slack_toolkit",
        },
        ConfigGroup.LARK.value: {
            "env_vars": ["LARK_APP_ID", "LARK_APP_SECRET"],
            "toolkit": "lark_toolkit",
        },
        ConfigGroup.NOTION.value: {
            "env_vars": ["MCP_REMOTE_CONFIG_DIR"],
            "toolkit": "notion_mcp_toolkit",
        },
        ConfigGroup.TWITTER.value: {
            "env_vars": [
                "TWITTER_CONSUMER_KEY",
                "TWITTER_CONSUMER_SECRET",
                "TWITTER_ACCESS_TOKEN",
                "TWITTER_ACCESS_TOKEN_SECRET",
            ],
            "toolkit": "twitter_toolkit",
        },
        ConfigGroup.WHATSAPP.value: {
            "env_vars": ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
            "toolkit": "whatsapp_toolkit",
        },
        ConfigGroup.LINKEDIN.value: {
            "env_vars": [
                "LINKEDIN_CLIENT_ID",
                "LINKEDIN_CLIENT_SECRET",
                "LINKEDIN_ACCESS_TOKEN",
                "LINKEDIN_REFRESH_TOKEN",
            ],
            "toolkit": "linkedin_toolkit",
        },
        ConfigGroup.REDDIT.value: {
            "env_vars": [
                "REDDIT_CLIENT_ID",
                "REDDIT_CLIENT_SECRET",
                "REDDIT_USER_AGENT",
            ],
            "toolkit": "reddit_toolkit",
        },
        # ConfigGroup.DISCORD.value: {
        #     "env_vars": ["DISCORD_BOT_TOKEN"],
        #     "toolkit": "discord_toolkit",
        # },
        ConfigGroup.SEARCH.value: {
            "env_vars": ["GOOGLE_API_KEY", "SEARCH_ENGINE_ID", "EXA_API_KEY"],
            "toolkit": "search_toolkit",
        },
        ConfigGroup.AUDIO_ANALYSIS.value: {
            "env_vars": [],
            "toolkit": "audio_analysis_toolkit",
        },
        ConfigGroup.CODE_EXECUTION.value: {
            "env_vars": [],
            "toolkit": "code_execution_toolkit",
        },
        ConfigGroup.CRAW4AI.value: {
            "env_vars": [],
            "toolkit": "craw4ai_toolkit",
        },
        ConfigGroup.DALLE.value: {
            "env_vars": [],
            "toolkit": "dalle_toolkit",
        },
        ConfigGroup.EDGEONE_PAGES_MCP.value: {
            "env_vars": [],
            "toolkit": "edgeone_pages_mcp_toolkit",
        },
        ConfigGroup.EXCEL.value: {
            "env_vars": [],
            "toolkit": "excel_toolkit",
        },
        ConfigGroup.FILE_WRITE.value: {
            "env_vars": [],
            "toolkit": "file_write_toolkit",
        },
        ConfigGroup.GITHUB.value: {
            "env_vars": ["GITHUB_TOKEN"],
            "toolkit": "github_toolkit",
        },
        ConfigGroup.GOOGLE_CALENDAR.value: {
            "env_vars": [
                "GOOGLE_CLIENT_ID",
                "GOOGLE_CLIENT_SECRET",
                "GOOGLE_REFRESH_TOKEN",
            ],
            "toolkit": "google_calendar_toolkit",
        },
        ConfigGroup.GOOGLE_DRIVE_MCP.value: {
            "env_vars": [],
            "toolkit": "google_drive_mcp_toolkit",
        },
        ConfigGroup.GOOGLE_GMAIL_MCP.value: {
            "env_vars": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
            "toolkit": "google_gmail_native_toolkit",
        },
        ConfigGroup.IMAGE_ANALYSIS.value: {
            "env_vars": [],
            "toolkit": "image_analysis_toolkit",
        },
        ConfigGroup.MCP_SEARCH.value: {
            "env_vars": [],
            "toolkit": "mcp_search_toolkit",
        },
        ConfigGroup.PPTX.value: {
            "env_vars": [],
            "toolkit": "pptx_toolkit",
        },
        ConfigGroup.RAG.value: {
            "env_vars": ["OPENAI_API_KEY"],
            "toolkit": "rag_toolkit",
        },
        ConfigGroup.CODEX.value: {
            "env_vars": ["OPENAI_API_KEY"],
            "toolkit": "codex_oauth",
        },
    }

    @classmethod
    def getinfo(cls):
        return cls.configs

    @classmethod
    def is_valid_group(cls, group: str) -> bool:
        return group in cls.configs

    @classmethod
    def get_group_env_vars(cls, group: str) -> list[str]:
        if not cls.is_valid_group(group):
            raise KeyError(f"Invalid group: {group}")
        return cls.configs[group]["env_vars"]

    @classmethod
    def is_valid_env_var(cls, group: str, env_var: str) -> bool:
        if not cls.is_valid_group(group):
            return False
        return env_var in cls.configs[group]["env_vars"]

    @classmethod
    def validate_env_vars(cls, group: str, env_vars: list[str]) -> tuple[bool, list[str]]:
        if not cls.is_valid_group(group):
            return False, env_vars

        valid_vars = cls.configs[group]["env_vars"]
        invalid_vars = [var for var in env_vars if var not in valid_vars]

        return len(invalid_vars) == 0, invalid_vars
