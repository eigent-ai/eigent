import asyncio
from functools import wraps
from inspect import iscoroutinefunction, getmembers, ismethod, signature
import json
from typing import Any, Callable, Type, TypeVar
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from app.service.task import (
    ActionActivateToolkitData,
    ActionDeactivateToolkitData,
    get_task_lock,
)
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import process_task
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("toolkit_listen")


def _safe_put_queue(task_lock, data):
    """Safely put data to the queue, handling both sync and async contexts"""
    logger.info(f"[SAFE_PUT_QUEUE] ========== START ==========")
    logger.info(f"[SAFE_PUT_QUEUE] data type: {data.__class__.__name__}")
    logger.info(f"[SAFE_PUT_QUEUE] data content: {data}")

    try:
        # Try to get current event loop
        logger.info(f"[SAFE_PUT_QUEUE] Attempting to get running event loop")
        loop = asyncio.get_running_loop()
        logger.info(f"[SAFE_PUT_QUEUE] Got running loop: {loop} - ASYNC CONTEXT")

        # We're in an async context, create a task
        logger.info(f"[SAFE_PUT_QUEUE] Creating async task for put_queue")
        task = asyncio.create_task(task_lock.put_queue(data))

        if hasattr(task_lock, "add_background_task"):
            logger.info(f"[SAFE_PUT_QUEUE] Adding to background tasks")
            task_lock.add_background_task(task)

        # Add done callback to handle any exceptions and prevent warnings
        def handle_task_result(t):
            try:
                t.result()  # This will raise any exception that occurred
                logger.info(f"[SAFE_PUT_QUEUE] Async task completed successfully")
            except Exception as e:
                logger.error(f"[SAFE_PUT_QUEUE] Background task failed: {e}")
        task.add_done_callback(handle_task_result)
        logger.info(f"[SAFE_PUT_QUEUE] Async task created and callback added")

    except RuntimeError as re:
        logger.info(f"[SAFE_PUT_QUEUE] No running event loop (RuntimeError: {re}) - SYNC CONTEXT")
        # No running event loop, we need to handle this differently
        try:
            import queue
            result_queue = queue.Queue()
            logger.info(f"[SAFE_PUT_QUEUE] Created result queue for thread communication")

            # Create a new event loop in a separate thread to avoid conflicts
            def run_in_thread():
                try:
                    logger.info(f"[SAFE_PUT_QUEUE_THREAD] Thread started")
                    # Create a new event loop for this thread
                    new_loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(new_loop)
                    logger.info(f"[SAFE_PUT_QUEUE_THREAD] Created new event loop: {new_loop}")

                    try:
                        logger.info(f"[SAFE_PUT_QUEUE_THREAD] Running task_lock.put_queue in new loop")
                        new_loop.run_until_complete(task_lock.put_queue(data))
                        logger.info(f"[SAFE_PUT_QUEUE_THREAD] put_queue completed successfully")
                        result_queue.put(("success", None))
                    except Exception as e:
                        logger.error(f"[SAFE_PUT_QUEUE_THREAD] put_queue failed: {e}")
                        result_queue.put(("error", e))
                    finally:
                        new_loop.close()
                        logger.info(f"[SAFE_PUT_QUEUE_THREAD] Event loop closed")
                except Exception as e:
                    logger.error(f"[SAFE_PUT_QUEUE_THREAD] Thread failed: {e}")
                    result_queue.put(("error", e))

            # Run in a separate non-daemon thread to ensure completion
            logger.info(f"[SAFE_PUT_QUEUE] Starting new thread for put_queue")
            thread = threading.Thread(target=run_in_thread, daemon=False)
            thread.start()
            logger.info(f"[SAFE_PUT_QUEUE] Thread started, waiting for result (timeout=1.0s)")

            # Wait briefly to ensure the thread starts and completes
            try:
                status, error = result_queue.get(timeout=1.0)
                logger.info(f"[SAFE_PUT_QUEUE] Thread result: status={status}, error={error}")

                if status == "error":
                    logger.error(f"[SAFE_PUT_QUEUE] Thread execution failed: {error}")
                else:
                    logger.info(f"[SAFE_PUT_QUEUE] Thread execution succeeded for {data.__class__.__name__}")
            except queue.Empty:
                # Thread is still running, but we can't wait forever
                logger.warning(f"[SAFE_PUT_QUEUE] Thread execution timeout after 1s for {data.__class__.__name__}, continuing anyway")

        except Exception as e:
            logger.error(f"[SAFE_PUT_QUEUE] Failed to send data to queue: {e}")

    logger.info(f"[SAFE_PUT_QUEUE] ========== END ==========")


def listen_toolkit(
    wrap_method: Callable[..., Any] | None = None,
    inputs: Callable[..., str] | None = None,
    return_msg: Callable[[Any], str] | None = None,
):
    def decorator(func: Callable[..., Any]):
        wrap = func if wrap_method is None else wrap_method

        if iscoroutinefunction(func):
            # async function wrapper
            @wraps(wrap)
            async def async_wrapper(*args, **kwargs):
                toolkit: AbstractToolkit = args[0]
                # Check if api_task_id exists
                if not hasattr(toolkit, 'api_task_id'):
                    logger.warning(f"[listen_toolkit] {toolkit.__class__.__name__} missing api_task_id, calling method directly")
                    return await func(*args, **kwargs)
                    
                task_lock = get_task_lock(toolkit.api_task_id)

                if inputs is not None:
                    args_str = inputs(*args, **kwargs)
                else:
                    # remove first param self
                    filtered_args = args[1:] if len(args) > 0 else []

                    args_str = ", ".join(repr(arg) for arg in filtered_args)
                    if kwargs:
                        kwargs_str = ", ".join(f"{k}={v!r}" for k, v in kwargs.items())
                        args_str = f"{args_str}, {kwargs_str}" if args_str else kwargs_str

                # Truncate args_str if too long
                MAX_ARGS_LENGTH = 500
                if len(args_str) > MAX_ARGS_LENGTH:
                    args_str = args_str[:MAX_ARGS_LENGTH] + f"... (truncated, total length: {len(args_str)} chars)"

                toolkit_name = toolkit.toolkit_name()
                method_name = func.__name__.replace("_", " ")

                # Multi-layer fallback to get process_task_id
                process_task_id_from_contextvar = process_task.get("")
                logger.info(f"[LISTEN_TOOLKIT_CONTEXTVAR] In wrapper for {func.__name__}: ContextVar = '{process_task_id_from_contextvar}'")

                process_task_id = process_task_id_from_contextvar
                if not process_task_id:
                    # Fallback 1: Try to get from toolkit.api_task_id
                    process_task_id = getattr(toolkit, 'api_task_id', "")
                    if process_task_id:
                        logger.warning(f"[toolkit_listen] ContextVar process_task is empty, using toolkit.api_task_id: {process_task_id}")
                    else:
                        logger.warning(f"[toolkit_listen] Both ContextVar process_task and toolkit.api_task_id are empty for {toolkit_name}.{method_name}")

                activate_timestamp = datetime.now().isoformat()

                # Debug logging
                logger.info(f"[TOOLKIT DEBUG] About to log ACTIVATE for {toolkit_name}.{method_name}")

                # Log toolkit activation
                logger.info(f"[TOOLKIT ACTIVATE] Toolkit: {toolkit_name} | Method: {method_name} | Task ID: {process_task_id} | Agent: {toolkit.agent_name} | Timestamp: {activate_timestamp}")

                activate_data = ActionActivateToolkitData(
                    data={
                        "agent_name": toolkit.agent_name,
                        "process_task_id": process_task_id,
                        "toolkit_name": toolkit_name,
                        "method_name": method_name,
                        "message": args_str,
                    },
                )
                await task_lock.put_queue(activate_data)
                error = None
                res = None
                try:
                    res = await func(*args, **kwargs)
                except Exception as e:
                    error = e

                if return_msg and error is None:
                    res_msg = return_msg(res)
                elif isinstance(res, str):
                    res_msg = res
                else:
                    if error is None:
                        try:
                            res_msg = json.dumps(res, ensure_ascii=False)
                        except TypeError:
                            # Handle cases where res contains non-serializable objects (like coroutines)
                            res_str = str(res)
                            # Truncate very long outputs to avoid flooding logs
                            MAX_LENGTH = 500
                            if len(res_str) > MAX_LENGTH:
                                res_msg = res_str[:MAX_LENGTH] + f"... (truncated, total length: {len(res_str)} chars)"
                            else:
                                res_msg = res_str
                    else:
                        res_msg = str(error)

                deactivate_timestamp = datetime.now().isoformat()
                status = "ERROR" if error is not None else "SUCCESS"

                # Log toolkit deactivation
                logger.info(f"[TOOLKIT DEACTIVATE] Toolkit: {toolkit_name} | Method: {method_name} | Task ID: {process_task_id} | Agent: {toolkit.agent_name} | Status: {status} | Timestamp: {deactivate_timestamp}")

                deactivate_data = ActionDeactivateToolkitData(
                    data={
                        "agent_name": toolkit.agent_name,
                        "process_task_id": process_task_id,
                        "toolkit_name": toolkit_name,
                        "method_name": method_name,
                        "message": res_msg,
                    },
                )
                await task_lock.put_queue(deactivate_data)
                if error is not None:
                    raise error
                return res

            return async_wrapper

        else:
            # sync function wrapper
            @wraps(wrap)
            def sync_wrapper(*args, **kwargs):
                logger.info(f"[LISTEN_TOOLKIT_SYNC] ========== WRAPPER START for {func.__name__} ==========")
                logger.info(f"[LISTEN_TOOLKIT_SYNC] args count: {len(args)}, kwargs: {list(kwargs.keys())}")

                toolkit: AbstractToolkit = args[0]
                logger.info(f"[LISTEN_TOOLKIT_SYNC] toolkit type: {toolkit.__class__.__name__}")

                # Check if api_task_id exists
                if not hasattr(toolkit, 'api_task_id'):
                    logger.warning(f"[listen_toolkit] {toolkit.__class__.__name__} missing api_task_id, calling method directly")
                    return func(*args, **kwargs)

                logger.info(f"[LISTEN_TOOLKIT_SYNC] api_task_id: {toolkit.api_task_id}")
                task_lock = get_task_lock(toolkit.api_task_id)
                logger.info(f"[LISTEN_TOOLKIT_SYNC] Got task_lock: {task_lock}")

                if inputs is not None:
                    args_str = inputs(*args, **kwargs)
                else:
                    # remove first param self
                    filtered_args = args[1:] if len(args) > 0 else []

                    args_str = ", ".join(repr(arg) for arg in filtered_args)
                    if kwargs:
                        kwargs_str = ", ".join(f"{k}={v!r}" for k, v in kwargs.items())
                        args_str = f"{args_str}, {kwargs_str}" if args_str else kwargs_str

                # Truncate args_str if too long
                MAX_ARGS_LENGTH = 500
                if len(args_str) > MAX_ARGS_LENGTH:
                    args_str = args_str[:MAX_ARGS_LENGTH] + f"... (truncated, total length: {len(args_str)} chars)"

                toolkit_name = toolkit.toolkit_name()
                method_name = func.__name__.replace("_", " ")

                # Multi-layer fallback to get process_task_id
                process_task_id_from_contextvar = process_task.get("")
                logger.info(f"[LISTEN_TOOLKIT_CONTEXTVAR] In wrapper for {func.__name__}: ContextVar = '{process_task_id_from_contextvar}'")

                process_task_id = process_task_id_from_contextvar
                if not process_task_id:
                    # Fallback 1: Try to get from toolkit.api_task_id
                    process_task_id = getattr(toolkit, 'api_task_id', "")
                    if process_task_id:
                        logger.warning(f"[toolkit_listen] ContextVar process_task is empty, using toolkit.api_task_id: {process_task_id}")
                    else:
                        logger.warning(f"[toolkit_listen] Both ContextVar process_task and toolkit.api_task_id are empty for {toolkit_name}.{method_name}")

                activate_timestamp = datetime.now().isoformat()

                # Log toolkit activation (sync)
                logger.info(f"[TOOLKIT ACTIVATE] Toolkit: {toolkit_name} | Method: {method_name} | Task ID: {process_task_id} | Agent: {toolkit.agent_name} | Timestamp: {activate_timestamp}")

                activate_data = ActionActivateToolkitData(
                    data={
                        "agent_name": toolkit.agent_name,
                        "process_task_id": process_task_id,
                        "toolkit_name": toolkit_name,
                        "method_name": method_name,
                        "message": args_str,
                    },
                )
                logger.info(f"[LISTEN_TOOLKIT_SYNC] Sending ActionActivateToolkitData via _safe_put_queue")
                _safe_put_queue(task_lock, activate_data)
                logger.info(f"[LISTEN_TOOLKIT_SYNC] ActionActivateToolkitData sent")

                error = None
                res = None
                try:
                    logger.info(f"[LISTEN_TOOLKIT_SYNC] ===>>> Calling actual function {func.__name__} <<<===")
                    res = func(*args, **kwargs)
                    logger.info(f"[LISTEN_TOOLKIT_SYNC] ===>>> Function {func.__name__} returned <<<===")
                    # Safety check: if the result is a coroutine, this is a programming error
                    if asyncio.iscoroutine(res):
                        error_msg = f"Async function {func.__name__} was incorrectly called in sync context. This is a bug - the function should be marked as async or should not return a coroutine."
                        logger.error(f"[listen_toolkit] {error_msg}")
                        # Cannot safely await in sync context - close the coroutine to prevent warnings
                        res.close()
                        raise TypeError(error_msg)
                except Exception as e:
                    error = e

                if return_msg and error is None:
                    res_msg = return_msg(res)
                elif isinstance(res, str):
                    res_msg = res
                else:
                    if error is None:
                        try:
                            res_msg = json.dumps(res, ensure_ascii=False)
                        except TypeError:
                            # Handle cases where res contains non-serializable objects (like coroutines)
                            res_str = str(res)
                            # Truncate very long outputs to avoid flooding logs
                            MAX_LENGTH = 500
                            if len(res_str) > MAX_LENGTH:
                                res_msg = res_str[:MAX_LENGTH] + f"... (truncated, total length: {len(res_str)} chars)"
                            else:
                                res_msg = res_str
                    else:
                        res_msg = str(error)

                deactivate_timestamp = datetime.now().isoformat()
                status = "ERROR" if error is not None else "SUCCESS"

                # Log toolkit deactivation (sync)
                logger.info(f"[TOOLKIT DEACTIVATE] Toolkit: {toolkit_name} | Method: {method_name} | Task ID: {process_task_id} | Agent: {toolkit.agent_name} | Status: {status} | Timestamp: {deactivate_timestamp}")

                deactivate_data = ActionDeactivateToolkitData(
                    data={
                        "agent_name": toolkit.agent_name,
                        "process_task_id": process_task_id,
                        "toolkit_name": toolkit_name,
                        "method_name": method_name,
                        "message": res_msg,
                    },
                )
                logger.info(f"[LISTEN_TOOLKIT_SYNC] Sending ActionDeactivateToolkitData")
                _safe_put_queue(task_lock, deactivate_data)
                logger.info(f"[LISTEN_TOOLKIT_SYNC] ActionDeactivateToolkitData sent")
                logger.info(f"[LISTEN_TOOLKIT_SYNC] ========== WRAPPER END for {func.__name__} ==========")

                if error is not None:
                    logger.error(f"[LISTEN_TOOLKIT_SYNC] Raising error: {error}")
                    raise error
                return res

            return sync_wrapper

    return decorator


T = TypeVar('T')

# Methods that should not be wrapped by auto_listen_toolkit
# These are utility/helper methods that don't perform actual tool operations
EXCLUDED_METHODS = {
    'get_tools',           # Tool enumeration
    'get_can_use_tools',   # Tool filtering
    'toolkit_name',        # Metadata getter
    'run_mcp_server',      # MCP server initialization
    'model_dump',          # Pydantic model serialization
    'model_dump_json',     # Pydantic model serialization
    'dict',                # Pydantic legacy dict method
    'json',                # Pydantic legacy json method
    'copy',                # Object copying
    'update',              # Object update
}


def auto_listen_toolkit(base_toolkit_class: Type[T]) -> Callable[[Type[T]], Type[T]]:
    """
    Class decorator that automatically wraps all public methods from the base toolkit
    with the @listen_toolkit decorator.

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
    def class_decorator(cls: Type[T]) -> Type[T]:

        base_methods = {}
        for name in dir(base_toolkit_class):
            # Skip private methods and excluded helper methods
            if not name.startswith('_') and name not in EXCLUDED_METHODS:
                attr = getattr(base_toolkit_class, name)
                if callable(attr):
                    base_methods[name] = attr

        for method_name, base_method in base_methods.items():
            # Check if method is overridden in the subclass
            if method_name in cls.__dict__:
                # Method is overridden, check if it already has @listen_toolkit decorator
                overridden_method = cls.__dict__[method_name]

                # Check if already decorated by looking for the wrapper attributes
                # that listen_toolkit adds (like __wrapped__ or specific markers)
                is_already_decorated = (
                    hasattr(overridden_method, '__wrapped__') or
                    (hasattr(overridden_method, '__name__') and
                     hasattr(getattr(overridden_method, '__code__', None), 'co_freevars') and
                     'toolkit' in getattr(overridden_method.__code__, 'co_freevars', []))
                )

                if is_already_decorated:
                    # Already has @listen_toolkit, skip
                    continue

                # Not decorated, wrap the overridden method
                decorated_override = listen_toolkit(base_method)(overridden_method)
                setattr(cls, method_name, decorated_override)
                continue

            sig = signature(base_method)

            def create_wrapper(method_name: str, base_method: Callable) -> Callable:
                # Unwrap decorators to check the actual function
                unwrapped_method = base_method
                while hasattr(unwrapped_method, '__wrapped__'):
                    unwrapped_method = unwrapped_method.__wrapped__

                # Check if the unwrapped method is a coroutine function
                if iscoroutinefunction(unwrapped_method):
                    async def async_method_wrapper(self, *args, **kwargs):
                        return await getattr(super(cls, self), method_name)(*args, **kwargs)
                    async_method_wrapper.__name__ = method_name
                    async_method_wrapper.__signature__ = sig
                    return async_method_wrapper
                else:
                    def sync_method_wrapper(self, *args, **kwargs):
                        return getattr(super(cls, self), method_name)(*args, **kwargs)
                    sync_method_wrapper.__name__ = method_name
                    sync_method_wrapper.__signature__ = sig
                    return sync_method_wrapper

            wrapper = create_wrapper(method_name, base_method)
            decorated_method = listen_toolkit(base_method)(wrapper)

            setattr(cls, method_name, decorated_method)

        return cls

    return class_decorator
