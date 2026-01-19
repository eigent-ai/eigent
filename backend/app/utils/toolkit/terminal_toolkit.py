import asyncio
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from camel.toolkits.terminal_toolkit import TerminalToolkit as BaseTerminalToolkit
from camel.toolkits.terminal_toolkit.terminal_toolkit import _to_plain
from app.component.environment import env
from app.service.task import Action, ActionTerminalData, Agents, get_task_lock
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import process_task
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("terminal_toolkit")


@auto_listen_toolkit(BaseTerminalToolkit)
class TerminalToolkit(BaseTerminalToolkit, AbstractToolkit):
    agent_name: str = Agents.developer_agent
    _thread_pool: Optional[ThreadPoolExecutor] = None
    _thread_local = threading.local()

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
        clone_current_env: bool = True,
    ):
        # === TIMING: TerminalToolkit init start ===
        init_start = time.time()

        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name
        if working_directory is None:
            working_directory = env("file_save_path", os.path.expanduser("~/.eigent/terminal/"))

        logger.info(f"⏱️ [TIMING] TerminalToolkit.__init__ started for agent={self.agent_name}", extra={
            "api_task_id": api_task_id,
            "agent_name": self.agent_name,
            "working_directory": working_directory,
            "safe_mode": safe_mode,
            "use_docker_backend": use_docker_backend
        })
        logger.info(f"⏱️ [TIMING] working_directory={working_directory}")

        # === TIMING: Thread pool creation ===
        thread_pool_start = time.time()
        if TerminalToolkit._thread_pool is None:
            TerminalToolkit._thread_pool = ThreadPoolExecutor(
                max_workers=1,
                thread_name_prefix="terminal_toolkit"
            )
            thread_pool_time = (time.time() - thread_pool_start) * 1000
            logger.info(f"⏱️ [TIMING] Created terminal toolkit thread pool in {thread_pool_time:.2f}ms")
        else:
            logger.debug("Thread pool already exists, skipping creation")

        # === TIMING: Base class init (this is the heavy part) ===
        super_init_start = time.time()
        logger.info("⏱️ [TIMING] Starting BaseTerminalToolkit.__init__...")
        logger.info(f"⏱️ [TIMING] Parameters: working_directory={working_directory}, clone_current_env={clone_current_env}")

        # Check if env already exists (determines if env setup is needed)
        # .venv is used when clone_current_env=True, .initial_env when False
        if clone_current_env:
            env_path = os.path.join(working_directory, ".venv") if working_directory else None
        else:
            env_path = os.path.join(working_directory, ".initial_env") if working_directory else None
        env_exists = env_path and os.path.exists(env_path)
        logger.info(f"⏱️ [TIMING] env_path={env_path}, env_exists={env_exists}")

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
        super_init_time = (time.time() - super_init_start) * 1000
        total_init_time = (time.time() - init_start) * 1000
        logger.info(f"⏱️ [TIMING] BaseTerminalToolkit.__init__ completed in {super_init_time:.2f}ms (env_existed={env_exists})")
        logger.info(f"⏱️ [TIMING] TerminalToolkit.__init__ TOTAL: {total_init_time:.2f}ms")

    def _write_to_log(self, log_file: str, content: str) -> None:
        r"""Write content to log file with optional ANSI stripping.

        Args:
            log_file (str): Path to the log file
            content (str): Content to write
        """
        # Convert ANSI escape sequences to plain text
        super()._write_to_log(log_file, content)
        logger.debug("Terminal output logged", extra={
            "api_task_id": self.api_task_id,
            "log_file": log_file,
            "content_length": len(content)
        })
        self._update_terminal_output(_to_plain(content))

    def _update_terminal_output(self, output: str):
        task_lock = get_task_lock(self.api_task_id)
        process_task_id = process_task.get("")

        # Create the coroutine
        coro = task_lock.put_queue(
            ActionTerminalData(
                action=Action.terminal,
                process_task_id=process_task_id,
                data=output,
            )
        )

        # Try to get the current event loop, if none exists, create a new one in a thread
        try:
            loop = asyncio.get_running_loop()
            # If we're in an async context, schedule the coroutine
            task = loop.create_task(coro)
            if hasattr(task_lock, "add_background_task"):
                task_lock.add_background_task(task)
        except RuntimeError:
            self._thread_pool.submit(self._run_coro_in_thread, coro,task_lock)

    @staticmethod
    def _run_coro_in_thread(coro,task_lock):
        """
        Execute coro in the thread pool, with each thread bound to a long-term event loop
        """
        if not hasattr(TerminalToolkit._thread_local, "loop"):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            TerminalToolkit._thread_local.loop = loop
        else:
            loop = TerminalToolkit._thread_local.loop

        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            TerminalToolkit._thread_local.loop = loop

        try:
            task = loop.create_task(coro)
            if hasattr(task_lock, "add_background_task"):
                task_lock.add_background_task(task)
            loop.run_until_complete(task)
        except Exception as e:
            logging.error(
                f"Failed to execute coroutine in thread pool: {str(e)}",
                exc_info=True
            )

    def shell_exec(
        self,
        command: str,
        id: str | None = None,
        block: bool = True,
        timeout: float = 20.0,
    ) -> str:
        r"""Executes a shell command in blocking or non-blocking mode.

        Args:
            command (str): The shell command to execute.
            id (str, optional): A unique identifier for the command's session.
                If not provided, a unique ID will be automatically generated.
            block (bool, optional): Determines the execution mode. Defaults to True.
            timeout (float, optional): Timeout in seconds for blocking mode. Defaults to 20.0.

        Returns:
            str: The output of the command execution.
        """
        # Auto-generate ID if not provided
        if id is None:
            import time
            id = f"auto_{int(time.time() * 1000)}"

        result = super().shell_exec(id=id, command=command, block=block, timeout=timeout)

        # If the command executed successfully but returned empty output,
        # provide a clear success message to help the AI agent understand
        # that the command completed without error.
        if block and result == "":
            return "Command executed successfully (no output)."

        return result

    @classmethod
    def shutdown(cls):
        if cls._thread_pool:
            cls._thread_pool.shutdown(wait=True)
            cls._thread_pool = None
