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

"""Capture CAMEL provider calls in the Desktop RunJournal.

The adapter deliberately wraps only CAMEL's public ``run``/``arun`` model
boundary.  It does not parse or rewrite tool calls, and it does not modify
CAMEL's native ``camel_log`` settings or files.  The two independent records
are intentionally retained so trajectory audits can compare their coverage.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import os
import threading
import uuid
from types import MethodType
from typing import Any
from weakref import WeakKeyDictionary

from app.permission_policy.models import redact_action_arguments
from app.run_context.context import get_current_run_context
from app.run_journal.models import ModelInvocationRecord
from app.run_journal.runtime import get_default_run_journal
from app.run_journal.store import SQLiteRunJournal
from app.workload import capture_required
from app.workspace_config.models import canonical_digest

logger = logging.getLogger("model_invocation_capture")

_CAPTURE_INSTALLED = "_eigent_model_invocation_capture_installed"
_REDACTION_VERSION = "model-invocation-v1"
_CAPTURE_POLICY_CACHE: WeakKeyDictionary[SQLiteRunJournal, dict[str, bool]] = (
    WeakKeyDictionary()
)
_CAPTURE_POLICY_CACHE_LOCK = threading.Lock()


def _json_value(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        try:
            return value.model_dump(mode="json")
        except TypeError:
            return value.model_dump()
    if hasattr(value, "dict"):
        try:
            return value.dict()
        except Exception:
            pass
    if isinstance(value, dict):
        return {str(key): _json_value(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(child) for child in value]
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return repr(value)


def _response_document(value: Any) -> dict[str, Any]:
    serialized = _json_value(value)
    if isinstance(serialized, dict):
        return serialized
    return {"value": serialized}


def _request_document(
    model_backend: Any,
    messages: list[dict[str, Any]],
    response_format: Any,
    tools: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    config = _json_value(getattr(model_backend, "model_config_dict", {}) or {})
    if not isinstance(config, dict):
        config = {"value": config}
    if tools is not None:
        config["tools"] = _json_value(tools)
    if response_format is not None:
        if hasattr(response_format, "model_json_schema"):
            try:
                config["response_format"] = response_format.model_json_schema()
            except Exception:
                config["response_format"] = repr(response_format)
        else:
            config["response_format"] = repr(response_format)
    return {
        "messages": _json_value(messages),
        "model_config_dict": config,
    }


def _usage(response: dict[str, Any]) -> dict[str, int | None]:
    raw = response.get("usage")
    usage = raw if isinstance(raw, dict) else {}
    prompt = usage.get("prompt_tokens", usage.get("input_tokens"))
    completion = usage.get("completion_tokens", usage.get("output_tokens"))
    cache_read = usage.get("cache_read_input_tokens")
    cache_write = usage.get("cache_creation_input_tokens")
    details = usage.get("prompt_tokens_details")
    if isinstance(details, dict):
        cache_read = cache_read or details.get("cached_tokens")

    def non_negative_int(value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed >= 0 else None

    return {
        "prompt_tokens": non_negative_int(prompt),
        "completion_tokens": non_negative_int(completion),
        "cache_read_tokens": non_negative_int(cache_read),
        "cache_write_tokens": non_negative_int(cache_write),
    }


def _finish_reason(response: dict[str, Any]) -> str | None:
    direct = response.get("finish_reason")
    if direct is not None:
        return str(direct)
    choices = response.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        value = choices[0].get("finish_reason")
        return str(value) if value is not None else None
    return None


def _error_code(exc: BaseException) -> str:
    for key in ("code", "status_code", "type"):
        value = getattr(exc, key, None)
        if value is not None:
            return str(value)
    return type(exc).__name__


def _transport(model_backend: Any) -> str:
    # CAMEL stores api_mode as an initializer-owned private attribute rather
    # than in model_config_dict. Prefer that authoritative runtime value so a
    # Responses request is never mislabeled as Chat Completions in SQLite.
    runtime_mode = getattr(model_backend, "_api_mode", None)
    if runtime_mode:
        return str(runtime_mode)
    config = getattr(model_backend, "model_config_dict", {}) or {}
    if isinstance(config, dict):
        explicit = config.get("api_mode") or config.get("transport")
        if explicit:
            return str(explicit)
    return "chat_completions"


def _thinking_effort(model_backend: Any) -> str | None:
    config = getattr(model_backend, "model_config_dict", {}) or {}
    if not isinstance(config, dict):
        return None
    reasoning = config.get("reasoning")
    response_effort = (
        reasoning.get("effort") if isinstance(reasoning, dict) else None
    )
    value = (
        config.get("reasoning_effort")
        or config.get("thinking_effort")
        or response_effort
    )
    return str(value) if value is not None else None


class _StreamAccumulator:
    def __init__(self) -> None:
        self.response_id = ""
        self.model = ""
        self.content: list[str] = []
        self.reasoning_content: list[str] = []
        self.finish_reason: str | None = None
        self.usage: dict[str, Any] | None = None
        self.tool_calls: dict[int, dict[str, Any]] = {}

    @property
    def terminal_document_ready(self) -> bool:
        """Return whether a provider terminal chunk is fully captured.

        CAMEL may stop consuming a stream as soon as it observes the final
        usage-bearing chunk.  In that case the wrapper never receives the
        following ``StopIteration``/``StopAsyncIteration`` callback.  A
        finish reason plus usage is the provider-neutral terminal shape that
        CAMEL itself uses before breaking, so it is safe to persist the
        accumulated response immediately without changing stream semantics.
        """

        return self.finish_reason is not None and self.usage is not None

    def add(self, chunk: Any) -> bool:
        payload = _response_document(chunk)
        event_type = payload.get("type")
        if event_type == "content.delta":
            delta = payload.get("delta")
            if isinstance(delta, str) and delta:
                self.content.append(delta)
                return True
            return False
        self.response_id = self.response_id or str(payload.get("id") or "")
        self.model = self.model or str(payload.get("model") or "")
        usage = payload.get("usage")
        if isinstance(usage, dict):
            self.usage = usage
        choices = payload.get("choices")
        if not isinstance(choices, list):
            return False
        observed_output = False
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            if choice.get("finish_reason") is not None:
                self.finish_reason = str(choice["finish_reason"])
            delta = choice.get("delta")
            if not isinstance(delta, dict):
                continue
            content = delta.get("content")
            if isinstance(content, str):
                self.content.append(content)
                observed_output = observed_output or bool(content)
            reasoning = delta.get("reasoning_content")
            if isinstance(reasoning, str):
                self.reasoning_content.append(reasoning)
                observed_output = observed_output or bool(reasoning)
            calls = delta.get("tool_calls")
            if not isinstance(calls, list):
                continue
            for position, call in enumerate(calls):
                if not isinstance(call, dict):
                    continue
                index = int(call.get("index", position))
                aggregate = self.tool_calls.setdefault(
                    index,
                    {
                        "id": "",
                        "type": call.get("type", "function"),
                        "function": {"name": "", "arguments": ""},
                    },
                )
                if call.get("id"):
                    aggregate["id"] = str(call["id"])
                    observed_output = True
                function = call.get("function")
                if isinstance(function, dict):
                    if function.get("name"):
                        aggregate["function"]["name"] += str(function["name"])
                        observed_output = True
                    if function.get("arguments"):
                        aggregate["function"]["arguments"] += str(
                            function["arguments"]
                        )
                        observed_output = True
        return observed_output

    def document(self) -> dict[str, Any]:
        return {
            "id": self.response_id,
            "model": self.model,
            "content": "".join(self.content),
            "reasoning_content": "".join(self.reasoning_content) or None,
            "tool_calls": [
                self.tool_calls[index] for index in sorted(self.tool_calls)
            ],
            "finish_reason": self.finish_reason,
            "usage": self.usage,
            "streaming": True,
        }


class _CaptureSession:
    def __init__(
        self,
        *,
        journal: SQLiteRunJournal,
        record: ModelInvocationRecord,
        required: bool,
    ) -> None:
        self.journal = journal
        self.record = record
        self.required = required
        self._closed = False
        self._first_token = False
        self._lock = threading.Lock()

    @property
    def closed(self) -> bool:
        with self._lock:
            return self._closed

    def first_token(self) -> None:
        with self._lock:
            if self._closed or self._first_token:
                return
            self._first_token = True
        try:
            self.journal.mark_model_invocation_first_token(
                self.record.invocation_id
            )
        except Exception as exc:
            logger.exception("Failed to persist model first-token marker")
            _record_capture_gap(
                self.journal,
                run_id=self.record.run_id,
                attempt_id=self.record.attempt_id,
                step_id=self.record.step_id,
                gap_id=f"capture-gap:{self.record.invocation_id}:first-token",
                detail_code=type(exc).__name__,
            )
            if self.required:
                raise

    async def afirst_token(self) -> None:
        await asyncio.to_thread(self.first_token)

    def complete(self, response: dict[str, Any]) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        usage = _usage(response)
        try:
            self.journal.finish_model_invocation(
                self.record.invocation_id,
                status="completed",
                response=response,
                finish_reason=_finish_reason(response),
                **usage,
            )
        except Exception as exc:
            logger.exception("Failed to complete durable model invocation")
            _record_capture_gap(
                self.journal,
                run_id=self.record.run_id,
                attempt_id=self.record.attempt_id,
                step_id=self.record.step_id,
                gap_id=f"capture-gap:{self.record.invocation_id}:terminal",
                detail_code=type(exc).__name__,
            )
            if self.required:
                raise

    async def acomplete(self, response: dict[str, Any]) -> None:
        await asyncio.to_thread(self.complete, response)

    def fail(
        self, exc: BaseException, *, outcome_unknown: bool = False
    ) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        status = "outcome_unknown" if outcome_unknown else "failed"
        try:
            self.journal.finish_model_invocation(
                self.record.invocation_id,
                status=status,
                error_code=_error_code(exc),
                error_message=str(exc),
            )
        except Exception as capture_exc:
            logger.exception("Failed to close durable model invocation")
            _record_capture_gap(
                self.journal,
                run_id=self.record.run_id,
                attempt_id=self.record.attempt_id,
                step_id=self.record.step_id,
                gap_id=f"capture-gap:{self.record.invocation_id}:failure",
                detail_code=type(capture_exc).__name__,
            )

    async def afail(
        self, exc: BaseException, *, outcome_unknown: bool = False
    ) -> None:
        await asyncio.to_thread(
            self.fail, exc, outcome_unknown=outcome_unknown
        )


class _RecordedSyncStream:
    def __init__(self, stream: Any, session: _CaptureSession) -> None:
        self._stream = stream
        self._session = session
        self._accumulator = _StreamAccumulator()

    def __iter__(self) -> _RecordedSyncStream:
        return self

    def __next__(self) -> Any:
        try:
            chunk = next(self._stream)
        except StopIteration:
            self._complete_from_stream()
            raise
        except BaseException as exc:
            self._session.fail(exc, outcome_unknown=True)
            raise
        try:
            if self._accumulator.add(chunk):
                self._session.first_token()
            if (
                self._accumulator.terminal_document_ready
                and not self._session.closed
            ):
                self._session.complete(self._accumulator.document())
        except Exception as exc:
            # Best-effort capture must not corrupt a provider stream that
            # CAMEL can otherwise consume. A required CapturePolicy instead
            # makes this projection failure terminal for the Attempt.
            self._session.fail(exc, outcome_unknown=True)
            if self._session.required:
                raise
        return chunk

    def __enter__(self) -> _RecordedSyncStream:
        enter = getattr(self._stream, "__enter__", None)
        if enter is not None:
            try:
                entered = enter()
            except BaseException as exc:
                self._session.fail(
                    exc, outcome_unknown=_exception_outcome_unknown(exc)
                )
                raise
            if entered is not self._stream and hasattr(entered, "__next__"):
                self._stream = entered
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> bool:
        if exc is not None:
            self._session.fail(exc, outcome_unknown=True)
        elif not self._session.closed:
            self._session.fail(
                RuntimeError("model stream closed before exhaustion"),
                outcome_unknown=True,
            )
        close = getattr(self._stream, "__exit__", None)
        return bool(close(exc_type, exc, traceback)) if close else False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)

    def _complete_from_stream(self) -> None:
        try:
            finalizer = getattr(self._stream, "get_final_completion", None)
            response = (
                _response_document(finalizer())
                if callable(finalizer)
                else self._accumulator.document()
            )
        except Exception as exc:
            self._session.fail(exc, outcome_unknown=True)
            if self._session.required:
                raise
            return
        self._session.complete(response)

    def get_final_completion(self) -> Any:
        response = self._stream.get_final_completion()
        if not self._session.closed:
            try:
                self._session.complete(_response_document(response))
            except Exception as exc:
                self._session.fail(exc, outcome_unknown=True)
                if self._session.required:
                    raise
        return response

    def until_done(self) -> Any:
        result = self._stream.until_done()
        if not self._session.closed:
            self._complete_from_stream()
        return result

    def close(self) -> Any:
        if not self._session.closed:
            self._session.fail(
                RuntimeError("model stream closed before exhaustion"),
                outcome_unknown=True,
            )
        close = getattr(self._stream, "close", None)
        return close() if callable(close) else None


class _RecordedSyncStreamManager:
    """Preserve sync provider context-manager semantics while recording."""

    def __init__(self, manager: Any, session: _CaptureSession) -> None:
        self._manager = manager
        self._session = session
        self._stream: _RecordedSyncStream | None = None

    def __enter__(self) -> _RecordedSyncStream:
        try:
            entered = self._manager.__enter__()
        except BaseException as exc:
            self._session.fail(
                exc, outcome_unknown=_exception_outcome_unknown(exc)
            )
            raise
        if not hasattr(entered, "__iter__"):
            error = TypeError(
                "model stream context manager did not yield a sync stream"
            )
            self._session.fail(error, outcome_unknown=True)
            raise error
        self._stream = _RecordedSyncStream(entered, self._session)
        return self._stream

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> bool:
        if exc is not None:
            self._session.fail(exc, outcome_unknown=True)
        elif not self._session.closed:
            self._session.fail(
                RuntimeError("model stream closed before exhaustion"),
                outcome_unknown=True,
            )
        return bool(self._manager.__exit__(exc_type, exc, traceback))

    def __getattr__(self, name: str) -> Any:
        return getattr(self._manager, name)


class _RecordedAsyncStream:
    def __init__(self, stream: Any, session: _CaptureSession) -> None:
        self._stream = stream
        self._session = session
        self._accumulator = _StreamAccumulator()

    def __aiter__(self) -> _RecordedAsyncStream:
        return self

    async def __anext__(self) -> Any:
        try:
            chunk = await self._stream.__anext__()
        except StopAsyncIteration:
            await self._complete_from_stream()
            raise
        except BaseException as exc:
            await self._session.afail(exc, outcome_unknown=True)
            raise
        try:
            if self._accumulator.add(chunk):
                await self._session.afirst_token()
            if (
                self._accumulator.terminal_document_ready
                and not self._session.closed
            ):
                await self._session.acomplete(self._accumulator.document())
        except Exception as exc:
            await self._session.afail(exc, outcome_unknown=True)
            if self._session.required:
                raise
        return chunk

    async def __aenter__(self) -> _RecordedAsyncStream:
        enter = getattr(self._stream, "__aenter__", None)
        if enter is not None:
            try:
                entered = await enter()
            except BaseException as exc:
                await self._session.afail(
                    exc, outcome_unknown=_exception_outcome_unknown(exc)
                )
                raise
            if entered is not self._stream and hasattr(entered, "__anext__"):
                self._stream = entered
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> bool:
        if exc is not None:
            await self._session.afail(exc, outcome_unknown=True)
        elif not self._session.closed:
            await self._session.afail(
                RuntimeError("model stream closed before exhaustion"),
                outcome_unknown=True,
            )
        close = getattr(self._stream, "__aexit__", None)
        return bool(await close(exc_type, exc, traceback)) if close else False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)

    async def _complete_from_stream(self) -> None:
        try:
            finalizer = getattr(self._stream, "get_final_completion", None)
            if callable(finalizer):
                response = finalizer()
                if inspect.isawaitable(response):
                    response = await response
                document = _response_document(response)
            else:
                document = self._accumulator.document()
        except Exception as exc:
            await self._session.afail(exc, outcome_unknown=True)
            if self._session.required:
                raise
            return
        await self._session.acomplete(document)

    async def get_final_completion(self) -> Any:
        response = self._stream.get_final_completion()
        if inspect.isawaitable(response):
            response = await response
        if not self._session.closed:
            try:
                await self._session.acomplete(_response_document(response))
            except Exception as exc:
                await self._session.afail(exc, outcome_unknown=True)
                if self._session.required:
                    raise
        return response

    async def until_done(self) -> Any:
        result = self._stream.until_done()
        if inspect.isawaitable(result):
            result = await result
        if not self._session.closed:
            await self._complete_from_stream()
        return result

    async def close(self) -> Any:
        if not self._session.closed:
            await self._session.afail(
                RuntimeError("model stream closed before exhaustion"),
                outcome_unknown=True,
            )
        close = getattr(self._stream, "close", None)
        if close is None:
            close = getattr(self._stream, "aclose", None)
        result = close() if callable(close) else None
        return await result if inspect.isawaitable(result) else result

    async def aclose(self) -> Any:
        return await self.close()


class _RecordedAsyncStreamManager:
    """Preserve provider context-manager semantics while recording output."""

    def __init__(self, manager: Any, session: _CaptureSession) -> None:
        self._manager = manager
        self._session = session
        self._stream: _RecordedAsyncStream | None = None

    async def __aenter__(self) -> _RecordedAsyncStream:
        try:
            entered = await self._manager.__aenter__()
        except BaseException as exc:
            await self._session.afail(
                exc, outcome_unknown=_exception_outcome_unknown(exc)
            )
            raise
        if not hasattr(entered, "__aiter__"):
            error = TypeError(
                "model stream context manager did not yield an async stream"
            )
            await self._session.afail(error, outcome_unknown=True)
            raise error
        self._stream = _RecordedAsyncStream(entered, self._session)
        return self._stream

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> bool:
        if exc is not None:
            await self._session.afail(exc, outcome_unknown=True)
        elif not self._session.closed:
            await self._session.afail(
                RuntimeError("model stream closed before exhaustion"),
                outcome_unknown=True,
            )
        return bool(await self._manager.__aexit__(exc_type, exc, traceback))

    def __getattr__(self, name: str) -> Any:
        return getattr(self._manager, name)


def _exception_outcome_unknown(exc: BaseException) -> bool:
    """Return whether dispatch may have reached the provider."""

    return isinstance(exc, (asyncio.CancelledError, TimeoutError)) or (
        "timeout" in type(exc).__name__.lower()
    )


def _capture_is_required(
    journal: SQLiteRunJournal,
    attempt_id: str | None,
) -> bool:
    if attempt_id:
        with _CAPTURE_POLICY_CACHE_LOCK:
            cached = _CAPTURE_POLICY_CACHE.get(journal, {}).get(attempt_id)
        if cached is not None:
            return cached
        try:
            attempt = journal.get_run_attempt(attempt_id)
        except Exception:
            logger.exception("Failed to resolve Attempt capture policy")
        else:
            if attempt is not None:
                # Attempt admission freezes the environment compatibility
                # setting into an immutable WorkloadProfile. Never let a
                # later process-wide env change override that audit fact.
                required = capture_required(attempt.workload_profile)
                with _CAPTURE_POLICY_CACHE_LOCK:
                    journal_cache = _CAPTURE_POLICY_CACHE.setdefault(
                        journal, {}
                    )
                    journal_cache[attempt_id] = required
                return required
    # Compatibility entry point. New Test/A-B/Rollout callers should bind a
    # required CapturePolicy in the immutable WorkloadProfile instead.
    return os.environ.get("EIGENT_MODEL_CAPTURE_REQUIRED", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _record_capture_gap(
    journal: SQLiteRunJournal,
    *,
    run_id: str,
    attempt_id: str | None,
    step_id: str | None,
    gap_id: str,
    detail_code: str,
) -> None:
    if not attempt_id:
        return
    for candidate_step_id in (step_id, None) if step_id else (None,):
        try:
            journal.record_attempt_evidence_gap(
                gap_id=gap_id,
                run_id=run_id,
                attempt_id=attempt_id,
                step_id=candidate_step_id,
                dimension="model_decisions",
                reason_code="capture_failed",
                source="model_capture",
                detail_code=detail_code,
            )
            return
        except Exception:
            # A stale runtime Step must not make the Attempt-level gap
            # disappear. Retry once without Step correlation; a secondary
            # storage failure still must not replace the original failure.
            logger.exception(
                "Failed to persist model capture evidence gap%s",
                " with Step correlation" if candidate_step_id else "",
            )


def _start_capture(
    *,
    journal: SQLiteRunJournal,
    model_backend: Any,
    agent_id: str,
    provider: str,
    model_name: str,
    messages: list[dict[str, Any]],
    call_args: tuple[Any, ...],
    call_kwargs: dict[str, Any],
) -> _CaptureSession | None:
    context = get_current_run_context()
    if context is None:
        return None
    # Import locally to keep the capture adapter independent from runtime
    # initialization order. The ContextVar value is copied into asyncio worker
    # threads, so async and sync dispatch observe the same authored Step.
    from app.run_runtime.step_coordinator import (
        RunStepCoordinator,
        get_current_step_id,
    )

    step_id = get_current_step_id()
    if step_id is None:
        # Model dispatch happens between tool scopes, so the ContextVar alone
        # cannot correlate the ordinary CAMEL think/tool/think loop.  Resolve
        # the uniquely running authored Step using the same conservative
        # agent-aware fallback already used by legacy event projection.
        try:
            step_id = RunStepCoordinator(journal).current_running_step_id(
                context.run_id,
                agent_id=agent_id,
            )
        except Exception:
            # Step attribution is enrichment. A transient replay failure must
            # not turn best-effort model capture into a dispatch gate.
            logger.exception(
                "Failed to resolve running Step for model capture",
                extra={"run_id": context.run_id, "agent_id": agent_id},
            )
            step_id = None
    required = _capture_is_required(journal, context.attempt_id)
    response_format = call_kwargs.get(
        "response_format", call_args[0] if call_args else None
    )
    tools = call_kwargs.get(
        "tools", call_args[1] if len(call_args) > 1 else None
    )
    logical_call_id = ""
    try:
        request = _request_document(
            model_backend, messages, response_format, tools
        )
        safe_request = redact_action_arguments({"request": request})["request"]
        assert isinstance(safe_request, dict)
        request_digest = canonical_digest(safe_request)
        logical_call_id = canonical_digest(
            {
                "run_id": context.run_id,
                "agent_id": agent_id,
                "request_digest": request_digest,
            }
        )
        if journal.get_run(context.run_id) is None:
            logger.warning(
                "Skipping model capture because Run %s is not admitted",
                context.run_id,
            )
            return None
        record = journal.start_model_invocation(
            invocation_id=f"modelinv_{uuid.uuid4().hex}",
            run_id=context.run_id,
            attempt_id=context.attempt_id,
            step_id=step_id,
            agent_id=agent_id,
            logical_call_id=logical_call_id,
            provider=provider,
            model=model_name,
            transport=_transport(model_backend),
            thinking_effort=_thinking_effort(model_backend),
            request=request,
            redaction_version=_REDACTION_VERSION,
        )
    except Exception as exc:
        logger.exception("Failed to start durable model invocation")
        _record_capture_gap(
            journal,
            run_id=context.run_id,
            attempt_id=context.attempt_id,
            step_id=step_id,
            gap_id=(
                f"capture-gap:{logical_call_id}:dispatch"
                if logical_call_id
                else f"capture-gap:{uuid.uuid4().hex}:dispatch"
            ),
            detail_code=type(exc).__name__,
        )
        if required:
            raise
        return None
    return _CaptureSession(journal=journal, record=record, required=required)


def instrument_model_backend(
    model_backend: Any,
    *,
    agent_id: str,
    provider: str,
    model_name: str,
    journal: SQLiteRunJournal | None = None,
) -> Any:
    """Install one idempotent capture adapter on a CAMEL model instance."""

    # TODO(camel): Replace this public run/arun adapter when CAMEL exposes a
    # transport-attempt hook with pre-dispatch, terminal/stream, provider
    # request-id, and SDK retry-index callbacks. Without that upstream hook,
    # one CAMEL model call is durable here but hidden HTTP retries cannot be
    # represented as separate ModelInvocation rows.

    if getattr(model_backend, _CAPTURE_INSTALLED, False):
        return model_backend
    durable_journal = journal or get_default_run_journal()
    original_run = model_backend.run
    original_arun = model_backend.arun

    def captured_run(
        self: Any,
        messages: list[dict[str, Any]],
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        session = _start_capture(
            journal=durable_journal,
            model_backend=self,
            agent_id=agent_id,
            provider=provider,
            model_name=model_name,
            messages=messages,
            call_args=args,
            call_kwargs=kwargs,
        )
        try:
            response = original_run(messages, *args, **kwargs)
        except BaseException as exc:
            if session is not None:
                session.fail(
                    exc, outcome_unknown=_exception_outcome_unknown(exc)
                )
            raise
        if session is None:
            return response
        if inspect.isgenerator(response) or (
            hasattr(response, "__next__")
            and hasattr(response, "__iter__")
            and not hasattr(response, "choices")
        ):
            return _RecordedSyncStream(response, session)
        if hasattr(response, "__enter__"):
            return _RecordedSyncStreamManager(response, session)
        try:
            document = _response_document(response)
        except Exception as exc:
            session.fail(exc, outcome_unknown=True)
            if session.required:
                raise
            return response
        session.complete(document)
        return response

    async def captured_arun(
        self: Any,
        messages: list[dict[str, Any]],
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        session = await asyncio.to_thread(
            _start_capture,
            journal=durable_journal,
            model_backend=self,
            agent_id=agent_id,
            provider=provider,
            model_name=model_name,
            messages=messages,
            call_args=args,
            call_kwargs=kwargs,
        )
        try:
            response = await original_arun(messages, *args, **kwargs)
        except BaseException as exc:
            if session is not None:
                await session.afail(
                    exc, outcome_unknown=_exception_outcome_unknown(exc)
                )
            raise
        if session is None:
            return response
        if hasattr(response, "__aiter__"):
            return _RecordedAsyncStream(response, session)
        if hasattr(response, "__aenter__"):
            return _RecordedAsyncStreamManager(response, session)
        try:
            document = _response_document(response)
        except Exception as exc:
            await session.afail(exc, outcome_unknown=True)
            if session.required:
                raise
            return response
        await session.acomplete(document)
        return response

    model_backend.run = MethodType(captured_run, model_backend)
    model_backend.arun = MethodType(captured_arun, model_backend)
    setattr(model_backend, _CAPTURE_INSTALLED, True)
    return model_backend


__all__ = ["instrument_model_backend"]
