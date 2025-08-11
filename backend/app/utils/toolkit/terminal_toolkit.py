import asyncio
import os
from pathlib import Path
from typing import Any, Dict
from camel.toolkits.terminal_toolkit import TerminalToolkit as BaseTerminalToolkit
from app.component.command import uv
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
        shell_sessions: Dict[str, Any] | None = None,
        working_directory: str | None = None,
        need_terminal: bool = True,
        use_shell_mode: bool = True,
        clone_current_env: bool = False,
        safe_mode: bool = True,
    ):
        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name
        if working_directory is None:
            working_directory = env("file_save_path", os.path.expanduser("~/.eigent/terminal/"))
        super().__init__(
            timeout=timeout,
            shell_sessions=shell_sessions,
            working_directory=working_directory,
            need_terminal=False,  # Override the code that creates GUI output logs, use queue for SSE output instead
            use_shell_mode=use_shell_mode,
            clone_current_env=clone_current_env,
            safe_mode=safe_mode,
        )

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

    def _ensure_uv_available(self) -> bool:
        self.uv_path = uv()
        return True

    @listen_toolkit(
        BaseTerminalToolkit.shell_exec,
        lambda _, id, command: f"id: {id}, command: {command}",
    )
    def shell_exec(self, id: str, command: str) -> str:
        return super().shell_exec(id=id, command=command)

    @listen_toolkit(
        BaseTerminalToolkit.shell_view,
        lambda _, id: f"id: {id}",
    )
    def shell_view(self, id: str) -> str:
        return super().shell_view(id)

    @listen_toolkit(
        BaseTerminalToolkit.shell_wait,
        lambda _, id, seconds: f"id: {id}, seconds: {seconds}",
    )
    def shell_wait(self, id: str, seconds: int | None = None) -> str:
        return super().shell_wait(id=id, seconds=seconds)

    @listen_toolkit(
        BaseTerminalToolkit.shell_write_to_process,
        lambda _, id, input, press_enter: f"id: {id}, input: {input}, press_enter: {press_enter}",
    )
    def shell_write_to_process(self, id: str, input: str, press_enter: bool) -> str:
        return super().shell_write_to_process(id=id, input=input, press_enter=press_enter)

    @listen_toolkit(
        BaseTerminalToolkit.shell_kill_process,
        lambda _, id: f"id: {id}",
    )
    def shell_kill_process(self, id: str) -> str:
        return super().shell_kill_process(id=id)

    @listen_toolkit(
        BaseTerminalToolkit.ask_user_for_help,
        lambda _, id: f"id: {id}",
    )
    def ask_user_for_help(self, id: str) -> str:
        return super().ask_user_for_help(id=id)
