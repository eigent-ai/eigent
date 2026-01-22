from unittest.mock import patch

from app.service.error_handler import (prepare_model_error_response,
                                       should_stop_task)
from camel.models import ModelProcessingError


@patch('app.service.error_handler.normalize_error_to_openai_format')
def test_invalid_api_key_error_should_stop_task(mock_normalize):
    """Test that invalid API key error results in task being stopped."""
    # Setup mock to return invalid_api_key error
    mock_normalize.return_value = ("Invalid key. Validation failed.",
                                   "invalid_api_key", {
                                       "message":
                                       "Invalid key. Validation failed.",
                                       "type": "invalid_request_error",
                                       "param": None,
                                       "code": "invalid_api_key",
                                   })

    error = ModelProcessingError("Error code: 401 - unauthorized")
    _, _, error_code = prepare_model_error_response(error, "project-id",
                                                    "task-id", "test context")

    # Verify this is an invalid API key error
    assert should_stop_task(error_code) is True

    # Simulate the chat_service logic
    should_stop = should_stop_task(error_code)
    assert should_stop is True


@patch('app.service.error_handler.normalize_error_to_openai_format')
def test_model_not_found_error_should_stop_task(mock_normalize):
    """Test that model_not_found error SHOULD stop task."""
    # Setup mock to return model_not_found error
    mock_normalize.return_value = (
        "Invalid model name. Validation failed.", "model_not_found", {
            "message": "Invalid model name. Validation failed.",
            "type": "invalid_request_error",
            "param": None,
            "code": "model_not_found",
        })

    error = ModelProcessingError("Error code: 404 - model does not exist")
    _, _, error_code = prepare_model_error_response(error, "project-id",
                                                    "task-id", "test context")

    # Verify this is a critical error that should stop the task
    assert should_stop_task(error_code) is True

    # Simulate the chat_service logic
    should_stop = should_stop_task(error_code)
    assert should_stop is True


@patch('app.service.error_handler.normalize_error_to_openai_format')
def test_quota_error_should_stop_task(mock_normalize):
    """Test that insufficient_quota error SHOULD stop task."""
    # Setup mock to return insufficient_quota error
    mock_normalize.return_value = ((
        "You exceeded your current quota, please check "
        "your plan and billing details."), "insufficient_quota", {
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
    _, _, error_code = prepare_model_error_response(error, "project-id",
                                                    "task-id", "test context")

    # Verify this is a critical error that should stop the task
    assert should_stop_task(error_code) is True

    # Simulate the chat_service logic
    should_stop = should_stop_task(error_code)
    assert should_stop is True


@patch('app.service.error_handler.normalize_error_to_openai_format')
def test_unknown_error_should_not_stop_task(mock_normalize):
    """Test that unknown/generic errors do NOT stop task."""
    # Setup mock to return no specific error code
    mock_normalize.return_value = ("Some generic error message", None, None)

    error = ModelProcessingError("Some generic error")
    _, _, error_code = prepare_model_error_response(error, "project-id",
                                                    "task-id", "test context")

    # Verify this is NOT an invalid API key error
    assert should_stop_task(error_code) is False

    # Simulate the chat_service logic
    should_stop = should_stop_task(error_code)
    assert should_stop is False


def test_task_stop_logic_workflow():
    """Test the complete workflow of error handling and task stopping logic."""
    test_cases = [
        # (error_code, should_stop_task, description)
        ("invalid_api_key", True, "Invalid API key should stop task"),
        ("insufficient_quota", True, "Insufficient quota should stop task"),
        ("model_not_found", True, "Model not found should stop task"),
        ("rate_limit_exceeded", False, "Rate limit should not stop task"),
        (None, False, "Unknown error should not stop task"),
    ]

    for error_code, expected_stop, description in test_cases:
        should_stop = should_stop_task(error_code)
        assert should_stop == expected_stop, f"Failed: {description}"
