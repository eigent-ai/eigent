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

import logging

from app.service.task import TaskLock
from app.utils.file_utils import list_files

logger = logging.getLogger(__name__)


def format_task_context(
    task_data: dict, seen_files: set | None = None, skip_files: bool = False
) -> str:
    """Format structured task data into a readable context string.

    Args:
        task_data: Dictionary containing task content, result,
            and working directory
        seen_files: Optional set to track already-listed files
            and avoid duplicates (deprecated, use skip_files
            instead)
        skip_files: If True, skip the file listing entirely
    """
    context_parts = []

    if task_data.get("task_content"):
        context_parts.append(f"Previous Task: {task_data['task_content']}")

    if task_data.get("task_result"):
        context_parts.append(
            f"Previous Task Result: {task_data['task_result']}"
        )

    # Skip file listing if requested
    if not skip_files:
        working_directory = task_data.get("working_directory")
        if working_directory:
            try:
                generated_files = list_files(
                    working_directory,
                    base=working_directory,
                    skip_dirs={"node_modules", "__pycache__", "venv"},
                    skip_extensions=(".pyc", ".tmp"),
                    skip_prefix=".",
                )
                if seen_files is not None:
                    generated_files = [
                        p for p in generated_files if p not in seen_files
                    ]
                    seen_files.update(generated_files)
                if generated_files:
                    context_parts.append("Generated Files from Previous Task:")
                    for file_path in sorted(generated_files):
                        context_parts.append(f"  - {file_path}")
            except Exception as e:
                logger.warning(f"Failed to collect generated files: {e}")

    return "\n".join(context_parts)


def collect_previous_task_context(
    working_directory: str,
    previous_task_content: str,
    previous_task_result: str,
    previous_summary: str = "",
) -> str:
    """
    Collect context from previous task including content, result,
    summary, and generated files.

    Args:
        working_directory: The working directory to scan for generated files
        previous_task_content: The content of the previous task
        previous_task_result: The result/output of the previous task
        previous_summary: The summary of the previous task

    Returns:
        Formatted context string to prepend to new task
    """

    context_parts = []

    # Add previous task information
    context_parts.append("=== CONTEXT FROM PREVIOUS TASK ===\n")

    # Add previous task content
    if previous_task_content:
        context_parts.append(f"Previous Task:\n{previous_task_content}\n")

    # Add previous task summary
    if previous_summary:
        context_parts.append(f"Previous Task Summary:\n{previous_summary}\n")

    # Add previous task result
    if previous_task_result:
        context_parts.append(
            f"Previous Task Result:\n{previous_task_result}\n"
        )

    # Collect generated files from working directory (safe listing)
    try:
        generated_files = list_files(
            working_directory,
            base=working_directory,
            skip_dirs={"node_modules", "__pycache__", "venv"},
            skip_extensions=(".pyc", ".tmp"),
            skip_prefix=".",
        )
        if generated_files:
            context_parts.append("Generated Files from Previous Task:")
            for file_path in sorted(generated_files):
                context_parts.append(f"  - {file_path}")
            context_parts.append("")
    except Exception as e:
        logger.warning(f"Failed to collect generated files: {e}")

    context_parts.append("=== END OF PREVIOUS TASK CONTEXT ===\n")

    return "\n".join(context_parts)


def check_conversation_history_length(
    task_lock: TaskLock, max_length: int = 200000
) -> tuple[bool, int]:
    """
    Check if conversation history exceeds maximum length

    Returns:
        tuple: (is_exceeded, total_length)
    """
    if (
        not hasattr(task_lock, "conversation_history")
        or not task_lock.conversation_history
    ):
        return False, 0

    total_length = 0
    for entry in task_lock.conversation_history:
        total_length += len(entry.get("content", ""))

    is_exceeded = total_length > max_length

    if is_exceeded:
        logger.warning(
            f"Conversation history length {total_length} "
            f"exceeds maximum {max_length}"
        )

    return is_exceeded, total_length


def build_conversation_context(
    task_lock: TaskLock, header: str = "=== CONVERSATION HISTORY ==="
) -> str:
    """Build conversation context from task_lock history
    with files listed only once at the end.

    Args:
        task_lock: TaskLock containing conversation history
        header: Header text for the context section

    Returns:
        Formatted context string with task history
        and files listed once at the end
    """
    context = ""
    working_directories = set()  # Collect all unique working directories

    if task_lock.conversation_history:
        context = f"{header}\n"

        for entry in task_lock.conversation_history:
            if entry["role"] == "task_result":
                if isinstance(entry["content"], dict):
                    formatted_context = format_task_context(
                        entry["content"], skip_files=True
                    )
                    context += formatted_context + "\n\n"
                    if entry["content"].get("working_directory"):
                        working_directories.add(
                            entry["content"]["working_directory"]
                        )
                else:
                    context += entry["content"] + "\n"
            elif entry["role"] == "assistant":
                context += f"Assistant: {entry['content']}\n\n"

        if working_directories:
            all_generated_files: set[str] = set()
            for working_directory in working_directories:
                try:
                    files_list = list_files(
                        working_directory,
                        base=working_directory,
                        skip_dirs={"node_modules", "__pycache__", "venv"},
                        skip_extensions=(".pyc", ".tmp"),
                        skip_prefix=".",
                    )
                    all_generated_files.update(files_list)
                except Exception as e:
                    logger.warning(
                        "Failed to collect generated "
                        f"files from {working_directory}: {e}"
                    )

            if all_generated_files:
                context += "Generated Files from Previous Tasks:\n"
                for file_path in sorted(all_generated_files):
                    context += f"  - {file_path}\n"
                context += "\n"

        context += "\n"

    return context
