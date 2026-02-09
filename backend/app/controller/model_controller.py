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

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.component.error_format import normalize_error_to_openai_format
from app.component.model_validation import create_agent
from app.model.chat import PLATFORM_MAPPING

logger = logging.getLogger("model_controller")

router = APIRouter()


class ValidateModelRequest(BaseModel):
    model_platform: str = Field("OPENAI", description="Model platform")
    model_type: str = Field("GPT_4O_MINI", description="Model type")
    api_key: str | None = Field(None, description="API key")
    url: str | None = Field(None, description="Model URL")
    model_config_dict: dict | None = Field(
        None, description="Model config dict"
    )
    extra_params: dict | None = Field(
        None, description="Extra model parameters"
    )

    @field_validator("model_platform")
    @classmethod
    def map_model_platform(cls, v: str) -> str:
        return PLATFORM_MAPPING.get(v, v)


class ValidateModelResponse(BaseModel):
    is_valid: bool = Field(..., description="Is valid")
    is_tool_calls: bool = Field(..., description="Is tool call used")
    error_code: str | None = Field(None, description="Error code")
    error: dict | None = Field(None, description="OpenAI-style error object")
    message: str = Field(..., description="Message")


@router.post("/model/validate")
async def validate_model(request: ValidateModelRequest):
    """Validate model configuration and tool call support."""
    platform = request.model_platform
    model_type = request.model_type
    has_custom_url = request.url is not None
    has_config = request.model_config_dict is not None

    logger.info(
        "Model validation started",
        extra={
            "platform": platform,
            "model_type": model_type,
            "has_url": has_custom_url,
            "has_config": has_config,
        },
    )

    # API key validation
    if request.api_key is not None and str(request.api_key).strip() == "":
        logger.warning(
            "Model validation failed: empty API key",
            extra={"platform": platform, "model_type": model_type},
        )
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Invalid key. Validation failed.",
                "error_code": "invalid_api_key",
                "error": {
                    "type": "invalid_request_error",
                    "param": None,
                    "code": "invalid_api_key",
                },
            },
        )

    try:
        extra = request.extra_params or {}

        logger.debug(
            "Creating agent for validation",
            extra={"platform": platform, "model_type": model_type},
        )
        agent = create_agent(
            platform,
            model_type,
            api_key=request.api_key,
            url=request.url,
            model_config_dict=request.model_config_dict,
            **extra,
        )

        logger.debug(
            "Agent created, executing test step",
            extra={"platform": platform, "model_type": model_type},
        )
        response = agent.step(
            input_message="""
            Get the content of https://www.camel-ai.org,
            you must use the get_website_content tool to get the content ,
            i just want to verify the get_website_content tool is working,
            you must call the get_website_content tool only once.
            """
        )

    except Exception as e:
        # Normalize error to OpenAI-style error structure
        logger.error(
            "Model validation failed",
            extra={
                "platform": platform,
                "model_type": model_type,
                "error": str(e),
            },
            exc_info=True,
        )
        message, error_code, error_obj = normalize_error_to_openai_format(e)

        raise HTTPException(
            status_code=400,
            detail={
                "message": message,
                "error_code": error_code,
                "error": error_obj,
            },
        )

    # Check validation results
    is_valid = bool(response)
    is_tool_calls = False

    if response and hasattr(response, "info") and response.info:
        tool_calls = response.info.get("tool_calls", [])
        if tool_calls and len(tool_calls) > 0:
            expected = (
                "Tool execution completed"
                " successfully for"
                " https://www.camel-ai.org,"
                " Website Content:"
                " Welcome to CAMEL AI!"
            )
            is_tool_calls = tool_calls[0].result == expected

    no_tool_msg = (
        "This model doesn't support tool calls. please try with another model."
    )
    result = ValidateModelResponse(
        is_valid=is_valid,
        is_tool_calls=is_tool_calls,
        message="Validation Success" if is_tool_calls else no_tool_msg,
        error_code=None,
        error=None,
    )

    logger.info(
        "Model validation completed",
        extra={
            "platform": platform,
            "model_type": model_type,
            "is_valid": is_valid,
            "is_tool_calls": is_tool_calls,
        },
    )

    return result


class ModelTypeSuggestionRequest(BaseModel):
    platform: str | None = Field(None, description="Model platform")
    api_key: str | None = Field(
        None, description="Optional API key for OpenAI"
    )
    api_url: str | None = Field(None, description="Optional API URL")


class ModelTypeSuggestionResponse(BaseModel):
    model_types: list[str] = Field(
        ..., description="List of available model types"
    )
    source: str = Field(
        ..., description="Source of suggestions: 'camel' or 'openai'"
    )


@router.post("/model/types")
async def get_model_types(request: ModelTypeSuggestionRequest):
    """Get available model types for a given platform.

    Returns model types from CAMEL enum filtered by platform.
    If api_key is provided for OpenAI-compatible platforms,
    also fetches available models from the API.
    """
    from camel.types import ModelType

    platform = request.platform
    api_key = request.api_key
    api_url = request.api_url

    model_types: list[str] = []
    source = "camel"

    # Platform name → model name prefixes for filtering
    PLATFORM_PREFIXES: dict[str, list[str]] = {
        "openai": ["gpt-", "o1", "o3", "o4", "chatgpt-"],
        "anthropic": ["claude-"],
        "gemini": ["gemini-"],
        "deepseek": ["deepseek"],
        "qwen": ["qwen"],
        "minimax": ["minimax"],
        "moonshot": ["moonshot", "kimi"],
        "azure": ["gpt-", "o1", "o3", "o4"],
        # These platforms can run any model → return all
        "openrouter": [],
        "bedrock": [],
        "ollama": [],
        "vllm": [],
        "sglang": [],
        "lmstudio": [],
        "modelark": [],
        "zai": [],
    }

    try:
        all_model_types = [mt.value for mt in ModelType]

        if platform:
            platform_lower = platform.lower().replace("-", "_")
            prefixes = PLATFORM_PREFIXES.get(platform_lower)

            if prefixes is not None and len(prefixes) > 0:
                # Filter model types by known prefixes for this platform
                model_types = [
                    mt
                    for mt in all_model_types
                    if any(mt.lower().startswith(p) for p in prefixes)
                ]
            else:
                # Unknown platform or open platform → return all
                model_types = all_model_types
        else:
            model_types = all_model_types

        # For OpenAI-compatible platforms with an API key,
        # also fetch live models from the API
        openai_like = {
            "openai",
            "openai_compatible_model",
            "openai-compatible-model",
            "azure",
            "openrouter",
            "lmstudio",
            "vllm",
            "sglang",
            "zai",
            "modelark",
        }
        platform_lower = (platform or "").lower().replace("-", "_")
        if api_key and platform_lower in openai_like:
            try:
                import httpx

                api_base_url = (api_url or "https://api.openai.com/v1").rstrip(
                    "/"
                )
                headers = {"Authorization": f"Bearer {api_key}"}

                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.get(
                        f"{api_base_url}/models",
                        headers=headers,
                    )
                    if response.status_code == 200:
                        data = response.json()
                        api_models = [
                            model["id"]
                            for model in data.get("data", [])
                            if model.get("id")
                        ]
                        combined = list(set(model_types + api_models))
                        model_types = sorted(combined)
                        source = "camel+api"
                        logger.info(
                            f"Fetched {len(api_models)} models from API"
                        )
                    else:
                        logger.warning(
                            f"Failed to fetch models from API: "
                            f"{response.status_code}"
                        )
            except Exception as e:
                logger.warning(f"Error fetching models from API: {e}")

        model_types = sorted(set(model_types))
        return ModelTypeSuggestionResponse(
            model_types=model_types, source=source
        )

    except Exception as e:
        logger.error(f"Error getting model types: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"message": f"Failed to get model types: {str(e)}"},
        )
