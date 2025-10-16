from utils import traceroot_wrapper as traceroot
import importlib.util
import os
from pathlib import Path
from fastapi import APIRouter, FastAPI
from dotenv import load_dotenv
import importlib
from typing import Any, overload
import threading

traceroot_logger = traceroot.get_logger("env")

# Thread-local storage for user-specific environment
_thread_local = threading.local()

# Default global environment path
default_env_path = os.path.join(os.path.expanduser("~"), ".eigent", ".env")
load_dotenv(dotenv_path=default_env_path)


def set_user_env_path(env_path: str | None = None):
    """
    Set user-specific environment path for current thread.
    If env_path is None, uses default global environment.
    """
    if env_path and os.path.exists(env_path):
        _thread_local.env_path = env_path
        # Load user-specific environment variables
        load_dotenv(dotenv_path=env_path, override=True)
    else:
        # Clear thread-local env_path to fall back to global
        if hasattr(_thread_local, 'env_path'):
            delattr(_thread_local, 'env_path')


def get_current_env_path() -> str:
    """
    Get current environment path (either user-specific or default).
    """
    return getattr(_thread_local, 'env_path', default_env_path)


@overload
def env(key: str) -> str | None: ...


@overload
def env(key: str, default: str) -> str: ...


@overload
def env(key: str, default: Any) -> Any: ...


def env(key: str, default=None):
    """
    Get environment variable. 
    First checks thread-local user-specific environment, 
    then falls back to global environment.
    """
    # If we have a user-specific environment path, try to reload it to get latest values
    if hasattr(_thread_local, 'env_path') and os.path.exists(_thread_local.env_path):
        # Temporarily load user-specific env to get the latest value
        from dotenv import dotenv_values
        user_env_values = dotenv_values(_thread_local.env_path)
        if key in user_env_values:
            return user_env_values[key] or default
    
    # Fall back to global environment
    return os.getenv(key, default)


def env_or_fail(key: str):
    value = env(key)
    if value is None:
        traceroot_logger.warning(f"[ENVIRONMENT] can't get env config value for key: {key}")
        raise Exception(f"can't get env config value for key: {key}")
    return value

@traceroot.trace()
def env_not_empty(key: str):
    value = env(key)
    if not value:
        traceroot_logger.warning(f"[ENVIRONMENT] env config value can't be empty for key: {key}")
        raise Exception(f"env config value can't be empty for key: {key}")
    return value


def base_path():
    return Path(__file__).parent.parent.parent


def to_path(path: str):
    return base_path() / path


def auto_import(package: str):
    """
    Automatically import all Python files in the specified directory
    """
    # Get all file names in the folder
    folder = package.replace(".", "/")
    files = os.listdir(folder)

    # Import all .py files in the folder
    for file in files:
        if file.endswith(".py") and not file.startswith("__"):
            module_name = file[:-3]  # Remove the .py extension from filename
            importlib.import_module(package + "." + module_name)


def auto_include_routers(api: FastAPI, prefix: str, directory: str):
    """
    Automatically scan all modules in the specified directory and register routes

    :param api: FastAPI instance
    :param prefix: Route prefix
    :param directory: Directory path to scan
    """
    # Convert directory to absolute path
    dir_path = Path(directory).resolve()

    # Traverse all .py files in the directory
    for root, _, files in os.walk(dir_path):
        for file_name in files:
            if file_name.endswith("_controller.py") and not file_name.startswith("__"):
                # Construct complete file path
                file_path = Path(root) / file_name

                # Generate module name
                module_name = file_path.stem

                # Load module using importlib
                spec = importlib.util.spec_from_file_location(module_name, file_path)
                if spec is None or spec.loader is None:
                    continue
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)

                # Check if router attribute exists in module and is an APIRouter instance
                router = getattr(module, "router", None)
                if isinstance(router, APIRouter):
                    api.include_router(router, prefix=prefix)
