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

import pytest

from app.hands import capabilities


@pytest.mark.unit
def test_has_terminal_shell_accepts_windows_powershell(monkeypatch):
    monkeypatch.setattr(capabilities.os, "name", "nt")

    def fake_which(command: str) -> str | None:
        if command == "powershell.exe":
            return (
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\"
                "powershell.exe"
            )
        return None

    monkeypatch.setattr(capabilities.shutil, "which", fake_which)

    assert capabilities._has_terminal_shell() is True


@pytest.mark.unit
def test_has_terminal_shell_accepts_posix_sh(monkeypatch):
    monkeypatch.setattr(capabilities.os, "name", "posix")

    def fake_which(command: str) -> str | None:
        if command == "sh":
            return "/bin/sh"
        return None

    monkeypatch.setattr(capabilities.shutil, "which", fake_which)

    assert capabilities._has_terminal_shell() is True
