"""
Unit tests for validate_model_before_task function.

TODO: Rename this file to test_task.py after fixing errors
in backend/tests/unit/service/test_task.py
"""

from unittest.mock import Mock, patch

import pytest
from camel.types import ModelPlatformType

from app.model.chat import Chat
from app.service.task import validate_model_before_task

# Test data constants
TEST_PROJECT_ID = "test_project"
TEST_TASK_ID = "test_task_123"
TEST_QUESTION = "Test question"
TEST_EMAIL = "test@example.com"
TEST_MODEL_PLATFORM = ModelPlatformType.OPENAI
TEST_MODEL_TYPE = "gpt-4o"
TEST_API_URL = "https://api.openai.com/v1"
TEST_VALID_API_KEY = "sk-valid-key"
TEST_INVALID_API_KEY = "sk-invalid-key"


@pytest.mark.asyncio
async def test_validate_model_success():
    """Test successful model validation."""
    options = Chat(
        project_id=TEST_PROJECT_ID,
        task_id=TEST_TASK_ID,
        question=TEST_QUESTION,
        email=TEST_EMAIL,
        model_platform=TEST_MODEL_PLATFORM,
        model_type=TEST_MODEL_TYPE,
        api_key=TEST_VALID_API_KEY,
        api_url=TEST_API_URL,
        model_config={},
    )

    # Mock the create_agent and agent.step
    mock_agent = Mock()
    mock_agent.step = Mock(return_value="test response")

    with patch("app.service.task.create_agent", return_value=mock_agent):
        is_valid, error_msg = await validate_model_before_task(options)

    assert is_valid is True
    assert error_msg is None


@pytest.mark.asyncio
async def test_validate_model_invalid_api_key():
    """Test model validation with invalid API key."""
    options = Chat(
        project_id=TEST_PROJECT_ID,
        task_id=TEST_TASK_ID,
        question=TEST_QUESTION,
        email=TEST_EMAIL,
        model_platform=TEST_MODEL_PLATFORM,
        model_type=TEST_MODEL_TYPE,
        api_key=TEST_INVALID_API_KEY,
        api_url=TEST_API_URL,
        model_config={},
    )

    # Mock the create_agent to raise authentication error
    with patch("app.service.task.create_agent") as mock_create:
        mock_agent = Mock()
        mock_agent.step = Mock(
            side_effect=Exception("Error code: 401 - Invalid API key")
        )
        mock_create.return_value = mock_agent

        is_valid, error_msg = await validate_model_before_task(options)

    assert is_valid is False
    assert error_msg is not None
    assert "401" in error_msg or "Invalid API key" in error_msg


@pytest.mark.asyncio
async def test_validate_model_network_error():
    """Test model validation with network error."""
    options = Chat(
        project_id=TEST_PROJECT_ID,
        task_id=TEST_TASK_ID,
        question=TEST_QUESTION,
        email=TEST_EMAIL,
        model_platform=TEST_MODEL_PLATFORM,
        model_type=TEST_MODEL_TYPE,
        api_key=TEST_VALID_API_KEY,
        api_url="https://invalid-url.com",
        model_config={},
    )

    # Mock the create_agent to raise network error
    with patch("app.service.task.create_agent") as mock_create:
        mock_agent = Mock()
        mock_agent.step = Mock(side_effect=Exception("Connection error"))
        mock_create.return_value = mock_agent

        is_valid, error_msg = await validate_model_before_task(options)

    assert is_valid is False
    assert error_msg is not None
    assert "Connection error" in error_msg


@pytest.mark.asyncio
async def test_validate_model_with_custom_config():
    """Test model validation with custom model configuration."""
    custom_config = {"temperature": 0.7, "max_tokens": 1000}

    options = Chat(
        project_id=TEST_PROJECT_ID,
        task_id=TEST_TASK_ID,
        question=TEST_QUESTION,
        email=TEST_EMAIL,
        model_platform=TEST_MODEL_PLATFORM,
        model_type=TEST_MODEL_TYPE,
        api_key=TEST_VALID_API_KEY,
        api_url=TEST_API_URL,
        model_config=custom_config,
    )

    mock_agent = Mock()
    mock_agent.step = Mock(return_value="test response")

    with patch(
        "app.service.task.create_agent", return_value=mock_agent
    ) as mock_create:
        is_valid, error_msg = await validate_model_before_task(options)

        # Verify create_agent was called
        mock_create.assert_called_once()
        call_args = mock_create.call_args
        assert call_args.kwargs["model_platform"] == options.model_platform
        assert call_args.kwargs["model_type"] == options.model_type
        assert call_args.kwargs["api_key"] == options.api_key
        assert call_args.kwargs["url"] == options.api_url

    assert is_valid is True
    assert error_msg is None


@pytest.mark.asyncio
async def test_validate_model_rate_limit_error():
    """Test model validation with rate limit error."""
    options = Chat(
        project_id=TEST_PROJECT_ID,
        task_id=TEST_TASK_ID,
        question=TEST_QUESTION,
        email=TEST_EMAIL,
        model_platform=TEST_MODEL_PLATFORM,
        model_type=TEST_MODEL_TYPE,
        api_key=TEST_VALID_API_KEY,
        api_url=TEST_API_URL,
        model_config={},
    )

    # Mock the create_agent to raise rate limit error
    with patch("app.service.task.create_agent") as mock_create:
        mock_agent = Mock()
        mock_agent.step = Mock(
            side_effect=Exception("Error code: 429 - Rate limit exceeded")
        )
        mock_create.return_value = mock_agent

        is_valid, error_msg = await validate_model_before_task(options)

    assert is_valid is False
    assert error_msg is not None
    assert "429" in error_msg or "Rate limit" in error_msg
