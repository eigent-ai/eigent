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
from app.component.model_validation import (
    ValidationErrorType,
    ValidationStage,
    validate_model_with_details,
)
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

        logger.info(
            "Model validation completed",
            extra={
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
            },
        )

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
