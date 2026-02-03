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
import json
import logging
import queue
import threading
from collections.abc import Callable
from datetime import datetime
from functools import wraps
from inspect import iscoroutinefunction, signature
from typing import Any, TypeVar

from app.service.task import (
    ActionActivateToolkitData,
    ActionDeactivateToolkitData,
    get_task_lock,
    process_task,
)
from app.utils.toolkit.abstract_toolkit import AbstractToolkit

logger = logging.getLogger("toolkit_listen")

MAX_LENGTH = 500


def _truncate(text: str, max_length: int = MAX_LENGTH) -> str:
    """Truncate text if it exceeds max_length."""
    if len(text) > max_length:
        return (
            f"{text[:max_length]}... "
            f"(truncated, total length: {len(text)} chars)"
        )
    return text


def _format_args(
    args: tuple,
    kwargs: dict,
    inputs_formatter: Callable[..., str] | None,
) -> str:
    """Format function arguments as a string."""
    if inputs_formatter is not None:
        return _truncate(inputs_formatter(*args, **kwargs))

    # Remove first param (self)
    filtered_args = args[1:] if len(args) > 0 else []
    args_str = ", ".join(repr(arg) for arg in filtered_args)

    if kwargs:
        kwargs_str = ", ".join(f"{k}={v!r}" for k, v in kwargs.items())
        args_str = f"{args_str}, {kwargs_str}" if args_str else kwargs_str

    return _truncate(args_str)


def _format_result(
    res: Any,
    error: Exception | None,
    return_msg_formatter: Callable[[Any], str] | None,
) -> str:
    """Format the result or error as a string."""
    if error is not None:
        return _truncate(str(error))

    if return_msg_formatter is not None:
        return _truncate(return_msg_formatter(res))

    if isinstance(res, str):
        return _truncate(res)

    try:
        return _truncate(json.dumps(res, ensure_ascii=False))
    except TypeError:
        return _truncate(str(res))


def _get_context(
    toolkit: "AbstractToolkit",
    func_name: str,
) -> tuple[str, str, str, bool]:
    """
    Extract common context from toolkit and function.

    Returns:
        (toolkit_name, method_name, process_task_id, skip_workflow_display)
    """
    toolkit_name = toolkit.toolkit_name()
    method_name = func_name.replace("_", " ")
    skip_workflow_display = func_name == "send_message_to_user"

    # Multi-layer fallback to get process_task_id
    process_task_id = process_task.get("")
    if not process_task_id:
        process_task_id = getattr(toolkit, "api_task_id", "")
        if not process_task_id:
            logger.warning(
                f"[toolkit_listen] Both ContextVar process_task "
                f"and toolkit.api_task_id are empty for "
                f"{toolkit_name}.{method_name}"
            )

    return toolkit_name, method_name, process_task_id, skip_workflow_display


def _create_activate_data(
    toolkit: "AbstractToolkit",
    toolkit_name: str,
    method_name: str,
    process_task_id: str,
    args_str: str,
) -> ActionActivateToolkitData:
    """Create activation data for toolkit method call."""
    return ActionActivateToolkitData(
        data={
            "agent_name": toolkit.agent_name,
            "process_task_id": process_task_id,
            "toolkit_name": toolkit_name,
            "method_name": method_name,
            "message": args_str,
        }
    )


def _create_deactivate_data(
    toolkit: "AbstractToolkit",
    toolkit_name: str,
    method_name: str,
    process_task_id: str,
    res_msg: str,
) -> ActionDeactivateToolkitData:
    """Create deactivation data for toolkit method call."""
    return ActionDeactivateToolkitData(
        data={
            "agent_name": toolkit.agent_name,
            "process_task_id": process_task_id,
            "toolkit_name": toolkit_name,
            "method_name": method_name,
            "message": res_msg,
        }
    )


def _log_deactivate(
    toolkit_name: str,
    method_name: str,
    process_task_id: str,
    agent_name: str,
    error: Exception | None,
) -> None:
    """Log toolkit deactivation."""
    status = "ERROR" if error is not None else "SUCCESS"
    timestamp = datetime.now().isoformat()
    logger.info(
        f"[TOOLKIT DEACTIVATE] Toolkit: {toolkit_name} | "
        f"Method: {method_name} | Task ID: {process_task_id} | "
        f"Agent: {agent_name} | Status: {status} | "
        f"Timestamp: {timestamp}"
    )


def _safe_put_queue(task_lock, data):
    """Safely put data to the queue, handling both sync and async contexts"""
    try:
        # Try to get current event loop
        asyncio.get_running_loop()

        # We're in an async context, create a task
        task = asyncio.create_task(task_lock.put_queue(data))

        if hasattr(task_lock, "add_background_task"):
            task_lock.add_background_task(task)

        # Add done callback to handle any exceptions
        def handle_task_result(t):
            try:
                t.result()
            except Exception as e:
                logger.error(f"[SAFE_PUT_QUEUE] Background task failed: {e}")

        task.add_done_callback(handle_task_result)

    except RuntimeError:
        # No running event loop, run in a separate thread
        try:
            result_queue = queue.Queue()

            def run_in_thread():
                try:
                    new_loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(new_loop)
                    try:
                        new_loop.run_until_complete(task_lock.put_queue(data))
                        result_queue.put(("success", None))
                    except Exception as e:
                        logger.error(f"[SAFE_PUT_QUEUE] put_queue failed: {e}")
                        result_queue.put(("error", e))
                    finally:
                        new_loop.close()
                except Exception as e:
                    logger.error(f"[SAFE_PUT_QUEUE] Thread failed: {e}")
                    result_queue.put(("error", e))

            thread = threading.Thread(target=run_in_thread, daemon=False)
            thread.start()

            # Wait briefly for completion
            try:
                status, error = result_queue.get(timeout=1.0)
                if status == "error":
                    logger.error(
                        f"[SAFE_PUT_QUEUE] Thread execution failed: {error}"
                    )
            except queue.Empty:
                logger.warning(
                    f"[SAFE_PUT_QUEUE] Thread timeout after 1s "
                    f"for {data.__class__.__name__}"
                )

        except Exception as e:
            logger.error(f"[SAFE_PUT_QUEUE] Failed to send data to queue: {e}")


def listen_toolkit(
    wrap_method: Callable[..., Any] | None = None,
    inputs: Callable[..., str] | None = None,
    return_msg: Callable[[Any], str] | None = None,
):
    """
    Decorator that wraps toolkit methods to emit activate/deactivate
    events.

    When a decorated method is called, it sends an ActionActivateToolkitData
    event before execution and an ActionDeactivateToolkitData event after
    completion. These events are used to track toolkit usage in the workflow
    UI.

    Works with both sync and async methods. For sync methods called outside an
    async context, events are sent via a background thread.

    Args:
        wrap_method (callable, optional): Method to use for preserving
            function metadata (name, signature, etc.) via @wraps.
            Defaults to the decorated function.
        inputs (callable, optional): Callable to format the input
            arguments string. Receives (*args, **kwargs) and returns
            a string representation. If not provided, args are auto-formatted.
        return_msg (callable, optional): Optional callable to format the return
            value string. Receives the return value and returns a string
            representation. If not provided, the result is JSON-serialized
            or converted to str.

    Example:
        @listen_toolkit()
        async def create_note(self, title: str, content: str) -> str:
            ...

        @listen_toolkit(
            inputs=lambda self, path: f"path={path}",
            return_msg=lambda res: f"Created {len(res)} files"
        )
        def batch_create(self, path: str) -> list:
            ...
    """

    def decorator(func: Callable[..., Any]):
        wrap = func if wrap_method is None else wrap_method

        if iscoroutinefunction(func):
            # async function wrapper
            @wraps(wrap)
            async def async_wrapper(*args, **kwargs):
                toolkit: AbstractToolkit = args[0]
                if not hasattr(toolkit, "api_task_id"):
                    logger.warning(
                        f"[listen_toolkit] {toolkit.__class__.__name__} "
                        f"missing api_task_id, calling method directly"
                    )
                    return await func(*args, **kwargs)

                task_lock = get_task_lock(toolkit.api_task_id)
                args_str = _format_args(args, kwargs, inputs)
                ctx = _get_context(toolkit, func.__name__)
                toolkit_name, method_name, process_task_id, skip = ctx

                if not skip:
                    activate_data = _create_activate_data(
                        toolkit,
                        toolkit_name,
                        method_name,
                        process_task_id,
                        args_str,
                    )
                    await task_lock.put_queue(activate_data)

                error = None
                res = None
                try:
                    res = await func(*args, **kwargs)
                except Exception as e:
                    error = e

                res_msg = _format_result(res, error, return_msg)
                _log_deactivate(
                    toolkit_name,
                    method_name,
                    process_task_id,
                    toolkit.agent_name,
                    error,
                )

                if not skip:
                    deactivate_data = _create_deactivate_data(
                        toolkit,
                        toolkit_name,
                        method_name,
                        process_task_id,
                        res_msg,
                    )
                    await task_lock.put_queue(deactivate_data)

                if error is not None:
                    raise error
                return res

            async_wrapper.__listen_toolkit__ = True
            return async_wrapper

        else:
            # sync function wrapper
            @wraps(wrap)
            def sync_wrapper(*args, **kwargs):
                toolkit: AbstractToolkit = args[0]
                if not hasattr(toolkit, "api_task_id"):
                    logger.warning(
                        f"[listen_toolkit] {toolkit.__class__.__name__} "
                        f"missing api_task_id, calling method directly"
                    )
                    return func(*args, **kwargs)

                task_lock = get_task_lock(toolkit.api_task_id)
                args_str = _format_args(args, kwargs, inputs)
                ctx = _get_context(toolkit, func.__name__)
                toolkit_name, method_name, process_task_id, skip = ctx

                if not skip:
                    activate_data = _create_activate_data(
                        toolkit,
                        toolkit_name,
                        method_name,
                        process_task_id,
                        args_str,
                    )
                    _safe_put_queue(task_lock, activate_data)

                error = None
                res = None
                try:
                    res = func(*args, **kwargs)
                    # Safety check: if the result is a coroutine,
                    # this is a programming error
                    if asyncio.iscoroutine(res):
                        error_msg = (
                            f"Async function {func.__name__} "
                            f"was incorrectly called in sync context. "
                            f"This is a bug - the function should be marked "
                            f"as async or should not return a coroutine."
                        )
                        logger.error(f"[listen_toolkit] {error_msg}")
                        res.close()
                        raise TypeError(error_msg)
                except Exception as e:
                    error = e

                res_msg = _format_result(res, error, return_msg)
                _log_deactivate(
                    toolkit_name,
                    method_name,
                    process_task_id,
                    toolkit.agent_name,
                    error,
                )

                if not skip:
                    deactivate_data = _create_deactivate_data(
                        toolkit,
                        toolkit_name,
                        method_name,
                        process_task_id,
                        res_msg,
                    )
                    _safe_put_queue(task_lock, deactivate_data)

                if error is not None:
                    raise error
                return res

            sync_wrapper.__listen_toolkit__ = True
            return sync_wrapper

    return decorator


T = TypeVar("T")

# Methods that should not be wrapped by auto_listen_toolkit
# These are utility/helper methods that don't perform actual tool operations
EXCLUDED_METHODS = {
    "get_tools",  # Tool enumeration
    "get_can_use_tools",  # Tool filtering
    "toolkit_name",  # Metadata getter
    "run_mcp_server",  # MCP server initialization
    "model_dump",  # Pydantic model serialization
    "model_dump_json",  # Pydantic model serialization
    "dict",  # Pydantic legacy dict method
    "json",  # Pydantic legacy json method
    "copy",  # Object copying
    "update",  # Object update
}


def auto_listen_toolkit(
    base_toolkit_class: type[T],
) -> Callable[[type[T]], type[T]]:
    """
    Class decorator that automatically wraps all public methods
    from the base toolkit with the @listen_toolkit decorator.

    Excluded methods (not wrapped):
    - get_tools, get_can_use_tools: Tool enumeration/filtering
    - toolkit_name: Metadata getter
    - run_mcp_server: MCP server initialization
    - Pydantic serialization methods: model_dump, model_dump_json, dict, json
    - Object utility methods: copy, update

    These methods are typically called during initialization or for metadata,
    and should not trigger activate/deactivate events.

    Usage:
        @auto_listen_toolkit(BaseNoteTakingToolkit)
        class NoteTakingToolkit(BaseNoteTakingToolkit, AbstractToolkit):
            agent_name: str = Agents.document_agent
    """

    def class_decorator(cls: type[T]) -> type[T]:
        base_methods = {}
        for name in dir(base_toolkit_class):
            # Skip private methods and excluded helper methods
            if not name.startswith("_") and name not in EXCLUDED_METHODS:
                attr = getattr(base_toolkit_class, name)
                if callable(attr):
                    base_methods[name] = attr

        for method_name, base_method in base_methods.items():
            # Check if method is overridden in the subclass
            if method_name in cls.__dict__:
                # Method is overridden, check if it already has
                # @listen_toolkit decorator
                overridden_method = cls.__dict__[method_name]

                # Check if already decorated by looking for
                # the __listen_toolkit__ marker
                # that listen_toolkit adds to its wrappers
                is_already_decorated = getattr(
                    overridden_method, "__listen_toolkit__", False
                )

                if is_already_decorated:
                    # Already has @listen_toolkit, skip
                    continue

                # Not decorated, wrap the overridden method
                decorated_override = listen_toolkit(base_method)(
                    overridden_method
                )
                setattr(cls, method_name, decorated_override)
                continue

            sig = signature(base_method)

            def create_wrapper(
                method_name: str, base_method: Callable
            ) -> Callable:
                # Unwrap decorators to check the actual function
                unwrapped_method = base_method
                while hasattr(unwrapped_method, "__wrapped__"):
                    unwrapped_method = unwrapped_method.__wrapped__

                # Check if the unwrapped method is a coroutine function
                if iscoroutinefunction(unwrapped_method):

                    async def async_method_wrapper(self, *args, **kwargs):
                        return await getattr(super(cls, self), method_name)(
                            *args, **kwargs
                        )

                    async_method_wrapper.__name__ = method_name
                    async_method_wrapper.__signature__ = sig
                    return async_method_wrapper
                else:

                    def sync_method_wrapper(self, *args, **kwargs):
                        return getattr(super(cls, self), method_name)(
                            *args, **kwargs
                        )

                    sync_method_wrapper.__name__ = method_name
                    sync_method_wrapper.__signature__ = sig
                    return sync_method_wrapper

            wrapper = create_wrapper(method_name, base_method)
            decorated_method = listen_toolkit(base_method)(wrapper)

            setattr(cls, method_name, decorated_method)

        return cls

    return class_decorator
