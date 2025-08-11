from camel.agents import ChatAgent
from camel.models import ModelFactory
from camel.types import ModelPlatformType, ModelType


def get_website_content(url: str) -> str:
    r"""Gets the content of a website.

    Args:
        url (str): The URL of the website.

    Returns:
        str: The content of the website.
    """
    return f"Tool execution completed successfully for https://www.camel-ai.org, Website Content: Welcome to CAMEL AI!"


def create_agent(
    model_platform: str, model_type: str, api_key: str = None, url: str = None, model_config_dict: dict = None, **kwargs
) -> ChatAgent:
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
        timeout=10,
        model_config_dict=model_config_dict,
        **kwargs,
    )
    agent = ChatAgent(
        system_message="You are a helpful assistant that must use the tool get_website_content to get the content of a website.",
        model=model,
        tools=[get_website_content],
    )
    return agent
