from unittest.mock import patch

from app.service.error_handler import (prepare_model_error_response,
                                       should_stop_task)
from camel.models import ModelProcessingError


def test_should_stop_task_with_invalid_key():
    """Test that should_stop_task returns True for
    invalid_api_key error code.
    """
    assert should_stop_task("invalid_api_key") is True


def test_should_stop_task_with_quota_error():
    """Test that should_stop_task returns True for quota errors."""
    assert should_stop_task("insufficient_quota") is True


def test_should_stop_task_with_model_not_found():
    """Test that should_stop_task returns True for model_not_found errors."""
    assert should_stop_task("model_not_found") is True


def test_should_stop_task_with_other_error():
    """Test that should_stop_task returns False for non-critical errors."""
    assert should_stop_task("rate_limit_exceeded") is False
    assert should_stop_task(None) is False


@patch('app.service.error_handler.normalize_error_to_openai_format')
@patch('app.service.error_handler.logger')
def test_prepare_model_error_response_with_invalid_api_key(
        mock_logger, mock_normalize):
    """Test prepare_model_error_response with invalid API key error."""
    # Setup mock
    mock_normalize.return_value = ("Invalid key. Validation failed.",
                                   "invalid_api_key", {
                                       "message":
                                       "Invalid key. Validation failed.",
                                       "type": "invalid_request_error",
                                       "param": None,
                                       "code": "invalid_api_key",
                                   })

    error = ModelProcessingError("Error code: 401 - unauthorized")
    project_id = "test-project"
    task_id = "test-task"

    # Call function
    error_payload, message, error_code = prepare_model_error_response(
        error, project_id, task_id, "test context")

    # Assertions
    assert error_code == "invalid_api_key"
    assert message == "Invalid key. Validation failed."
    assert error_payload["error_code"] == "invalid_api_key"
    assert error_payload["message"] == "Invalid key. Validation failed."

    # Verify logger was called
    mock_logger.error.assert_called_once()
    mock_normalize.assert_called_once_with(error)


@patch('app.service.error_handler.normalize_error_to_openai_format')
@patch('app.service.error_handler.logger')
def test_prepare_model_error_response_with_model_not_found(
        mock_logger, mock_normalize):
    """Test prepare_model_error_response with model_not_found
    error (should stop task).
    """
    # Setup mock
    mock_normalize.return_value = (
        "Invalid model name. Validation failed.", "model_not_found", {
            "message": "Invalid model name. Validation failed.",
            "type": "invalid_request_error",
            "param": None,
            "code": "model_not_found",
        })

    error = ModelProcessingError("Error code: 404 - model does not exist")
    project_id = "test-project"
    task_id = "test-task"

    # Call function
    error_payload, message, error_code = prepare_model_error_response(
        error, project_id, task_id, "test context")

    # Assertions
    assert error_code == "model_not_found"
    assert message == "Invalid model name. Validation failed."
    assert error_payload["error_code"] == "model_not_found"
    assert error_payload["message"] == "Invalid model name. Validation failed."

    # Verify this SHOULD stop the task
    # (checked by caller using should_stop_task)
    assert should_stop_task(error_code) is True

    # Verify logger was called
    mock_logger.error.assert_called_once()
    mock_normalize.assert_called_once_with(error)


@patch('app.service.error_handler.normalize_error_to_openai_format')
@patch('app.service.error_handler.logger')
def test_prepare_model_error_response_with_quota_error(mock_logger,
                                                       mock_normalize):
    """Test prepare_model_error_response with
    insufficient_quota error (should stop task).
    """
    # Setup mock
    mock_normalize.return_value = ((
        "You exceeded your current quota, please "
        "check your plan and billing details."), "insufficient_quota", {
            "message": ("You exceeded your current quota, please "
                        "check your plan and billing details."),
            "type":
            "insufficient_quota",
            "param":
            None,
            "code":
            "insufficient_quota",
        })

    error = ModelProcessingError("Error code: 429 - quota exceeded")
    project_id = "test-project"
    task_id = "test-task"

    # Call function
    _, message, error_code = prepare_model_error_response(
        error, project_id, task_id, "test context")

    # Assertions
    assert error_code == "insufficient_quota"
    assert message == ("You exceeded your current quota, "
                       "please check your plan and billing details.")

    # Verify this SHOULD stop the task
    # (checked by caller using should_stop_task)
    assert should_stop_task(error_code) is True

    # Verify logger was called
    mock_logger.error.assert_called_once()
    mock_normalize.assert_called_once_with(error)
