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
import atexit
import os
import pathlib
import signal
import sys

# Add project root to Python path to import shared utils
_project_root = pathlib.Path(__file__).parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

# Disable verbose CAMEL logs
logging.getLogger("camel").setLevel(logging.WARNING)
logging.getLogger("camel.base_model").setLevel(logging.WARNING)
logging.getLogger("camel.agents").setLevel(logging.WARNING)
logging.getLogger("camel.societies").setLevel(logging.WARNING)

import app.patches.strip_think_tags  # noqa: F401 — must run before any model use
from app import api
from app.component.environment import env
from app.router import register_routers

os.environ["PYTHONIOENCODING"] = "utf-8"

app_logger = logging.getLogger("main")

# Log application startup
app_logger.info("Starting Eigent Multi-Agent System API")
app_logger.info(f"Python encoding: {os.environ.get('PYTHONIOENCODING')}")
app_logger.info(f"Environment: {os.environ.get('ENVIRONMENT', 'development')}")

prefix = env("url_prefix", "")
app_logger.info(f"Loading routers with prefix: '{prefix}'")
register_routers(api, prefix)
app_logger.info("All routers loaded successfully")

# Check if debug mode is enabled via environment variable
if os.environ.get("ENABLE_PYTHON_DEBUG") == "true":
    try:
        import debugpy

        DEBUG_PORT = int(os.environ.get("DEBUG_PORT", "5678"))
        app_logger.info(
            f"Debug mode enabled - Starting debugpy server on port {DEBUG_PORT}"
        )
        debugpy.listen(("localhost", DEBUG_PORT))
        app_logger.info(
            f"Debugger ready for attachment on localhost:{DEBUG_PORT}"
        )
        # 📝 In VS Code: Run 'Debug Python Backend (Attach)' configuration
        # Don't wait for client automatically - let it attach when ready
    except ImportError:
        app_logger.warning(
            "debugpy not available, install with: uv add debugpy"
        )
    except Exception as e:
        app_logger.error(f"Failed to start debugpy: {e}")

dir = pathlib.Path(__file__).parent / "runtime"
dir.mkdir(parents=True, exist_ok=True)


# Write PID file asynchronously
async def write_pid_file():
    r"""Write PID file asynchronously"""
    import aiofiles

    async with aiofiles.open(dir / "run.pid", "w") as f:
        await f.write(str(os.getpid()))
    app_logger.info(f"PID file written: {os.getpid()}")


# PID task will be created on startup
pid_task = None


@api.on_event("startup")
async def startup_event():
    global pid_task
    pid_task = asyncio.create_task(write_pid_file())
    app_logger.info("PID write task created")

    # Initialize telemetry tracer provider
    from app.utils.telemetry.workforce_metrics import (
        initialize_tracer_provider,
    )

    initialize_tracer_provider()
    app_logger.info("Telemetry tracer provider initialized")


# Graceful shutdown handler
shutdown_event = asyncio.Event()


async def cleanup_resources():
    r"""Cleanup all resources on shutdown"""
    app_logger.info("Starting graceful shutdown process")

    from app.service.task import _cleanup_task, task_locks

    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass

    # Cleanup all task locks
    for task_id in list(task_locks.keys()):
        try:
            task_lock = task_locks[task_id]
            await task_lock.cleanup()
        except Exception as e:
            app_logger.error(f"Error cleaning up task {task_id}: {e}")

    # Remove PID file
    pid_file = dir / "run.pid"
    if pid_file.exists():
        pid_file.unlink()

    app_logger.info("All resources cleaned up successfully")


def signal_handler(signum, frame):
    r"""Handle shutdown signals"""
    app_logger.warning(f"Received shutdown signal: {signum}")
    asyncio.create_task(cleanup_resources())
    shutdown_event.set()


signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)


# Register cleanup on exit with safe synchronous wrapper
def sync_cleanup():
    """Synchronous cleanup for atexit - handles PID file removal"""
    try:
        # Only perform synchronous cleanup tasks
        pid_file = dir / "run.pid"
        if pid_file.exists():
            pid_file.unlink()
            app_logger.info("PID file removed during shutdown")
    except Exception as e:
        app_logger.error(f"Error during atexit cleanup: {e}")


atexit.register(sync_cleanup)

# Log successful initialization
app_logger.info("Application initialization completed successfully")
