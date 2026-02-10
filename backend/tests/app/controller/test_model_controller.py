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
from fastapi.testclient import TestClient

from app.component.model_validation import (
    EXPECTED_TOOL_RESULT,
    ValidationErrorType,
    ValidationResult,
    ValidationStage,
)
from app.controller.model_controller import (
    ValidateModelRequest,
    ValidateModelResponse,
    validate_model,
)


@pytest.mark.unit
class TestModelControllerEnhanced:
    """Test cases for enhanced model controller with detailed validation."""

    @pytest.mark.asyncio
    async def test_validate_model_with_diagnostics_success(self):
        """Test successful model validation with diagnostics enabled."""
        request_data = ValidateModelRequest(
            model_platform="openai",
            model_type="gpt-4o",
            api_key="test_key",
            include_diagnostics=True,
        )

        mock_agent = MagicMock()
        mock_response = MagicMock()
        tool_call = MagicMock()
        tool_call.result = EXPECTED_TOOL_RESULT
        mock_response.info = {"tool_calls": [tool_call]}
        mock_agent.step.return_value = mock_response

        with patch(
            "app.controller.model_controller.validate_model_with_details"
        ) as mock_validate:
            validation_result = ValidationResult()
            validation_result.is_valid = True
            validation_result.is_tool_calls = True
            validation_result.error_type = None
            validation_result.failed_stage = None
            validation_result.successful_stages = [
                ValidationStage.INITIALIZATION,
                ValidationStage.MODEL_CREATION,
                ValidationStage.AGENT_CREATION,
                ValidationStage.MODEL_CALL,
                ValidationStage.TOOL_CALL_EXECUTION,
            ]
            validation_result.validation_stages = {
                ValidationStage.INITIALIZATION: True,
                ValidationStage.MODEL_CREATION: True,
                ValidationStage.AGENT_CREATION: True,
                ValidationStage.MODEL_CALL: True,
                ValidationStage.TOOL_CALL_EXECUTION: True,
            }
            validation_result.diagnostic_info = {
                "initialization": {"model_platform": "openai"},
                "model_creation": {"model_created": True},
            }
            validation_result.model_response_info = {
                "has_response": True,
                "tool_calls_count": 1,
            }
            validation_result.tool_call_info = {
                "tool_calls_count": 1,
                "execution_successful": True,
            }
            mock_validate.return_value = validation_result

            response = await validate_model(request_data)

            assert isinstance(response, ValidateModelResponse)
            assert response.is_valid is True
            assert response.is_tool_calls is True
            assert response.error_type is None
            assert response.failed_stage is None
            assert response.successful_stages == [
                "initialization",
                "model_creation",
                "agent_creation",
                "model_call",
                "tool_call_execution",
            ]
            assert response.diagnostic_info is not None
            assert response.model_response_info is not None
            assert response.tool_call_info is not None
            assert response.validation_stages is not None
            assert (
                response.validation_stages["tool_call_execution"] is True
            )

    @pytest.mark.asyncio
    async def test_validate_model_with_diagnostics_failure(self):
        """Test model validation failure with diagnostics enabled."""
        request_data = ValidateModelRequest(
            model_platform="openai",
            model_type="gpt-4o",
            api_key="invalid_key",
            include_diagnostics=True,
        )

        with patch(
            "app.controller.model_controller.validate_model_with_details"
        ) as mock_validate:
            validation_result = ValidationResult()
            validation_result.is_valid = False
            validation_result.is_tool_calls = False
            validation_result.error_type = ValidationErrorType.AUTHENTICATION_ERROR
            validation_result.failed_stage = ValidationStage.MODEL_CREATION
            validation_result.raw_error_message = "401 Unauthorized"
            validation_result.error_message = "401 Unauthorized"
            validation_result.successful_stages = [
                ValidationStage.INITIALIZATION
            ]
            validation_result.validation_stages = {
                ValidationStage.INITIALIZATION: True,
                ValidationStage.MODEL_CREATION: False,
            }
            validation_result.diagnostic_info = {
                "initialization": {"model_platform": "openai"},
            }
            mock_validate.return_value = validation_result

            response = await validate_model(request_data)

            assert isinstance(response, ValidateModelResponse)
            assert response.is_valid is False
            assert response.is_tool_calls is False
            assert response.error_type == "authentication_error"
            assert response.failed_stage == "model_creation"
            assert response.successful_stages == ["initialization"]
            assert response.diagnostic_info is not None
            assert response.message == "401 Unauthorized"

    @pytest.mark.asyncio
    async def test_validate_model_without_diagnostics(self):
        """Test model validation without diagnostics (default)."""
        request_data = ValidateModelRequest(
            model_platform="openai",
            model_type="gpt-4o",
            api_key="test_key",
            include_diagnostics=False,
        )

        with patch(
            "app.controller.model_controller.validate_model_with_details"
        ) as mock_validate:
            validation_result = ValidationResult()
            validation_result.is_valid = True
            validation_result.is_tool_calls = True
            mock_validate.return_value = validation_result

            response = await validate_model(request_data)

            assert isinstance(response, ValidateModelResponse)
            assert response.is_valid is True
            assert response.is_tool_calls is True
            # Diagnostic fields should not be included when include_diagnostics=False
            assert response.error_type is None
            assert response.failed_stage is None
            assert response.successful_stages is None
            assert response.diagnostic_info is None

    @pytest.mark.asyncio
    async def test_validate_model_tool_call_not_supported(self):
        """Test model validation when tool calls are not supported."""
        request_data = ValidateModelRequest(
            model_platform="openai",
            model_type="gpt-4o",
            api_key="test_key",
            include_diagnostics=True,
        )

        with patch(
            "app.controller.model_controller.validate_model_with_details"
        ) as mock_validate:
            validation_result = ValidationResult()
            validation_result.is_valid = True
            validation_result.is_tool_calls = False
            validation_result.error_type = (
                ValidationErrorType.TOOL_CALL_NOT_SUPPORTED
            )
            validation_result.failed_stage = (
                ValidationStage.TOOL_CALL_EXECUTION
            )
            validation_result.successful_stages = [
                ValidationStage.INITIALIZATION,
                ValidationStage.MODEL_CREATION,
                ValidationStage.AGENT_CREATION,
                ValidationStage.MODEL_CALL,
            ]
            mock_validate.return_value = validation_result

            response = await validate_model(request_data)

            assert isinstance(response, ValidateModelResponse)
            assert response.is_valid is True
            assert response.is_tool_calls is False
            assert response.error_type == "tool_call_not_supported"
            assert (
                "does not support tool calling" in response.message
                or "tool call" in response.message.lower()
            )

    @pytest.mark.asyncio
    async def test_validate_model_tool_call_execution_failed(self):
        """Test model validation when tool call execution fails."""
        request_data = ValidateModelRequest(
            model_platform="openai",
            model_type="gpt-4o",
            api_key="test_key",
            include_diagnostics=True,
        )

        with patch(
            "app.controller.model_controller.validate_model_with_details"
        ) as mock_validate:
            validation_result = ValidationResult()
            validation_result.is_valid = False
            validation_result.is_tool_calls = False
            validation_result.error_type = (
                ValidationErrorType.TOOL_CALL_EXECUTION_FAILED
            )
            validation_result.failed_stage = (
                ValidationStage.TOOL_CALL_EXECUTION
            )
            validation_result.raw_error_message = "Tool execution failed"
            validation_result.error_message = "Tool execution failed"
            mock_validate.return_value = validation_result

            response = await validate_model(request_data)

            assert isinstance(response, ValidateModelResponse)
            assert response.is_valid is False
            assert response.is_tool_calls is False
            assert response.error_type == "tool_call_execution_failed"
            assert response.message == "Tool execution failed"

    @pytest.mark.asyncio
    async def test_validate_model_network_error(self):
        """Test model validation with network error."""
        request_data = ValidateModelRequest(
            model_platform="openai",
            model_type="gpt-4o",
            api_key="test_key",
            include_diagnostics=True,
        )

        with patch(
            "app.controller.model_controller.validate_model_with_details"
        ) as mock_validate:
            validation_result = ValidationResult()
            validation_result.is_valid = False
            validation_result.is_tool_calls = False
            validation_result.error_type = ValidationErrorType.NETWORK_ERROR
            validation_result.failed_stage = ValidationStage.MODEL_CREATION
            validation_result.raw_error_message = "Connection timeout"
            validation_result.error_message = "Connection timeout"
            mock_validate.return_value = validation_result

            response = await validate_model(request_data)

            assert isinstance(response, ValidateModelResponse)
            assert response.is_valid is False
            assert response.error_type == "network_error"
            assert response.message == "Connection timeout"

    @pytest.mark.asyncio
    async def test_validate_model_rate_limit_error(self):
        """Test model validation with rate limit error."""
        request_data = ValidateModelRequest(
            model_platform="openai",
            model_type="gpt-4o",
            api_key="test_key",
            include_diagnostics=True,
        )

        with patch(
            "app.controller.model_controller.validate_model_with_details"
        ) as mock_validate:
            validation_result = ValidationResult()
            validation_result.is_valid = False
            validation_result.is_tool_calls = False
            validation_result.error_type = ValidationErrorType.RATE_LIMIT_ERROR
            validation_result.failed_stage = ValidationStage.MODEL_CALL
            validation_result.raw_error_message = "429 Rate limit exceeded"
            validation_result.error_message = "429 Rate limit exceeded"
            mock_validate.return_value = validation_result

            response = await validate_model(request_data)

            assert isinstance(response, ValidateModelResponse)
            assert response.is_valid is False
            assert response.error_type == "rate_limit_error"
            assert response.message == "429 Rate limit exceeded"

    @pytest.mark.asyncio
    async def test_validate_model_empty_api_key(self):
        """Test model validation with empty API key."""
        request_data = ValidateModelRequest(
            model_platform="openai",
            model_type="gpt-4o",
            api_key="",  # Empty API key
        )

        # Should raise HTTPException before calling validate_model_with_details
        with pytest.raises(Exception):  # HTTPException is raised
            await validate_model(request_data)

    @pytest.mark.asyncio
    async def test_validate_model_error_response_structure(self):
        """Test that error response structure is correct."""
        request_data = ValidateModelRequest(
            model_platform="openai",
            model_type="gpt-4o",
            api_key="test_key",
            include_diagnostics=True,
        )

        with patch(
            "app.controller.model_controller.validate_model_with_details"
        ) as mock_validate:
            validation_result = ValidationResult()
            validation_result.is_valid = False
            validation_result.is_tool_calls = False
            validation_result.error_type = ValidationErrorType.AUTHENTICATION_ERROR
            validation_result.error_message = "Invalid API key"
            validation_result.error_details = {"code": "invalid_key"}
            mock_validate.return_value = validation_result

            response = await validate_model(request_data)

            assert response.error_code == "authentication_error"
            assert response.error is not None
            assert response.error["type"] == "invalid_request_error"
            assert response.error["code"] == "authentication_error"
            assert response.error["message"] == "Invalid API key"
            assert "details" in response.error
            assert response.error["details"]["code"] == "invalid_key"


@pytest.mark.integration
class TestModelControllerIntegrationEnhanced:
    """Integration tests for enhanced model controller."""

    def test_validate_model_endpoint_with_diagnostics(
        self, client: TestClient
    ):
        """Test validate model endpoint with diagnostics through FastAPI test client."""
        request_data = {
            "model_platform": "openai",
            "model_type": "gpt-4o",
            "api_key": "test_key",
            "include_diagnostics": True,
        }

        with patch(
            "app.controller.model_controller.validate_model_with_details"
        ) as mock_validate:
            validation_result = ValidationResult()
            validation_result.is_valid = True
            validation_result.is_tool_calls = True
            validation_result.successful_stages = [
                ValidationStage.INITIALIZATION,
                ValidationStage.MODEL_CREATION,
                ValidationStage.AGENT_CREATION,
                ValidationStage.MODEL_CALL,
                ValidationStage.TOOL_CALL_EXECUTION,
            ]
            validation_result.validation_stages = {
                ValidationStage.INITIALIZATION: True,
                ValidationStage.MODEL_CREATION: True,
                ValidationStage.AGENT_CREATION: True,
                ValidationStage.MODEL_CALL: True,
                ValidationStage.TOOL_CALL_EXECUTION: True,
            }
            validation_result.diagnostic_info = {"test": "info"}
            validation_result.model_response_info = {"has_response": True}
            validation_result.tool_call_info = {"tool_calls_count": 1}
            mock_validate.return_value = validation_result

            response = client.post("/model/validate", json=request_data)

            assert response.status_code == 200
            response_data = response.json()
            assert response_data["is_valid"] is True
            assert response_data["is_tool_calls"] is True
            assert "error_type" in response_data
            assert "failed_stage" in response_data
            assert "successful_stages" in response_data
            assert "diagnostic_info" in response_data
            assert "model_response_info" in response_data
            assert "tool_call_info" in response_data
            assert "validation_stages" in response_data

    def test_validate_model_endpoint_without_diagnostics(
        self, client: TestClient
    ):
        """Test validate model endpoint without diagnostics through FastAPI test client."""
        request_data = {
            "model_platform": "openai",
            "model_type": "gpt-4o",
            "api_key": "test_key",
            "include_diagnostics": False,
        }

        with patch(
            "app.controller.model_controller.validate_model_with_details"
        ) as mock_validate:
            validation_result = ValidationResult()
            validation_result.is_valid = True
            validation_result.is_tool_calls = True
            mock_validate.return_value = validation_result

            response = client.post("/model/validate", json=request_data)

            assert response.status_code == 200
            response_data = response.json()
            assert response_data["is_valid"] is True
            assert response_data["is_tool_calls"] is True
            # Diagnostic fields should not be present when include_diagnostics=False
            assert "error_type" not in response_data or response_data.get("error_type") is None
            assert "failed_stage" not in response_data or response_data.get("failed_stage") is None

