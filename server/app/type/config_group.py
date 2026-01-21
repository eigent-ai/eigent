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
