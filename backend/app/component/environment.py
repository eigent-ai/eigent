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

import importlib
import importlib.util
import logging
import os
import threading
from pathlib import Path
from typing import Any, overload

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI

logger = logging.getLogger("env")

# Thread-local storage for user-specific environment
_thread_local = threading.local()

# Default global environment path
default_env_path = os.path.join(os.path.expanduser("~"), ".eigent", ".env")
load_dotenv(dotenv_path=default_env_path)

# Safe base directory for user environment files
env_base_dir = os.path.join(os.path.expanduser("~"), ".eigent")


def sanitize_env_path(env_path: str | None) -> str | None:
    """
    Validate and sanitize user-provided environment file path.

    Security: Ensures the path stays within ~/.eigent directory
    and ends with .env
    to prevent path traversal attacks and unauthorized file access.

    Args:
        env_path: User-provided environment file path

    Returns:
        Validated absolute path string if valid, None otherwise
    """
    if not env_path:
        return None

    try:
        # Convert to Path object for safe manipulation
        user_path = Path(env_path)

        # Reject absolute paths — they should always be relative to env_base_dir
        if user_path.is_absolute():
            logger.warning(
                f"Security: Rejected absolute env_path. Path: {env_path}"
            )
            return None
        else:
            # Join relative path to base directory
            resolved_path = (Path(env_base_dir) / user_path).resolve()

        # Verify the resolved path is still within env_base_dir
        base_resolved = Path(env_base_dir).resolve()
        try:
            resolved_path.relative_to(base_resolved)
        except ValueError:
            logger.warning(
                f"Security: Rejected env_path outside safe directory. "
                f"Path: {env_path}, Resolved: {resolved_path}, "
                f"Base: {base_resolved}"
            )
            return None

        name = resolved_path.name
        if not (name.endswith(".env") or name.startswith(".env.")):
            logger.warning(
                f"Security: Rejected env_path with invalid extension. "
                f"Path: {env_path}, must be .env or .env.*"
            )
            return None

        return str(resolved_path)

    except (ValueError, OSError) as e:
        logger.warning(
            f"Security: Invalid env_path rejected. "
            f"Path: {env_path}, Error: {e}"
        )
        return None


def set_user_env_path(env_path: str | None = None):
    """
    Set user-specific environment path for current thread.
    If env_path is None, uses default global environment.

    Security: All paths are validated through sanitize_env_path to prevent
    path traversal and unauthorized file access.
    """
    # Sanitize the path before any filesystem operations
    safe_env_path = sanitize_env_path(env_path)

    exists_value = os.path.exists(safe_env_path) if safe_env_path else None
    logger.info(
        f"Setting user environment path: original={env_path}, "
        f"sanitized={safe_env_path}, exists={exists_value}"
    )

    if safe_env_path and os.path.exists(safe_env_path):
        _thread_local.env_path = safe_env_path
        # Load user-specific environment variables
        load_dotenv(dotenv_path=safe_env_path, override=True)
        logger.info(f"User-specific environment loaded: {safe_env_path}")
    else:
        # Clear thread-local env_path to fall back to global
        if hasattr(_thread_local, "env_path"):
            delattr(_thread_local, "env_path")
        logger.info("Reset to default global environment")

        if env_path and not safe_env_path:
            logger.warning(
                f"User environment path rejected by security "
                f"validation: {env_path}"
            )
        elif safe_env_path and not os.path.exists(safe_env_path):
            logger.warning(
                f"User environment path does not exist, "
                f"falling back to global: {safe_env_path}"
            )


def get_current_env_path() -> str:
    """
    Get current environment path (either user-specific or default).
    """
    return getattr(_thread_local, "env_path", default_env_path)


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

    Security: Re-validates path at point of use to ensure integrity.
    """
    # If we have a user-specific environment path, try to reload it
    # to get latest values.
    if hasattr(_thread_local, "env_path"):
        # Re-validate path at point of use for security
        stored_path = _thread_local.env_path
        validated_path = sanitize_env_path(stored_path)

        if validated_path and os.path.exists(validated_path):
            # Temporarily load user-specific env to get the latest value
            from dotenv import dotenv_values

            user_env_values = dotenv_values(validated_path)
            if key in user_env_values:
                value = user_env_values[key] or default
                logger.debug(
                    f"Environment variable retrieved from user-specific "
                    f"config: key={key}, env_path={validated_path}, "
                    f"has_value={value is not None}"
                )
                return value
        elif stored_path and not validated_path:
            # Path failed validation - clear it and log warning
            logger.warning(
                f"Security: Thread-local env_path failed re-validation, "
                f"clearing: {stored_path}"
            )
            delattr(_thread_local, "env_path")

    # Fall back to global environment
    value = os.getenv(key, default)
    logger.debug(
        f"Environment variable retrieved from global config: key={key}, "
        f"has_value={value is not None}, using_default={value == default}"
    )
    return value


def env_or_fail(key: str):
    value = env(key)
    if value is None:
        logger.warning(
            f"[ENVIRONMENT] can't get env config value for key: {key}"
        )
        raise Exception(f"can't get env config value for key: {key}")
    return value


def env_not_empty(key: str):
    value = env(key)
    if not value:
        logger.warning(
            f"[ENVIRONMENT] env config value can't be empty for key: {key}"
        )
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
            # Remove the .py extension from filename
            module_name = file[:-3]
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
            if file_name.endswith(
                "_controller.py"
            ) and not file_name.startswith("__"):
                # Construct complete file path
                file_path = Path(root) / file_name

                # Generate module name
                module_name = file_path.stem

                # Load module using importlib
                spec = importlib.util.spec_from_file_location(
                    module_name, file_path
                )
                if spec is None or spec.loader is None:
                    continue
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)

                # Check if router attribute exists in module
                # and is an APIRouter instance
                router = getattr(module, "router", None)
                if isinstance(router, APIRouter):
                    api.include_router(router, prefix=prefix)
