"""File system utilities."""

from pathlib import Path
from app.component.environment import env
from app.model.chat import Chat
from utils.path_safety import sanitize_path


def _resolve_and_validate_path(path: str | Path, fallback: Path, allowed_root: Path) -> Path:
    """
    Resolve a candidate path and ensure it stays within the allowed working directory root.
    Falls back to the provided safe path on any validation failure.
    """
    sanitized = sanitize_path(path, allowed_root)
    return sanitized if sanitized else fallback


def get_working_directory(options: Chat, task_lock=None) -> str:
    """
    Get the correct working directory for file operations.
    Uses a sanitized, canonical path based on user/project/task identifiers.
    """
    if not task_lock:
        from app.service.task import get_task_lock_if_exists
        task_lock = get_task_lock_if_exists(options.project_id)

    allowed_root = (Path.home() / "eigent").resolve()
    base_path = Path(options.file_save_path()).resolve()

    if task_lock and hasattr(task_lock, 'new_folder_path') and task_lock.new_folder_path:
        safe_path = _resolve_and_validate_path(task_lock.new_folder_path, base_path, allowed_root)
        return str(safe_path)

    env_path = env("file_save_path")
    if env_path:
        safe_path = _resolve_and_validate_path(env_path, base_path, allowed_root)
        return str(safe_path)

    return str(base_path)
