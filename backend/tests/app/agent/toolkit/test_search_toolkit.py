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

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from app.agent.toolkit.search_toolkit import SearchToolkit
from app.service.task import TaskLock, task_locks

pytestmark = pytest.mark.unit

_ENV_MOD = "app.agent.toolkit.search_toolkit.env"
_ENV_NOT_EMPTY_MOD = "app.agent.toolkit.search_toolkit.env_not_empty"
_TEST_TASK_ID = "test_task_search"


def _ensure_task_lock(task_id: str = _TEST_TASK_ID):
    """Ensure a task lock exists for the given task_id."""
    if task_id not in task_locks:
        task_locks[task_id] = TaskLock(
            id=task_id, queue=asyncio.Queue(), human_input={}
        )


def test_get_can_use_tools_duckduckgo_fallback_when_no_keys():
    """When no Google API keys or cloud_api_key, DuckDuckGo is used."""
    with patch(_ENV_MOD, return_value=None):
        tools = SearchToolkit.get_can_use_tools("test_task")
        assert len(tools) == 1
        assert "duckduckgo" in tools[0].func.__name__


def test_get_can_use_tools_google_api_when_keys_present():
    """When Google API keys are present, search_google is used."""

    def mock_env(key, default=None):
        return {
            "GOOGLE_API_KEY": "test-key",
            "SEARCH_ENGINE_ID": "test-cx",
        }.get(key, default)

    with patch(_ENV_MOD, side_effect=mock_env):
        tools = SearchToolkit.get_can_use_tools("test_task")
        assert len(tools) == 1
        assert "search_google" == tools[0].func.__name__


def test_get_can_use_tools_cloud_api_key():
    """When cloud_api_key is present, search_google is used."""

    def mock_env(key, default=None):
        return {"cloud_api_key": "cloud-key"}.get(key, default)

    with patch(_ENV_MOD, side_effect=mock_env):
        tools = SearchToolkit.get_can_use_tools("test_task")
        assert len(tools) == 1
        assert "search_google" == tools[0].func.__name__


def test_get_can_use_tools_accepts_agent_name():
    """get_can_use_tools passes agent_name to the toolkit instance."""
    with patch(_ENV_MOD, return_value=None):
        tools = SearchToolkit.get_can_use_tools(
            "test_task", agent_name="test_agent"
        )
        assert len(tools) == 1


def test_search_google_uses_user_keys():
    """search_google uses user-configured API keys when available."""
    _ensure_task_lock()

    def mock_env(key, default=None):
        return {
            "GOOGLE_API_KEY": "user-key",
            "SEARCH_ENGINE_ID": "user-cx",
        }.get(key, default)

    toolkit = SearchToolkit(_TEST_TASK_ID)
    with patch(_ENV_MOD, side_effect=mock_env):
        with patch.object(
            SearchToolkit.__bases__[0],
            "search_google",
            return_value=[{"result_id": 1, "title": "test"}],
        ) as mock_super:
            result = toolkit.search_google("test query")
            mock_super.assert_called_once()
            assert result == [{"result_id": 1, "title": "test"}]


def test_search_google_falls_back_to_cloud():
    """search_google falls back to cloud search when no user keys."""
    _ensure_task_lock()

    toolkit = SearchToolkit(_TEST_TASK_ID)
    with patch(_ENV_MOD, return_value=None):
        with patch.object(
            toolkit,
            "cloud_search_google",
            return_value=[{"result_id": 1, "title": "cloud"}],
        ) as mock_cloud:
            result = toolkit.search_google("test query")
            mock_cloud.assert_called_once_with("test query", "web", 10, 1)
            assert result == [{"result_id": 1, "title": "cloud"}]


def test_get_can_use_tools_google_keys_no_duckduckgo():
    """When Google API keys are present, DuckDuckGo is NOT included."""

    def mock_env(key, default=None):
        return {
            "GOOGLE_API_KEY": "test-key",
            "SEARCH_ENGINE_ID": "test-cx",
        }.get(key, default)

    with patch(_ENV_MOD, side_effect=mock_env):
        tools = SearchToolkit.get_can_use_tools("test_task")
        names = [t.func.__name__ for t in tools]
        assert "duckduckgo" not in " ".join(names)


def test_search_duckduckgo_delegates_to_base():
    """search_duckduckgo delegates to the base class method."""
    _ensure_task_lock()

    toolkit = SearchToolkit(_TEST_TASK_ID)
    expected = [{"result_id": 1, "title": "duck result"}]

    with patch.object(
        SearchToolkit.__bases__[0],
        "search_duckduckgo",
        return_value=expected,
    ) as mock_super:
        result = toolkit.search_duckduckgo("test query")
        mock_super.assert_called_once()
        assert result == expected


def test_cloud_search_google_calls_server():
    """cloud_search_google makes HTTP request to server proxy."""
    toolkit = SearchToolkit("test_task")

    mock_response = MagicMock()
    mock_response.json.return_value = [{"result_id": 1, "title": "proxied"}]

    with (
        patch(
            _ENV_NOT_EMPTY_MOD,
            side_effect=lambda k: {
                "SERVER_URL": "http://test-server",
                "cloud_api_key": "test-cloud-key",
            }[k],
        ),
        patch(
            "app.agent.toolkit.search_toolkit.httpx.get",
            return_value=mock_response,
        ) as mock_get,
    ):
        result = toolkit.cloud_search_google("test query")

    mock_get.assert_called_once()
    assert result == [{"result_id": 1, "title": "proxied"}]
