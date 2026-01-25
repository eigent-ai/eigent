"""Tests for workforce metrics telemetry."""
from datetime import datetime
from unittest.mock import MagicMock, Mock, patch

import app.utils.telemetry.workforce_metrics as wm_module
import pytest
from app.utils.telemetry.workforce_metrics import WorkforceMetricsCallback
from camel.societies.workforce.events import (LogEvent, TaskAssignedEvent,
                                              TaskCompletedEvent,
                                              TaskCreatedEvent,
                                              TaskFailedEvent,
                                              TaskStartedEvent,
                                              WorkerCreatedEvent)


@pytest.fixture(autouse=True)
def reset_global_tracer_provider():
    """Reset global tracer provider between tests for isolation."""
    yield
    # Reset global after each test
    wm_module._GLOBAL_TRACER_PROVIDER = None


@pytest.fixture
def mock_env_vars():
    """Mock environment variables for Langfuse."""
    envs = {
        "LANGFUSE_PUBLIC_KEY": "test_public_key",
        "LANGFUSE_SECRET_KEY": "test_secret_key",
        "LANGFUSE_BASE_URL": "https://test.langfuse.com",
    }
    with patch.dict(
            "os.environ",
            envs,
    ):
        yield


@pytest.fixture
def metrics_callback(mock_env_vars):
    """Create a WorkforceMetricsCallback instance for testing."""
    with patch("app.utils.telemetry.workforce_metrics.OTLPSpanExporter"):
        # Initialize the tracer provider first
        wm_module.initialize_tracer_provider()

        callback = WorkforceMetricsCallback(project_id="test_project",
                                            task_id="test_task")
        # Mock the tracer and spans
        callback.tracer = Mock()
        callback.root_span = Mock()
        yield callback


def test_log_worker_created(metrics_callback):
    """Test log_worker_created function."""
    event = WorkerCreatedEvent(worker_id="worker_1",
                               worker_type="test_worker",
                               role="test_role")

    mock_span = Mock()
    metrics_callback.tracer.start_as_current_span = Mock(return_value=Mock(
        __enter__=Mock(return_value=mock_span), __exit__=Mock()))

    metrics_callback.log_worker_created(event,
                                        agent_class="TestAgent",
                                        model_type="gpt-4")

    # Verify span attributes were set
    assert mock_span.set_attribute.called
    assert mock_span.set_status.called


def test_log_task_created(metrics_callback):
    """Test log_task_created function."""
    event = TaskCreatedEvent(
        task_id="task_1",
        description="Test task",
        parent_task_id="parent_1",
        task_type="test_type",
    )

    mock_span = Mock()
    metrics_callback.tracer.start_as_current_span = Mock(return_value=Mock(
        __enter__=Mock(return_value=mock_span), __exit__=Mock()))

    metrics_callback.log_task_created(event)

    # Verify span attributes were set
    assert mock_span.set_attribute.called
    assert mock_span.set_status.called


def test_log_task_assigned(metrics_callback):
    """Test log_task_assigned function."""
    event = TaskAssignedEvent(
        task_id="task_1",
        worker_id="worker_1",
        queue_time_seconds=1.5,
        dependencies=["dep_1", "dep_2"],
    )

    mock_span = Mock()
    metrics_callback.tracer.start_as_current_span = Mock(return_value=Mock(
        __enter__=Mock(return_value=mock_span), __exit__=Mock()))

    metrics_callback.log_task_assigned(event)

    # Verify span attributes were set
    assert mock_span.set_attribute.called
    assert mock_span.set_status.called


def test_log_task_started(metrics_callback):
    """Test log_task_started function."""
    event = TaskStartedEvent(task_id="task_1", worker_id="worker_1")

    mock_span = Mock()
    metrics_callback.tracer.start_span = Mock(return_value=mock_span)

    metrics_callback.log_task_started(event)

    # Verify span was created and stored
    assert "task_1" in metrics_callback.task_spans
    assert mock_span.set_attribute.called


def test_log_task_completed(metrics_callback):
    """Test log_task_completed function."""
    # Setup: start a task first
    task_id = "task_1"
    mock_span = Mock()
    metrics_callback.task_spans[task_id] = mock_span

    event = TaskCompletedEvent(
        task_id=task_id,
        worker_id="worker_1",
        parent_task_id="parent_1",
        processing_time_seconds=2.5,
        timestamp=datetime.now(),
        token_usage={
            "input_tokens": 100,
            "output_tokens": 50
        },
    )

    metrics_callback.log_task_completed(event)

    # Verify span was ended and attributes were set
    assert task_id not in metrics_callback.task_spans
    assert mock_span.set_attribute.called
    assert mock_span.set_status.called
    assert mock_span.end.called


def test_log_task_failed(metrics_callback):
    """Test log_task_failed function."""
    # Setup: start a task first
    task_id = "task_1"
    mock_span = Mock()
    metrics_callback.task_spans[task_id] = mock_span

    event = TaskFailedEvent(
        task_id=task_id,
        worker_id="worker_1",
        parent_task_id="parent_1",
        error_message="Test error",
    )

    metrics_callback.log_task_failed(event)

    # Verify span was ended with error status
    assert task_id not in metrics_callback.task_spans
    assert mock_span.set_attribute.called
    assert mock_span.set_status.called
    assert mock_span.end.called


def test_log_message_error(metrics_callback):
    """Test log_message function with error level."""
    event = LogEvent(level="error",
                     message="Test error message",
                     metadata={"key": "value"})

    mock_span = Mock()
    metrics_callback.tracer.start_as_current_span = Mock(return_value=Mock(
        __enter__=Mock(return_value=mock_span), __exit__=Mock()))

    metrics_callback.log_message(event)

    # Verify span was created for error message
    assert mock_span.set_attribute.called


def test_log_message_quality_score(metrics_callback):
    """Test log_message function parsing quality score."""
    event = LogEvent(
        level="info",
        message="Task task_1 completed successfully (quality score: 85).",
    )

    metrics_callback.log_message(event)

    # Verify quality score was parsed and stored
    assert "task_1" in metrics_callback.task_quality_scores
    assert metrics_callback.task_quality_scores["task_1"] == 85


def test_log_all_tasks_completed(metrics_callback):
    """Test log_all_tasks_completed function."""
    event = MagicMock()
    event.timestamp = datetime.now()
    event.total_tasks = 5

    mock_span = Mock()
    metrics_callback.tracer.start_as_current_span = Mock(return_value=Mock(
        __enter__=Mock(return_value=mock_span), __exit__=Mock()))

    metrics_callback.log_all_tasks_completed(event)

    # Verify span was created and root span was ended
    assert mock_span.set_attribute.called
    assert mock_span.set_status.called
    assert metrics_callback.root_span.end.called


def test_batch_span_processor_configuration_prevents_oom(mock_env_vars):
    """Test BatchSpanProcessor config with limits to prevent OOM."""
    with patch("app.utils.telemetry.workforce_metrics.OTLPSpanExporter"
               ) as mock_exporter_class, patch(
                   "app.utils.telemetry.workforce_metrics.BatchSpanProcessor"
               ) as mock_processor_class:
        # Initialize tracer provider
        wm_module.initialize_tracer_provider()

        # Verify BatchSpanProcessor was called with OOM prevention config
        mock_processor_class.assert_called_once()
        call_args = mock_processor_class.call_args

        # Verify the exporter was passed
        assert call_args[0][0] == mock_exporter_class.return_value

        # Verify kwargs have proper configuration
        assert call_args[1]["max_queue_size"] == 4096
        assert call_args[1]["export_timeout_millis"] == 30000
        assert call_args[1]["schedule_delay_millis"] == 3000
        assert call_args[1]["max_export_batch_size"] == 1024


def test_missing_langfuse_env_vars_disables_tracing():
    """Test that missing Langfuse env vars disables tracing."""
    with patch.dict("os.environ", {}, clear=True), patch(
            "app.utils.telemetry.workforce_metrics.OTLPSpanExporter"
    ) as mock_exporter_class, patch(
            "app.utils.telemetry.workforce_metrics.BatchSpanProcessor"
    ) as mock_processor_class:
        # Initialize tracer provider without credentials
        wm_module.initialize_tracer_provider()

        # Create callback without Langfuse credentials
        callback = WorkforceMetricsCallback(project_id="test_project",
                                            task_id="test_task")

        # Verify tracing is disabled
        assert callback.enabled is False

        # Verify no exporter or processor was created
        mock_exporter_class.assert_not_called()
        mock_processor_class.assert_not_called()

        # Verify log methods do nothing when disabled
        event = WorkerCreatedEvent(worker_id="worker_1",
                                   worker_type="test_worker",
                                   role="test_role")
        callback.log_worker_created(event)  # Should not raise errors


def test_multiple_callbacks_share_tracer_provider(mock_env_vars):
    """Test that multiple callbacks share the same TracerProvider."""
    with patch("app.utils.telemetry.workforce_metrics.BatchSpanProcessor"
               ) as mock_processor_class:
        # Initialize tracer provider once
        wm_module.initialize_tracer_provider()

        # Create first callback
        callback1 = WorkforceMetricsCallback(project_id="project1",
                                             task_id="task1")

        # Create second callback
        callback2 = WorkforceMetricsCallback(project_id="project2",
                                             task_id="task2")

        # Verify BatchSpanProcessor was only called once (singleton)
        assert mock_processor_class.call_count == 1

        # Both callbacks should be enabled
        assert callback1.enabled is True
        assert callback2.enabled is True
