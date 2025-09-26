from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

from app.controller.model_controller import validate_model, ValidateModelRequest, ValidateModelResponse


@pytest.mark.unit
class TestModelController:
    """Test cases for model controller endpoints."""

    @pytest.mark.asyncio
    async def test_validate_model_success(self):
        """Test successful model validation."""
        request_data = ValidateModelRequest(
            model_platform="openai",
            model_type="gpt-4o",
            api_key="test_key",
            url="https://api.openai.com/v1",
            model_config_dict={"temperature": 0.7},
            extra_params={"max_tokens": 1000},
        )

        mock_agent = MagicMock()
        mock_response = MagicMock()
        tool_call = MagicMock()
        tool_call.result = (
            "Tool execution completed successfully for https://www.camel-ai.org, Website Content: Welcome to CAMEL AI!"
        )
        mock_response.info = {"tool_calls": [tool_call]}
        mock_agent.step.return_value = mock_response

        with patch("app.controller.model_controller.create_agent", return_value=mock_agent):
            response = await validate_model(request_data)

            assert isinstance(response, ValidateModelResponse)
            assert response.is_valid is True
            assert response.is_tool_calls is True
            assert response.message == "Validation Success"
            assert response.error_code is None
            assert response.error is None

    @pytest.mark.asyncio
    async def test_validate_model_creation_failure(self):
        """Test model validation when agent creation fails."""
        request_data = ValidateModelRequest(model_platform="INVALID", model_type="INVALID_MODEL", api_key="invalid_key")

        with patch(
            "app.controller.model_controller.create_agent", side_effect=Exception("Invalid model configuration")
        ):
            response = await validate_model(request_data)
            assert isinstance(response, ValidateModelResponse)
            assert response.is_valid is False
            assert response.is_tool_calls is False
            assert "Invalid model name" in response.message

    @pytest.mark.asyncio
    async def test_validate_model_step_failure(self):
        """Test model validation when agent step fails."""
        request_data = ValidateModelRequest(model_platform="openai", model_type="gpt-4o", api_key="test_key")

        mock_agent = MagicMock()
        mock_agent.step.side_effect = Exception("API call failed")

        with patch("app.controller.model_controller.create_agent", return_value=mock_agent):
            response = await validate_model(request_data)

            assert isinstance(response, ValidateModelResponse)
            assert response.is_valid is False
            assert response.is_tool_calls is False
            assert "API call failed" in response.message

    @pytest.mark.asyncio
    async def test_validate_model_tool_calls_false(self):
        """Test model validation when tool calls fail."""
        request_data = ValidateModelRequest(model_platform="openai", model_type="gpt-4o", api_key="test_key")

        mock_agent = MagicMock()
        mock_response = MagicMock()
        tool_call = MagicMock()
        tool_call.result = "Different response"
        mock_response.info = {"tool_calls": [tool_call]}
        mock_agent.step.return_value = mock_response

        with patch("app.controller.model_controller.create_agent", return_value=mock_agent):
            response = await validate_model(request_data)

            assert isinstance(response, ValidateModelResponse)
            assert response.is_valid is True
            assert response.is_tool_calls is False
            assert response.message == "This model doesn't support tool calls. please try with another model."

    @pytest.mark.asyncio
    async def test_validate_model_with_minimal_parameters(self):
        """Test model validation with minimal parameters."""
        request_data = ValidateModelRequest()  # Uses default values

        mock_agent = MagicMock()
        mock_response = MagicMock()
        tool_call = MagicMock()
        tool_call.result = (
            "Tool execution completed successfully for https://www.camel-ai.org, Website Content: Welcome to CAMEL AI!"
        )
        mock_response.info = {"tool_calls": [tool_call]}
        mock_agent.step.return_value = mock_response

        with patch("app.controller.model_controller.create_agent", return_value=mock_agent):
            response = await validate_model(request_data)
            assert isinstance(response, ValidateModelResponse)
            assert response.is_valid is False
            assert response.is_tool_calls is False
            assert response.error_code is not None
            assert response.error is not None

    @pytest.mark.asyncio
    async def test_validate_model_no_response(self):
        """Test model validation when no response is returned."""
        request_data = ValidateModelRequest(model_platform="openai", model_type="gpt-4o")

        mock_agent = MagicMock()
        mock_agent.step.return_value = None

        # When response is None, should return False
        with patch("app.controller.model_controller.create_agent", return_value=mock_agent):
            result = await validate_model(request_data)
            assert result.is_valid is False
            assert result.is_tool_calls is False
            assert result.error_code is None
            assert result.error is None


@pytest.mark.integration
class TestModelControllerIntegration:
    """Integration tests for model controller."""

    def test_validate_model_endpoint_integration(self, client: TestClient):
        """Test validate model endpoint through FastAPI test client."""
        request_data = {
            "model_platform": "openai",
            "model_type": "gpt-4o",
            "api_key": "test_key",
            "url": "https://api.openai.com/v1",
            "model_config_dict": {"temperature": 0.7},
            "extra_params": {"max_tokens": 1000},
        }

        mock_agent = MagicMock()
        mock_response = MagicMock()
        tool_call = MagicMock()
        tool_call.result = (
            "Tool execution completed successfully for https://www.camel-ai.org, Website Content: Welcome to CAMEL AI!"
        )
        mock_response.info = {"tool_calls": [tool_call]}
        mock_agent.step.return_value = mock_response

        with patch("app.controller.model_controller.create_agent", return_value=mock_agent):
            response = client.post("/model/validate", json=request_data)

            assert response.status_code == 200
            response_data = response.json()
            assert response_data["is_valid"] is True
            assert response_data["is_tool_calls"] is True
            assert response_data["message"] == "Validation Success"

    def test_validate_model_endpoint_error_integration(self, client: TestClient):
        """Test validate model endpoint error handling through FastAPI test client."""
        request_data = {"model_platform": "INVALID", "model_type": "INVALID_MODEL"}

        with patch("app.controller.model_controller.create_agent", side_effect=Exception("Test error")):
            response = client.post("/model/validate", json=request_data)

            assert response.status_code == 200  # Returns 200 with error in response body
            response_data = response.json()
            assert response_data["is_valid"] is False
            assert response_data["is_tool_calls"] is False
            assert "Invalid model name" in response_data["message"]


@pytest.mark.model_backend
class TestModelControllerWithRealModels:
    """Tests that require real model backends (marked for selective running)."""

    @pytest.mark.asyncio
    async def test_validate_model_with_real_openai_model(self):
        """Test model validation with real OpenAI model (requires API key)."""
        # This test would validate against real OpenAI API
        # Marked as model_backend for selective execution
        assert True  # Placeholder

    @pytest.mark.very_slow
    async def test_validate_multiple_model_platforms(self):
        """Test validation across multiple model platforms (very slow test)."""
        # This test would validate multiple different model platforms
        # Marked as very_slow for execution only in full test mode
        assert True  # Placeholder


@pytest.mark.unit
class TestModelControllerErrorCases:
    """Test error cases and edge conditions for model controller."""

    @pytest.mark.asyncio
    async def test_validate_model_with_invalid_json_config(self):
        """Test model validation with invalid JSON configuration."""
        request_data = ValidateModelRequest(
            model_platform="openai",
            model_type="gpt-4o",
            model_config_dict={"invalid": float("inf")},  # Invalid JSON value
        )

        with patch("app.controller.model_controller.create_agent", side_effect=ValueError("Invalid configuration")):
            response = await validate_model(request_data)

            assert response.is_valid is False
            assert "Invalid configuration" in response.message

    @pytest.mark.asyncio
    async def test_validate_model_with_network_error(self):
        """Test model validation with network connectivity issues."""
        request_data = ValidateModelRequest(model_platform="openai", model_type="gpt-4o", url="https://invalid-url.com")

        mock_agent = MagicMock()
        mock_agent.step.side_effect = ConnectionError("Network unreachable")

        with patch("app.controller.model_controller.create_agent", return_value=mock_agent):
            response = await validate_model(request_data)

            assert response.is_valid is False
            assert "Network unreachable" in response.message

    @pytest.mark.asyncio
    async def test_validate_model_with_malformed_tool_calls_response(self):
        """Test model validation with malformed tool calls in response."""
        request_data = ValidateModelRequest(model_platform="openai", model_type="gpt-4o")

        mock_agent = MagicMock()
        mock_response = MagicMock()
        mock_response.info = {
            "tool_calls": []  # Empty tool calls
        }
        mock_agent.step.return_value = mock_response

        with patch("app.controller.model_controller.create_agent", return_value=mock_agent):
            # Should handle empty tool calls gracefully
            result = await validate_model(request_data)
            assert result.is_valid is True  # Response exists
            assert result.is_tool_calls is False  # No valid tool calls

    @pytest.mark.asyncio
    async def test_validate_model_with_missing_info_field(self):
        """Test model validation with missing info field in response."""
        request_data = ValidateModelRequest(model_platform="openai", model_type="gpt-4o")

        mock_agent = MagicMock()
        mock_response = MagicMock()
        mock_response.info = {}  # Missing tool_calls
        mock_agent.step.return_value = mock_response

        with patch("app.controller.model_controller.create_agent", return_value=mock_agent):
            # Should handle missing tool_calls key gracefully
            result = await validate_model(request_data)
            assert result.is_valid is True  # Response exists
            assert result.is_tool_calls is False  # No tool_calls key

    @pytest.mark.asyncio
    async def test_validate_model_empty_api_key(self):
        """Test model validation with empty API key."""
        request_data = ValidateModelRequest(
            model_platform="openai",
            model_type="gpt-4o",
            api_key="",  # Empty API key
        )

        response = await validate_model(request_data)

        assert response.is_valid is False
        assert response.is_tool_calls is False
        assert response.message == "Invalid key. Validation failed."
        assert response.error_code == "invalid_api_key"
        assert response.error is not None
        assert response.error["message"] == "Invalid key. Validation failed."
        assert response.error["type"] == "invalid_request_error"
        assert response.error["code"] == "invalid_api_key"

    @pytest.mark.asyncio
    async def test_validate_model_invalid_model_type(self):
        """Test model validation with invalid model type."""
        request_data = ValidateModelRequest(
            model_platform="openai", model_type="INVALID_MODEL_TYPE", api_key="test_key"
        )

        response = await validate_model(request_data)
        assert response.is_valid is False
        assert response.is_tool_calls is False
        assert response.message == "Invalid model name. Validation failed."
        assert response.error_code is not None
        assert "model_not_found" in response.error_code
        assert response.error is not None
        assert response.error["message"] == "Invalid model name. Validation failed."
        assert response.error["type"] == "invalid_request_error"
        assert response.error["code"] == "model_not_found"
