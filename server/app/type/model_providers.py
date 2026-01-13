from enum import Enum
from typing import List


class ModelProviders(Enum):
    OPENAI = "openai"
    AWS_BEDROCK = "aws-bedrock"
    AZURE = "azure"
    ANTHROPIC = "anthropic"
    GROQ = "groq"
    OPENROUTER = "openrouter"
    OLLAMA = "ollama"
    LITELLM = "litellm"
    LMSTUDIO = "lmstudio"
    ZHIPU = "zhipuai"
    GEMINI = "gemini"
    VLLM = "vllm"
    MISTRAL = "mistral"
    REKA = "reka"
    TOGETHER = "together"
    STUB = "stub"
    OPENAI_COMPATIBLE_MODEL = "openai-compatible-model"
    SAMBA = "samba-nova"
    COHERE = "cohere"
    YI = "lingyiwanwu"
    QWEN = "tongyi-qianwen"
    NVIDIA = "nvidia"
    DEEPSEEK = "deepseek"
    PPIO = "ppio"
    SGLANG = "sglang"
    INTERNLM = "internlm"
    MOONSHOT = "moonshot"
    MODELSCOPE = "modelscope"
    SILICONFLOW = "siliconflow"
    AIML = "aiml"
    VOLCANO = "volcano"
    NETMIND = "netmind"
    NOVITA = "novita"
    WATSONX = "watsonx"
    MINIMAX = "minimax"

    @classmethod
    def get_all_values(cls) -> List[str]:
        return [platform.value for platform in cls]

    @classmethod
    def get_all_names(cls) -> List[str]:
        return [platform.name for platform in cls]

    @classmethod
    def get_all_items(cls) -> List[dict]:
        return [{"name": platform.name, "value": platform.value} for platform in cls]

    @classmethod
    def is_valid_platform(cls, platform_name: str) -> bool:
        try:
            cls(platform_name)
            return True
        except ValueError:
            return False

    @classmethod
    def get_platform_by_name(cls, platform_name: str) -> "ModelPlatformType":
        return cls(platform_name)
