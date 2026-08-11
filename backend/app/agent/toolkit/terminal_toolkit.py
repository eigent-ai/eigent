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
import re
import shlex
import shutil
import signal
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, ContextManager

from camel.toolkits.terminal_toolkit import (
    TerminalToolkit as BaseTerminalToolkit,
)
from camel.toolkits.terminal_toolkit.terminal_toolkit import _to_plain

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env
from app.run_runtime.tool_checkpoint import get_current_tool_checkpoint
from app.service.task import (
    Action,
    ActionTerminalData,
    Agents,
    get_task_lock,
    process_task,
)
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.space_overlay_client import run_context_for_task
from app.workspace_git import (
    get_default_workspace_git_lifecycle,
    get_default_workspace_mutation_service,
)

logger = logging.getLogger("terminal_toolkit")

# App version - should match electron app version
# TODO: Consider getting this from a shared config
APP_VERSION = "1.0.2"


_SECRET_BROKER_ENVIRONMENT_KEY = re.compile(
    r"^EIGENT_[A-Z0-9_]+_SECRET_BROKER_(?:ENDPOINT|CAPABILITY)$"
)

_BUNDLE_RUNTIME_BASE_ENVIRONMENT_KEYS = {
    "APPDATA",
    "COMSPEC",
    "CURL_CA_BUNDLE",
    "HOME",
    "JAVA_HOME",
    "LANG",
    "LOCALAPPDATA",
    "LOGNAME",
    "NODE_EXTRA_CA_CERTS",
    "PATH",
    "PATHEXT",
    "PYTHONIOENCODING",
    "REQUESTS_CA_BUNDLE",
    "SHELL",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "USER",
    "USERPROFILE",
    "WINDIR",
}


def is_secret_broker_environment_key(name: str) -> bool:
    return bool(
        _SECRET_BROKER_ENVIRONMENT_KEY.fullmatch(name.strip().upper())
    )


def is_control_plane_environment_key(name: str) -> bool:
    normalized = name.strip().upper()
    return (
        normalized == "EIGENT_LOCAL_CONTROL_CAPABILITY"
        or is_secret_broker_environment_key(normalized)
        or normalized == "AUTHORIZATION"
        or normalized.endswith("_AUTHORIZATION")
        or normalized == "PROXY_AUTHORIZATION"
    )


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
        runtime_env_provider: (
            Callable[[], ContextManager[dict[str, str]]] | None
        ) = None,
    ):
        self.api_task_id = api_task_id
        self._runtime_env_provider = runtime_env_provider
        self._runtime_env_overlay: dict[str, str] | None = None
        self._active_runtime_secret_values: tuple[str, ...] = ()
        self._runtime_env_lock = threading.RLock()
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

        super().__init__(
            timeout=timeout,
            working_directory=working_directory,
            use_docker_backend=use_docker_backend,
            docker_container_name=docker_container_name,
            session_logs_dir=session_logs_dir,
            safe_mode=safe_mode,
            allowed_commands=allowed_commands,
            clone_current_env=True,
            install_dependencies=[],
        )

        # Auto-register with TaskLock for cleanup when task ends
        from app.service.task import get_task_lock_if_exists

        task_lock = get_task_lock_if_exists(api_task_id)
        if task_lock:
            task_lock.register_toolkit(self)
            logger.info(
                "TerminalToolkit registered for cleanup",
                extra={
                    "api_task_id": api_task_id,
                    "working_directory": working_directory,
                },
            )

    def _get_env_vars(self) -> dict[str, str]:
        """Build an agent environment without Desktop control credentials."""

        if self._runtime_env_provider is None:
            environment = super()._get_env_vars()
        else:
            if self._runtime_env_overlay is None:
                raise RuntimeError(
                    "Workspace Bundle environment is only available during "
                    "an authorized process spawn"
                )
            environment = {
                key: value
                for key, value in os.environ.items()
                if key.upper() in _BUNDLE_RUNTIME_BASE_ENVIRONMENT_KEYS
                or key.upper().startswith("LC_")
            }
            environment.update(self._runtime_env_vars)
            environment.update(self._runtime_env_overlay)
            environment["PYTHONUNBUFFERED"] = "1"
        for key in tuple(environment):
            if is_control_plane_environment_key(key):
                environment.pop(key, None)
        return environment

    def _scrub_runtime_output(self, content: str) -> str:
        scrubbed = content
        for value in getattr(self, "_active_runtime_secret_values", ()):
            scrubbed = scrubbed.replace(
                value,
                "[REDACTED_WORKSPACE_SECRET]",
            )
        return scrubbed

    def _runtime_shell_exec(
        self,
        *,
        command: str,
        block: bool,
        timeout: float,
    ) -> str:
        """Run one secret-bearing Bundle command without background sessions.

        A background process can emit after its vault values have left the
        authorized spawn scope. Until per-session streaming redaction exists,
        secret-bearing Bundle commands are therefore blocking-only and are
        given a dedicated process group that is cleaned on return or timeout.

        This is lifecycle hygiene, not an OS sandbox: a same-UID command that
        deliberately starts a new session is inside the documented
        ``shell == full access`` trust boundary.
        """

        if not block:
            return (
                "Error: Background terminal sessions are unavailable when "
                "this Workspace injects protected environment values. Run "
                "a bounded command instead."
            )
        if self.use_docker_backend:
            return (
                "Error: Docker terminal execution is unavailable when this "
                "Workspace injects protected environment values."
            )
        if self.safe_mode:
            is_safe, sanitized = self._sanitize_command(command)
            if not is_safe:
                return (
                    "Error: Command rejected by TerminalToolkit safe mode. "
                    f"{sanitized}"
                )
            command = sanitized
        env_path = self._get_venv_path()
        if env_path:
            if self.os_type == "Windows":
                activate = os.path.join(env_path, "Scripts", "activate.bat")
                command = f'call "{activate}" && {command}'
            else:
                activate = os.path.join(env_path, "bin", "activate")
                command = f". {shlex.quote(activate)} && {command}"

        log_entry = (
            f"--- Executing protected Bundle command at {time.ctime()} ---\n"
            f"> {command}\n"
        )
        output = ""
        process: subprocess.Popen[str] | None = None
        timed_out = False
        try:
            popen_options: dict[str, object] = {}
            if os.name == "nt":
                create_group = getattr(
                    subprocess,
                    "CREATE_NEW_PROCESS_GROUP",
                    0,
                )
                if create_group:
                    popen_options["creationflags"] = create_group
            else:
                popen_options["start_new_session"] = True
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.PIPE,
                shell=True,
                text=True,
                cwd=self.working_dir,
                encoding="utf-8",
                env=self._get_env_vars(),
                **popen_options,
            )
            try:
                output, _ = process.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                self._terminate_runtime_process_tree(process)
                try:
                    output, _ = process.communicate(timeout=1.0)
                except subprocess.TimeoutExpired:
                    process.kill()
                    output, _ = process.communicate()
            output = output or ""
            log_entry += f"--- Output ---\n{output}\n"
            if timed_out:
                return self._scrub_runtime_output(
                    "Error: Protected Bundle command exceeded the timeout "
                    "and was terminated.\n" + _to_plain(output)
                )
            if output.strip():
                return self._scrub_runtime_output(_to_plain(output))
            return "Command executed successfully (no output)."
        except Exception as exc:
            message = self._scrub_runtime_output(
                f"Error executing command: {exc}"
            )
            log_entry += f"--- Error ---\n{message}\n"
            return message
        finally:
            cleanup_failure: Exception | None = None
            if process is not None:
                try:
                    self._terminate_runtime_process_tree(process)
                except Exception as exc:
                    cleanup_failure = exc
                    cleanup_error = self._scrub_runtime_output(str(exc))
                    log_entry += (
                        "--- Process cleanup error ---\n"
                        f"{cleanup_error}\n"
                    )
                    logger.exception(
                        "Failed to terminate protected Bundle process tree",
                        extra={"api_task_id": self.api_task_id},
                    )
            self._write_to_log(self.blocking_log_file, log_entry + "\n")
            if cleanup_failure is not None:
                raise RuntimeError(
                    "Protected Bundle process cleanup failed"
                ) from cleanup_failure

    def _terminate_runtime_process_tree(
        self,
        process: subprocess.Popen[str],
    ) -> None:
        """Best-effort cleanup for descendants in the command process group."""

        if os.name == "nt":
            completed = subprocess.run(
                [
                    "taskkill",
                    "/PID",
                    str(process.pid),
                    "/T",
                    "/F",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if completed.returncode not in {0, 128}:
                raise RuntimeError(
                    "Protected Bundle process tree cleanup failed: "
                    + (completed.stderr or completed.stdout).strip()
                )
            return

        # The session leader may already have exited while ordinary children
        # remain. Its process group still uses the leader PID, so signal that
        # stable id directly instead of asking getpgid() about the dead leader.
        process_group = process.pid
        try:
            os.killpg(process_group, signal.SIGTERM)
        except ProcessLookupError:
            return
        except PermissionError as exc:
            try:
                process_group_detail = os.getpgid(process.pid)
            except ProcessLookupError:
                # macOS may report EPERM for killpg() after the session leader
                # and its final child have become unreapable zombies. A dead
                # leader proves there is no live root left to supervise.
                return
            except OSError:
                process_group_detail = None
            raise RuntimeError(
                "Protected Bundle process tree could not be terminated "
                f"(pid={process.pid}, pgid={process_group_detail})"
            ) from exc

        time.sleep(0.1)
        try:
            os.killpg(process_group, signal.SIGKILL)
        except ProcessLookupError:
            return
        except PermissionError as exc:
            try:
                os.getpgid(process.pid)
            except ProcessLookupError:
                return
            raise RuntimeError(
                "Protected Bundle process tree could not be force-terminated"
            ) from exc

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
        # ANSI controls can split one secret into fragments. Normalize first,
        # then scrub the exact runtime values before logging or SSE emission.
        content = self._scrub_runtime_output(_to_plain(content))
        super()._write_to_log(log_file, content)
        logger.debug(
            "Terminal output logged",
            extra={
                "api_task_id": self.api_task_id,
                "log_file": log_file,
                "content_length": len(content),
            },
        )
        self._update_terminal_output(content)

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
                exc_info=True,
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
        runtime_env_provider = getattr(self, "_runtime_env_provider", None)
        if runtime_env_provider is not None and not block:
            return (
                "Error: Background terminal sessions are unavailable when "
                "this Workspace injects protected environment values. Run "
                "a bounded command instead."
            )

        # Auto-generate ID if not provided
        if id is None:
            import time

            id = f"auto_{int(time.time() * 1000)}"

        run_context = run_context_for_task(self.api_task_id)
        mutation_service = None
        prepared = None
        request_id = None
        if run_context is not None:
            checkpoint = get_current_tool_checkpoint()
            request_id = (
                checkpoint.tool_call_id
                if checkpoint is not None
                else f"local-terminal:{uuid.uuid4().hex}"
            )
            mutation_service = get_default_workspace_mutation_service()
            prepared = mutation_service.prepare_broad_write(
                context=run_context,
                operation_request_id=request_id,
                actor_id=self.agent_name,
                trigger="terminal.execute",
            )
            if prepared is not None:
                # CAMEL reads this field immediately before process spawn.
                # Existing sessions keep their original cwd; a new command is
                # never started in the User Worktree once Git is enabled.
                self.working_dir = str(prepared.agent_workspace.agent_worktree)

        if runtime_env_provider is None:
            result = super().shell_exec(
                id=id, command=command, block=block, timeout=timeout
            )
        else:
            with self._runtime_env_lock:
                with runtime_env_provider() as runtime_environment:
                    self._runtime_env_overlay = dict(runtime_environment)
                    self._active_runtime_secret_values = tuple(
                        sorted(
                            {
                                value
                                for value in runtime_environment.values()
                                if value
                            },
                            key=len,
                            reverse=True,
                        )
                    )
                    try:
                        result = self._runtime_shell_exec(
                            command=command,
                            block=block,
                            timeout=timeout,
                        )
                    finally:
                        self._runtime_env_overlay.clear()
                        self._runtime_env_overlay = None
                        self._active_runtime_secret_values = ()

        process_continues = (
            isinstance(result, str)
            and "Process continues in background" in result
        )
        if (
            prepared is not None
            and mutation_service is not None
            and request_id is not None
            and block
            and not process_continues
        ):
            mutation_service.complete_broad_write(
                prepared,
                operation_request_id=request_id,
                actor_id=self.agent_name,
                trigger="terminal.execute",
            )
        elif (
            prepared is not None
            and mutation_service is not None
            and request_id is not None
            and process_continues
        ):
            self._watch_background_workspace_mutation(
                session_id=id,
                mutation_service=mutation_service,
                prepared=prepared,
                operation_request_id=request_id,
            )

        # If the command executed successfully but returned empty output,
        # provide a clear success message to help the AI agent understand
        # that the command completed without error.
        if block and result == "":
            return "Command executed successfully (no output)."

        return result

    def _watch_background_workspace_mutation(
        self,
        *,
        session_id: str,
        mutation_service,
        prepared,
        operation_request_id: str,
    ) -> None:
        """Checkpoint a background process only after its session exits."""

        lock = getattr(self, "_workspace_checkpoint_watchers_lock", None)
        if lock is None:
            lock = threading.Lock()
            self._workspace_checkpoint_watchers_lock = lock
            self._workspace_checkpoint_watchers = set()
        with lock:
            if session_id in self._workspace_checkpoint_watchers:
                return
            self._workspace_checkpoint_watchers.add(session_id)

        def wait_and_checkpoint() -> None:
            try:
                while self._workspace_session_running(session_id):
                    threading.Event().wait(0.25)
                mutation_service.complete_broad_write(
                    prepared,
                    operation_request_id=operation_request_id,
                    actor_id=self.agent_name,
                    trigger="terminal.execute",
                )
                get_default_workspace_git_lifecycle().finalize_run(
                    prepared.context.run_id
                )
            except Exception:
                logger.exception(
                    "Background terminal workspace checkpoint failed",
                    extra={"session_id": session_id},
                )
            finally:
                with lock:
                    self._workspace_checkpoint_watchers.discard(session_id)

        threading.Thread(
            target=wait_and_checkpoint,
            name=f"workspace-checkpoint-{session_id}",
            daemon=True,
        ).start()

    def _workspace_session_running(self, session_id: str) -> bool:
        session_lock = getattr(self, "_session_lock", None)
        if session_lock is None:
            return bool(
                getattr(self, "shell_sessions", {})
                .get(session_id, {})
                .get("running", False)
            )
        with session_lock:
            return bool(
                self.shell_sessions.get(session_id, {}).get("running", False)
            )

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
