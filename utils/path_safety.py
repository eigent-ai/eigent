from __future__ import annotations

from pathlib import Path
import re
from typing import Pattern

# Default safe pattern for path components (alphanumeric, underscore, dot, dash)
DEFAULT_SAFE_COMPONENT: Pattern[str] = re.compile(r"^[A-Za-z0-9_.-]+$")


def safe_component(value: str, field_name: str, pattern: Pattern[str] = DEFAULT_SAFE_COMPONENT) -> str:
    """Validate a single path component against a safe pattern."""
    if not pattern.fullmatch(value):
        raise ValueError(f"Invalid characters in {field_name}")
    return value


def sanitize_path(path_value: str | Path | None, allowed_root: Path) -> Path | None:
    """
    Resolve a path and ensure it stays under the allowed_root.
    Returns the resolved Path if valid, otherwise None.
    """
    if not path_value:
        return None
    try:
        resolved = Path(path_value).expanduser().resolve()
        resolved.relative_to(allowed_root)
        return resolved
    except Exception:
        return None
