import pytest
from fastapi.testclient import TestClient
from app.controller.health_controller import HealthResponse

@pytest.mark.unit
class TestHealthController:
    """Test cases for health controller."""

    def test_health_response_model(self):
        """Test HealthResponse model structure."""
        model = HealthResponse(status="ok", service="eigent")
        assert model.status == "ok"
        assert model.service == "eigent"

    @pytest.mark.asyncio
    async def test_health_check_function(self):
        """Test the health_check function directly."""
        from app.controller.health_controller import health_check
        
        response = await health_check()
        assert isinstance(response, HealthResponse)
        assert response.status == "ok"
        assert response.service == "eigent"

@pytest.mark.integration
class TestHealthControllerIntegration:
    """Integration tests for health controller."""

    def test_health_check_endpoint(self, client: TestClient):
        """Test health check endpoint via TestClient."""
        # Note: This assumes the router is included in the app created by the client fixture
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "eigent"}
