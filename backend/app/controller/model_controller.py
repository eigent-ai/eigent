from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.component.model_validation import create_agent
from camel.types import ModelType
from app.component.error_format import normalize_error_to_openai_format
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("model_controller")


router = APIRouter()


class ValidateModelRequest(BaseModel):
    model_platform: str = Field("OPENAI", description="Model platform")
    model_type: str = Field("GPT_4O_MINI", description="Model type")
    api_key: str | None = Field(None, description="API key")
    url: str | None = Field(None, description="Model URL")
    model_config_dict: dict | None = Field(None, description="Model config dict")
    extra_params: dict | None = Field(None, description="Extra model parameters")


class ValidateModelResponse(BaseModel):
    is_valid: bool = Field(..., description="Is valid")
    is_tool_calls: bool = Field(..., description="Is tool call used")
    error_code: str | None = Field(None, description="Error code")
    error: dict | None = Field(None, description="OpenAI-style error object")
    message: str = Field(..., description="Message")


@router.post("/model/validate")
@traceroot.trace()
async def validate_model(request: ValidateModelRequest):
    """Validate model configuration and tool call support."""
    platform = request.model_platform
    model_type = request.model_type
    has_custom_url = request.url is not None
    has_config = request.model_config_dict is not None

    logger.info("Model validation started", extra={"platform": platform, "model_type": model_type, "has_url": has_custom_url, "has_config": has_config})

    # API key validation
    if request.api_key is not None and str(request.api_key).strip() == "":
        logger.warning("Model validation failed: empty API key", extra={"platform": platform, "model_type": model_type})
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
            }
        )

    try:
        extra = request.extra_params or {}

        logger.debug("Creating agent for validation", extra={"platform": platform, "model_type": model_type})
        agent = create_agent(
            platform,
            model_type,
            api_key=request.api_key,
            url=request.url,
            model_config_dict=request.model_config_dict,
            **extra,
        )

        logger.debug("Agent created, executing test step", extra={"platform": platform, "model_type": model_type})
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
        logger.error("Model validation failed", extra={"platform": platform, "model_type": model_type, "error": str(e)}, exc_info=True)
        message, error_code, error_obj = normalize_error_to_openai_format(e)

        raise HTTPException(
            status_code=400,
            detail={
                "message": message,
                "error_code": error_code,
                "error": error_obj,
            }
        )
    
    # Check validation results
    is_valid = bool(response)
    is_tool_calls = False

    if response and hasattr(response, "info") and response.info:
        tool_calls = response.info.get("tool_calls", [])
        if tool_calls and len(tool_calls) > 0:
            is_tool_calls = (
                tool_calls[0].result
                == "Tool execution completed successfully for https://www.camel-ai.org, Website Content: Welcome to CAMEL AI!"
            )

    result = ValidateModelResponse(
        is_valid=is_valid,
        is_tool_calls=is_tool_calls,
        message="Validation Success"
        if is_tool_calls
        else "This model doesn't support tool calls. please try with another model.",
        error_code=None,
        error=None,
    )

    logger.info("Model validation completed", extra={"platform": platform, "model_type": model_type, "is_valid": is_valid, "is_tool_calls": is_tool_calls})

    return result
