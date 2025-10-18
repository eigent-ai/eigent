# ========= Copyright 2025 @ EIGENT.AI. All Rights Reserved. =========
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
# ========= Copyright 2025 @ EIGENT.AI. All Rights Reserved. =========

import asyncio
import os
import tempfile
from pathlib import Path
from typing import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Load environment variables
load_dotenv()


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--full-test-mode", action="store_true", help="Run all tests"
    )
    parser.addoption(
        "--default-test-mode",
        action="store_true",
        help="Run all tests except the very slow ones",
    )
    parser.addoption(
        "--fast-test-mode",
        action="store_true",
        help="Run only tests without LLM inference",
    )
    parser.addoption(
        "--llm-test-only",
        action="store_true",
        help="Run only tests with LLM inference except the very slow ones",
    )
    parser.addoption(
        "--very-slow-test-only",
        action="store_true",
        help="Run only the very slow tests",
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if config.getoption("--llm-test-only"):
        skip_fast = pytest.mark.skip(reason="Skipped for llm test only")
        for item in items:
            if "model_backend" not in item.keywords:
                item.add_marker(skip_fast)
        return
    elif config.getoption("--very-slow-test-only"):
        skip_fast = pytest.mark.skip(reason="Skipped for very slow test only")
        for item in items:
            if "very_slow" not in item.keywords:
                item.add_marker(skip_fast)
        return
    # Run all tests in full test mode
    elif config.getoption("--full-test-mode"):
        return
    # Skip all tests involving LLM inference both remote
    # (including OpenAI API) and local ones, since they are slow
    # and may drain money if fast test mode is enabled.
    elif config.getoption("--fast-test-mode"):
        skip = pytest.mark.skip(reason="Skipped for fast test mode")
        for item in items:
            if "optional" in item.keywords or "model_backend" in item.keywords:
                item.add_marker(skip)
        return
    else:
        skip_full_test = pytest.mark.skip(
            reason="Very slow test runs only in full test mode"
        )
        for item in items:
            if "very_slow" in item.keywords:
                item.add_marker(skip_full_test)
        return


@pytest.fixture
def temp_dir() -> Generator[Path, None, None]:
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield Path(temp_dir)


@pytest.fixture
def sample_file_path(temp_dir: Path) -> Path:
    """Create a sample file for testing."""
    file_path = temp_dir / "test_file.txt"
    file_path.write_text("Sample content for testing")
    return file_path


@pytest.fixture
def sample_env_path(temp_dir: Path) -> Path:
    """Create a sample .env file for testing."""
    env_path = temp_dir / ".env"
    env_path.write_text("SAMPLE_ENV_VAR=test_value\nOPENAI_API_KEY=test_key")
    return env_path


@pytest.fixture
def mock_openai_api():
    """Mock OpenAI API calls."""
    with patch("openai.OpenAI") as mock_openai:
        mock_client = MagicMock()
        mock_openai.return_value = mock_client
        
        # Mock chat completion
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Test response"
        mock_response.usage.total_tokens = 100
        
        mock_client.chat.completions.create.return_value = mock_response
        yield mock_client


@pytest.fixture
def mock_model_backend():
    """Mock model backend for testing."""
    with patch("camel.models.ModelFactory.create") as mock_create:
        backend = MagicMock()
        backend.model_type = "gpt-4"
        backend.model_config_dict = {"max_tokens": 4096}
        backend.current_model = MagicMock()
        backend.current_model.model_type = "gpt-4"
        mock_create.return_value = backend
        yield backend


@pytest.fixture
def mock_camel_agent():
    """Mock CAMEL agent for testing."""
    agent = MagicMock()  # Use MagicMock instead of AsyncMock
    agent.role_name = "test_agent"
    agent.agent_id = "test_agent_123"
    
    # Make step method return proper structure with both .msg and .msgs[0]
    mock_response = MagicMock()
    mock_message = MagicMock()
    mock_message.content = "Test agent response"
    mock_message.parsed = None
    
    mock_response.msg = mock_message
    mock_response.msgs = [mock_message]  # msgs[0] should point to the same content
    mock_response.info = {"usage": {"total_tokens": 50}}
    
    agent.step.return_value = mock_response
    
    agent.astep = AsyncMock()
    agent.astep.return_value.msg.content = "Test async agent response"
    agent.astep.return_value.msg.parsed = None
    agent.astep.return_value.info = {"usage": {"total_tokens": 50}}
    agent.add_tools = MagicMock()  # Add this for install_mcp tests
    agent.chat_history = []  # Add this for chat history tests
    return agent


@pytest.fixture
def mock_task():
    """Mock CAMEL Task for testing."""
    task = MagicMock()
    task.id = "test_task_123"
    task.content = "Test task content"
    task.result = None
    task.state = "OPEN"  # Changed from CREATED to OPEN
    task.additional_info = {}
    task.parent = None
    task.subtasks = []
    return task


@pytest.fixture
def mock_request():
    """Mock FastAPI Request object."""
    request = AsyncMock()
    request.is_disconnected = AsyncMock(return_value=False)
    return request


@pytest.fixture
def app() -> FastAPI:
    """Create FastAPI test application."""
    from fastapi import FastAPI
    from app.controller.chat_controller import router as chat_router
    from app.controller.model_controller import router as model_router
    from app.controller.task_controller import router as task_router
    from app.controller.tool_controller import router as tool_router
    
    app = FastAPI()
    app.include_router(chat_router)
    app.include_router(model_router)
    app.include_router(task_router)
    app.include_router(tool_router)
    
    return app


@pytest.fixture
def client(app: FastAPI) -> Generator[TestClient, None, None]:
    """Create test client."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def mock_task_lock():
    """Mock TaskLock for testing."""
    task_lock = MagicMock()
    task_lock.id = "test_task_123"
    task_lock.status = "OPEN"  # Changed from CREATED to OPEN
    task_lock.queue = asyncio.Queue()
    task_lock.get_queue = AsyncMock()
    task_lock.put_queue = AsyncMock()
    task_lock.put_human_input = AsyncMock()
    task_lock.add_background_task = MagicMock()
    return task_lock


@pytest.fixture
def mock_workforce():
    """Mock Workforce for testing."""
    workforce = MagicMock()
    workforce._running = False
    workforce.eigent_make_sub_tasks = MagicMock(return_value=[])
    workforce.eigent_start = AsyncMock()
    workforce.add_single_agent_worker = MagicMock()
    workforce.pause = MagicMock()
    workforce.resume = MagicMock()
    workforce.stop = MagicMock()
    workforce.stop_gracefully = MagicMock()
    return workforce


@pytest.fixture
def mock_worker_with_agent():
    """Mock worker with agent_id for SingleAgentWorker tests."""
    worker = MagicMock()
    worker.agent_id = "test_agent_123"
    worker.astep = AsyncMock()
    worker.step = MagicMock()
    
    # Mock response structure
    mock_response = MagicMock()
    mock_response.msg = MagicMock()
    mock_response.msg.content = "Test worker response"
    mock_response.msg.parsed = {"result": "test"}
    mock_response.info = {"usage": {"total_tokens": 50}}
    
    worker.astep.return_value = mock_response
    worker.step.return_value = mock_response
    return worker


@pytest.fixture(scope="function")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_environment_variables():
    """Mock environment variables for testing."""
    env_vars = {
        "OPENAI_API_KEY": "test_key",
        "OPENAI_API_BASE_URL": "https://api.openai.com/v1",
        "CAMEL_MODEL_LOG_ENABLED": "true",
        "CAMEL_LOG_DIR": "/tmp/test_logs",
        "file_save_path": "/tmp/test_files",
        "browser_port": "8080"
    }
    
    with patch.dict(os.environ, env_vars, clear=False):
        yield env_vars


@pytest.fixture
def sample_chat_data():
    """Sample chat data for testing."""
    return {
        "task_id": "test_task_123",
        "project_id": "test_project_456",
        "email": "test@example.com",
        "question": "Create a simple Python script",
        "attaches": [],
        "model_type": "gpt-4",
        "model_platform": "openai",
        "api_key": "test_key",
        "api_url": "https://api.openai.com/v1",
        "new_agents": [],
        "env_path": ".env",
        "browser_port": 8080,
        "summary_prompt": ""
    }


@pytest.fixture
def sample_task_content():
    """Sample task content for testing."""
    return {
        "id": "test_task_123",
        "content": "Test task content",
        "state": "OPEN"  # Changed from CREATED to OPEN
    }


# Async fixtures
@pytest.fixture
async def async_mock_agent() -> AsyncGenerator[AsyncMock, None]:
    """Async mock agent for testing."""
    agent = AsyncMock()
    agent.role_name = "async_test_agent"
    agent.agent_id = "async_test_agent_456"
    
    # Mock async step method
    mock_response = MagicMock()
    mock_response.msg.content = "Async test response"
    mock_response.msg.parsed = {"test": "data"}
    mock_response.info = {"usage": {"total_tokens": 75}}
    
    agent.astep.return_value = mock_response
    
    yield agent


# Markers for test categorization
pytest_plugins = ["pytest_asyncio"]


def pytest_configure(config):
    """Configure pytest markers."""
    config.addinivalue_line(
        "markers", "model_backend: mark test as requiring model backend"
    )
    config.addinivalue_line(
        "markers", "very_slow: mark test as very slow (requires full test mode)"
    )
    config.addinivalue_line(
        "markers", "optional: mark test as optional (skipped in fast mode)"
    )
    config.addinivalue_line(
        "markers", "integration: mark test as integration test"
    )
    config.addinivalue_line(
        "markers", "unit: mark test as unit test"
    )
