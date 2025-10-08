import os
import pathlib
import signal
import asyncio
import atexit
from app import api
from app.component.environment import auto_include_routers, env
from app.utils import traceroot_wrapper as traceroot


os.environ["PYTHONIOENCODING"] = "utf-8"

app_logger = traceroot.get_logger("main")

# Log application startup
app_logger.info("Starting Eigent Multi-Agent System API")
app_logger.info(f"Python encoding: {os.environ.get('PYTHONIOENCODING')}")
app_logger.info(f"Environment: {os.environ.get('ENVIRONMENT', 'development')}")

prefix = env("url_prefix", "")
app_logger.info(f"Loading routers with prefix: '{prefix}'")
auto_include_routers(api, prefix, "app/controller")
app_logger.info("All routers loaded successfully")



dir = pathlib.Path(__file__).parent / "runtime"
dir.mkdir(parents=True, exist_ok=True)


# Write PID file asynchronously
async def write_pid_file():
    r"""Write PID file asynchronously"""
    import aiofiles

    async with aiofiles.open(dir / "run.pid", "w") as f:
        await f.write(str(os.getpid()))
    app_logger.info(f"PID file written: {os.getpid()}")


# Create task to write PID
pid_task = asyncio.create_task(write_pid_file())
app_logger.info("PID write task created")

# Graceful shutdown handler
shutdown_event = asyncio.Event()


async def cleanup_resources():
    r"""Cleanup all resources on shutdown"""
    app_logger.info("Starting graceful shutdown...")
    app_logger.info("Starting graceful shutdown process")

    from app.service.task import task_locks, _cleanup_task

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

    app_logger.info("Graceful shutdown completed")
    app_logger.info("All resources cleaned up successfully")


def signal_handler(signum, frame):
    r"""Handle shutdown signals"""
    app_logger.info(f"Received signal {signum}")
    app_logger.warning(f"Received shutdown signal: {signum}")
    asyncio.create_task(cleanup_resources())
    shutdown_event.set()


signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

# Register cleanup on exit
atexit.register(lambda: asyncio.run(cleanup_resources()))

# Log successful initialization
app_logger.info("Application initialization completed successfully")
