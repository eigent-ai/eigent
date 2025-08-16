import os
import pathlib
import signal
import asyncio
import atexit
from app import api
from loguru import logger
import traceroot
from app.component.environment import auto_include_routers, env

# Create traceroot logger for main application
traceroot_logger = traceroot.get_logger('main')


os.environ["PYTHONIOENCODING"] = "utf-8"

# Log application startup
traceroot_logger.info("Starting Eigent Multi-Agent System API")
traceroot_logger.info(f"Python encoding: {os.environ.get('PYTHONIOENCODING')}")
traceroot_logger.info(f"Environment: {os.environ.get('ENVIRONMENT', 'development')}")

prefix = env("url_prefix", "")
traceroot_logger.info(f"Loading routers with prefix: '{prefix}'")
auto_include_routers(api, prefix, "app/controller")
traceroot_logger.info("All routers loaded successfully")


# Configure Loguru
log_path = os.path.expanduser("~/.eigent/runtime/log/app.log")
os.makedirs(os.path.dirname(log_path), exist_ok=True)
logger.add(
    log_path,  # Log file
    rotation="10 MB",  # Log rotation: 10MB per file
    retention="10 days",  # Retain logs for the last 10 days
    level="DEBUG",  # Log level
    encoding="utf-8",
)
traceroot_logger.info(f"Loguru configured with log file: {log_path}")

dir = pathlib.Path(__file__).parent / "runtime"
dir.mkdir(parents=True, exist_ok=True)


# Write PID file asynchronously
@traceroot.trace()
async def write_pid_file():
    r"""Write PID file asynchronously"""
    import aiofiles

    async with aiofiles.open(dir / "run.pid", "w") as f:
        await f.write(str(os.getpid()))
    traceroot_logger.info(f"PID file written: {os.getpid()}")


# Create task to write PID
pid_task = asyncio.create_task(write_pid_file())
traceroot_logger.info("PID write task created")

# Graceful shutdown handler
shutdown_event = asyncio.Event()


@traceroot.trace()
async def cleanup_resources():
    r"""Cleanup all resources on shutdown"""
    logger.info("Starting graceful shutdown...")
    traceroot_logger.info("Starting graceful shutdown process")

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
            logger.error(f"Error cleaning up task {task_id}: {e}")

    # Remove PID file
    pid_file = dir / "run.pid"
    if pid_file.exists():
        pid_file.unlink()

    logger.info("Graceful shutdown completed")
    traceroot_logger.info("All resources cleaned up successfully")


@traceroot.trace()
def signal_handler(signum, frame):
    r"""Handle shutdown signals"""
    logger.info(f"Received signal {signum}")
    traceroot_logger.warning(f"Received shutdown signal: {signum}")
    asyncio.create_task(cleanup_resources())
    shutdown_event.set()


signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

# Register cleanup on exit
atexit.register(lambda: asyncio.run(cleanup_resources()))

# Log successful initialization
traceroot_logger.info("Application initialization completed successfully")
