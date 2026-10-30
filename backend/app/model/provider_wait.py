"""Content-free observation of the installed OpenAI SDK's serial retries.

Instance hooks target openai 1.109.1; they retain the SDK retry loop, HTTP
client, auth, routing, payload and configured attempt count. No retry worker,
heartbeat, request body capture or synthetic model progress is introduced.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import sys
import threading
import time
import uuid
from collections.abc import Callable
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from types import MethodType
from typing import Any

import anyio
import httpx
from openai import (
    APIConnectionError,
    APITimeoutError,
    AsyncOpenAI,
    AsyncStream,
    OpenAI,
    Stream,
    __version__,
)

from app.run_context.context import get_current_run_context
from app.run_runtime.active_timeout import (
    refresh_active_execution_timeout,
    remaining_active_execution_seconds,
)

logger = logging.getLogger("provider_wait")
_CURRENT: ContextVar[_Observation | None] = ContextVar(
    "provider_wait", default=None
)
_INVOCATION: ContextVar[str | None] = ContextVar(
    "provider_invocation", default=None
)
_STREAMS: ContextVar[list[Any] | None] = ContextVar(
    "provider_streams", default=None
)
_SYNC_STREAMS: ContextVar[list[Any] | None] = ContextVar(
    "provider_sync_streams", default=None
)
_PROGRESS: ContextVar[Callable[[], None] | None] = ContextVar(
    "provider_progress", default=None
)
_INSTALLED = "_eigent_provider_wait_installed"


class ProviderRetryBudgetExceeded(TimeoutError):
    """The next serial attempt cannot start inside the active budget."""


def _now() -> float:
    try:
        return asyncio.get_running_loop().time()
    except RuntimeError:
        return time.monotonic()


def _remaining() -> float | None:
    try:
        return remaining_active_execution_seconds()
    except RuntimeError:
        # A sync client in a worker thread cannot operate the loop's timers.
        return None


def _number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(value):
        return max(0.0, float(value))
    return None


def _error_kind(exc: BaseException) -> str:
    if isinstance(exc, asyncio.CancelledError):
        return "timeout" if _remaining() == 0 else "cancelled"
    if isinstance(
        exc, (TimeoutError, httpx.TimeoutException, APITimeoutError)
    ):
        return "timeout"
    if isinstance(exc, (httpx.TransportError, APIConnectionError)):
        return "transport_error"
    return "failed"


def _retry_after(client: Any, response: httpx.Response) -> float | None:
    try:
        return client._parse_retry_after_header(response.headers)
    except Exception:
        # Optional diagnostics must not turn a valid response into a
        # transport failure. Leave the SDK's retry calculation unchanged.
        return None


def _sync_owner() -> tuple[int, asyncio.Task | None]:
    try:
        task = asyncio.current_task()
    except RuntimeError:
        task = None
    return threading.get_ident(), task


class _Observation:
    def __init__(self, client: Any, options: Any, *, stream: bool = False):
        self.started = _now()
        self.attempt_started = self.started
        self.attempt = 0
        self.phase = "waiting"
        self.closed = False
        self.stream = stream
        self.response: httpx.Response | None = None
        self.status: int | None = None
        self.retry_after_seconds: float | None = None
        self.request_ids: dict[str, str] = {}
        self.headers_elapsed: float | None = None
        self.first_event_elapsed: float | None = None
        self.last_progress_at: float | None = None
        self.progress_count = 0
        self._last_emitted_progress = self.started
        self.on_progress = _PROGRESS.get()
        self.timeout_seconds: dict[str, float | None] = {}
        context = get_current_run_context()
        self.identity = {
            "call_id": f"provider_{uuid.uuid4().hex}",
            "invocation_id": _INVOCATION.get(),
            "run_id": context.run_id if context else None,
            "run_attempt_id": context.attempt_id if context else None,
        }
        self.max_retries = options.get_max_retries(client.max_retries)

    def emit(self, phase: str, **fields: Any) -> None:
        if self.closed:
            return
        self.phase = phase
        now = _now()
        event = {
            **self.identity,
            "phase": phase,
            "attempt": self.attempt,
            "max_retries": self.max_retries,
            "sdk_version": __version__,
            "elapsed_seconds": round(now - self.started, 6),
            "attempt_elapsed_seconds": round(now - self.attempt_started, 6),
            "remaining_active_seconds": _remaining(),
            "timeout_seconds": self.timeout_seconds,
            "status": self.status,
            "retry_after_seconds": self.retry_after_seconds,
            "request_id_hashes": self.request_ids.copy(),
            "headers_elapsed_seconds": self.headers_elapsed,
            "first_event_elapsed_seconds": self.first_event_elapsed,
            "progress_events": self.progress_count,
            "since_progress_seconds": (
                round(now - self.last_progress_at, 6)
                if self.last_progress_at is not None
                else None
            ),
            **fields,
        }
        # JSON survives the ordinary text log formatter; extra supports tests
        # and structured sinks. No exception, URL, header or body repr here.
        try:
            logger.info(
                "provider_wait %s",
                json.dumps(event),
                extra={"provider_wait": event},
            )
        except Exception:
            pass  # Diagnostics must not fail or replay a model invocation.

    def finish(self, phase: str) -> None:
        self.emit(phase, previous_phase=self.phase)
        self.closed = True

    def prepare(self, request: httpx.Request) -> None:
        remaining = _remaining()
        if remaining is not None and remaining <= 0:
            raise ProviderRetryBudgetExceeded(
                "Active execution budget exhausted before provider dispatch"
            )
        self.attempt += 1
        self.attempt_started = _now()
        self.status = None
        self.retry_after_seconds = None
        self.request_ids = {}
        self.headers_elapsed = None
        self.first_event_elapsed = None
        configured = dict(request.extensions.get("timeout", {}))
        self.timeout_seconds = {
            key: _number(value) for key, value in configured.items()
        }
        if remaining is not None:
            request.extensions["timeout"] = {
                key: (
                    value
                    if self.stream and key == "read"
                    else min(value, remaining)
                    if value is not None
                    else remaining
                )
                for key, value in configured.items()
            }
            # A stream's idle read timeout persists across deltas. Shrinking
            # it to the initial sliding remainder would cause premature
            # failures after real progress renews the watchdog. The outer
            # guard still cancels silent headers/reads at its live deadline.
        self.emit(
            "waiting",
            stage="dispatch",
            effective_timeout_seconds=request.extensions.get("timeout", {}),
        )

    def trace(self, name: str) -> None:
        if name in {
            "connection.connect_tcp.started",
            "connection.start_tls.started",
        }:
            self.emit("connecting", stage="tcp" if "tcp" in name else "tls")
        elif name.endswith("receive_response_headers.started"):
            self.emit("waiting", stage="response_headers")

    def headers(
        self, response: httpx.Response, retry_after: float | None
    ) -> None:
        # Headers arrive before the SDK reads an error body or returns a
        # stream. Keep request-local ownership for failures in that gap.
        self.response = response
        self.status = response.status_code
        self.retry_after_seconds = _number(retry_after)
        self.headers_elapsed = round(_now() - self.attempt_started, 6)
        self.request_ids = {
            name: hashlib.sha256(response.headers[name].encode()).hexdigest()
            for name in ("x-request-id", "apim-request-id", "x-ms-request-id")
            if response.headers.get(name)
        }
        self.emit("waiting", stage="response_body")

    def progress(self, event: Any) -> None:
        if self.closed:
            return
        if self.first_event_elapsed is None:
            self.first_event_elapsed = round(_now() - self.attempt_started, 6)
            self.emit("streaming", stage="first_event")
        if _has_output_delta(event):
            self.progress_count += 1
            self.last_progress_at = _now()
            try:
                refresh_active_execution_timeout()
            except RuntimeError:
                pass  # Sync worker threads cannot reschedule async timers.
            if self.on_progress is not None:
                self.on_progress()
            # Emit first progress, then at most once per 5 s. This runs only
            # on actual output deltas, never on an elapsed-time heartbeat.
            if (
                self.progress_count == 1
                or self.last_progress_at - self._last_emitted_progress >= 5
            ):
                self.emit("streaming", stage="output_delta")
                self._last_emitted_progress = self.last_progress_at
        terminal = _stream_terminal(event)
        if terminal:
            self.finish(terminal)


def _has_output_delta(event: Any) -> bool:
    event_type = getattr(event, "type", None)
    if event_type in {
        "response.output_text.delta",
        "response.refusal.delta",
        "response.reasoning_text.delta",
        "response.reasoning_summary_text.delta",
        "response.function_call_arguments.delta",
        "content.delta",
    }:
        delta = getattr(event, "delta", None)
        return isinstance(delta, str) and bool(delta)
    for choice in getattr(event, "choices", None) or []:
        delta = getattr(choice, "delta", None)
        if getattr(delta, "content", None) or getattr(
            delta, "reasoning_content", None
        ):
            return True
        for call in getattr(delta, "tool_calls", None) or []:
            function = getattr(call, "function", None)
            if getattr(function, "name", None) or getattr(
                function, "arguments", None
            ):
                return True
    return False


def _stream_terminal(event: Any) -> str | None:
    event_type = getattr(event, "type", None)
    if event_type in {
        "response.completed",
        "response.failed",
        "response.incomplete",
    }:
        return event_type.removeprefix("response.")
    if event_type == "error":
        return "failed"
    for choice in getattr(event, "choices", None) or []:
        reason = getattr(choice, "finish_reason", None)
        if reason:
            return (
                "incomplete"
                if reason in {"length", "content_filter"}
                else "completed"
            )
    return None


@contextmanager
def provider_invocation_scope(invocation_id: str | None):
    token = _INVOCATION.set(invocation_id)
    try:
        yield
    finally:
        _INVOCATION.reset(token)


@asynccontextmanager
async def provider_stream_scope(on_progress: Callable[[], None] | None = None):
    """Close responses even when CAMEL stops consuming at a finish marker."""
    streams: list[Any] = []
    token = _STREAMS.set(streams)
    progress_token = _PROGRESS.set(on_progress)
    try:
        yield
    finally:
        primary_error = sys.exception()
        _STREAMS.reset(token)
        _PROGRESS.reset(progress_token)
        error = None
        for stream in reversed(list(streams)):
            try:
                if (
                    primary_error is not None
                    and not stream._observation.closed
                ):
                    stream._observation.finish(
                        "closed"
                        if isinstance(primary_error, GeneratorExit)
                        else _error_kind(primary_error)
                    )
                await stream.close()
            except Exception as exc:
                error = error or exc
        if error is not None:
            # Drain every owned response before reporting cleanup failure.
            # Do not replace an in-flight cancellation/provider exception.
            if primary_error is None:
                raise error
            logger.warning("provider_wait stream_cleanup_failed")


@contextmanager
def provider_sync_stream_scope(
    on_progress: Callable[[], None] | None = None,
):
    """Own sync responses until the enclosing CAMEL consumer exits."""
    streams: list[Any] = []
    token = _SYNC_STREAMS.set(streams)
    progress_token = _PROGRESS.set(on_progress)
    try:
        yield
    finally:
        primary_error = sys.exception()
        _SYNC_STREAMS.reset(token)
        _PROGRESS.reset(progress_token)
        error = None
        for stream in reversed(list(streams)):
            try:
                if (
                    primary_error is not None
                    and not stream._observation.closed
                ):
                    stream._observation.finish(
                        "closed"
                        if isinstance(primary_error, GeneratorExit)
                        else _error_kind(primary_error)
                    )
                stream.close()
            except Exception as exc:
                error = error or exc
        if error is not None:
            if primary_error is None:
                raise error
            logger.warning("provider_wait stream_cleanup_failed")


class _ObservedAsyncStream(AsyncStream):
    def __init__(self, stream: AsyncStream, observation: _Observation):
        self._inner = stream
        self._observation = observation
        self.response = stream.response
        self._closed = False
        self.owner_task = asyncio.current_task()
        self.registry = _STREAMS.get()
        if self.registry is not None:
            self.registry.append(self)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            event = await self._inner.__anext__()
        except StopAsyncIteration:
            self._observation.finish("stream_ended")
            await self.close()
            raise
        except BaseException as exc:
            self._observation.finish(_error_kind(exc))
            try:
                await self.close()
            except Exception:
                logger.warning("provider_wait stream_cleanup_failed")
            raise
        self._observation.progress(event)
        return event

    async def close(self):
        if self._closed:
            return
        try:
            await self._inner.close()
            self._closed = True
            if self.registry is not None and self in self.registry:
                self.registry.remove(self)
        finally:
            if not self._observation.closed:
                self._observation.finish("closed")

    async def aclose(self):
        await self.close()

    def __getattr__(self, name):
        return getattr(self._inner, name)


class _ObservedSyncStream(Stream):
    def __init__(self, stream: Stream, observation: _Observation):
        self._inner = stream
        self._observation = observation
        self.response = stream.response
        self._closed = False
        self.owner = _sync_owner()
        self.registry = _SYNC_STREAMS.get()
        if self.registry is not None:
            self.registry.append(self)

    def __iter__(self):
        return self

    def __next__(self):
        try:
            event = next(self._inner)
        except StopIteration:
            self._observation.finish("stream_ended")
            self.close()
            raise
        except BaseException as exc:
            self._observation.finish(_error_kind(exc))
            try:
                self.close()
            except Exception:
                logger.warning("provider_wait stream_cleanup_failed")
            raise
        self._observation.progress(event)
        return event

    def close(self):
        if self._closed:
            return
        try:
            self._inner.close()
            self._closed = True
            if self.registry is not None and self in self.registry:
                self.registry.remove(self)
        finally:
            if not self._observation.closed:
                self._observation.finish("closed")

    def __getattr__(self, name):
        return getattr(self._inner, name)


def _retry_delay(client: Any, kwargs: dict[str, Any]) -> float:
    response = kwargs["response"]
    delay = client._calculate_retry_timeout(
        kwargs["max_retries"] - kwargs["retries_taken"],
        kwargs["options"],
        response.headers if response is not None else None,
    )
    observation = _CURRENT.get()
    if observation is not None:
        remaining = _remaining()
        error = sys.exception()
        observation.emit(
            "retrying",
            retry_delay_seconds=delay,
            error_kind="http_status"
            if response is not None
            else (_error_kind(error) if error is not None else "unknown"),
        )
        if remaining is not None and delay >= remaining:
            raise ProviderRetryBudgetExceeded(
                "Provider retry delay exceeds remaining active execution budget"
            )
    return delay


def _install_client(client: Any) -> None:
    if not isinstance(client, (OpenAI, AsyncOpenAI)) or getattr(
        client, _INSTALLED, False
    ):
        return
    original_request = client.request
    original_prepare = client._prepare_request
    original_should_retry = client._should_retry

    def should_retry(self, response):
        retry = original_should_retry(response)
        delay = _retry_after(self, response) if retry else None
        # This SDK replaces server hints > 60 s with short backoff. Decline
        # that retry and preserve the original HTTP error instead.
        if retry and delay is not None and math.isfinite(delay) and delay > 60:
            observation = _CURRENT.get()
            if observation is not None:
                observation.emit(
                    "waiting",
                    stage="retry_declined",
                    retry_after_seconds=delay,
                    reason="server_delay_exceeds_sdk_limit",
                )
            return False
        return retry

    if isinstance(client, AsyncOpenAI):

        async def prepare(self, request):
            await original_prepare(request)
            observation = _CURRENT.get()
            if observation is None:
                return
            observation.prepare(request)
            prior_trace = request.extensions.get("trace")

            async def trace(name, info):
                observation.trace(name)
                if prior_trace is not None:
                    await prior_trace(name, info)

            request.extensions["trace"] = trace

        async def headers(response):
            observation = _CURRENT.get()
            if observation is not None:
                observation.headers(
                    response,
                    _retry_after(client, response),
                )

        async def sleep_for_retry(self, **kwargs):
            await anyio.sleep(_retry_delay(self, kwargs))

        async def request(self, *args, **kwargs):
            # CAMEL may stop at a provider terminal marker. Release that
            # response before the same task starts its next model call.
            for stream in list(_STREAMS.get() or []):
                if (
                    stream.owner_task is asyncio.current_task()
                    and stream._observation.closed
                ):
                    await stream.close()
            options = kwargs.get("options") if "options" in kwargs else args[1]
            observation = _Observation(
                self, options, stream=kwargs.get("stream", False)
            )
            token = _CURRENT.set(observation)
            try:
                result = await original_request(*args, **kwargs)
                if isinstance(result, AsyncStream):
                    result = _ObservedAsyncStream(result, observation)
                else:
                    status = getattr(result, "status", None)
                    observation.finish(
                        status
                        if status
                        in {
                            "completed",
                            "failed",
                            "incomplete",
                            "queued",
                            "in_progress",
                        }
                        else "completed"
                    )
                return result
            except BaseException as exc:
                observation.finish(_error_kind(exc))
                response = observation.response
                if response is not None and not response.is_closed:
                    try:
                        with anyio.CancelScope(shield=True):
                            await response.aclose()
                    except BaseException:
                        # Preserve the original cancellation/provider error.
                        logger.warning("provider_wait response_cleanup_failed")
                raise
            finally:
                _CURRENT.reset(token)
    else:

        def prepare(self, request):
            original_prepare(request)
            observation = _CURRENT.get()
            if observation is None:
                return
            observation.prepare(request)
            prior_trace = request.extensions.get("trace")

            def trace(name, info):
                observation.trace(name)
                if prior_trace is not None:
                    prior_trace(name, info)

            request.extensions["trace"] = trace

        def headers(response):
            observation = _CURRENT.get()
            if observation is not None:
                observation.headers(
                    response,
                    _retry_after(client, response),
                )

        def sleep_for_retry(self, **kwargs):
            time.sleep(_retry_delay(self, kwargs))

        def request(self, *args, **kwargs):
            for stream in list(_SYNC_STREAMS.get() or []):
                if (
                    stream.owner == _sync_owner()
                    and stream._observation.closed
                ):
                    stream.close()
            options = kwargs.get("options") if "options" in kwargs else args[1]
            observation = _Observation(
                self, options, stream=kwargs.get("stream", False)
            )
            token = _CURRENT.set(observation)
            try:
                result = original_request(*args, **kwargs)
                if isinstance(result, Stream):
                    return _ObservedSyncStream(result, observation)
                status = getattr(result, "status", None)
                observation.finish(
                    status
                    if status
                    in {
                        "completed",
                        "failed",
                        "incomplete",
                        "queued",
                        "in_progress",
                    }
                    else "completed"
                )
                return result
            except BaseException as exc:
                observation.finish(_error_kind(exc))
                response = observation.response
                if response is not None and not response.is_closed:
                    try:
                        response.close()
                    except BaseException:
                        logger.warning("provider_wait response_cleanup_failed")
                raise
            finally:
                _CURRENT.reset(token)

    client.request = MethodType(request, client)
    client._prepare_request = MethodType(prepare, client)
    client._should_retry = MethodType(should_retry, client)
    client._sleep_for_retry = MethodType(sleep_for_retry, client)
    client._client.event_hooks["response"].append(headers)
    setattr(client, _INSTALLED, True)


def instrument_provider_wait(model_backend: Any) -> None:
    """Install only on the model's actual OpenAI-family SDK instances."""
    for name in ("_client", "_async_client"):
        _install_client(getattr(model_backend, name, None))


def sdk_owns_model_retries(model_backend: Any) -> bool:
    """Only disable CAMEL's extra 429 loop when every model has this hook."""
    models = getattr(model_backend, "models", None)
    if not isinstance(models, list):
        models = [model_backend]
    return bool(models) and all(
        any(
            getattr(getattr(model, name, None), _INSTALLED, False) is True
            for name in ("_client", "_async_client")
        )
        for model in models
    )
