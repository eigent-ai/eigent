import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from camel.toolkits.terminal_toolkit import TerminalToolkit as BaseTerminalToolkit
from camel.toolkits.terminal_toolkit.terminal_toolkit import _to_plain
from app.component.environment import env
from app.service.task import Action, ActionTerminalData, Agents, get_task_lock
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import process_task

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_terminal_executor():
    return ThreadPoolExecutor(max_workers=3, thread_name_prefix="terminal_output")


@auto_listen_toolkit(BaseTerminalToolkit)
class TerminalToolkit(BaseTerminalToolkit, AbstractToolkit):
    agent_name: str = Agents.developer_agent

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        timeout: float | None = None,
        working_directory: str | None = None,
        use_docker_backend: bool = False,
        docker_container_name: str | None = None,
        session_logs_dir: str | None = None,
        safe_mode: bool = True,
        allowed_commands: list[str] | None = None,
        clone_current_env: bool = False,
    ):
        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name
        if working_directory is None:
            working_directory = env("file_save_path", os.path.expanduser("~/.eigent/terminal/"))
        super().__init__(
            timeout=timeout,
            working_directory=working_directory,
            use_docker_backend=use_docker_backend,
            docker_container_name=docker_container_name,
            session_logs_dir=session_logs_dir,
            safe_mode=safe_mode,
            allowed_commands=allowed_commands,
            clone_current_env=clone_current_env,
        )

    def _write_to_log(self, log_file: str, content: str) -> None:
        r"""Write content to log file with optional ANSI stripping.

        Args:
            log_file (str): Path to the log file
            content (str): Content to write
        """
        # Convert ANSI escape sequences to plain text
        super()._write_to_log(log_file, content)
        self._update_terminal_output(_to_plain(content))

    def _update_terminal_output(self, output: str):
        task_lock = get_task_lock(self.api_task_id)
        process_task_id = process_task.get("")

        coro = task_lock.put_queue(
            ActionTerminalData(
                action=Action.terminal,
                process_task_id=process_task_id,
                data=output,
            )
        )

        try:
            loop = asyncio.get_running_loop()
            task = loop.create_task(coro)
            if hasattr(task_lock, "add_background_task"):
                task_lock.add_background_task(task)
        except RuntimeError:
            executor = get_terminal_executor()

            def send_output():
                try:
                    asyncio.run(coro)
                except Exception as e:
                    logger.error(
                        f"Failed to send terminal output: {e}",
                        exc_info=True,
                        extra={
                            "api_task_id": self.api_task_id,
                            "output_preview": output[:200]
                        }
                    )

            executor.submit(send_output)
