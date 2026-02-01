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

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.utils.listen.toolkit_listen import (MAX_LENGTH, _format_args,
                                             _format_result, _truncate,
                                             listen_toolkit)


@pytest.mark.unit
def test_truncate_short_text():
    """Text shorter than max_length should not be truncated."""
    text = "short text"
    result = _truncate(text)
    assert result == text


@pytest.mark.unit
def test_truncate_long_text():
    """Text longer than max_length should be truncated with message."""
    text = "a" * 600
    result = _truncate(text)
    assert len(result) < len(text)
    assert result.startswith("a" * MAX_LENGTH)
    assert "truncated" in result
    assert "600 chars" in result


@pytest.mark.unit
def test_truncate_custom_max_length():
    """Custom max_length should be respected."""
    text = "hello world"
    result = _truncate(text, max_length=5)
    assert result.startswith("hello")
    assert "truncated" in result


@pytest.mark.unit
def test_format_args_with_positional_args():
    """Format positional args, excluding self."""
    args = ("self", "arg1", "arg2")
    kwargs = {}
    result = _format_args(args, kwargs, None)
    assert "'arg1'" in result
    assert "'arg2'" in result
    assert "self" not in result


@pytest.mark.unit
def test_format_args_with_kwargs():
    """Format keyword arguments."""
    args = ("self", )
    kwargs = {"key1": "value1", "key2": 42}
    result = _format_args(args, kwargs, None)
    assert "key1='value1'" in result
    assert "key2=42" in result


@pytest.mark.unit
def test_format_args_with_both():
    """Format both positional and keyword arguments."""
    args = ("self", "pos_arg")
    kwargs = {"key": "value"}
    result = _format_args(args, kwargs, None)
    assert "'pos_arg'" in result
    assert "key='value'" in result


@pytest.mark.unit
def test_format_args_with_custom_formatter():
    """Custom formatter should be used when provided."""
    args = ("self", "arg1")
    kwargs = {"key": "value"}

    def formatter(*_args, **_kwargs):
        return "custom_format"

    result = _format_args(args, kwargs, formatter)
    assert result == "custom_format"


@pytest.mark.unit
def test_format_args_truncates_long_output():
    """Long formatted args should be truncated."""
    args = ("self", "a" * 600)
    kwargs = {}
    result = _format_args(args, kwargs, None)
    assert "truncated" in result


@pytest.mark.unit
def test_format_result_with_error():
    """Error should be converted to string."""
    error = ValueError("test error")
    result = _format_result(None, error, None)
    assert result == "test error"


@pytest.mark.unit
def test_format_result_with_custom_formatter():
    """Custom formatter should be used when provided."""

    def formatter(res):
        return f"formatted: {res}"

    result = _format_result("value", None, formatter)
    assert result == "formatted: value"


@pytest.mark.unit
def test_format_result_with_string():
    """String result should be returned as-is."""
    result = _format_result("string result", None, None)
    assert result == "string result"


@pytest.mark.unit
def test_format_result_with_dict():
    """Dict should be JSON serialized."""
    result = _format_result({"key": "value"}, None, None)
    assert result == '{"key": "value"}'


@pytest.mark.unit
def test_format_result_with_non_serializable():
    """Non-serializable objects should be converted to truncated string."""
    non_serializable = object()
    result = _format_result(non_serializable, None, None)
    assert "object" in result


@pytest.mark.unit
def test_format_result_truncates_long_error():
    """Long error messages should be truncated."""
    error = ValueError("e" * 600)
    result = _format_result(None, error, None)
    assert "truncated" in result


@pytest.mark.unit
def test_format_result_truncates_long_string():
    """Long string results should be truncated."""
    result = _format_result("x" * 600, None, None)
    assert "truncated" in result


@pytest.mark.unit
def test_format_result_truncates_long_json():
    """Large JSON-serializable results should be truncated."""
    big_dict = {"k": "v" * 600}
    result = _format_result(big_dict, None, None)
    assert "truncated" in result


@pytest.mark.unit
def test_format_result_truncates_long_formatter_output():
    """Long custom formatter output should be truncated."""

    def formatter(res):
        return "x" * 600

    result = _format_result("value", None, formatter)
    assert "truncated" in result


# =============================================================================
# listen_toolkit decorator tests
# =============================================================================


def _create_mock_toolkit(api_task_id="test_task_123"):
    """Create a mock toolkit for testing."""
    toolkit = MagicMock()
    toolkit.api_task_id = api_task_id
    toolkit.agent_name = "test_agent"
    toolkit.toolkit_name.return_value = "TestToolkit"
    return toolkit


@pytest.mark.unit
def test_listen_toolkit_sync_returns_result():
    """Sync decorated function should return the correct result."""
    mock_toolkit = _create_mock_toolkit()
    mock_task_lock = MagicMock()
    mock_task_lock.put_queue = AsyncMock()

    with patch("app.utils.listen.toolkit_listen.get_task_lock",
               return_value=mock_task_lock):

        @listen_toolkit()
        def test_method(self, arg1):
            return f"result: {arg1}"

        result = test_method(mock_toolkit, "hello")
        assert result == "result: hello"


@pytest.mark.unit
def test_listen_toolkit_sync_raises_exception():
    """Sync decorated function should propagate exceptions."""
    mock_toolkit = _create_mock_toolkit()
    mock_task_lock = MagicMock()
    mock_task_lock.put_queue = AsyncMock()

    with patch("app.utils.listen.toolkit_listen.get_task_lock",
               return_value=mock_task_lock):

        @listen_toolkit()
        def test_method(self):
            raise ValueError("test error")

        with pytest.raises(ValueError, match="test error"):
            test_method(mock_toolkit)


@pytest.mark.unit
def test_listen_toolkit_sync_without_api_task_id():
    """Sync function should be called directly if api_task_id is missing."""
    toolkit = MagicMock(spec=[])  # No api_task_id attribute

    @listen_toolkit()
    def test_method(self, value):
        return value * 2

    result = test_method(toolkit, 5)
    assert result == 10


@pytest.mark.unit
def test_listen_toolkit_marks_wrapper():
    """Decorated function should have __listen_toolkit__ marker."""

    @listen_toolkit()
    def sync_method(self):
        pass

    @listen_toolkit()
    async def async_method(self):
        pass

    assert hasattr(sync_method, "__listen_toolkit__")
    assert sync_method.__listen_toolkit__ is True
    assert hasattr(async_method, "__listen_toolkit__")
    assert async_method.__listen_toolkit__ is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_listen_toolkit_async_returns_result():
    """Async decorated function should return the correct result."""
    mock_toolkit = _create_mock_toolkit()
    mock_task_lock = MagicMock()
    mock_task_lock.put_queue = AsyncMock()

    with patch("app.utils.listen.toolkit_listen.get_task_lock",
               return_value=mock_task_lock):

        @listen_toolkit()
        async def test_method(self, arg1):
            return f"async result: {arg1}"

        result = await test_method(mock_toolkit, "world")
        assert result == "async result: world"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_listen_toolkit_async_raises_exception():
    """Async decorated function should propagate exceptions."""
    mock_toolkit = _create_mock_toolkit()
    mock_task_lock = MagicMock()
    mock_task_lock.put_queue = AsyncMock()

    with patch("app.utils.listen.toolkit_listen.get_task_lock",
               return_value=mock_task_lock):

        @listen_toolkit()
        async def test_method(self):
            raise RuntimeError("async error")

        with pytest.raises(RuntimeError, match="async error"):
            await test_method(mock_toolkit)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_listen_toolkit_async_without_api_task_id():
    """Async function should be called directly if api_task_id is missing."""
    toolkit = MagicMock(spec=[])  # No api_task_id attribute

    @listen_toolkit()
    async def test_method(self, value):
        return value + 10

    result = await test_method(toolkit, 5)
    assert result == 15


@pytest.mark.unit
def test_listen_toolkit_with_custom_inputs_formatter():
    """Custom inputs formatter should be used."""
    mock_toolkit = _create_mock_toolkit()
    mock_task_lock = MagicMock()
    mock_task_lock.put_queue = AsyncMock()

    custom_formatter_called = []

    def custom_inputs(self, arg1, arg2):
        custom_formatter_called.append((arg1, arg2))
        return f"custom: {arg1}, {arg2}"

    with patch("app.utils.listen.toolkit_listen.get_task_lock",
               return_value=mock_task_lock):

        @listen_toolkit(inputs=custom_inputs)
        def test_method(self, arg1, arg2):
            return "done"

        test_method(mock_toolkit, "a", "b")

    assert len(custom_formatter_called) == 1
    assert custom_formatter_called[0] == ("a", "b")


@pytest.mark.unit
def test_listen_toolkit_with_custom_return_msg_formatter():
    """Custom return_msg formatter should be used."""
    mock_toolkit = _create_mock_toolkit()
    mock_task_lock = MagicMock()
    mock_task_lock.put_queue = AsyncMock()

    def custom_return_msg(res):
        return f"formatted: {res}"

    with patch(
            "app.utils.listen.toolkit_listen.get_task_lock",
            return_value=mock_task_lock
    ), patch("app.utils.listen.toolkit_listen._format_result") as mock_format:
        mock_format.return_value = "formatted: test_result"

        @listen_toolkit(return_msg=custom_return_msg)
        def test_method(self):
            return "test_result"

        test_method(mock_toolkit)

        # Verify _format_result was called with our custom formatter
        mock_format.assert_called_once()
        call_args = mock_format.call_args
        assert call_args[0][2] == custom_return_msg
