import asyncio
import os
from camel.toolkits.terminal_toolkit import TerminalToolkit as BaseTerminalToolkit
from camel.toolkits.terminal_toolkit.terminal_toolkit import _to_plain
from app.component.environment import env
from app.service.task import Action, ActionTerminalData, Agents, get_task_lock
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import process_task


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
        # This method will be called during init. At that time, the process_task_id parameter does not exist, so it is set to be empty default
        process_task_id = process_task.get("")
        task = asyncio.create_task(
            task_lock.put_queue(
                ActionTerminalData(
                    action=Action.terminal,
                    process_task_id=process_task_id,
                    data=output,
                )
            )
        )
        if hasattr(task_lock, "add_background_task"):
            task_lock.add_background_task(task)

    @listen_toolkit(
        BaseTerminalToolkit.shell_exec,
        lambda _, id, command, block=True: f"id: {id}, command: {command}, block: {block}",
    )
    def shell_exec(self, id: str, command: str, block: bool = True) -> str:
        return super().shell_exec(id=id, command=command, block=block)

    @listen_toolkit(
        BaseTerminalToolkit.shell_view,
        lambda _, id: f"id: {id}",
    )
    def shell_view(self, id: str) -> str:
        return super().shell_view(id)

    @listen_toolkit(
        BaseTerminalToolkit.shell_wait,
        lambda _, id, wait_seconds=None: f"id: {id}, wait_seconds: {wait_seconds}",
    )
    def shell_wait(self, id: str, wait_seconds: float = 5.0) -> str:
        return super().shell_wait(id=id, wait_seconds=wait_seconds)

    @listen_toolkit(
        BaseTerminalToolkit.shell_write_to_process,
        lambda _, id, command: f"id: {id}, command: {command}",
    )
    def shell_write_to_process(self, id: str, command: str) -> str:
        return super().shell_write_to_process(id=id, command=command)

    @listen_toolkit(
        BaseTerminalToolkit.shell_kill_process,
        lambda _, id: f"id: {id}",
    )
    def shell_kill_process(self, id: str) -> str:
        return super().shell_kill_process(id=id)

    @listen_toolkit(
        BaseTerminalToolkit.shell_ask_user_for_help,
        lambda _, id, prompt: f"id: {id}, prompt: {prompt}",
    )
    def shell_ask_user_for_help(self, id: str, prompt: str) -> str:
        return super().shell_ask_user_for_help(id=id, prompt=prompt)
