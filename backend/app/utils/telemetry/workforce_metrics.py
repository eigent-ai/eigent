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

import base64
import json
import logging
import os
import re
from typing import Any

import camel
from camel.societies.workforce.events import (
    LogEvent,
    TaskAssignedEvent,
    TaskCompletedEvent,
    TaskCreatedEvent,
    TaskDecomposedEvent,
    TaskFailedEvent,
    TaskStartedEvent,
    TaskUpdatedEvent,
    WorkerCreatedEvent,
)
from camel.societies.workforce.workforce_metrics import WorkforceMetrics
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
    OTLPSpanExporter,
)
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Status, StatusCode

logger = logging.getLogger(__name__)

# Environment variable keys
ENV_LANGFUSE_PUBLIC_KEY = "LANGFUSE_PUBLIC_KEY"
ENV_LANGFUSE_SECRET_KEY = "LANGFUSE_SECRET_KEY"
ENV_LANGFUSE_BASE_URL = "LANGFUSE_BASE_URL"
ENV_OTEL_EXPORTER_OTLP_ENDPOINT = "OTEL_EXPORTER_OTLP_ENDPOINT"
ENV_OTEL_EXPORTER_OTLP_HEADERS = "OTEL_EXPORTER_OTLP_HEADERS"

# Default values
DEFAULT_LANGFUSE_BASE_URL = "https://us.cloud.langfuse.com"
DEFAULT_LANGFUSE_TAGS = ["workforce", "camel", "eigent"]
LANGFUSE_OTEL_PATH = "/api/public/otel"

# Attribute keys for eigent.project namespace
ATTR_PROJECT_ID = "eigent.project.id"

# Attribute keys for eigent.task namespace
ATTR_TASK_ID = "eigent.task.id"
ATTR_TASK_DESCRIPTION = "eigent.task.description"
ATTR_TASK_PARENT_ID = "eigent.task.parent_id"
ATTR_TASK_TYPE = "eigent.task.type"
ATTR_TASK_STATUS = "eigent.task.status"
ATTR_TASK_UPDATE_TYPE = "eigent.task.update_type"
ATTR_TASK_UPDATE_OLD_VALUE = "eigent.task.update.old_value"
ATTR_TASK_UPDATE_NEW_VALUE = "eigent.task.update.new_value"
ATTR_TASK_UPDATE_METADATA = "eigent.task.update.metadata"
ATTR_TASK_QUEUE_TIME_SECONDS = "eigent.task.queue_time_seconds"
ATTR_TASK_PROCESSING_TIME_SECONDS = "eigent.task.processing_time_seconds"
ATTR_TASK_QUALITY_SCORE = "eigent.task.quality_score"
ATTR_TASK_TIMESTAMP = "eigent.task.timestamp"
ATTR_TASK_DEPENDENCIES = "eigent.task.dependencies"
ATTR_TASK_SUBTASK_IDS = "eigent.task.subtask_ids"
ATTR_TASK_FAILURE_COUNT = "eigent.task.failure_count"

# Attribute keys for eigent.worker namespace
ATTR_WORKER_ID = "eigent.worker.id"
ATTR_WORKER_TYPE = "eigent.worker.type"
ATTR_WORKER_ROLE = "eigent.worker.role"
ATTR_WORKER_AGENT = "eigent.worker.agent"
ATTR_WORKER_MODEL_TYPE = "eigent.worker.model.type"

# Attribute keys for workforce namespace
ATTR_WORKFORCE_TOTAL_TASKS = "workforce.total_tasks"

# Langfuse-specific attributes
ATTR_LANGFUSE_SESSION_ID = "langfuse.session.id"
ATTR_LANGFUSE_TAGS = "langfuse.tags"

# OpenTelemetry service and tracer names
SERVICE_NAME_WORKFORCE = "eigent-workforce"
TRACER_NAME_WORKFORCE = "eigent.workforce"

# Span names
SPAN_WORKFORCE_EXECUTION = "workforce.execution"
SPAN_WORKER_CREATED = "worker.created"
SPAN_TASK_CREATED = "task.created"
SPAN_TASK_DECOMPOSED = "task.decomposed"
SPAN_TASK_ASSIGNED = "task.assigned"
SPAN_TASK_UPDATED = "task.updated"
SPAN_TASK_EXECUTION = "task.execution"
SPAN_LOG_MESSAGE = "log.message"
SPAN_ALL_TASKS_COMPLETED = "workforce.all_tasks_completed"

# Global tracer provider singleton to avoid creating multiple processors
# This is initialized once during FastAPI startup
_GLOBAL_TRACER_PROVIDER: TracerProvider = None


def initialize_tracer_provider() -> None:
    """Initialize the global TracerProvider during application startup.

    Should be called once during FastAPI startup event.
    This ensures we only have one BatchSpanProcessor running,
    preventing resource leaks when multiple WorkforceMetricsCallback
    instances are created.
    """
    global _GLOBAL_TRACER_PROVIDER

    if _GLOBAL_TRACER_PROVIDER is not None:
        logger.warning("TracerProvider already initialized, skipping")
        return

    # Get configuration from environment
    langfuse_public_key = os.getenv(ENV_LANGFUSE_PUBLIC_KEY)
    langfuse_secret_key = os.getenv(ENV_LANGFUSE_SECRET_KEY)
    langfuse_base_url = os.getenv(
        ENV_LANGFUSE_BASE_URL, DEFAULT_LANGFUSE_BASE_URL
    )

    # Create resource with service information
    resource = Resource(attributes={SERVICE_NAME: SERVICE_NAME_WORKFORCE})

    # Create tracer provider
    provider = TracerProvider(resource=resource)

    # Configure OTLP exporter for Langfuse if credentials are available
    if langfuse_public_key and langfuse_secret_key:
        logger.info("Initializing Langfuse telemetry")
        # Set environment variables for OTLP exporter
        endpoint_url = _create_langfuse_endpoint(langfuse_base_url)
        os.environ[ENV_OTEL_EXPORTER_OTLP_ENDPOINT] = endpoint_url
        auth_header = _create_basic_auth_header(
            langfuse_public_key, langfuse_secret_key
        )
        os.environ[ENV_OTEL_EXPORTER_OTLP_HEADERS] = auth_header

        # Create exporter using environment variables
        exporter = OTLPSpanExporter()

        # Use BatchSpanProcessor for async/non-blocking export
        # Configure max_queue_size to prevent OOM when exporter fails
        # Configure export_timeout to fail fast if endpoint is down
        processor = BatchSpanProcessor(
            exporter,
            max_queue_size=4096,  # Drop spans if queue is full
            export_timeout_millis=30000,  # 30s timeout
            schedule_delay_millis=3000,  # Export every 3s
            max_export_batch_size=1024,  # Export up to 1024 spans
        )
        provider.add_span_processor(processor)
        logger.info("Langfuse telemetry initialized successfully")
    else:
        logger.info("Langfuse credentials not found, telemetry disabled")

    _GLOBAL_TRACER_PROVIDER = provider


def get_tracer_provider() -> TracerProvider | None:
    """Get the global TracerProvider instance.

    Returns:
        TracerProvider if initialized, None otherwise
    """
    if _GLOBAL_TRACER_PROVIDER is None:
        logger.warning(
            "TracerProvider not initialized. "
            "Call initialize_tracer_provider() during app startup."
        )
        return None
    return _GLOBAL_TRACER_PROVIDER


def _create_langfuse_endpoint(base_url: str) -> str:
    """Create Langfuse OTLP endpoint URL.

    Args:
        base_url: Langfuse base URL

    Returns:
        Full OTLP endpoint URL
    """
    return f"{base_url}{LANGFUSE_OTEL_PATH}"


def _create_basic_auth_header(public_key: str, secret_key: str) -> str:
    """Create Basic Authentication header for Langfuse.

    Args:
        public_key: Langfuse public key
        secret_key: Langfuse secret key

    Returns:
        Authorization header value (e.g., "Authorization=Basic ...")
    """
    credentials = f"{public_key}:{secret_key}"
    encoded = base64.b64encode(credentials.encode()).decode()
    return f"Authorization=Basic {encoded}"


class WorkforceMetricsCallback(WorkforceMetrics):
    """OpenTelemetry metrics callback for workforce events.

    Sends workforce events to Langfuse via OTLP protocol.
    Events are sent as spans with rich attributes.

    Benefits:
    - Async/non-blocking: Uses BatchSpanProcessor for background export
    - Automatic batching: Reduces network overhead
    - Distributed tracing: Task dependencies shown as parent-child spans
    """

    def __init__(self, project_id: str, task_id: str):
        """Initialize OpenTelemetry metrics callback.

        Uses a global shared TracerProvider to avoid creating multiple
        BatchSpanProcessor instances, which would lead to resource leaks.

        Args:
            project_id: The project/workforce identifier
            task_id: The task identifier

        Environment variables:
            LANGFUSE_PUBLIC_KEY: Langfuse public key (required)
            LANGFUSE_SECRET_KEY: Langfuse secret key (required)
            LANGFUSE_BASE_URL: Langfuse base URL
                (optional, defaults to "https://us.cloud.langfuse.com")
        """
        super().__init__()
        self.project_id = project_id
        self.task_id = task_id

        # Check if telemetry is enabled
        langfuse_public_key = os.getenv(ENV_LANGFUSE_PUBLIC_KEY)
        langfuse_secret_key = os.getenv(ENV_LANGFUSE_SECRET_KEY)
        self.enabled = bool(langfuse_public_key and langfuse_secret_key)

        # Initialize tracer and root_span as None by default
        self.tracer = None
        self.root_span = None

        # Only initialize OpenTelemetry resources when telemetry is enabled
        if self.enabled:
            # Get the global shared tracer provider
            # This ensures only one BatchSpanProcessor is running
            provider = get_tracer_provider()
            if provider is None:
                # TracerProvider not initialized (e.g., app startup not
                # completed or running in test environment)
                self.enabled = False
            else:
                # Get tracer from the shared provider
                # Use CAMEL version for instrumentation versioning
                self.tracer = provider.get_tracer(
                    TRACER_NAME_WORKFORCE, camel.__version__
                )
                self.root_span = self.tracer.start_span(
                    f"{SPAN_WORKFORCE_EXECUTION}:{task_id}"
                )
                # Langfuse-specific attributes
                self.root_span.set_attribute(
                    ATTR_LANGFUSE_SESSION_ID, project_id
                )
                tags = json.dumps(DEFAULT_LANGFUSE_TAGS.copy())
                self.root_span.set_attribute(ATTR_LANGFUSE_TAGS, tags)
                # Custom attributes
                self.root_span.set_attribute(ATTR_PROJECT_ID, project_id)
                self.root_span.set_attribute(ATTR_TASK_ID, task_id)

        # Track active spans for task execution
        self.task_spans = {}

        # Track quality scores (task_id -> quality_score)
        self.task_quality_scores = {}

    def log_worker_created(
        self,
        event: WorkerCreatedEvent,
        agent_class: str = None,
        model_type: str = None,
        **kwargs,
    ) -> None:
        """Log worker creation as a span.

        Args:
            event: Worker creation event from CAMEL
            agent_class: Agent class name (optional)
            model_type: Model type (optional)
            **kwargs: Additional unused arguments for compatibility
        """
        if not self.enabled:
            return

        # Create span as child of root span using context
        ctx = trace.set_span_in_context(self.root_span)
        with self.tracer.start_as_current_span(
            SPAN_WORKER_CREATED, context=ctx
        ) as span:
            # Eigent-specific attributes
            span.set_attribute(ATTR_WORKER_ID, event.worker_id)
            span.set_attribute(ATTR_WORKER_TYPE, event.worker_type)
            span.set_attribute(ATTR_WORKER_ROLE, event.role)

            if agent_class:
                span.set_attribute(ATTR_WORKER_AGENT, agent_class)
            if model_type:
                span.set_attribute(ATTR_WORKER_MODEL_TYPE, model_type)

            span.set_status(Status(StatusCode.OK))

    def log_task_created(self, event: TaskCreatedEvent) -> None:
        """Log task creation as a span.

        Args:
            event: Task created event from CAMEL
        """
        if not self.enabled:
            return

        ctx = trace.set_span_in_context(self.root_span)
        with self.tracer.start_as_current_span(
            SPAN_TASK_CREATED, context=ctx
        ) as span:
            span.set_attribute(ATTR_TASK_ID, event.task_id)
            span.set_attribute(ATTR_TASK_DESCRIPTION, event.description)
            span.set_attribute(ATTR_PROJECT_ID, self.project_id)

            if event.parent_task_id:
                span.set_attribute(ATTR_TASK_PARENT_ID, event.parent_task_id)
            if event.task_type:
                span.set_attribute(ATTR_TASK_TYPE, event.task_type)

            span.set_status(Status(StatusCode.OK))

    def log_task_decomposed(self, event: TaskDecomposedEvent) -> None:
        """Log task decomposition as a span.

        Args:
            event (TaskDecomposedEvent): Task decomposed event from CAMEL
        """
        if not self.enabled:
            return

        ctx = trace.set_span_in_context(self.root_span)
        with self.tracer.start_as_current_span(
            SPAN_TASK_DECOMPOSED, context=ctx
        ) as span:
            span.set_attribute(ATTR_TASK_PARENT_ID, event.parent_task_id)
            span.set_attribute(ATTR_PROJECT_ID, self.project_id)

            if event.subtask_ids:
                span.set_attribute(
                    ATTR_TASK_SUBTASK_IDS, json.dumps(event.subtask_ids)
                )

            span.set_status(Status(StatusCode.OK))

    def log_task_assigned(self, event: TaskAssignedEvent) -> None:
        """Log task assignment as a span.

        Args:
            event: Task assignment event from CAMEL
        """
        if not self.enabled:
            return

        ctx = trace.set_span_in_context(self.root_span)
        with self.tracer.start_as_current_span(
            SPAN_TASK_ASSIGNED, context=ctx
        ) as span:
            span.set_attribute(ATTR_TASK_ID, event.task_id)
            span.set_attribute(ATTR_WORKER_ID, event.worker_id)
            span.set_attribute(ATTR_PROJECT_ID, self.project_id)

            if event.queue_time_seconds is not None:
                span.set_attribute(
                    ATTR_TASK_QUEUE_TIME_SECONDS, event.queue_time_seconds
                )

            # Add dependencies as JSON array
            if event.dependencies:
                deps_json = json.dumps(event.dependencies)
                span.set_attribute(ATTR_TASK_DEPENDENCIES, deps_json)

            span.set_status(Status(StatusCode.OK))

    def log_task_updated(self, event: TaskUpdatedEvent) -> None:
        """Log task update events (replan/reassign/manual) as a span.

        Args:
            event: Task updated event from CAMEL
        """
        if not self.enabled:
            return

        ctx = trace.set_span_in_context(self.root_span)
        with self.tracer.start_as_current_span(
            SPAN_TASK_UPDATED, context=ctx
        ) as span:
            span.set_attribute(ATTR_TASK_ID, event.task_id)
            span.set_attribute(ATTR_PROJECT_ID, self.project_id)
            span.set_attribute(ATTR_TASK_UPDATE_TYPE, event.update_type)

            if event.worker_id:
                span.set_attribute(ATTR_WORKER_ID, event.worker_id)
            if event.parent_task_id:
                span.set_attribute(ATTR_TASK_PARENT_ID, event.parent_task_id)
            if event.old_value is not None:
                span.set_attribute(ATTR_TASK_UPDATE_OLD_VALUE, event.old_value)
            if event.new_value is not None:
                span.set_attribute(ATTR_TASK_UPDATE_NEW_VALUE, event.new_value)
            if event.metadata:
                span.set_attribute(
                    ATTR_TASK_UPDATE_METADATA, json.dumps(event.metadata)
                )
            if hasattr(event, "timestamp") and event.timestamp:
                span.set_attribute(
                    ATTR_TASK_TIMESTAMP, event.timestamp.isoformat()
                )

            span.set_status(Status(StatusCode.OK))

    def log_task_started(self, event: TaskStartedEvent) -> None:
        """Log task start and create a span for the task execution.

        Args:
            event: Task started event from CAMEL
        """
        if not self.enabled:
            return

        # Start a long-running span for task execution as child of root span
        ctx = trace.set_span_in_context(self.root_span)
        span = self.tracer.start_span(
            f"{SPAN_TASK_EXECUTION}:{event.task_id}", context=ctx
        )
        span.set_attribute(ATTR_TASK_ID, event.task_id)
        worker_id = (
            event.worker_id if hasattr(event, "worker_id") else "unknown"
        )
        span.set_attribute(ATTR_WORKER_ID, worker_id)
        span.set_attribute(ATTR_PROJECT_ID, self.project_id)
        span.set_attribute(ATTR_TASK_STATUS, "started")

        # Store span to end it later
        self.task_spans[event.task_id] = span

    def log_task_completed(self, event: TaskCompletedEvent) -> None:
        """Log task completion and end the execution span.

        Args:
            event: Task completion event from CAMEL
        """
        if not self.enabled:
            return

        # End the execution span if it exists
        if event.task_id in self.task_spans:
            span = self.task_spans.pop(event.task_id)
            span.set_attribute(ATTR_TASK_STATUS, "completed")
            span.set_attribute(ATTR_WORKER_ID, event.worker_id)

            # Add timestamp as ISO string
            if hasattr(event, "timestamp") and event.timestamp:
                span.set_attribute(
                    ATTR_TASK_TIMESTAMP, event.timestamp.isoformat()
                )

            if event.parent_task_id:
                span.set_attribute(ATTR_TASK_PARENT_ID, event.parent_task_id)
            if event.processing_time_seconds is not None:
                span.set_attribute(
                    ATTR_TASK_PROCESSING_TIME_SECONDS,
                    event.processing_time_seconds,
                )

            # Check for quality score from parsed log messages first
            if event.task_id in self.task_quality_scores:
                quality_score = self.task_quality_scores.pop(event.task_id)
                span.set_attribute(ATTR_TASK_QUALITY_SCORE, quality_score)
            # Fallback to event attributes if available
            elif (
                hasattr(event, "quality_score")
                and event.quality_score is not None
            ):
                span.set_attribute(
                    ATTR_TASK_QUALITY_SCORE, event.quality_score
                )
            elif (
                hasattr(event, "metadata")
                and event.metadata
                and "quality_score" in event.metadata
            ):
                span.set_attribute(
                    ATTR_TASK_QUALITY_SCORE, event.metadata["quality_score"]
                )

            if event.token_usage:
                # Store all token usage as custom attributes
                for key, value in event.token_usage.items():
                    span.set_attribute(f"eigent.task.token_usage.{key}", value)

            span.set_status(Status(StatusCode.OK))
            span.end()

    def log_task_failed(self, event: TaskFailedEvent) -> None:
        """Log task failure and end the execution span with error status.

        Args:
            event: Task failure event from CAMEL
        """
        if not self.enabled:
            return

        # End the execution span with error if it exists
        if event.task_id in self.task_spans:
            span = self.task_spans.pop(event.task_id)
            span.set_attribute(ATTR_TASK_STATUS, "failed")
            # TODO: add error.message

            if event.parent_task_id:
                span.set_attribute(ATTR_TASK_PARENT_ID, event.parent_task_id)
            if event.worker_id:
                span.set_attribute(ATTR_WORKER_ID, event.worker_id)
            if event.metadata and isinstance(event.metadata.get("failure_count"),
                                             int):
                span.set_attribute(ATTR_TASK_FAILURE_COUNT,
                                   event.metadata["failure_count"])

            span.set_status(Status(StatusCode.ERROR, event.error_message))
            span.end()

    def log_message(self, log_event: LogEvent) -> None:
        """Log error and critical messages as span events.
        Also parse quality scores from info-level task completion messages.

        Args:
            log_event: LogEvent from CAMEL
        """
        if not self.enabled:
            return

        # Parse quality score from info-level messages
        # Pattern: "Task <task_id> completed successfully (quality score: X)."
        # TODO: add this from the camel
        if log_event.level == "info":
            pattern = (
                r"Task\s+(\S+)\s+completed successfully"
                r".*quality score:\s*(\d+)"
            )
            match = re.search(pattern, log_event.message)
            if match:
                task_id = match.group(1)
                quality_score = int(match.group(2))
                self.task_quality_scores[task_id] = quality_score

        # Only log errors and critical messages
        if log_event.level in ["error", "critical"]:
            ctx = trace.set_span_in_context(self.root_span)
            with self.tracer.start_as_current_span(
                SPAN_LOG_MESSAGE, context=ctx
            ) as span:
                span.set_attribute("log.level", log_event.level)
                span.set_attribute("log.message", log_event.message)
                span.set_attribute(ATTR_PROJECT_ID, self.project_id)

                # Add metadata if available
                if log_event.metadata:
                    for key, value in log_event.metadata.items():
                        span.set_attribute(f"log.{key}", str(value))

                # Set span status based on log level
                if log_event.level == "critical":
                    span.set_status(
                        Status(StatusCode.ERROR, log_event.message)
                    )

    def log_all_tasks_completed(self, event) -> None:
        """Log when all tasks in the workforce are completed.

        Args:
            event: All tasks completed event from CAMEL
        """
        if not self.enabled:
            return

        ctx = trace.set_span_in_context(self.root_span)
        with self.tracer.start_as_current_span(
            SPAN_ALL_TASKS_COMPLETED, context=ctx
        ) as span:
            span.set_attribute(ATTR_PROJECT_ID, self.project_id)
            span.set_attribute(ATTR_TASK_ID, self.task_id)

            # Add timestamp as ISO string
            if hasattr(event, "timestamp") and event.timestamp:
                span.set_attribute(
                    ATTR_TASK_TIMESTAMP, event.timestamp.isoformat()
                )

            if hasattr(event, "total_tasks"):
                span.set_attribute(
                    ATTR_WORKFORCE_TOTAL_TASKS, event.total_tasks
                )
            span.set_status(Status(StatusCode.OK))

        # End the root span when all tasks are completed
        if self.root_span:
            self.root_span.set_status(Status(StatusCode.OK))
            self.root_span.end()

    def dump_to_json(self) -> str:
        """Dump metrics to JSON string.

        Returns:
            JSON string representation of metrics
        """
        return json.dumps(
            {
                "project_id": self.project_id,
                "task_id": self.task_id,
                "otel_enabled": self.enabled,
                "active_spans": len(self.task_spans),
            }
        )

    def get_ascii_tree_representation(self) -> str:
        """Get ASCII tree representation of workforce metrics.

        Returns:
            ASCII tree string
        """
        active_count = len(self.task_spans)
        return (
            f"OpenTelemetry Metrics for project {self.project_id}, "
            f"task {self.task_id} (active spans: {active_count})"
        )

    def get_kpis(self) -> dict[str, Any]:
        """Get key performance indicators.

        Returns:
            Dictionary of KPIs
        """
        return {
            "project_id": self.project_id,
            "task_id": self.task_id,
            "otel_enabled": self.enabled,
            "active_task_spans": len(self.task_spans),
        }

    def reset_task_data(self) -> None:
        """Reset task-specific data.

        This is called when starting a new task.
        """
        # End any remaining open task execution spans
        for _, span in self.task_spans.items():
            span.set_status(Status(StatusCode.ERROR, "Task interrupted/reset"))
            span.end()

        self.task_spans.clear()
