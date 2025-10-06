import asyncio
from functools import wraps
from inspect import iscoroutinefunction
import json
from typing import Any, Callable

from loguru import logger
from app.service.task import (
    ActionActivateToolkitData,
    ActionDeactivateToolkitData,
    get_task_lock,
)
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import process_task


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
                await task_lock.put_queue(
                    ActionActivateToolkitData(
                        data={
                            "agent_name": toolkit.agent_name,
                            "process_task_id": process_task.get(""),
                            "toolkit_name": toolkit_name,
                            "method_name": method_name,
                            "message": args_str,
                        },
                    )
                )
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

                await task_lock.put_queue(
                    ActionDeactivateToolkitData(
                        data={
                            "agent_name": toolkit.agent_name,
                            "process_task_id": process_task.get(""),
                            "toolkit_name": toolkit_name,
                            "method_name": method_name,
                            "message": res_msg,
                        },
                    )
                )
                if error is not None:
                    raise error
                return res

            return async_wrapper

        else:
            # sync function wrapper
            @wraps(wrap)
            def sync_wrapper(*args, **kwargs):
                toolkit: AbstractToolkit = args[0]
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
                task = asyncio.create_task(
                    task_lock.put_queue(
                        ActionActivateToolkitData(
                            data={
                                "agent_name": toolkit.agent_name,
                                "process_task_id": process_task.get(""),
                                "toolkit_name": toolkit_name,
                                "method_name": method_name,
                                "message": args_str,
                            },
                        )
                    )
                )
                if hasattr(task_lock, "add_background_task"):
                    task_lock.add_background_task(task)
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

                task = asyncio.create_task(
                    task_lock.put_queue(
                        ActionDeactivateToolkitData(
                            data={
                                "agent_name": toolkit.agent_name,
                                "process_task_id": process_task.get(""),
                                "toolkit_name": toolkit_name,
                                "method_name": method_name,
                                "message": res_msg,
                            },
                        )
                    )
                )
                if hasattr(task_lock, "add_background_task"):
                    task_lock.add_background_task(task)
                if error is not None:
                    raise error
                return res

            return sync_wrapper

    return decorator
