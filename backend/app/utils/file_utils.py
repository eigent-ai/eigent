"""File system utilities."""

from app.component.environment import env
from app.model.chat import Chat


def get_working_directory(options: Chat, task_lock=None) -> str:
    """
    Get the correct working directory for file operations.
    First checks if there's an updated path from improve API call,
    then falls back to environment variable or default path.
    """
    if not task_lock:
        from app.service.task import get_task_lock_if_exists
        task_lock = get_task_lock_if_exists(options.project_id)
    
    if task_lock and hasattr(task_lock, 'new_folder_path') and task_lock.new_folder_path:
        return str(task_lock.new_folder_path)
    else:
        return env("file_save_path", options.file_save_path())