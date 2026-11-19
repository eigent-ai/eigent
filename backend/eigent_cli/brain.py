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
"""Run Eigent in the background for hosts with no desktop app.

This starts the same backend the desktop app starts, as a separate process.
It is launched, never imported: the CLI stays a plain HTTP client.
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx

from eigent_cli.client import (
    EXIT_FAILED,
    EXIT_UNREACHABLE,
    BrainClient,
    CliError,
    Connection,
    _read_brain_info,
    cli_dir,
    resolve_connection,
)

# Outside 5001-5050: the desktop app clears that range for its own backend.
DEFAULT_PORT_RANGE = range(5151, 5200)
START_TIMEOUT_SECONDS = 120.0
STOP_TIMEOUT_SECONDS = 30.0
ALREADY_RUNNING_MARKER = "is already using"


def backend_dir() -> Path:
    """The backend this CLI ships with."""

    folder = Path(__file__).resolve().parent.parent
    if not (folder / "main.py").is_file():
        raise CliError(
            "This install has no Eigent backend to start. Start the Eigent "
            "app instead, with CLI access turned on."
        )
    return folder


def log_path() -> Path:
    return cli_dir() / "brain.log"


def is_reachable(connection: Connection, *, timeout: float = 3.0) -> bool:
    try:
        response = httpx.get(f"{connection.base_url}/health", timeout=timeout)
    except httpx.HTTPError:
        return False
    return response.status_code == 200


def find_running(url: str | None = None) -> Connection | None:
    """The Eigent this CLI would talk to, if it answers."""

    try:
        connection = resolve_connection(url)
    except CliError:
        return None
    return connection if is_reachable(connection) else None


def _port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def pick_port(preferred: int | None = None) -> int:
    if preferred is not None:
        if not _port_is_free(preferred):
            raise CliError(f"Port {preferred} is already in use.")
        return preferred
    for port in DEFAULT_PORT_RANGE:
        if _port_is_free(port):
            return port
    raise CliError(
        f"No free port between {DEFAULT_PORT_RANGE.start} and "
        f"{DEFAULT_PORT_RANGE.stop - 1}. Choose one with --port."
    )


def _log_tail(lines: int = 15) -> str:
    try:
        text = log_path().read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return "\n".join(text.splitlines()[-lines:])


def _start_failure(code: int | None) -> CliError:
    tail = _log_tail(40)
    if ALREADY_RUNNING_MARKER in tail:
        return CliError(
            "Eigent is already running on this computer, but without CLI "
            "access (most likely the desktop app). Set EIGENT_CLI_ACCESS=1 "
            "in your environment or in ~/.eigent/.env and restart it.",
            EXIT_UNREACHABLE,
        )
    reason = (
        f"exited with code {code}" if code is not None else "did not answer"
    )
    return CliError(
        f"Eigent {reason} while starting. See {log_path()}.",
        EXIT_UNREACHABLE,
    )


def spawn(port: int) -> subprocess.Popen[bytes]:
    folder = backend_dir()
    env = dict(os.environ)
    env["EIGENT_CLI_ACCESS"] = "1"
    env["EIGENT_BRAIN_PORT"] = str(port)
    env.setdefault("PYTHONIOENCODING", "utf-8")
    log_path().parent.mkdir(parents=True, exist_ok=True)
    options: dict[str, object] = {}
    if sys.platform == "win32":
        # A hidden console of its own: the commands a Task runs inherit it
        # instead of each opening a window.
        options["creationflags"] = (
            subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        )
    else:
        options["start_new_session"] = True
    with open(log_path(), "ab") as log:
        return subprocess.Popen(  # noqa: S603 - fixed argv, no shell
            [sys.executable, "main.py"],
            cwd=str(folder),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            close_fds=True,
            **options,
        )


def start_background(
    port: int | None = None, *, timeout: float = START_TIMEOUT_SECONDS
) -> Connection:
    """Start Eigent in the background and wait until it answers."""

    chosen_port = pick_port(port)
    # Not the process id: on Windows a virtual environment's python.exe is
    # a launcher, and the backend runs in its child.
    spawned_at = time.time() - 1.0
    process = spawn(chosen_port)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        code = process.poll()
        if code is not None:
            raise _start_failure(code)
        info = _read_brain_info() or {}
        started_at = info.get("started_at")
        if (
            info.get("port") == chosen_port
            and isinstance(started_at, int | float)
            and started_at >= spawned_at
        ):
            connection = resolve_connection()
            if is_reachable(connection, timeout=2.0):
                return connection
        time.sleep(0.5)
    raise _start_failure(None)


def published_pid() -> int | None:
    info = _read_brain_info()
    pid = info.get("pid") if info else None
    return pid if isinstance(pid, int) else None


def stop(
    client: BrainClient,
    connection: Connection,
    *,
    force: bool = False,
    timeout: float = STOP_TIMEOUT_SECONDS,
) -> None:
    """Ask a background Eigent to stop, and wait until it has."""

    pid = published_pid()
    client.post("/v1/brain/shutdown")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not is_reachable(connection, timeout=1.0):
            return
        time.sleep(0.5)
    if force and pid is not None:
        try:
            os.kill(pid, getattr(signal, "SIGKILL", signal.SIGTERM))
        except OSError as exc:
            raise CliError(f"Could not stop process {pid}: {exc}") from exc
        return
    raise CliError(
        "Eigent is still shutting down. Try again in a moment, or use "
        "--force.",
        EXIT_FAILED,
    )


__all__ = [
    "backend_dir",
    "find_running",
    "is_reachable",
    "log_path",
    "pick_port",
    "start_background",
    "stop",
]
