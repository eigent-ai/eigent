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

"""
Standard Python Environment Management

This module provides utilities for managing a pre-configured Python environment
with common packages (pandas, numpy, matplotlib, requests, openpyxl).

The standard environment is created once at ~/.eigent/standard_env/ and copied
to working directories as needed. This avoids race conditions when multiple
agents try to create environments simultaneously.
"""

import os
import platform
import shutil
import subprocess
import sys
import threading
from collections.abc import Callable
from pathlib import Path

from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("standard_env")

# Standard packages to install in the environment
STANDARD_PACKAGES = [
    "pandas",
    "numpy",
    "matplotlib",
    "requests",
    "openpyxl",
]

# Lock for thread-safe environment operations
_env_lock = threading.Lock()

# Cache for environment paths to avoid repeated checks
_env_cache: dict[str, str] = {}


def get_standard_env_base_path() -> Path:
    """Get the base path for the standard environment."""
    return Path.home() / ".eigent" / "standard_env"


def get_standard_env_marker_file(env_path: Path) -> Path:
    """Get the path to the marker file that indicates a complete environment."""
    return env_path / ".env_complete"


def _get_python_executable(env_path: Path) -> str:
    """Get the Python executable path for an environment."""
    if platform.system() == "Windows":
        return str(env_path / "Scripts" / "python.exe")
    return str(env_path / "bin" / "python")


def _get_uv_path() -> str | None:
    """Get the path to uv if available."""
    try:
        result = subprocess.run(
            ["which", "uv"]
            if platform.system() != "Windows"
            else ["where", "uv"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return result.stdout.strip().split("\n")[0]
    except Exception:
        pass
    return None


def ensure_standard_environment(
    update_callback: Callable[[str], None] | None = None,
) -> str | None:
    """
    Ensure the standard environment exists with all required packages.

    Creates the environment at ~/.eigent/standard_env/ if it doesn't exist.
    This is a one-time setup that can be done at application startup.

    Args:
        update_callback: Optional callback for progress updates.

    Returns:
        Path to the standard environment, or None if creation failed.
    """
    env_path = get_standard_env_base_path()
    marker_file = get_standard_env_marker_file(env_path)

    # Fast path: if marker exists, environment is ready
    if marker_file.exists():
        logger.debug(f"Standard environment already exists at {env_path}")
        return str(env_path)

    with _env_lock:
        # Double-check after acquiring lock
        if marker_file.exists():
            return str(env_path)

        if update_callback:
            update_callback(f"Creating standard environment at {env_path}\n")

        logger.info(f"Creating standard environment at {env_path}")

        try:
            # Remove incomplete environment if exists
            if env_path.exists():
                logger.info("Removing incomplete standard environment")
                shutil.rmtree(env_path)

            env_path.mkdir(parents=True, exist_ok=True)

            current_version = (
                f"{sys.version_info.major}.{sys.version_info.minor}"
            )
            uv_path = _get_uv_path()

            if uv_path:
                # Use uv for faster environment creation
                if update_callback:
                    update_callback("Using uv to create environment...\n")

                # Create venv with uv
                subprocess.run(
                    [
                        uv_path,
                        "venv",
                        "--python",
                        current_version,
                        str(env_path),
                    ],
                    check=True,
                    capture_output=True,
                    timeout=300,
                )

                python_path = _get_python_executable(env_path)

                # Install pip, setuptools, wheel
                subprocess.run(
                    [
                        uv_path,
                        "pip",
                        "install",
                        "--python",
                        python_path,
                        "pip",
                        "setuptools",
                        "wheel",
                    ],
                    check=True,
                    capture_output=True,
                    timeout=300,
                )

                # Install standard packages
                if update_callback:
                    update_callback(
                        f"Installing packages: {', '.join(STANDARD_PACKAGES)}\n"
                    )

                subprocess.run(
                    [uv_path, "pip", "install", "--python", python_path]
                    + STANDARD_PACKAGES,
                    check=True,
                    capture_output=True,
                    timeout=600,
                )
            else:
                # Fallback to standard venv
                if update_callback:
                    update_callback(
                        "Using standard venv to create environment...\n"
                    )

                import venv

                venv.create(str(env_path), with_pip=True)

                python_path = _get_python_executable(env_path)

                # Upgrade pip
                subprocess.run(
                    [python_path, "-m", "pip", "install", "--upgrade", "pip"],
                    check=True,
                    capture_output=True,
                    timeout=300,
                )

                # Install standard packages
                if update_callback:
                    update_callback(
                        f"Installing packages: {', '.join(STANDARD_PACKAGES)}\n"
                    )

                subprocess.run(
                    [python_path, "-m", "pip", "install", "--upgrade"]
                    + STANDARD_PACKAGES,
                    check=True,
                    capture_output=True,
                    timeout=600,
                )

            # Create marker file to indicate completion
            marker_file.touch()

            if update_callback:
                update_callback("Standard environment created successfully!\n")

            logger.info(
                f"Standard environment created successfully at {env_path}"
            )
            return str(env_path)

        except Exception as e:
            logger.error(
                f"Failed to create standard environment: {e}", exc_info=True
            )
            # Clean up on failure
            if env_path.exists():
                try:
                    shutil.rmtree(env_path)
                except Exception:
                    pass
            return None


def copy_standard_env_to_working_dir(
    working_dir: str, update_callback: Callable[[str], None] | None = None
) -> str | None:
    """
    Copy the standard environment to a working directory.

    This function is thread-safe and will only copy once per working directory.
    If the environment already exists in the working directory, it returns
    immediately.

    Args:
        working_dir: The working directory to copy the environment to.
        update_callback: Optional callback for progress updates.

    Returns:
        Path to the copied environment's Python executable, or None if failed.
    """
    target_env_path = Path(working_dir) / ".venv"
    target_marker = get_standard_env_marker_file(target_env_path)

    # Fast path: if environment already exists and is complete
    if target_marker.exists():
        python_path = _get_python_executable(target_env_path)
        if os.path.exists(python_path):
            logger.debug(f"Using existing environment at {target_env_path}")
            return python_path

    # Check cache
    cache_key = str(target_env_path)
    if cache_key in _env_cache:
        cached_path = _env_cache[cache_key]
        if os.path.exists(cached_path):
            return cached_path

    with _env_lock:
        # Double-check after acquiring lock
        if target_marker.exists():
            python_path = _get_python_executable(target_env_path)
            if os.path.exists(python_path):
                _env_cache[cache_key] = python_path
                return python_path

        # Ensure standard environment exists
        standard_env_path = ensure_standard_environment(update_callback)
        if not standard_env_path:
            logger.error("Failed to ensure standard environment exists")
            return None

        if update_callback:
            update_callback(f"Copying environment to {working_dir}\n")

        logger.info(f"Copying standard environment to {target_env_path}")

        try:
            # Ensure working directory exists
            Path(working_dir).mkdir(parents=True, exist_ok=True)

            # Remove incomplete target if exists
            if target_env_path.exists():
                shutil.rmtree(target_env_path)

            # Copy the environment
            # Use copytree with symlinks=True to preserve symlinks (faster and smaller)
            shutil.copytree(
                standard_env_path,
                target_env_path,
                symlinks=True,
                ignore_dangling_symlinks=True,
            )

            # Update pyvenv.cfg if it exists (important for venv relocatability)
            pyvenv_cfg = target_env_path / "pyvenv.cfg"
            if pyvenv_cfg.exists():
                # For most use cases, symlinked venvs work fine after copy
                # But we can update the home path if needed
                pass

            # Create marker file
            target_marker.touch()

            python_path = _get_python_executable(target_env_path)
            _env_cache[cache_key] = python_path

            if update_callback:
                update_callback("Environment copied successfully!\n")

            logger.info(f"Environment copied to {target_env_path}")
            return python_path

        except Exception as e:
            logger.error(f"Failed to copy environment: {e}", exc_info=True)
            # Clean up on failure
            if target_env_path.exists():
                try:
                    shutil.rmtree(target_env_path)
                except Exception:
                    pass
            return None


def get_env_python_executable(working_dir: str) -> str | None:
    """
    Get the Python executable for a working directory's environment.

    This assumes the environment has already been set up via
    copy_standard_env_to_working_dir().

    Args:
        working_dir: The working directory.

    Returns:
        Path to the Python executable, or None if not found.
    """
    env_path = Path(working_dir) / ".venv"
    python_path = _get_python_executable(env_path)

    if os.path.exists(python_path):
        return python_path

    return None


def cleanup_env_cache():
    """Clear the environment path cache."""
    global _env_cache
    with _env_lock:
        _env_cache.clear()
