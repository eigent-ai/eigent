from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.component.model_validation import create_agent


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
    message: str = Field(..., description="Message")


@router.post("/model/validate")
async def validate_model(request: ValidateModelRequest):
    try:
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
        return ValidateModelResponse(is_valid=False, is_tool_calls=False, message=str(e))
    return ValidateModelResponse(
        is_valid=True if response else False,
        is_tool_calls=response.info["tool_calls"][0].result == "Tool execution completed successfully for https://www.camel-ai.org, Website Content: Welcome to CAMEL AI!",
        message="",
    )
