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
"""Opt-in access for the ``eigent`` command-line client.

The Desktop renderer capability never leaves process memory, so a terminal
cannot use it. When ``EIGENT_CLI_ACCESS`` is on, the Brain keeps a separate
token in ``~/.eigent/cli/token`` and publishes where it listens in
``~/.eigent/cli/brain.json``. The token only authorizes Run routes; see
``require_run_control_principal``.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import sys
import time
from pathlib import Path

logger = logging.getLogger("cli_access")

CLI_ACCESS_ENV = "EIGENT_CLI_ACCESS"
CLI_TOKEN_HEADER = "X-Eigent-CLI-Token"
BRAIN_INFO_VERSION = 1

_TRUE_VALUES = {"1", "true", "yes", "on"}
_process_cli_token: str | None = None


def cli_dir() -> Path:
    return Path.home() / ".eigent" / "cli"


def cli_token_path() -> Path:
    return cli_dir() / "token"


def brain_info_path() -> Path:
    return cli_dir() / "brain.json"


def cli_access_enabled() -> bool:
    from app.component.environment import env

    return str(env(CLI_ACCESS_ENV, "") or "").strip().lower() in _TRUE_VALUES


def current_cli_token() -> str | None:
    """The token this Brain accepts, or None when CLI access is off."""

    return _process_cli_token


def _write_private(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(content)
    os.replace(tmp, path)


def load_or_create_cli_token() -> str:
    path = cli_token_path()
    try:
        token = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        token = ""
    if len(token) >= 32:
        return token
    token = secrets.token_urlsafe(32)
    _write_private(path, token + "\n")
    return token


def listen_address(argv: list[str] | None = None) -> tuple[str, int | None]:
    """Where this Brain listens.

    Standalone start sets ``EIGENT_BRAIN_PORT``; Desktop starts uvicorn with
    ``--port`` on the command line.
    """

    args = list(sys.argv if argv is None else argv)

    def _flag(name: str) -> str | None:
        for index, arg in enumerate(args):
            if arg == name and index + 1 < len(args):
                return args[index + 1]
            if arg.startswith(f"{name}="):
                return arg.split("=", 1)[1]
        return None

    host = os.environ.get("EIGENT_BRAIN_HOST") or _flag("--host")
    raw_port = os.environ.get("EIGENT_BRAIN_PORT") or _flag("--port")
    try:
        port = int(raw_port) if raw_port else None
    except ValueError:
        port = None
    return host or "127.0.0.1", port


def initialize_cli_access(argv: list[str] | None = None) -> bool:
    """Load the CLI token and publish this Brain's address.

    Never raises: the CLI is optional and must not block Brain startup.
    Returns whether CLI access is on.
    """

    global _process_cli_token
    _process_cli_token = None
    try:
        if not cli_access_enabled():
            return False
        token = load_or_create_cli_token()
        host, port = listen_address(argv)
        _write_private(
            brain_info_path(),
            json.dumps(
                {
                    "version": BRAIN_INFO_VERSION,
                    "pid": os.getpid(),
                    "host": host,
                    "port": port,
                    "started_at": time.time(),
                },
                indent=2,
            )
            + "\n",
        )
        _process_cli_token = token
        logger.info("CLI access is on", extra={"port": port})
        return True
    except Exception:
        logger.exception("CLI access could not be initialized")
        _process_cli_token = None
        return False


def shutdown_cli_access() -> None:
    """Remove brain.json if this process wrote it."""

    global _process_cli_token
    _process_cli_token = None
    path = brain_info_path()
    try:
        info = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if info.get("pid") == os.getpid():
        try:
            path.unlink()
        except OSError:
            pass
