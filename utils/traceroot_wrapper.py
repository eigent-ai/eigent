from pathlib import Path
from typing import Callable
import logging


def _find_config() -> bool:
    """Check if .traceroot-config.yaml exists in current or parent directories."""
    path = Path.cwd()
    for _ in range(10):  # Search up to 10 levels
        if (path / ".traceroot-config.yaml").exists():
            return True
        if path == path.parent:
            break
        path = path.parent
    return False


# Load traceroot only if config exists
_TRACEROOT_ENABLED = _find_config()

if _TRACEROOT_ENABLED:
    import traceroot
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
    def trace():
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
