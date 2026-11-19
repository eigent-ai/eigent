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

No test here touches the real PATH or the registry: both are replaced.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

from eigent_cli import install
from eigent_cli.main import Context, run

BACKEND = str(Path(install.__file__).resolve().parent.parent)


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("PATH", os.pathsep.join(["/usr/bin", "/bin"]))
    return tmp_path


class FakeRegistry:
    """The user PATH value in the Windows registry."""

    def __init__(self, value: str = "", kind: int = 2) -> None:
        self.value = value
        self.kind = kind
        self.writes: list[tuple[str, int]] = []

    def read(self) -> tuple[str, int]:
        return self.value, self.kind

    def write(self, value: str, kind: int) -> None:
        self.writes.append((value, kind))
        self.value, self.kind = value, kind


@pytest.fixture
def windows(home, monkeypatch):
    registry = FakeRegistry(r"%USERPROFILE%\AppData\Local\Programs\Tool;C:\x")
    monkeypatch.setattr(install.sys, "platform", "win32")
    monkeypatch.setattr(install.os, "pathsep", ";")
    monkeypatch.setattr(install, "read_windows_user_path", registry.read)
    monkeypatch.setattr(install, "write_windows_user_path", registry.write)
    monkeypatch.setenv("PATH", r"C:\Windows;C:\x")
    return registry


@pytest.fixture
def linux(home, monkeypatch):
    monkeypatch.setattr(install.sys, "platform", "linux")
    return home


def _run(*args: str, as_json: bool = False) -> int:
    return run(list(args), obj=Context(url=None, as_json=as_json))


# ------------------------------------------------------------- launcher


def test_posix_launcher_runs_this_cli_on_this_python(home):
    target = install.write_launcher("linux")

    assert target == home / ".eigent" / "bin" / "eigent"
    content = target.read_text(encoding="utf-8")
    assert content.startswith("#!/bin/sh\n")
    assert f"EIGENT_CLI_BACKEND='{BACKEND}'" in content
    assert f"exec '{sys.executable}' -m eigent_cli \"$@\"" in content
    assert not list(target.parent.glob("*.tmp"))


def test_windows_launcher_passes_arguments_and_the_exit_code(home):
    target = install.write_launcher("win32")

    assert target.name == "eigent.cmd"
    lines = target.read_bytes().decode("utf-8").split("\r\n")
    assert lines[0] == "@echo off"
    assert f'set "PYTHONPATH={BACKEND};%PYTHONPATH%"' in lines
    assert f'"{sys.executable}" -m eigent_cli %*' in lines
    assert "exit /b %ERRORLEVEL%" in lines


def test_launchers_quote_awkward_paths():
    posix = install.posix_launcher(
        "/home/o'neil/python", "/opt/Eigent's/backend"
    )
    assert "exec '/home/o'\\''neil/python' -m eigent_cli" in posix
    assert "EIGENT_CLI_BACKEND='/opt/Eigent'\\''s/backend'" in posix

    windows = install.windows_launcher(r"C:\100%me\python.exe", r"C:\b")
    assert r'"C:\100%%me\python.exe" -m eigent_cli %*' in windows


# -------------------------------------------------------- Windows PATH


def test_windows_adds_the_folder_to_the_user_path_once(windows, home, capsys):
    folder = str(home / ".eigent" / "bin")

    assert _run("install-path") == 0

    ((written, kind),) = windows.writes
    # Other entries stay exactly as stored, variables unexpanded.
    assert (
        written == rf"%USERPROFILE%\AppData\Local\Programs\Tool;C:\x;{folder}"
    )
    assert kind == 2
    out = capsys.readouterr().out
    assert "Wrote the launcher" in out and "Open a new terminal" in out
    assert (home / ".eigent" / "bin" / "eigent.cmd").is_file()

    assert _run("install-path") == 0
    assert len(windows.writes) == 1
    assert "already on your user PATH" in capsys.readouterr().out


def test_windows_starts_a_path_when_the_user_has_none(windows, home):
    windows.value = ""

    assert _run("install-path") == 0

    assert windows.writes == [(str(home / ".eigent" / "bin"), 2)]


def test_windows_recognises_the_folder_written_another_way(
    windows, home, monkeypatch
):
    monkeypatch.setenv("USERPROFILE", str(home))
    windows.value = r"C:\x;%USERPROFILE%\.eigent\bin\;"

    assert _run("install-path") == 0
    assert windows.writes == []


def test_nothing_is_changed_when_the_folder_is_already_on_path(
    windows, home, capsys
):
    monkeypatch_path = rf"C:\Windows;{home / '.eigent' / 'bin'}"
    os.environ["PATH"] = monkeypatch_path

    assert _run("install-path", as_json=True) == 0

    result = json.loads(capsys.readouterr().out)
    assert result["path"] == "already"
    assert windows.writes == []


def test_the_apps_launcher_is_left_as_it_is(windows, home, capsys):
    launcher = home / ".eigent" / "bin" / "eigent.cmd"
    launcher.parent.mkdir(parents=True)
    launcher.write_text("written by the app", encoding="utf-8")

    assert _run("install-path", as_json=True) == 0

    assert launcher.read_text(encoding="utf-8") == "written by the app"
    assert json.loads(capsys.readouterr().out)["launcher_written"] is False


# ---------------------------------------------------- macOS and Linux


def test_posix_links_into_local_bin_when_that_is_on_path(
    linux, monkeypatch, capsys
):
    local_bin = linux / ".local" / "bin"
    monkeypatch.setenv("PATH", os.pathsep.join(["/usr/bin", str(local_bin)]))
    links: list[tuple[Path, Path]] = []
    monkeypatch.setattr(
        Path,
        "symlink_to",
        lambda self, target: links.append((self, Path(target))),
    )

    assert _run("install-path") == 0

    assert links == [
        (local_bin / "eigent", linux / ".eigent" / "bin" / "eigent")
    ]
    assert "Linked" in capsys.readouterr().out


def test_posix_never_replaces_someone_elses_eigent(linux, monkeypatch, capsys):
    local_bin = linux / ".local" / "bin"
    local_bin.mkdir(parents=True)
    (local_bin / "eigent").write_text("another tool", encoding="utf-8")
    monkeypatch.setenv("PATH", os.pathsep.join(["/usr/bin", str(local_bin)]))

    assert _run("install-path") == 0

    assert (local_bin / "eigent").read_text(encoding="utf-8") == "another tool"
    assert 'export PATH="$HOME/.eigent/bin:$PATH"' in capsys.readouterr().out


def test_posix_refreshes_its_own_link(linux, monkeypatch):
    local_bin = linux / ".local" / "bin"
    local_bin.mkdir(parents=True)
    monkeypatch.setenv("PATH", os.pathsep.join(["/usr/bin", str(local_bin)]))
    calls: list[str] = []
    monkeypatch.setattr(Path, "is_symlink", lambda self: self.name == "eigent")
    monkeypatch.setattr(Path, "unlink", lambda self: calls.append("unlink"))
    monkeypatch.setattr(
        Path, "symlink_to", lambda self, target: calls.append("link")
    )

    assert install.link_into_local_bin(
        linux / ".eigent" / "bin" / "eigent"
    ) == (local_bin / "eigent")
    assert calls == ["unlink", "link"]


def test_posix_prints_the_line_to_add_and_edits_no_profile(linux, capsys):
    (linux / ".bashrc").write_text("# mine\n", encoding="utf-8")

    assert _run("install-path", as_json=True) == 0

    assert json.loads(capsys.readouterr().out)["path"] == "manual"
    assert (linux / ".bashrc").read_text(encoding="utf-8") == "# mine\n"
    assert not (linux / ".local").exists()


# ----------------------------------------------------------- completion


@pytest.mark.parametrize("shell", install.SHELLS)
def test_completion_prints_a_script_for_the_shell(shell, capsys):
    assert _run("completion", shell) == 0

    script = capsys.readouterr().out
    assert "_EIGENT_COMPLETE" in script
    assert f"{shell}_complete" in script


def test_completion_refuses_an_unknown_shell(capsys):
    assert _run("completion", "powershell") == 2


def test_the_script_can_complete_commands(monkeypatch, capsys):
    monkeypatch.setenv("_EIGENT_COMPLETE", "bash_complete")
    monkeypatch.setenv("COMP_WORDS", "eigent rem")
    monkeypatch.setenv("COMP_CWORD", "1")

    assert _run() == 0
    assert "remote" in capsys.readouterr().out
