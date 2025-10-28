from pathlib import Path
from typing import Callable
import logging
from dotenv import load_dotenv

# Try to import traceroot, but handle gracefully if not available
try:
    import traceroot
    TRACEROOT_AVAILABLE = True
except ImportError:
    TRACEROOT_AVAILABLE = False
    traceroot = None

# Auto-detect module name based on caller's path
def _get_module_name():
    """Automatically detect if this is being called from backend or server."""
    import inspect
    frame = inspect.currentframe()
    try:
        # Go up the stack to find the caller
        caller_frame = frame.f_back.f_back if frame and frame.f_back else None
        if caller_frame:
            caller_file = caller_frame.f_globals.get('__file__', '')
            if 'backend' in caller_file:
                return 'backend'
            elif 'server' in caller_file:
                return 'server'
    finally:
        del frame
    return 'unknown'

env_path = Path(__file__).resolve().parents[1] / '.env'

load_dotenv(env_path)

if TRACEROOT_AVAILABLE and traceroot.init():
    from traceroot.logger import get_logger as _get_traceroot_logger

    trace = traceroot.trace

    def get_logger(name: str = __name__):
        """Get TraceRoot logger instance."""
        return _get_traceroot_logger(name)

    def is_enabled() -> bool:
        """Check if TraceRoot is enabled."""
        return True

    # Log successful initialization
    module_name = _get_module_name()
    _init_logger = _get_traceroot_logger("traceroot_wrapper")
    _init_logger.info("TraceRoot initialized successfully", extra={"backend": "traceroot", "service_module": module_name})
else:
    # No-op implementations when TraceRoot is not configured
    def trace(*args, **kwargs):
        """No-op trace decorator."""
        def decorator(func: Callable) -> Callable:
            return func
        return decorator

    def get_logger(name: str = __name__):
        """Get standard Python logger when TraceRoot is disabled."""
        logger = logging.getLogger(name)
        if not logger.handlers:
            # Configure basic logging if no handlers exist
            handler = logging.StreamHandler()
            formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
            handler.setFormatter(formatter)
            logger.addHandler(handler)
            logger.setLevel(logging.INFO)
        return logger

    def is_enabled() -> bool:
        """Check if TraceRoot is enabled."""
        return False

    # Log fallback mode
    _fallback_logger = logging.getLogger("traceroot_wrapper")
    if TRACEROOT_AVAILABLE:
        _fallback_logger.warning("TraceRoot available but not initialized - using Python logging as fallback")
    else:
        _fallback_logger.warning("TraceRoot not available - using Python logging as fallback")


__all__ = ['trace', 'get_logger', 'is_enabled']
