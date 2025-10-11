import asyncio
from functools import wraps
from inspect import iscoroutinefunction, getmembers, ismethod, signature
import json
from typing import Any, Callable, Type, TypeVar
import threading
from concurrent.futures import ThreadPoolExecutor

from loguru import logger
from app.service.task import (
    ActionActivateToolkitData,
    ActionDeactivateToolkitData,
    get_task_lock,
)
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import process_task


def _safe_put_queue(task_lock, data):
    """Safely put data to the queue, handling both sync and async contexts"""
    try:
        # Try to get current event loop
        loop = asyncio.get_running_loop()
        # We're in an async context, create a task
        task = asyncio.create_task(task_lock.put_queue(data))
        if hasattr(task_lock, "add_background_task"):
            task_lock.add_background_task(task)
    except RuntimeError:
        # No running event loop, we need to handle this differently
        try:
            # Try to find an existing event loop in the current thread
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Schedule the coroutine in the existing running loop
                future = asyncio.run_coroutine_threadsafe(
                    task_lock.put_queue(data),
                    loop
                )
                # Log but don't wait for the result
                logger.debug(f"[listen_toolkit] Scheduled put_queue in existing event loop")
            else:
                # Create a new event loop just for this operation
                logger.debug(f"[listen_toolkit] Creating new event loop for put_queue")
                asyncio.run(task_lock.put_queue(data))
        except Exception as e:
            logger.error(f"[listen_toolkit] Failed to send data to queue: {e}")


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

                toolkit_name = toolkit.toolkit_name()
                method_name = func.__name__.replace("_", " ")
                logger.info(f"[listen_toolkit] {toolkit_name}.{method_name} called with args: {args_str}")
                activate_data = ActionActivateToolkitData(
                    data={
                        "agent_name": toolkit.agent_name,
                        "process_task_id": process_task.get(""),
                        "toolkit_name": toolkit_name,
                        "method_name": method_name,
                        "message": args_str,
                    },
                )
                logger.debug(f"[listen_toolkit] Sending activate data: {activate_data.model_dump()}")
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
                            res_msg = str(res)
                    else:
                        res_msg = str(error)

                deactivate_data = ActionDeactivateToolkitData(
                    data={
                        "agent_name": toolkit.agent_name,
                        "process_task_id": process_task.get(""),
                        "toolkit_name": toolkit_name,
                        "method_name": method_name,
                        "message": res_msg,
                    },
                )
                logger.debug(f"[listen_toolkit] Sending deactivate data: {deactivate_data.model_dump()}")
                await task_lock.put_queue(deactivate_data)
                if error is not None:
                    raise error
                return res

            return async_wrapper

        else:
            # sync function wrapper
            @wraps(wrap)
            def sync_wrapper(*args, **kwargs):
                toolkit: AbstractToolkit = args[0]
                # Check if api_task_id exists
                if not hasattr(toolkit, 'api_task_id'):
                    logger.warning(f"[listen_toolkit] {toolkit.__class__.__name__} missing api_task_id, calling method directly")
                    return func(*args, **kwargs)
                    
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

                toolkit_name = toolkit.toolkit_name()
                method_name = func.__name__.replace("_", " ")
                logger.info(f"[listen_toolkit] {toolkit_name}.{method_name} called with args: {args_str}")
                activate_data = ActionActivateToolkitData(
                    data={
                        "agent_name": toolkit.agent_name,
                        "process_task_id": process_task.get(""),
                        "toolkit_name": toolkit_name,
                        "method_name": method_name,
                        "message": args_str,
                    },
                )
                logger.debug(f"[listen_toolkit sync] Sending activate data: {activate_data.model_dump()}")
                _safe_put_queue(task_lock, activate_data)
                error = None
                res = None
                try:
                    logger.debug(f"Executing toolkit method: {toolkit_name}.{method_name} for agent '{toolkit.agent_name}'")
                    res = func(*args, **kwargs)
                    # Safety check: if the result is a coroutine, we need to await it
                    if asyncio.iscoroutine(res):
                        import warnings

                        warnings.warn(f"Async function {func.__name__} was incorrectly called synchronously")
                        res = asyncio.run(res)
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
                            res_msg = str(res)
                    else:
                        res_msg = str(error)

                deactivate_data = ActionDeactivateToolkitData(
                    data={
                        "agent_name": toolkit.agent_name,
                        "process_task_id": process_task.get(""),
                        "toolkit_name": toolkit_name,
                        "method_name": method_name,
                        "message": res_msg,
                    },
                )
                logger.debug(f"[listen_toolkit sync] Sending deactivate data: {deactivate_data.model_dump()}")
                _safe_put_queue(task_lock, deactivate_data)
                if error is not None:
                    raise error
                return res

            return sync_wrapper

    return decorator


T = TypeVar('T')


def auto_listen_toolkit(base_toolkit_class: Type[T]) -> Callable[[Type[T]], Type[T]]:
    """
    Class decorator that automatically wraps all public methods from the base toolkit
    with the @listen_toolkit decorator.
    
    Usage:
        @auto_listen_toolkit(BaseNoteTakingToolkit)
        class NoteTakingToolkit(BaseNoteTakingToolkit, AbstractToolkit):
            agent_name: str = Agents.document_agent
    """
    def class_decorator(cls: Type[T]) -> Type[T]:

        base_methods = {}
        for name in dir(base_toolkit_class):
            if not name.startswith('_'):
                attr = getattr(base_toolkit_class, name)
                if callable(attr):
                    base_methods[name] = attr
                    logger.debug(f"[auto_listen_toolkit] Found base method: {name}")

        for method_name, base_method in base_methods.items():
            if method_name in cls.__dict__:
                continue
                
            sig = signature(base_method)
            
            def create_wrapper(method_name: str, base_method: Callable) -> Callable:
                if iscoroutinefunction(base_method):
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
