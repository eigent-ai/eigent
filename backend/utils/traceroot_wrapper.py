from pathlib import Path
from typing import Callable
import logging
import traceroot
from dotenv import load_dotenv


env_path = Path(__file__).resolve().parents[2] / '.env'

load_dotenv(env_path)

if traceroot.init():
    from traceroot.logger import get_logger as _get_traceroot_logger

    trace = traceroot.trace

    def get_logger(name: str = __name__):
        """Get TraceRoot logger instance."""
        return _get_traceroot_logger(name)

    def is_enabled() -> bool:
        """Check if TraceRoot is enabled."""
        return True
else:
    # No-op implementations when TraceRoot is not configured
    def trace(*args, **kwargs):
        """No-op trace decorator."""
        def decorator(func: Callable) -> Callable:
            return func
        return decorator

    def get_logger(name: str = __name__):
        """Get standard Python logger when TraceRoot is disabled."""
        return logging.getLogger(name)

    def is_enabled() -> bool:
        """Check if TraceRoot is enabled."""
        return False


__all__ = ['trace', 'get_logger', 'is_enabled']