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
"""``eigent install-path`` and ``eigent completion``.

The CLI runs as ``python -m eigent_cli`` on the backend's Python. A launcher
in ``~/.eigent/bin`` makes that one word, ``eigent``. The desktop app writes
the launcher on every start; this command writes the same one for an install
with no app, and puts its folder on PATH. Nothing here runs unless the user
asks for it.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import click

from eigent_cli.client import CliError
from eigent_cli.main import Context, cli, pass_context

SHELLS = ("bash", "zsh", "fish")


def launcher_dir() -> Path:
    return Path.home() / ".eigent" / "bin"


def launcher_path(platform: str | None = None) -> Path:
    name = "eigent.cmd" if (platform or sys.platform) == "win32" else "eigent"
    return launcher_dir() / name


def _shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def posix_launcher(python: str, backend: str) -> str:
    return "\n".join(
        [
            "#!/bin/sh",
            "# Written by eigent install-path. The Eigent app rewrites it on "
            "every start.",
            f"EIGENT_CLI_BACKEND={_shell_quote(backend)}",
            'export PYTHONPATH="$EIGENT_CLI_BACKEND${PYTHONPATH:+:$PYTHONPATH}"',
            f'exec {_shell_quote(python)} -m eigent_cli "$@"',
            "",
        ]
    )


def windows_launcher(python: str, backend: str) -> str:
    def escape(value: str) -> str:
        return value.replace("%", "%%")

    return "\r\n".join(
        [
            "@echo off",
            "rem Written by eigent install-path. The Eigent app rewrites it "
            "on every start.",
            "setlocal",
            f'set "PYTHONPATH={escape(backend)};%PYTHONPATH%"',
            f'"{escape(python)}" -m eigent_cli %*',
            "exit /b %ERRORLEVEL%",
            "",
        ]
    )


def write_launcher(platform: str | None = None) -> Path:
    """Write a launcher for the Python and CLI that are running now."""

    platform = platform or sys.platform
    backend = str(Path(__file__).resolve().parent.parent)
    content = (
        windows_launcher(sys.executable, backend)
        if platform == "win32"
        else posix_launcher(sys.executable, backend)
    )
    target = launcher_path(platform)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f"{target.name}.{os.getpid()}.tmp")
    temporary.write_text(content, encoding="utf-8", newline="")
    if platform != "win32":
        temporary.chmod(0o755)
    os.replace(temporary, target)
    return target


# ---------------------------------------------------------------- PATH


def _same_folder(left: str, right: str) -> bool:
    def normal(value: str) -> str:
        return os.path.normcase(
            os.path.normpath(os.path.expandvars(value.strip().strip('"')))
        )

    return bool(left.strip()) and normal(left) == normal(right)


def path_contains(path_value: str, folder: str) -> bool:
    return any(
        _same_folder(entry, folder) for entry in path_value.split(os.pathsep)
    )


def read_windows_user_path() -> tuple[str, int]:
    """The user's own PATH value and its registry type, unexpanded."""

    import winreg

    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
        try:
            value, kind = winreg.QueryValueEx(key, "Path")
        except FileNotFoundError:
            return "", winreg.REG_EXPAND_SZ
    return str(value), kind


def write_windows_user_path(value: str, kind: int) -> None:
    import ctypes
    import winreg

    with winreg.OpenKey(
        winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_SET_VALUE
    ) as key:
        winreg.SetValueEx(key, "Path", 0, kind, value)
    # Tell running programs the environment changed, so a terminal opened
    # from now on has the new PATH without signing out.
    try:
        ctypes.windll.user32.SendMessageTimeoutW(
            0xFFFF, 0x001A, 0, "Environment", 0x0002, 2000, None
        )
    except Exception:  # noqa: S110 - a new sign-in picks it up anyway
        pass


def add_to_windows_user_path(folder: str) -> bool:
    """Append ``folder`` to the user's PATH. False when it is already there.

    Reads and writes the registry value as stored, so variables such as
    ``%USERPROFILE%`` in other entries stay as they are and a long PATH is
    never cut short.
    """

    current, kind = read_windows_user_path()
    if path_contains(current, folder):
        return False
    updated = f"{current.rstrip(';')};{folder}" if current.strip() else folder
    write_windows_user_path(updated, kind)
    return True


def link_into_local_bin(launcher: Path) -> Path | None:
    """Link the launcher into ``~/.local/bin`` when that is on PATH."""

    local_bin = Path.home() / ".local" / "bin"
    if not path_contains(os.environ.get("PATH", ""), str(local_bin)):
        return None
    link = local_bin / "eigent"
    if link.is_symlink() or not link.exists():
        local_bin.mkdir(parents=True, exist_ok=True)
        if link.is_symlink():
            link.unlink()
        link.symlink_to(launcher)
        return link
    # A real file named eigent is someone else's; leave it alone.
    return None


@cli.command(name="install-path")
@pass_context
def install_path(ctx: Context) -> None:
    """Make "eigent" a command you can type in any new terminal.

    Writes a launcher to ~/.eigent/bin if the Eigent app has not already,
    then puts it on your PATH: on Windows by adding that folder to your user
    PATH, elsewhere by linking it into ~/.local/bin when that is on PATH.
    It never edits your shell profile; it prints the line to add instead.
    """

    launcher = launcher_path()
    wrote = not launcher.exists()
    if wrote:
        launcher = write_launcher()
    folder = str(launcher.parent)
    result: dict[str, object] = {
        "launcher": str(launcher),
        "launcher_written": wrote,
    }
    if path_contains(os.environ.get("PATH", ""), folder):
        result["path"] = "already"
        message = f"{folder} is already on your PATH."
    elif sys.platform == "win32":
        changed = add_to_windows_user_path(folder)
        result["path"] = "added" if changed else "already"
        message = (
            f"Added {folder} to your user PATH. Open a new terminal to use it."
            if changed
            else f"{folder} is already on your user PATH. Open a new "
            "terminal to use it."
        )
    else:
        link = link_into_local_bin(launcher)
        if link is not None:
            result["path"] = "linked"
            result["link"] = str(link)
            message = f"Linked {link} to the launcher."
        else:
            result["path"] = "manual"
            message = (
                "Add this line to your shell profile, then open a new "
                'terminal:\n  export PATH="$HOME/.eigent/bin:$PATH"'
            )
    if ctx.as_json:
        ctx.emit(result)
        return
    if wrote:
        click.echo(f"Wrote the launcher: {launcher}")
    click.echo(message)


# ----------------------------------------------------------- completion


@cli.command()
@click.argument("shell", type=click.Choice(SHELLS))
def completion(shell: str) -> None:
    """Print a tab-completion script for bash, zsh or fish.

    \b
    bash:  eigent completion bash >> ~/.bashrc
    zsh:   eigent completion zsh >> ~/.zshrc
    fish:  eigent completion fish > ~/.config/fish/completions/eigent.fish
    """

    from click.shell_completion import get_completion_class

    completion_class = get_completion_class(shell)
    if completion_class is None:
        raise CliError(f"No completion script for {shell}.")
    click.echo(
        completion_class(cli, {}, "eigent", "_EIGENT_COMPLETE").source()
    )
