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
import threading

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

from app import api
from app.component.environment import env
from app.router import register_routers
from app.utils.event_loop_utils import set_main_event_loop

os.environ["PYTHONIOENCODING"] = "utf-8"

app_logger = logging.getLogger("main")

# Log application startup
app_logger.info("Starting Eigent Multi-Agent System API")
app_logger.info(f"Python encoding: {os.environ.get('PYTHONIOENCODING')}")
app_logger.info(f"Environment: {os.environ.get('ENVIRONMENT', 'development')}")

prefix = env("url_prefix", "")
app_logger.info(f"Loading routers with prefix: '{prefix}'")
app_logger.info(
    f"MCP will be at: {prefix}/mcp/list, health at: {prefix}/health"
)
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
    set_main_event_loop(asyncio.get_running_loop())
    pid_task = asyncio.create_task(write_pid_file())
    app_logger.info("PID write task created")

    # Initialize EnvironmentHands from Brain deployment (full on local/cloud_vm, sandbox in Docker)
    from app.router_layer.hands_resolver import init_environment_hands

    hands = init_environment_hands()
    app_logger.info(f"EnvironmentHands initialized: mode={hands.mode}")

    # Initialize telemetry tracer provider
    from app.utils.telemetry.workforce_metrics import (
        initialize_tracer_provider,
    )

    initialize_tracer_provider()
    app_logger.info("Telemetry tracer provider initialized")


@api.on_event("shutdown")
async def shutdown_event_handler():
    r"""Run cleanup when uvicorn receives SIGINT/SIGTERM and shuts down."""
    await cleanup_resources()


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

    # Shutdown OpenTelemetry tracer (releases BatchSpanProcessor worker threads)
    try:
        from app.utils.telemetry.workforce_metrics import (
            shutdown_tracer_provider,
        )

        shutdown_tracer_provider()
    except Exception as e:
        app_logger.warning(f"Telemetry shutdown failed: {e}")

    # Shutdown TerminalToolkit thread pool (prevents non-daemon threads blocking exit)
    try:
        from app.agent.toolkit.terminal_toolkit import TerminalToolkit

        if TerminalToolkit._thread_pool is not None:
            TerminalToolkit._thread_pool.shutdown(wait=False)
            TerminalToolkit._thread_pool = None
    except Exception as e:
        app_logger.warning(f"TerminalToolkit shutdown failed: {e}")

    # Best-effort close Browser toolkit WebSocket/Node connections.
    # Use a timeout so shutdown stays responsive even if a wrapper is stuck.
    try:
        from app.agent.toolkit.hybrid_browser_toolkit import (
            websocket_connection_pool,
        )

        await asyncio.wait_for(
            websocket_connection_pool.close_all(), timeout=3.0
        )
    except TimeoutError:
        app_logger.warning("Browser WebSocket pool shutdown timed out")
    except Exception as e:
        app_logger.warning(f"Browser WebSocket pool shutdown failed: {e}")

    set_main_event_loop(None)
    app_logger.info("All resources cleaned up successfully")


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


def run_standalone():
    """Run Brain in standalone mode (no Electron dependency)."""
    import uvicorn

    port = int(env("EIGENT_BRAIN_PORT", "5001"))
    host = env("EIGENT_BRAIN_HOST", "0.0.0.0")  # nosec B104 - bind all for Docker/dev
    reload = os.environ.get("EIGENT_DEBUG", "").lower() in ("1", "true", "yes")

    app_logger.info(
        f"Starting Brain in standalone mode: {host}:{port} (reload={reload})"
    )
    if reload:
        uvicorn.run(
            "main:api",
            host=host,
            port=port,
            reload=reload,
            timeout_graceful_shutdown=5,
        )
        return

    config = uvicorn.Config(
        "main:api",
        host=host,
        port=port,
        reload=False,
        timeout_graceful_shutdown=5,
    )
    server = uvicorn.Server(config)
    server.install_signal_handlers = lambda: None

    force_exit_timer = None
    signal_count = {"count": 0}
    old_sigint = signal.getsignal(signal.SIGINT)
    old_sigterm = signal.getsignal(signal.SIGTERM)

    def _force_exit(signum: int):
        signame = signal.Signals(signum).name
        app_logger.error(
            "Force exiting Brain after %s because graceful shutdown did not finish",
            signame,
        )
        os._exit(128 + signum)

    def _handle_signal(signum, _frame):
        nonlocal force_exit_timer
        signame = signal.Signals(signum).name
        signal_count["count"] += 1

        if signal_count["count"] == 1:
            app_logger.warning(
                "%s received, requesting graceful shutdown. Press Ctrl+C again to force exit.",
                signame,
            )
            server.should_exit = True
            if force_exit_timer is None:
                force_exit_timer = threading.Timer(
                    5.0, _force_exit, args=(signum,)
                )
                force_exit_timer.daemon = True
                force_exit_timer.start()
            return

        app_logger.error(
            "%s received again, force exiting Brain immediately", signame
        )
        _force_exit(signum)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    try:
        server.run()
    finally:
        if force_exit_timer is not None:
            force_exit_timer.cancel()
        signal.signal(signal.SIGINT, old_sigint)
        signal.signal(signal.SIGTERM, old_sigterm)


if __name__ == "__main__":
    run_standalone()
