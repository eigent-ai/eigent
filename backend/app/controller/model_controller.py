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

import httpx
from camel.types import ModelType
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.component.error_format import normalize_error_to_openai_format
from app.component.model_validation import (
    ValidationErrorType,
    ValidationStage,
    validate_model_with_details,
)
from app.model.chat import PLATFORM_MAPPING

logger = logging.getLogger("model_controller")


router = APIRouter()

# Constants
DEFAULT_OPENAI_API_URL = "https://api.openai.com/v1"

# Platform names that support OpenAI-compatible API endpoints
# Note: Platform names are normalized (lowercase, hyphens → underscores)
OPENAI_COMPATIBLE_PLATFORMS = {
    "openai",
    "openai_compatible_model",
    "azure",
    "openrouter",
    "lmstudio",
    "vllm",
    "sglang",
    "zai",
    "modelark",
}

# Maps platform names to model name prefixes for filtering
# Empty list means the platform can run any model
MODEL_PREFIXES: dict[str, list[str]] = {
    "openai": ["gpt-", "o1", "o3", "o4", "chatgpt-"],
    "anthropic": ["claude-"],
    "gemini": ["gemini-"],
    "deepseek": ["deepseek"],
    "qwen": ["qwen"],
    "minimax": ["minimax"],
    "moonshot": ["moonshot", "kimi"],
    "azure": ["gpt-", "o1", "o3", "o4"],
    # These platforms can run any model → return all
    "openai_compatible_model": [],
    "openrouter": [],
    "bedrock": [],
    "ollama": [],
    "vllm": [],
    "sglang": [],
    "lmstudio": [],
    "modelark": [],
    "zai": [],
}


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
    include_diagnostics: bool = Field(
        False, description="Include detailed diagnostic information"
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
    error_type: str | None = Field(None, description="Detailed error type")
    failed_stage: str | None = Field(
        None, description="Stage where validation failed"
    )
    successful_stages: list[str] | None = Field(
        None, description="Stages that succeeded"
    )
    diagnostic_info: dict | None = Field(
        None, description="Diagnostic information"
    )
    model_response_info: dict | None = Field(
        None, description="Model response information"
    )
    tool_call_info: dict | None = Field(
        None, description="Tool call information"
    )
    validation_stages: dict[str, bool] | None = Field(
        None, description="Validation stages status"
    )


@router.post("/model/validate")
async def validate_model(request: ValidateModelRequest):
    """Validate model configuration and tool call support with detailed error messages.

    This endpoint validates a model configuration and provides detailed error messages
    to help users understand the root cause of validation failures. It checks:
    1. Initialization (model type and platform)
    2. Model creation (authentication, network, model availability)
    3. Agent creation
    4. Model call execution
    5. Tool call execution

    Returns detailed diagnostic information if include_diagnostics is True.
    """
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
            "include_diagnostics": request.include_diagnostics,
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
                "message": "Invalid key. Validation failed. Please provide a valid API key.",
                "error_code": "invalid_api_key",
                "error_type": ValidationErrorType.AUTHENTICATION_ERROR.value,
                "failed_stage": ValidationStage.INITIALIZATION.value,
                "error": {
                    "type": "invalid_request_error",
                    "param": "api_key",
                    "code": "invalid_api_key",
                    "message": "API key cannot be empty. Please provide a valid API key.",
                },
            },
        )

    try:
        extra = request.extra_params or {}

        logger.debug(
            "Starting detailed model validation",
            extra={"platform": platform, "model_type": model_type},
        )
        validation_result = validate_model_with_details(
            platform,
            model_type,
            api_key=request.api_key,
            url=request.url,
            model_config_dict=request.model_config_dict,
            **extra,
        )

        # Build response message based on validation result
        # Prefer raw error messages from providers as they are usually clear and informative
        if validation_result.is_tool_calls:
            message = "Validation successful. Model supports tool calling and tool execution completed successfully."
        elif validation_result.is_valid:
            if (
                validation_result.error_type
                == ValidationErrorType.TOOL_CALL_NOT_SUPPORTED
            ):
                message = "Model call succeeded, but this model does not support tool calling functionality. Please try with another model that supports tool calls."
            elif (
                validation_result.error_type
                == ValidationErrorType.TOOL_CALL_EXECUTION_FAILED
            ):
                # Use raw error message if available, otherwise use the formatted one
                message = (
                    validation_result.raw_error_message
                    or validation_result.error_message
                    or "Tool call execution failed."
                )
            else:
                message = (
                    validation_result.raw_error_message
                    or validation_result.error_message
                    or "Model call succeeded, but tool call validation failed. Please check the model configuration."
                )
        else:
            # Use raw error message as primary message - provider errors are usually clear
            # Only add context for specific cases where it's helpful
            if validation_result.raw_error_message:
                message = validation_result.raw_error_message
            elif validation_result.error_message:
                message = validation_result.error_message
            else:
                message = "Model validation failed. Please check your configuration and try again."

        # Convert error type to error code for backward compatibility
        error_code = None
        error_obj = None

        if validation_result.error_type:
            error_code = validation_result.error_type.value

            # Create OpenAI-style error object
            error_obj = {
                "type": "invalid_request_error",
                "param": None,
                "code": validation_result.error_type.value,
                "message": validation_result.error_message or message,
            }

            # Add specific error details if available
            if validation_result.error_details:
                error_obj["details"] = validation_result.error_details

        # Build response
        response_data = {
            "is_valid": validation_result.is_valid,
            "is_tool_calls": validation_result.is_tool_calls,
            "error_code": error_code,
            "error": error_obj,
            "message": message,
        }

        # Include detailed diagnostic information if requested
        if request.include_diagnostics:
            response_data["error_type"] = (
                validation_result.error_type.value
                if validation_result.error_type
                else None
            )
            response_data["failed_stage"] = (
                validation_result.failed_stage.value
                if validation_result.failed_stage
                else None
            )
            response_data["successful_stages"] = [
                stage.value for stage in validation_result.successful_stages
            ]
            response_data["diagnostic_info"] = (
                validation_result.diagnostic_info
            )
            response_data["model_response_info"] = (
                validation_result.model_response_info
            )
            response_data["tool_call_info"] = validation_result.tool_call_info
            response_data["validation_stages"] = {
                stage.value: success
                for stage, success in validation_result.validation_stages.items()
            }

        result = ValidateModelResponse(**response_data)

        # Use error or warning log level if there's an issue
        log_extra = {
            "platform": platform,
            "model_type": model_type,
            "is_valid": validation_result.is_valid,
            "is_tool_calls": validation_result.is_tool_calls,
            "error_type": validation_result.error_type.value
            if validation_result.error_type
            else None,
            "failed_stage": validation_result.failed_stage.value
            if validation_result.failed_stage
            else None,
        }

        if not validation_result.is_valid:
            logger.error("Model validation completed", extra=log_extra)
        elif validation_result.error_type:
            logger.warning("Model validation completed", extra=log_extra)
        else:
            logger.info("Model validation completed", extra=log_extra)

        return result

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Fallback error handling for unexpected errors
        logger.error(
            "Unexpected error during model validation",
            extra={
                "platform": platform,
                "model_type": model_type,
                "error": str(e),
            },
            exc_info=True,
        )

        message, error_code, error_obj = normalize_error_to_openai_format(e)

        raise HTTPException(
            status_code=500,
            detail={
                "message": f"Unexpected error during validation: {message}",
                "error_code": error_code or "internal_error",
                "error": error_obj
                or {
                    "type": "internal_error",
                    "message": str(e),
                },
            },
        )


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
    platform = request.platform
    api_key = request.api_key
    api_url = request.api_url

    model_types: list[str] = []
    source = "camel"

    # Normalize platform name once: lowercase and replace hyphens with underscores
    # This is needed because some platforms use hyphens (e.g., "openai-compatible-model")
    # but Python dict keys use underscores for consistency
    platform_lower = (platform or "").lower().replace("-", "_")

    try:
        all_model_types = [mt.value for mt in ModelType]

        if platform_lower:
            prefixes = MODEL_PREFIXES.get(platform_lower)

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
        if api_key and platform_lower in OPENAI_COMPATIBLE_PLATFORMS:
            try:
                api_base_url = (api_url or DEFAULT_OPENAI_API_URL).rstrip("/")
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
