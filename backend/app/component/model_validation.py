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
import traceback
from enum import Enum
from typing import Any

from camel.agents import ChatAgent
from camel.models import ModelFactory, ModelProcessingError

logger = logging.getLogger("model_validation")

# Expected result from tool execution for validation
EXPECTED_TOOL_RESULT = "Tool execution completed successfully for https://www.camel-ai.org, Website Content: Welcome to CAMEL AI!"


class ValidationStage(str, Enum):
    """Stages of model validation process."""

    INITIALIZATION = "initialization"
    MODEL_CREATION = "model_creation"
    AGENT_CREATION = "agent_creation"
    MODEL_CALL = "model_call"
    TOOL_CALL_EXECUTION = "tool_call_execution"
    RESPONSE_PARSING = "response_parsing"


class ValidationErrorType(str, Enum):
    """Types of validation errors."""

    AUTHENTICATION_ERROR = "authentication_error"
    NETWORK_ERROR = "network_error"
    MODEL_NOT_FOUND = "model_not_found"
    RATE_LIMIT_ERROR = "rate_limit_error"
    QUOTA_EXCEEDED = "quota_exceeded"
    TIMEOUT_ERROR = "timeout_error"
    TOOL_CALL_NOT_SUPPORTED = "tool_call_not_supported"
    TOOL_CALL_EXECUTION_FAILED = "tool_call_execution_failed"
    INVALID_CONFIGURATION = "invalid_configuration"
    UNKNOWN_ERROR = "unknown_error"


class ValidationResult:
    """Detailed validation result with diagnostic information."""

    def __init__(self):
        self.is_valid: bool = False
        self.is_tool_calls: bool = False
        self.error_type: ValidationErrorType | None = None
        self.error_code: str | None = None
        self.error_message: str | None = None
        self.error_details: dict[str, Any] = {}
        self.validation_stages: dict[ValidationStage, bool] = {}
        self.diagnostic_info: dict[str, Any] = {}
        self.successful_stages: list[ValidationStage] = []
        self.failed_stage: ValidationStage | None = None
        self.model_response_info: dict[str, Any] | None = None
        self.tool_call_info: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert validation result to dictionary."""
        return {
            "is_valid": self.is_valid,
            "is_tool_calls": self.is_tool_calls,
            "error_type": self.error_type.value if self.error_type else None,
            "error_code": self.error_code,
            "error_message": self.error_message,
            "error_details": self.error_details,
            "validation_stages": {
                stage.value: success
                for stage, success in self.validation_stages.items()
            },
            "diagnostic_info": self.diagnostic_info,
            "successful_stages": [
                stage.value for stage in self.successful_stages
            ],
            "failed_stage": self.failed_stage.value
            if self.failed_stage
            else None,
            "model_response_info": self.model_response_info,
            "tool_call_info": self.tool_call_info,
        }


def get_website_content(url: str) -> str:
    r"""Gets the content of a website.

    Args:
        url (str): The URL of the website.

    Returns:
        str: The content of the website.
    """
    return EXPECTED_TOOL_RESULT


def categorize_error(
    exception: Exception, stage: ValidationStage
) -> ValidationErrorType:
    """Categorize exception into specific error type.

    This function attempts to categorize errors from various model platforms/providers
    (OpenAI, Anthropic, LiteLLM, Qwen, etc.) into standardized error types.

    Args:
        exception: The exception to categorize
        stage: The validation stage where error occurred

    Returns:
        ValidationErrorType: The categorized error type
    """
    error_str = str(exception).lower()
    error_type = exception.__class__.__name__.lower()
    exception_type_str = str(type(exception)).lower()

    # First, check exception type for common patterns
    # This helps catch errors from different providers that use standard exception types
    if "timeout" in error_type or "timeouterror" in exception_type_str:
        return ValidationErrorType.TIMEOUT_ERROR

    if "connection" in error_type or "connectionerror" in exception_type_str:
        return ValidationErrorType.NETWORK_ERROR

    if "authentication" in error_type or "autherror" in exception_type_str:
        return ValidationErrorType.AUTHENTICATION_ERROR

    # Check for ModelProcessingError from camel-ai, which wraps provider-specific errors
    if isinstance(exception, ModelProcessingError):
        # ModelProcessingError often contains provider-specific error messages
        if "timeout" in error_str or "timed out" in error_str:
            return ValidationErrorType.TIMEOUT_ERROR
        if any(
            keyword in error_str
            for keyword in [
                "authentication",
                "unauthorized",
                "401",
                "invalid_api_key",
                "api key",
            ]
        ):
            return ValidationErrorType.AUTHENTICATION_ERROR
        if any(
            keyword in error_str
            for keyword in [
                "not found",
                "404",
                "model_not_found",
                "does not exist",
            ]
        ):
            return ValidationErrorType.MODEL_NOT_FOUND
        if any(
            keyword in error_str
            for keyword in ["rate limit", "429", "too many requests"]
        ):
            return ValidationErrorType.RATE_LIMIT_ERROR
        if any(
            keyword in error_str
            for keyword in [
                "quota",
                "insufficient_quota",
                "billing",
                "payment",
            ]
        ):
            return ValidationErrorType.QUOTA_EXCEEDED
        if any(
            keyword in error_str
            for keyword in [
                "connection",
                "network",
                "dns",
                "resolve",
                "refused",
            ]
        ):
            return ValidationErrorType.NETWORK_ERROR

    # Authentication errors - check for various provider-specific patterns
    auth_keywords = [
        "invalid_api_key",
        "incorrect api key",
        "api key is invalid",
        "unauthorized",
        "authentication failed",
        "authentication error",
        "401",
        "invalid key",
        "api key required",
        "missing api key",
        "authentication required",
    ]
    if any(keyword in error_str for keyword in auth_keywords):
        return ValidationErrorType.AUTHENTICATION_ERROR

    # Network errors - check before timeout to avoid misclassification
    network_keywords = [
        "connection",
        "network",
        "dns",
        "resolve",
        "refused",
        "connection refused",
        "connection error",
        "network error",
        "connection timeout",  # This is network-related, not just timeout
    ]
    if any(keyword in error_str for keyword in network_keywords):
        # Distinguish between network timeout and general timeout
        if "timeout" in error_str and "connection" in error_str:
            return ValidationErrorType.NETWORK_ERROR
        if "timeout" in error_str:
            return ValidationErrorType.TIMEOUT_ERROR
        return ValidationErrorType.NETWORK_ERROR

    # Model not found errors - check for various provider-specific patterns
    model_not_found_keywords = [
        "model_not_found",
        "model does not exist",
        "model not found",
        "does not exist",
        "not found",
        "404",
        "invalid model",
        "model name",
        "unknown model",
        "model unavailable",
    ]
    if any(keyword in error_str for keyword in model_not_found_keywords):
        return ValidationErrorType.MODEL_NOT_FOUND

    # Rate limit errors - check before quota to avoid misclassification
    rate_limit_keywords = [
        "rate limit",
        "rate_limit",
        "429",
        "too many requests",
        "rate limit exceeded",
        "requests per minute",
        "requests per hour",
    ]
    if any(keyword in error_str for keyword in rate_limit_keywords):
        return ValidationErrorType.RATE_LIMIT_ERROR

    # Quota errors
    quota_keywords = [
        "quota",
        "insufficient_quota",
        "quota exceeded",
        "billing",
        "payment",
        "payment required",
        "account limit",
        "usage limit",
    ]
    if any(keyword in error_str for keyword in quota_keywords):
        return ValidationErrorType.QUOTA_EXCEEDED

    # Timeout errors - check after network to avoid misclassification
    timeout_keywords = [
        "timeout",
        "timed out",
        "time out",
        "request timeout",
        "read timeout",
    ]
    if any(keyword in error_str for keyword in timeout_keywords):
        return ValidationErrorType.TIMEOUT_ERROR

    # Configuration errors - use specific phrases to avoid false positives
    # Check for configuration-related errors with more specific keywords
    config_keywords = [
        "invalid configuration",
        "invalid config",
        "configuration error",
        "config error",
        "invalid parameter",
        "invalid param",
        "parameter error",
        "param error",
        "missing required",
        "required parameter",
        "required param",
    ]
    if any(keyword in error_str for keyword in config_keywords):
        return ValidationErrorType.INVALID_CONFIGURATION

    return ValidationErrorType.UNKNOWN_ERROR


def create_agent(
    model_platform: str,
    model_type: str,
    api_key: str = None,
    url: str = None,
    model_config_dict: dict = None,
    **kwargs,
) -> ChatAgent:
    """Create an agent for model validation.

    Args:
        model_platform: The model platform
        model_type: The model type
        api_key: API key for authentication
        url: Custom model URL
        model_config_dict: Model configuration dictionary
        **kwargs: Additional model parameters

    Returns:
        ChatAgent: The created agent

    Raises:
        ValueError: If model_type or model_platform is invalid
        Exception: If model creation fails
    """
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


def validate_model_with_details(
    model_platform: str,
    model_type: str,
    api_key: str = None,
    url: str = None,
    model_config_dict: dict = None,
    **kwargs,
) -> ValidationResult:
    """Validate model with detailed diagnostic information.

    Args:
        model_platform: The model platform
        model_type: The model type
        api_key: API key for authentication
        url: Custom model URL
        model_config_dict: Model configuration dictionary
        **kwargs: Additional model parameters

    Returns:
        ValidationResult: Detailed validation result
    """
    result = ValidationResult()

    # Stage 1: Initialization
    result.validation_stages[ValidationStage.INITIALIZATION] = False
    try:
        if model_type is None or model_type.strip() == "":
            result.error_type = ValidationErrorType.INVALID_CONFIGURATION
            result.error_message = (
                "Model type is required but was not provided."
            )
            result.error_details = {"missing_field": "model_type"}
            result.failed_stage = ValidationStage.INITIALIZATION
            return result

        if model_platform is None or model_platform.strip() == "":
            result.error_type = ValidationErrorType.INVALID_CONFIGURATION
            result.error_message = (
                "Model platform is required but was not provided."
            )
            result.error_details = {"missing_field": "model_platform"}
            result.failed_stage = ValidationStage.INITIALIZATION
            return result

        result.validation_stages[ValidationStage.INITIALIZATION] = True
        result.successful_stages.append(ValidationStage.INITIALIZATION)
        result.diagnostic_info["initialization"] = {
            "model_platform": model_platform,
            "model_type": model_type,
            "has_api_key": api_key is not None and api_key.strip() != "",
            "has_custom_url": url is not None,
            "has_config": model_config_dict is not None,
        }
        logger.debug(
            "Initialization stage passed",
            extra={"platform": model_platform, "model_type": model_type},
        )

    except Exception as e:
        result.error_type = ValidationErrorType.INVALID_CONFIGURATION
        result.error_message = f"Initialization failed: {str(e)}"
        result.error_details = {
            "exception_type": type(e).__name__,
            "exception_message": str(e),
        }
        result.failed_stage = ValidationStage.INITIALIZATION
        logger.error(
            "Initialization stage failed",
            extra={"error": str(e)},
            exc_info=True,
        )
        return result

    # Stage 2: Model Creation
    result.validation_stages[ValidationStage.MODEL_CREATION] = False
    try:
        logger.debug(
            "Creating model",
            extra={"platform": model_platform, "model_type": model_type},
        )
        model = ModelFactory.create(
            model_platform=model_platform,
            model_type=model_type,
            api_key=api_key,
            url=url,
            timeout=60,  # 1 minute for validation
            model_config_dict=model_config_dict,
            **kwargs,
        )
        result.validation_stages[ValidationStage.MODEL_CREATION] = True
        result.successful_stages.append(ValidationStage.MODEL_CREATION)
        result.diagnostic_info["model_creation"] = {
            "model_platform": model_platform,
            "model_type": model_type,
            "model_created": True,
        }
        logger.debug(
            "Model creation stage passed",
            extra={"platform": model_platform, "model_type": model_type},
        )

    except Exception as e:
        error_type = categorize_error(e, ValidationStage.MODEL_CREATION)
        result.error_type = error_type
        result.error_message = f"Model creation failed: {str(e)}"
        result.error_details = {
            "exception_type": type(e).__name__,
            "exception_message": str(e),
            "traceback": traceback.format_exc(),
        }
        result.failed_stage = ValidationStage.MODEL_CREATION

        # Provide specific error messages based on error type
        if error_type == ValidationErrorType.AUTHENTICATION_ERROR:
            result.error_message = "Authentication failed. Please check your API key and ensure it is valid and has the necessary permissions."
        elif error_type == ValidationErrorType.MODEL_NOT_FOUND:
            result.error_message = f"Model '{model_type}' not found on platform '{model_platform}'. Please verify the model name and platform are correct."
        elif error_type == ValidationErrorType.NETWORK_ERROR:
            result.error_message = "Network error occurred while creating the model. Please check your internet connection and try again."
        elif error_type == ValidationErrorType.TIMEOUT_ERROR:
            result.error_message = "Model creation timed out. The model service may be slow or unavailable. Please try again later."
        elif error_type == ValidationErrorType.QUOTA_EXCEEDED:
            result.error_message = "Quota exceeded. Please check your account billing and usage limits."
        elif error_type == ValidationErrorType.RATE_LIMIT_ERROR:
            result.error_message = (
                "Rate limit exceeded. Please wait a moment and try again."
            )

        logger.error(
            "Model creation stage failed",
            extra={"error": str(e), "error_type": error_type.value},
            exc_info=True,
        )
        return result

    # Stage 3: Agent Creation
    result.validation_stages[ValidationStage.AGENT_CREATION] = False
    try:
        logger.debug(
            "Creating agent",
            extra={"platform": model_platform, "model_type": model_type},
        )
        agent = ChatAgent(
            system_message="You are a helpful assistant that must use the tool get_website_content to get the content of a website.",
            model=model,
            tools=[get_website_content],
            step_timeout=1800,  # 30 minutes
        )
        result.validation_stages[ValidationStage.AGENT_CREATION] = True
        result.successful_stages.append(ValidationStage.AGENT_CREATION)
        result.diagnostic_info["agent_creation"] = {
            "agent_created": True,
            "tools_count": len([get_website_content]),
        }
        logger.debug(
            "Agent creation stage passed",
            extra={"platform": model_platform, "model_type": model_type},
        )

    except Exception as e:
        error_type = categorize_error(e, ValidationStage.AGENT_CREATION)
        result.error_type = error_type
        result.error_message = f"Agent creation failed: {str(e)}"
        result.error_details = {
            "exception_type": type(e).__name__,
            "exception_message": str(e),
            "traceback": traceback.format_exc(),
        }
        result.failed_stage = ValidationStage.AGENT_CREATION
        logger.error(
            "Agent creation stage failed",
            extra={"error": str(e)},
            exc_info=True,
        )
        return result

    # Stage 4: Model Call
    result.validation_stages[ValidationStage.MODEL_CALL] = False
    try:
        logger.debug(
            "Executing model call",
            extra={"platform": model_platform, "model_type": model_type},
        )
        response = agent.step(
            input_message="""
            Get the content of https://www.camel-ai.org,
            you must use the get_website_content tool to get the content ,
            i just want to verify the get_website_content tool is working,
            you must call the get_website_content tool only once.
            """
        )

        if response:
            result.validation_stages[ValidationStage.MODEL_CALL] = True
            result.successful_stages.append(ValidationStage.MODEL_CALL)
            result.is_valid = True

            # Extract model response information
            result.model_response_info = {
                "has_response": True,
                "has_message": hasattr(response, "msg")
                and response.msg is not None,
                "has_info": hasattr(response, "info")
                and response.info is not None,
            }

            if hasattr(response, "msg") and response.msg:
                result.model_response_info["message_content"] = (
                    str(response.msg.content)[:200]
                    if hasattr(response.msg, "content")
                    else None
                )

            if hasattr(response, "info") and response.info:
                result.model_response_info["usage"] = response.info.get(
                    "usage", {}
                )
                result.model_response_info["tool_calls_count"] = len(
                    response.info.get("tool_calls", [])
                )

            logger.debug(
                "Model call stage passed",
                extra={"platform": model_platform, "model_type": model_type},
            )
        else:
            result.error_type = ValidationErrorType.UNKNOWN_ERROR
            result.error_message = (
                "Model call succeeded but returned no response."
            )
            result.error_details = {"response": None}
            result.failed_stage = ValidationStage.MODEL_CALL
            logger.warning(
                "Model call returned no response",
                extra={"platform": model_platform, "model_type": model_type},
            )
            return result

    except Exception as e:
        error_type = categorize_error(e, ValidationStage.MODEL_CALL)
        result.error_type = error_type
        result.error_message = f"Model call failed: {str(e)}"
        result.error_details = {
            "exception_type": type(e).__name__,
            "exception_message": str(e),
            "traceback": traceback.format_exc(),
        }
        result.failed_stage = ValidationStage.MODEL_CALL

        # Provide specific error messages
        if error_type == ValidationErrorType.TIMEOUT_ERROR:
            result.error_message = "Model call timed out. The model may be slow or overloaded. Please try again later."
        elif error_type == ValidationErrorType.NETWORK_ERROR:
            result.error_message = "Network error occurred during model call. Please check your connection and try again."
        elif error_type == ValidationErrorType.RATE_LIMIT_ERROR:
            result.error_message = "Rate limit exceeded during model call. Please wait and try again."

        logger.error(
            "Model call stage failed",
            extra={"error": str(e), "error_type": error_type.value},
            exc_info=True,
        )
        return result

    # Stage 5: Tool Call Execution Check
    result.validation_stages[ValidationStage.TOOL_CALL_EXECUTION] = False
    try:
        if response and hasattr(response, "info") and response.info:
            tool_calls = response.info.get("tool_calls", [])

            result.tool_call_info = {
                "tool_calls_count": len(tool_calls),
                "has_tool_calls": len(tool_calls) > 0,
            }

            if tool_calls and len(tool_calls) > 0:
                tool_call = tool_calls[0]
                result.tool_call_info["first_tool_call"] = {
                    "tool_name": getattr(tool_call, "tool_name", None),
                    "has_result": hasattr(tool_call, "result"),
                    "result": str(getattr(tool_call, "result", ""))[:200]
                    if hasattr(tool_call, "result")
                    else None,
                }

                expected_result = EXPECTED_TOOL_RESULT
                actual_result = (
                    tool_call.result if hasattr(tool_call, "result") else None
                )

                if actual_result == expected_result:
                    result.validation_stages[
                        ValidationStage.TOOL_CALL_EXECUTION
                    ] = True
                    result.successful_stages.append(
                        ValidationStage.TOOL_CALL_EXECUTION
                    )
                    result.is_tool_calls = True
                    result.tool_call_info["execution_successful"] = True
                    logger.debug(
                        "Tool call execution stage passed",
                        extra={
                            "platform": model_platform,
                            "model_type": model_type,
                        },
                    )
                else:
                    result.error_type = (
                        ValidationErrorType.TOOL_CALL_EXECUTION_FAILED
                    )
                    result.error_message = f"Tool call was made but execution failed. Expected result: '{expected_result[:50]}...', but got: '{str(actual_result)[:50] if actual_result else 'None'}...'"
                    result.error_details = {
                        "expected_result": expected_result,
                        "actual_result": str(actual_result)
                        if actual_result
                        else None,
                        "tool_call": str(tool_call)[:200],
                    }
                    result.failed_stage = ValidationStage.TOOL_CALL_EXECUTION
                    result.tool_call_info["execution_successful"] = False
                    logger.warning(
                        "Tool call execution failed",
                        extra={
                            "platform": model_platform,
                            "model_type": model_type,
                            "expected": expected_result[:50],
                            "actual": str(actual_result)[:50]
                            if actual_result
                            else None,
                        },
                    )
            else:
                result.error_type = ValidationErrorType.TOOL_CALL_NOT_SUPPORTED
                result.error_message = "Model call succeeded, but the model did not make any tool calls. This model may not support tool calling functionality."
                result.error_details = {
                    "tool_calls": [],
                    "response_info": str(response.info)
                    if hasattr(response, "info")
                    else None,
                }
                result.failed_stage = ValidationStage.TOOL_CALL_EXECUTION
                result.tool_call_info["execution_successful"] = False
                logger.warning(
                    "No tool calls made by model",
                    extra={
                        "platform": model_platform,
                        "model_type": model_type,
                    },
                )
        else:
            result.error_type = ValidationErrorType.TOOL_CALL_NOT_SUPPORTED
            result.error_message = "Model call succeeded, but response does not contain tool call information. This model may not support tool calling functionality."
            result.error_details = {
                "has_info": hasattr(response, "info") if response else False,
                "response_type": type(response).__name__ if response else None,
            }
            result.failed_stage = ValidationStage.TOOL_CALL_EXECUTION
            result.tool_call_info = {
                "execution_successful": False,
                "has_info": False,
            }
            logger.warning(
                "Response missing tool call info",
                extra={"platform": model_platform, "model_type": model_type},
            )

    except Exception as e:
        result.error_type = ValidationErrorType.TOOL_CALL_EXECUTION_FAILED
        result.error_message = (
            f"Error while checking tool call execution: {str(e)}"
        )
        result.error_details = {
            "exception_type": type(e).__name__,
            "exception_message": str(e),
            "traceback": traceback.format_exc(),
        }
        result.failed_stage = ValidationStage.TOOL_CALL_EXECUTION
        logger.error(
            "Tool call execution check failed",
            extra={"error": str(e)},
            exc_info=True,
        )

    return result
