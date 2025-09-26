from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.component.model_validation import create_agent
from camel.types import ModelType
from app.component.error_format import normalize_error_to_openai_format


router = APIRouter(tags=["model"])


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
async def validate_model(request: ValidateModelRequest):
    try:
        # 1) API key validation
        if request.api_key is not None and str(request.api_key).strip() == "":
            return ValidateModelResponse(
                is_valid=False,
                is_tool_calls=False,
                message="Invalid key. Validation failed.",
                error_code="invalid_api_key",
                error={
                    "message": "Invalid key. Validation failed.",
                    "type": "invalid_request_error",
                    "param": None,
                    "code": "invalid_api_key",
                },
            )

        # 2) Model name validation
        if request.model_type:
            try:
                # Will raise if not a valid enum name
                _ = ModelType.from_name(request.model_type)
            except Exception as e:
                return ValidateModelResponse(
                    is_valid=False,
                    is_tool_calls=False,
                    message="Invalid model name. Validation failed.",
                    error_code=f"model_not_found : {e}",
                    error={
                        "message": "Invalid model name. Validation failed.",
                        "type": "invalid_request_error",
                        "param": None,
                        "code": "model_not_found",
                    },
                )

        extra = request.extra_params or {}

        agent = create_agent(
            request.model_platform,
            request.model_type,
            api_key=request.api_key,
            url=request.url,
            model_config_dict=request.model_config_dict,
            **extra,
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
        message, error_code, error_obj = normalize_error_to_openai_format(e)

        return ValidateModelResponse(
            is_valid=False,
            is_tool_calls=False,
            message=message,
            error_code=error_code,
            error=error_obj,
        )
    is_valid = bool(response)
    is_tool_calls = False

    if response and hasattr(response, "info") and response.info:
        tool_calls = response.info.get("tool_calls", [])
        if tool_calls and len(tool_calls) > 0:
            is_tool_calls = (
                tool_calls[0].result
                == "Tool execution completed successfully for https://www.camel-ai.org, Website Content: Welcome to CAMEL AI!"
            )

    return ValidateModelResponse(
        is_valid=is_valid,
        is_tool_calls=is_tool_calls,
        message="Validation Success"
        if is_tool_calls
        else "This model doesn’t support tool calls. please try with another model.",
        error_code=None,
        error=None,
    )
