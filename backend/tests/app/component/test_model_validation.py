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

from unittest.mock import MagicMock, patch

import pytest
from camel.models import ModelProcessingError

from app.component.model_validation import (
    EXPECTED_TOOL_RESULT,
    ValidationErrorType,
    ValidationResult,
    ValidationStage,
    categorize_error,
    create_agent,
    format_raw_error,
    validate_model_with_details,
)


@pytest.mark.unit
def test_validation_result_initialization():
    """Test ValidationResult initialization."""
    result = ValidationResult()
    assert result.is_valid is False
    assert result.is_tool_calls is False
    assert result.error_type is None
    assert result.error_code is None
    assert result.error_message is None
    assert result.raw_error_message is None
    assert result.error_details == {}
    assert result.validation_stages == {}
    assert result.diagnostic_info == {}
    assert result.successful_stages == []
    assert result.failed_stage is None
    assert result.model_response_info is None
    assert result.tool_call_info is None


@pytest.mark.unit
def test_validation_result_to_dict():
    """Test ValidationResult.to_dict() method."""
    result = ValidationResult()
    result.is_valid = True
    result.is_tool_calls = True
    result.error_type = ValidationErrorType.AUTHENTICATION_ERROR
    result.error_message = "Test error"
    result.raw_error_message = "Raw test error"
    result.validation_stages[ValidationStage.INITIALIZATION] = True
    result.successful_stages.append(ValidationStage.INITIALIZATION)
    result.failed_stage = ValidationStage.MODEL_CREATION

    result_dict = result.to_dict()
    assert result_dict["is_valid"] is True
    assert result_dict["is_tool_calls"] is True
    assert result_dict["error_type"] == "authentication_error"
    assert result_dict["error_message"] == "Test error"
    assert result_dict["raw_error_message"] == "Raw test error"
    assert result_dict["validation_stages"]["initialization"] is True
    assert "initialization" in result_dict["successful_stages"]
    assert result_dict["failed_stage"] == "model_creation"


@pytest.mark.unit
def test_format_short_error():
    """Test formatting of short error message."""
    error = ValueError("Short error message")
    result = format_raw_error(error)
    assert result == "Short error message"


@pytest.mark.unit
def test_format_long_error():
    """Test formatting of long error message with truncation."""
    long_message = "A" * 500
    error = ValueError(long_message)
    result = format_raw_error(error, max_length=100)
    assert len(result) == 103  # 100 + "..."
    assert result.endswith("...")


@pytest.mark.unit
def test_format_error_with_default_max_length():
    """Test formatting with default max_length."""
    long_message = "A" * 400
    error = ValueError(long_message)
    result = format_raw_error(error)
    assert len(result) == 303  # 300 + "..."
    assert result.endswith("...")


@pytest.mark.unit
def test_timeout_error():
    """Test categorization of timeout errors."""
    error = TimeoutError("Request timed out")
    result = categorize_error(error, ValidationStage.MODEL_CALL)
    assert result == ValidationErrorType.TIMEOUT_ERROR


@pytest.mark.unit
def test_connection_error():
    """Test categorization of connection errors."""
    error = ConnectionError("Connection failed")
    result = categorize_error(error, ValidationStage.MODEL_CALL)
    assert result == ValidationErrorType.NETWORK_ERROR


@pytest.mark.unit
def test_model_processing_error_401():
    """Test categorization of 401 errors from ModelProcessingError."""
    error = ModelProcessingError("401 Unauthorized")
    result = categorize_error(error, ValidationStage.MODEL_CREATION)
    assert result == ValidationErrorType.AUTHENTICATION_ERROR


@pytest.mark.unit
def test_model_processing_error_404():
    """Test categorization of 404 errors from ModelProcessingError."""
    error = ModelProcessingError("404 Model not found")
    result = categorize_error(error, ValidationStage.MODEL_CREATION)
    assert result == ValidationErrorType.MODEL_NOT_FOUND


@pytest.mark.unit
def test_model_processing_error_429():
    """Test categorization of 429 errors from ModelProcessingError."""
    error = ModelProcessingError("429 Rate limit exceeded")
    result = categorize_error(error, ValidationStage.MODEL_CALL)
    assert result == ValidationErrorType.RATE_LIMIT_ERROR


@pytest.mark.unit
def test_model_processing_error_quota():
    """Test categorization of quota errors from ModelProcessingError."""
    error = ModelProcessingError("Insufficient quota")
    result = categorize_error(error, ValidationStage.MODEL_CALL)
    assert result == ValidationErrorType.QUOTA_EXCEEDED


@pytest.mark.unit
def test_unknown_error():
    """Test categorization of unknown errors."""
    error = ValueError("Some random error")
    result = categorize_error(error, ValidationStage.MODEL_CALL)
    assert result == ValidationErrorType.UNKNOWN_ERROR


@pytest.mark.unit
def test_http_status_code_401():
    """Test categorization based on HTTP status code 401."""
    error = Exception("401 Unauthorized access")
    result = categorize_error(error, ValidationStage.MODEL_CREATION)
    assert result == ValidationErrorType.AUTHENTICATION_ERROR


@pytest.mark.unit
def test_http_status_code_404():
    """Test categorization based on HTTP status code 404."""
    error = Exception("404 Not found")
    result = categorize_error(error, ValidationStage.MODEL_CREATION)
    assert result == ValidationErrorType.MODEL_NOT_FOUND


@pytest.mark.unit
def test_http_status_code_429():
    """Test categorization based on HTTP status code 429."""
    error = Exception("429 Too many requests")
    result = categorize_error(error, ValidationStage.MODEL_CALL)
    assert result == ValidationErrorType.RATE_LIMIT_ERROR


@pytest.mark.unit
@patch("app.component.model_validation.ModelFactory.create")
@patch("app.component.model_validation.ChatAgent")
def test_create_agent_success(mock_chat_agent, mock_model_factory):
    """Test successful agent creation."""
    mock_model = MagicMock()
    mock_model_factory.return_value = mock_model
    mock_agent_instance = MagicMock()
    mock_chat_agent.return_value = mock_agent_instance

    agent = create_agent(
        model_platform="OPENAI",
        model_type="GPT_4O_MINI",
        api_key="test_key",
    )

    mock_model_factory.assert_called_once()
    mock_chat_agent.assert_called_once()
    assert agent == mock_agent_instance


@pytest.mark.unit
def test_create_agent_invalid_model_type():
    """Test agent creation with invalid model type."""
    with pytest.raises(ValueError, match="Invalid model_type"):
        create_agent(model_platform="OPENAI", model_type=None)


@pytest.mark.unit
def test_create_agent_invalid_model_platform():
    """Test agent creation with invalid model platform."""
    with pytest.raises(ValueError, match="Invalid model_platform"):
        create_agent(model_platform=None, model_type="GPT_4O_MINI")


@pytest.mark.unit
def test_validation_missing_model_type():
    """Test validation with missing model type."""
    result = validate_model_with_details(
        model_platform="OPENAI", model_type=""
    )
    assert result.is_valid is False
    assert result.error_type == ValidationErrorType.INVALID_CONFIGURATION
    assert result.failed_stage == ValidationStage.INITIALIZATION
    assert "Model type is required" in result.error_message


@pytest.mark.unit
def test_validation_missing_model_platform():
    """Test validation with missing model platform."""
    result = validate_model_with_details(
        model_platform="", model_type="GPT_4O_MINI"
    )
    assert result.is_valid is False
    assert result.error_type == ValidationErrorType.INVALID_CONFIGURATION
    assert result.failed_stage == ValidationStage.INITIALIZATION
    assert "Model platform is required" in result.error_message


@pytest.mark.unit
@patch("app.component.model_validation.ModelFactory.create")
def test_validation_model_creation_failure(mock_model_factory):
    """Test validation when model creation fails."""
    mock_model_factory.side_effect = ModelProcessingError("401 Unauthorized")

    result = validate_model_with_details(
        model_platform="OPENAI",
        model_type="GPT_4O_MINI",
        api_key="invalid_key",
    )

    assert result.is_valid is False
    assert result.error_type == ValidationErrorType.AUTHENTICATION_ERROR
    assert result.failed_stage == ValidationStage.MODEL_CREATION
    assert result.validation_stages[ValidationStage.INITIALIZATION] is True
    assert ValidationStage.INITIALIZATION in result.successful_stages


@pytest.mark.unit
@patch("app.component.model_validation.ModelFactory.create")
@patch("app.component.model_validation.ChatAgent")
def test_validation_agent_creation_failure(
    mock_chat_agent, mock_model_factory
):
    """Test validation when agent creation fails."""
    mock_model = MagicMock()
    mock_model_factory.return_value = mock_model
    mock_chat_agent.side_effect = Exception("Agent creation failed")

    result = validate_model_with_details(
        model_platform="OPENAI",
        model_type="GPT_4O_MINI",
        api_key="test_key",
    )

    assert result.is_valid is False
    assert result.failed_stage == ValidationStage.AGENT_CREATION
    assert result.validation_stages[ValidationStage.MODEL_CREATION] is True


@pytest.mark.unit
@patch("app.component.model_validation.ModelFactory.create")
@patch("app.component.model_validation.ChatAgent")
def test_validation_model_call_failure(mock_chat_agent, mock_model_factory):
    """Test validation when model call fails."""
    mock_model = MagicMock()
    mock_model_factory.return_value = mock_model
    mock_agent = MagicMock()
    mock_agent.step.side_effect = Exception("Model call failed")
    mock_chat_agent.return_value = mock_agent

    result = validate_model_with_details(
        model_platform="OPENAI",
        model_type="GPT_4O_MINI",
        api_key="test_key",
    )

    assert result.is_valid is False
    assert result.failed_stage == ValidationStage.MODEL_CALL
    assert result.validation_stages[ValidationStage.AGENT_CREATION] is True


@pytest.mark.unit
@patch("app.component.model_validation.ModelFactory.create")
@patch("app.component.model_validation.ChatAgent")
def test_validation_no_tool_calls(mock_chat_agent, mock_model_factory):
    """Test validation when model doesn't make tool calls."""
    mock_model = MagicMock()
    mock_model_factory.return_value = mock_model
    mock_agent = MagicMock()
    mock_response = MagicMock()
    mock_response.info = {"tool_calls": []}  # No tool calls
    mock_agent.step.return_value = mock_response
    mock_chat_agent.return_value = mock_agent

    result = validate_model_with_details(
        model_platform="OPENAI",
        model_type="GPT_4O_MINI",
        api_key="test_key",
    )

    assert result.is_valid is False
    assert result.is_tool_calls is False
    assert result.error_type == ValidationErrorType.TOOL_CALL_NOT_SUPPORTED
    assert result.failed_stage == ValidationStage.TOOL_CALL_EXECUTION
    assert result.validation_stages[ValidationStage.MODEL_CALL] is True


@pytest.mark.unit
@patch("app.component.model_validation.ModelFactory.create")
@patch("app.component.model_validation.ChatAgent")
def test_validation_tool_call_execution_failed(
    mock_chat_agent, mock_model_factory
):
    """Test validation when tool call execution fails."""
    mock_model = MagicMock()
    mock_model_factory.return_value = mock_model
    mock_agent = MagicMock()
    mock_response = MagicMock()
    tool_call = MagicMock()
    tool_call.result = "Wrong result"  # Wrong result
    mock_response.info = {"tool_calls": [tool_call]}
    mock_agent.step.return_value = mock_response
    mock_chat_agent.return_value = mock_agent

    result = validate_model_with_details(
        model_platform="OPENAI",
        model_type="GPT_4O_MINI",
        api_key="test_key",
    )

    assert result.is_valid is False
    assert result.is_tool_calls is False
    assert result.error_type == ValidationErrorType.TOOL_CALL_EXECUTION_FAILED
    assert result.failed_stage == ValidationStage.TOOL_CALL_EXECUTION


@pytest.mark.unit
@patch("app.component.model_validation.ModelFactory.create")
@patch("app.component.model_validation.ChatAgent")
def test_validation_success_with_tool_calls(
    mock_chat_agent, mock_model_factory
):
    """Test successful validation with tool calls."""
    mock_model = MagicMock()
    mock_model_factory.return_value = mock_model
    mock_agent = MagicMock()
    mock_response = MagicMock()
    tool_call = MagicMock()
    tool_call.result = EXPECTED_TOOL_RESULT  # Correct result
    mock_response.info = {"tool_calls": [tool_call]}
    mock_agent.step.return_value = mock_response
    mock_chat_agent.return_value = mock_agent

    result = validate_model_with_details(
        model_platform="OPENAI",
        model_type="GPT_4O_MINI",
        api_key="test_key",
    )

    assert result.is_valid is True
    assert result.is_tool_calls is True
    assert result.error_type is None
    assert result.failed_stage is None
    assert (
        result.validation_stages[ValidationStage.TOOL_CALL_EXECUTION] is True
    )
    assert ValidationStage.TOOL_CALL_EXECUTION in result.successful_stages


@pytest.mark.unit
@patch("app.component.model_validation.ModelFactory.create")
@patch("app.component.model_validation.ChatAgent")
def test_validation_diagnostic_info(mock_chat_agent, mock_model_factory):
    """Test that diagnostic info is properly populated."""
    mock_model = MagicMock()
    mock_model_factory.return_value = mock_model
    mock_agent = MagicMock()
    mock_response = MagicMock()
    tool_call = MagicMock()
    tool_call.result = EXPECTED_TOOL_RESULT
    mock_response.info = {"tool_calls": [tool_call]}
    mock_agent.step.return_value = mock_response
    mock_chat_agent.return_value = mock_agent

    result = validate_model_with_details(
        model_platform="OPENAI",
        model_type="GPT_4O_MINI",
        api_key="test_key",
    )

    assert "initialization" in result.diagnostic_info
    assert "model_creation" in result.diagnostic_info
    assert "agent_creation" in result.diagnostic_info
    assert result.model_response_info is not None
    assert result.tool_call_info is not None
    assert result.tool_call_info["execution_successful"] is True
