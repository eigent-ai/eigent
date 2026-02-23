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

import asyncio
import logging
import os
import platform
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor

from camel.toolkits.terminal_toolkit import (
    TerminalToolkit as BaseTerminalToolkit,
)
from camel.toolkits.terminal_toolkit.terminal_toolkit import _to_plain

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env
from app.hitl.terminal_command import (
    is_dangerous_command,
    validate_cd_within_working_dir,
)
from app.service.task import (
    Action,
    ActionCommandApprovalData,
    ActionTerminalData,
    Agents,
    get_task_lock,
    get_task_lock_if_exists,
    process_task,
)
from app.utils.listen.toolkit_listen import auto_listen_toolkit

logger = logging.getLogger("terminal_toolkit")


# App version - should match electron app version
# TODO: Consider getting this from a shared config
APP_VERSION = "0.0.84"


def get_terminal_base_venv_path() -> str:
    """Get the path to the terminal base venv created during app installation."""
    return os.path.join(
        os.path.expanduser("~"),
        ".eigent",
        "venvs",
        f"terminal_base-{APP_VERSION}",
    )


@auto_listen_toolkit(BaseTerminalToolkit)
class TerminalToolkit(BaseTerminalToolkit, AbstractToolkit):
    agent_name: str = Agents.developer_agent
    _thread_pool: ThreadPoolExecutor | None = None

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        timeout: float | None = None,
        working_directory: str | None = None,
        use_docker_backend: bool = False,
        docker_container_name: str | None = None,
        session_logs_dir: str | None = None,
        allowed_commands: list[str] | None = None,
        clone_current_env: bool = True,
    ):
        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name

        # Get base directory from environment
        base_dir = env(
            "file_save_path", os.path.expanduser("~/.eigent/terminal/")
        )

        if working_directory is None:
            working_directory = base_dir
        self._agent_venv_dir = os.path.join(base_dir, self.agent_name)

        logger.debug(
            f"Initializing TerminalToolkit for agent={self.agent_name}",
            extra={
                "api_task_id": api_task_id,
                "working_directory": working_directory,
                "agent_venv_dir": self._agent_venv_dir,
            },
        )

        if TerminalToolkit._thread_pool is None:
            TerminalToolkit._thread_pool = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="terminal_toolkit"
            )

        self._use_docker_backend = use_docker_backend
        self._working_directory = working_directory

        # Read terminal_approval from the project-level TaskLock so every
        # agent factory does not need to thread the setting through.
        task_lock = get_task_lock_if_exists(api_task_id)
        self._terminal_approval = (
            task_lock.hitl_options.terminal_approval if task_lock else False
        )

        # When terminal_approval is ON we handle dangerous commands via
        # user approval prompts.  Camel's safe_mode would hard-block them
        # instead, so we invert it.
        camel_safe_mode = not self._terminal_approval
        super().__init__(
            timeout=timeout,
            working_directory=working_directory,
            use_docker_backend=use_docker_backend,
            docker_container_name=docker_container_name,
            session_logs_dir=session_logs_dir,
            safe_mode=camel_safe_mode,
            allowed_commands=allowed_commands,
            clone_current_env=True,
            install_dependencies=[],
        )

        # Auto-register with TaskLock for cleanup when task ends
        if task_lock:
            task_lock.register_toolkit(self)
            task_lock.add_approval_input_listen(self.agent_name)
            logger.info(
                "TerminalToolkit registered for cleanup",
                extra={
                    "api_task_id": api_task_id,
                    "working_directory": working_directory,
                },
            )

    def _setup_cloned_environment(self):
        """Override to clone from terminal_base venv instead of current process venv.

        Creates a lightweight clone using symlinks to the terminal_base venv,
        which contains pre-installed packages (pandas, numpy, matplotlib, etc.).
        """
        self.cloned_env_path = os.path.join(self._agent_venv_dir, ".venv")
        terminal_base_path = get_terminal_base_venv_path()

        # Check if terminal_base exists
        if platform.system() == "Windows":
            base_python = os.path.join(
                terminal_base_path, "Scripts", "python.exe"
            )
        else:
            base_python = os.path.join(terminal_base_path, "bin", "python")

        if not os.path.exists(base_python):
            logger.warning(
                f"Terminal base venv not found at {terminal_base_path}, "
                "falling back to system Python"
            )
            return

        # Check if cloned env already exists
        if platform.system() == "Windows":
            cloned_python = os.path.join(
                self.cloned_env_path, "Scripts", "python.exe"
            )
        else:
            cloned_python = os.path.join(self.cloned_env_path, "bin", "python")

        if os.path.exists(cloned_python):
            logger.info(
                f"Using existing cloned environment: {self.cloned_env_path}"
            )
            self.python_executable = cloned_python
            return

        logger.info(f"Cloning terminal_base venv to: {self.cloned_env_path}")

        try:
            # Create the cloned venv directory
            os.makedirs(self.cloned_env_path, exist_ok=True)

            # Clone using symlinks for efficiency
            # We need to create proper venv structure with symlinks to terminal_base
            self._clone_venv_with_symlinks(
                terminal_base_path, self.cloned_env_path
            )

            self.python_executable = cloned_python
            logger.info(
                f"Successfully cloned environment to: {self.cloned_env_path}"
            )

        except Exception as e:
            logger.error(
                f"Failed to clone terminal_base venv: {e}", exc_info=True
            )
            # Cleanup partial clone
            if os.path.exists(self.cloned_env_path):
                shutil.rmtree(self.cloned_env_path, ignore_errors=True)
            logger.warning("Falling back to system Python")

    def _get_venv_path(self):
        """Return the cloned venv path for shell activation."""
        cloned_env_path = getattr(self, "cloned_env_path", None)
        if cloned_env_path and os.path.exists(cloned_env_path):
            return cloned_env_path
        return None

    def _clone_venv_with_symlinks(self, source_venv: str, target_venv: str):
        """Clone a venv using symlinks for efficiency.

        Creates the structure needed: pyvenv.cfg, bin/python, lib symlink, and activate scripts.
        """
        is_windows = platform.system() == "Windows"

        # Read source pyvenv.cfg to get Python home
        source_cfg = os.path.join(source_venv, "pyvenv.cfg")
        python_home = None

        with open(source_cfg, encoding="utf-8") as f:
            for line in f:
                if line.startswith("home = "):
                    python_home = line.split("=", 1)[1].strip()
                    break

        if not python_home:
            raise RuntimeError(
                f"Could not determine Python home from {source_cfg}"
            )

        # Copy pyvenv.cfg (simpler than recreating)
        shutil.copy2(source_cfg, os.path.join(target_venv, "pyvenv.cfg"))

        if is_windows:
            # Windows: copy executables from source
            target_bin = os.path.join(target_venv, "Scripts")
            os.makedirs(target_bin, exist_ok=True)
            source_scripts = os.path.join(source_venv, "Scripts")
            for exe in ["python.exe", "pythonw.exe"]:
                src = os.path.join(source_scripts, exe)
                if os.path.exists(src):
                    shutil.copy2(src, os.path.join(target_bin, exe))
            # Copy activate scripts (need to modify VIRTUAL_ENV path)
            for script in ["activate.bat", "activate.ps1", "deactivate.bat"]:
                src = os.path.join(source_scripts, script)
                if os.path.exists(src):
                    with open(src, encoding="utf-8") as f:
                        content = f.read()
                    content = content.replace(source_venv, target_venv)
                    dst = os.path.join(target_bin, script)
                    with open(dst, "w", encoding="utf-8") as f:
                        f.write(content)
            # Use directory junction for Lib (no admin rights needed, unlike symlink)
            source_lib = os.path.join(source_venv, "Lib")
            target_lib = os.path.join(target_venv, "Lib")
            subprocess.run(
                ["cmd", "/c", "mklink", "/J", target_lib, source_lib],
                check=True,
                capture_output=True,
            )
        else:
            # Unix: symlink python executable and lib directory
            target_bin = os.path.join(target_venv, "bin")
            os.makedirs(target_bin, exist_ok=True)

            # Symlink python to the base Python
            python_exe = os.path.join(python_home, "python3")
            if not os.path.exists(python_exe):
                python_exe = os.path.join(python_home, "python")
            os.symlink(python_exe, os.path.join(target_bin, "python"))
            os.symlink("python", os.path.join(target_bin, "python3"))

            # Copy activate scripts (need to modify VIRTUAL_ENV path)
            source_bin = os.path.join(source_venv, "bin")
            for script in ["activate", "activate.csh", "activate.fish"]:
                src = os.path.join(source_bin, script)
                if os.path.exists(src):
                    with open(src) as f:
                        content = f.read()
                    # Replace source venv path with target venv path
                    content = content.replace(source_venv, target_venv)
                    dst = os.path.join(target_bin, script)
                    with open(dst, "w") as f:
                        f.write(content)

            # Symlink lib directory
            source_lib = os.path.join(source_venv, "lib")
            os.symlink(source_lib, os.path.join(target_venv, "lib"))

    def _write_to_log(self, log_file: str, content: str) -> None:
        r"""Write content to log file with optional ANSI stripping.

        Args:
            log_file (str): Path to the log file
            content (str): Content to write
        """
        # Convert ANSI escape sequences to plain text
        super()._write_to_log(log_file, content)
        logger.debug(
            "Terminal output logged",
            extra={
                "api_task_id": self.api_task_id,
                "log_file": log_file,
                "content_length": len(content),
            },
        )
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
            self._thread_pool.submit(self._run_coro_in_thread, coro, task_lock)

    @staticmethod
    def _run_coro_in_thread(coro, task_lock):
        """
        Execute coro in the thread pool, with each thread bound to a long-term event loop
        """
        if not hasattr(AbstractToolkit._thread_local, "loop"):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            AbstractToolkit._thread_local.loop = loop
        else:
            loop = AbstractToolkit._thread_local.loop

        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            AbstractToolkit._thread_local.loop = loop

        try:
            task = loop.create_task(coro)
            if hasattr(task_lock, "add_background_task"):
                task_lock.add_background_task(task)
            loop.run_until_complete(task)
        except Exception as e:
            logging.error(
                f"Failed to execute coroutine in thread pool: {str(e)}",
                exc_info=True,
            )

    async def shell_exec(
        self,
        command: str,
        id: str | None = None,
        block: bool = True,
        timeout: float = 20.0,
    ) -> str:
        r"""Executes a shell command in blocking or non-blocking mode.

        When Safe Mode is on, dangerous commands (e.g. rm) trigger user
        approval before execution.

        .. note:: Async override of a sync base method

            Camel's ``BaseTerminalToolkit.shell_exec`` is **sync-only** (no
            async variant exists in the upstream library).  We override it
            as ``async def`` so the HITL approval flow can ``await`` the
            SSE queue and the approval-response queue — following the same
            asyncio.Queue pattern used by ``HumanToolkit.ask_human_via_gui``.

            Because the base method is sync and this override is async, the
            ``listen_toolkit`` decorator applies a ``__wrapped__`` fix (see
            ``toolkit_listen.py``) to ensure Camel's ``FunctionTool``
            dispatches this method via ``async_call`` on the **main** event
            loop, rather than via the sync ``__call__`` path which would run
            it on a background loop where cross-loop ``asyncio.Queue`` awaits
            silently fail.

        Args:
            command (str): The shell command to execute.
            id (str, optional): A unique identifier for the command's session.
                If not provided, a unique ID will be automatically generated.
            block (bool, optional): Determines the execution mode. Defaults to True.
            timeout (float, optional): Timeout in seconds for blocking mode. Defaults to 20.0.

        Returns:
            str: The output of the command execution.
        """
        import sys

        print(
            f"[APPROVAL-PRINT] shell_exec ENTERED, id={id}, terminal_approval={self._terminal_approval}",
            flush=True,
        )
        print(
            f"[APPROVAL-PRINT] command={command[:120]!r}",
            flush=True,
            file=sys.stderr,
        )
        logger.info(
            "[APPROVAL] async shell_exec called, id=%s, terminal_approval=%s",
            id,
            self._terminal_approval,
        )
        # Auto-generate ID if not provided
        if id is None:
            import time

            id = f"auto_{int(time.time() * 1000)}"

        # Non-Docker: validate cd does not escape working_directory (issue #1306)
        if not self._use_docker_backend:
            ok, err = validate_cd_within_working_dir(
                command, self._working_directory
            )
            if not ok:
                return err or "cd not allowed."

        is_dangerous = (
            is_dangerous_command(command) if self._terminal_approval else False
        )
        print(
            f"[APPROVAL-PRINT] terminal_approval={self._terminal_approval}, is_dangerous={is_dangerous}",
            flush=True,
        )
        logger.info(
            "[APPROVAL] terminal_approval=%s, is_dangerous=%s, command=%r",
            self._terminal_approval,
            is_dangerous,
            command[:120],
        )
        if self._terminal_approval and is_dangerous:
            print("[APPROVAL-PRINT] ENTERING approval flow!", flush=True)
            logger.info(
                "[APPROVAL] Entering approval flow for dangerous command"
            )
            approval_data = ActionCommandApprovalData(
                data={"command": command, "agent": self.agent_name}
            )
            rejection = await self._request_user_approval(approval_data)
            print(
                f"[APPROVAL-PRINT] Approval result: rejection={rejection}",
                flush=True,
            )
            logger.info("[APPROVAL] Approval result: rejection=%s", rejection)
            if rejection is not None:
                return rejection

        result = super().shell_exec(
            id=id, command=command, block=block, timeout=timeout
        )

        # If the command executed successfully but returned empty output,
        # provide a clear success message to help the AI agent understand
        # that the command completed without error.
        if block and result == "":
            return "Command executed successfully (no output)."

        return result

    def cleanup(self, remove_venv: bool = True):
        """Clean up all active sessions and optionally remove the virtual environment.

        Args:
            remove_venv: If True, removes the .venv or .initial_env folder created
                        by this toolkit. Defaults to True to prevent disk bloat.
        """
        # First call parent cleanup to kill all shell sessions
        super().cleanup()

        if not remove_venv:
            return

        # Remove cloned env (.venv) if it exists
        cloned_env_path = getattr(self, "cloned_env_path", None)
        if cloned_env_path and os.path.exists(cloned_env_path):
            try:
                shutil.rmtree(cloned_env_path)
                logger.info(
                    "Removed cloned venv",
                    extra={
                        "api_task_id": self.api_task_id,
                        "path": cloned_env_path,
                    },
                )
            except Exception as e:
                logger.warning(
                    "Failed to remove cloned venv",
                    extra={
                        "api_task_id": self.api_task_id,
                        "path": cloned_env_path,
                        "error": str(e),
                    },
                )

        # Remove initial env (.initial_env) if it exists
        initial_env_path = getattr(self, "initial_env_path", None)
        if initial_env_path and os.path.exists(initial_env_path):
            try:
                shutil.rmtree(initial_env_path)
                logger.info(
                    "Removed initial env",
                    extra={
                        "api_task_id": self.api_task_id,
                        "path": initial_env_path,
                    },
                )
            except Exception as e:
                logger.warning(
                    "Failed to remove initial env",
                    extra={
                        "api_task_id": self.api_task_id,
                        "path": initial_env_path,
                        "error": str(e),
                    },
                )

    @classmethod
    def shutdown(cls):
        if cls._thread_pool:
            cls._thread_pool.shutdown(wait=True)
            cls._thread_pool = None
