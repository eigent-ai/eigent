"""Conditional traceroot wrapper - only loads if .traceroot-config.yaml exists."""
from pathlib import Path
from typing import Callable


def _find_config() -> bool:
    """Check if .traceroot-config.yaml exists in current or parent directories."""
    path = Path.cwd()
    for _ in range(5):
        if (path / ".traceroot-config.yaml").exists():
            return True
        if path == path.parent:
            break
        path = path.parent
    return False


# Load traceroot only if config exists
if _find_config():
    import traceroot
    trace = traceroot.trace
    get_logger = traceroot.get_logger
else:
    # No-op implementations
    def trace():
        def decorator(func: Callable) -> Callable:
            return func
        return decorator
    
    class _NoOpLogger:
        def __getattr__(self, name):
            return lambda *args, **kwargs: None
    
    def get_logger(name: str):
        return _NoOpLogger()