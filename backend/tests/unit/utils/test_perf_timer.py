"""Unit tests for PerfTimer utility."""

import asyncio
import time
from unittest.mock import patch, MagicMock
import pytest

# Note: assuming 'app' is package root or properly added to sys.path via pyproject.toml
from app.utils.perf_timer import PerfTimer, perf_measure


@pytest.mark.unit
class TestPerfTimer:
    """Test cases for PerfTimer context manager."""

    def test_sync_context_manager_measures_duration(self):
        """PerfTimer should measure elapsed time for a sync block."""
        timer = PerfTimer("test_operation")
        with timer:
            time.sleep(0.05)

        assert timer.duration_ms >= 40  # allow some tolerance
        assert timer.duration_ms < 500  # shouldn't be unreasonably long

    def test_sync_context_manager_returns_self(self):
        """PerfTimer __enter__ should return self."""
        timer = PerfTimer("test_op")
        result = timer.__enter__()
        timer.__exit__(None, None, None)
        assert result is timer

    def test_duration_ms_before_exit_is_zero(self):
        """duration_ms should be 0.0 before the timer has exited."""
        timer = PerfTimer("test_op")
        assert timer.duration_ms == 0.0

    def test_kwargs_stored_as_context(self):
        """Extra kwargs should be stored and accessible."""
        timer = PerfTimer("op", project_id="abc", task_id="xyz")
        assert timer.operation == "op"
        assert timer.context == {"project_id": "abc", "task_id": "xyz"}

    @patch("app.utils.perf_timer.logger")
    def test_sync_context_logs_on_exit(self, mock_logger):
        """PerfTimer should log the duration on __exit__."""
        with PerfTimer("log_test"):
            pass

        mock_logger.info.assert_called_once()
        call_args = mock_logger.info.call_args
        assert "[PERF]" in call_args[0][0]
        assert "log_test" in call_args[0][0]

    @patch("app.utils.perf_timer.logger")
    def test_sync_context_logs_extra_with_context(self, mock_logger):
        """PerfTimer should include context kwargs in the log extra dict."""
        with PerfTimer("ctx_test", agent_name="dev"):
            pass

        call_kwargs = mock_logger.info.call_args[1]
        assert "extra" in call_kwargs
        assert call_kwargs["extra"]["perf_operation"] == "ctx_test"
        assert call_kwargs["extra"]["agent_name"] == "dev"
        assert "perf_duration_ms" in call_kwargs["extra"]

    def test_sync_context_propagates_exceptions(self):
        """PerfTimer should not suppress exceptions."""
        with pytest.raises(ValueError, match="test error"):
            with PerfTimer("error_test"):
                raise ValueError("test error")

    @patch("app.utils.perf_timer.logger")
    def test_sync_context_logs_even_on_exception(self, mock_logger):
        """PerfTimer should still log duration even when an exception occurs."""
        with pytest.raises(ValueError):
            with PerfTimer("err_log_test"):
                raise ValueError("boom")

        # Expecting warning log level on error
        mock_logger.warning.assert_called_once()
        assert "[PERF]" in mock_logger.warning.call_args[0][0]

    @pytest.mark.asyncio
    async def test_async_context_manager_measures_duration(self):
        """PerfTimer should work as an async context manager."""
        timer = PerfTimer("async_test")
        async with timer:
            await asyncio.sleep(0.05)

        assert timer.duration_ms >= 40
        assert timer.duration_ms < 500

    @pytest.mark.asyncio
    @patch("app.utils.perf_timer.logger")
    async def test_async_context_logs_on_exit(self, mock_logger):
        """PerfTimer async context manager should log on exit."""
        async with PerfTimer("async_log"):
            await asyncio.sleep(0.01)

        mock_logger.info.assert_called_once()
        assert "[PERF]" in mock_logger.info.call_args[0][0]

    @pytest.mark.asyncio
    async def test_async_context_propagates_exceptions(self):
        """PerfTimer async context should not suppress exceptions."""
        with pytest.raises(RuntimeError, match="async error"):
            async with PerfTimer("async_err"):
                raise RuntimeError("async error")

    def test_manual_enter_exit(self):
        """PerfTimer can be used with manual __enter__/__exit__ calls."""
        timer = PerfTimer("manual")
        timer.__enter__()
        time.sleep(0.02)
        timer.__exit__(None, None, None)
        assert timer.duration_ms >= 15


@pytest.mark.unit
class TestPerfMeasure:
    """Test cases for @perf_measure decorator."""

    def test_decorator_on_sync_function(self):
        """@perf_measure should time a sync function."""

        @perf_measure
        def add(a, b):
            return a + b

        result = add(2, 3)
        assert result == 5

    def test_decorator_preserves_function_name(self):
        """@perf_measure should preserve the original function name."""

        @perf_measure
        def my_func():
            pass

        assert my_func.__name__ == "my_func"

    @patch("app.utils.perf_timer.logger")
    def test_decorator_logs_duration(self, mock_logger):
        """@perf_measure should log the function execution time."""

        @perf_measure
        def slow_func():
            time.sleep(0.02)

        slow_func()

        mock_logger.info.assert_called_once()
        assert "[PERF]" in mock_logger.info.call_args[0][0]

    @pytest.mark.asyncio
    async def test_decorator_on_async_function(self):
        """@perf_measure should time an async function."""

        @perf_measure
        async def async_add(a, b):
            await asyncio.sleep(0.01)
            return a + b

        result = await async_add(3, 4)
        assert result == 7

    @pytest.mark.asyncio
    @patch("app.utils.perf_timer.logger")
    async def test_decorator_on_async_function_logs(self, mock_logger):
        """@perf_measure should log async function execution time."""

        @perf_measure
        async def async_work():
            await asyncio.sleep(0.01)

        await async_work()

        mock_logger.info.assert_called_once()
        assert "[PERF]" in mock_logger.info.call_args[0][0]

    def test_decorator_propagates_sync_exception(self):
        """@perf_measure should not swallow sync exceptions."""

        @perf_measure
        def fail():
            raise TypeError("bad type")

        with pytest.raises(TypeError, match="bad type"):
            fail()

    @pytest.mark.asyncio
    async def test_decorator_propagates_async_exception(self):
        """@perf_measure should not swallow async exceptions."""

        @perf_measure
        async def fail():
            raise TypeError("async bad type")

        with pytest.raises(TypeError, match="async bad type"):
            await fail()
