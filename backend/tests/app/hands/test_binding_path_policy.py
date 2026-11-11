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

import platform
from pathlib import Path, PurePosixPath, PureWindowsPath
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.controller import workspace_controller
from app.hands import binding_path_policy as policy
from app.hands.capabilities import BrainCapabilities
from app.hands.environment_hands import EnvironmentHands

MAC_HOME = PurePosixPath("/Users/alex")
LINUX_HOME = PurePosixPath("/home/alex")
WIN_HOME = PureWindowsPath(r"C:\Users\alex")
WIN_ENV = {
    "SystemDrive": "C:",
    "SystemRoot": r"C:\Windows",
    "ProgramFiles": r"C:\Program Files",
    "ProgramFiles(x86)": r"C:\Program Files (x86)",
    "ProgramData": r"C:\ProgramData",
}


def _mac(path: str) -> str | None:
    return policy.binding_path_refusal(
        PurePosixPath(path), home=MAC_HOME, system="Darwin"
    )


def _linux(path: str) -> str | None:
    return policy.binding_path_refusal(
        PurePosixPath(path), home=LINUX_HOME, system="Linux"
    )


def _windows(path: str) -> str | None:
    return policy.binding_path_refusal(
        PureWindowsPath(path),
        home=WIN_HOME,
        system="Windows",
        environ=WIN_ENV,
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    ("path", "reason"),
    [
        ("/", policy.FILESYSTEM_ROOT_FORBIDDEN),
        ("/Volumes", policy.FILESYSTEM_ROOT_FORBIDDEN),
        ("/System", policy.SYSTEM_PATH_FORBIDDEN),
        ("/System/Library/CoreServices", policy.SYSTEM_PATH_FORBIDDEN),
        ("/system/library", policy.SYSTEM_PATH_FORBIDDEN),
        ("/Library", policy.SYSTEM_PATH_FORBIDDEN),
        ("/Applications", policy.SYSTEM_PATH_FORBIDDEN),
        ("/usr/local", policy.SYSTEM_PATH_FORBIDDEN),
        ("/private/etc", policy.SYSTEM_PATH_FORBIDDEN),
        ("/private/var/db", policy.SYSTEM_PATH_FORBIDDEN),
        ("/Users", policy.SYSTEM_PATH_FORBIDDEN),
        ("/Users/sam", policy.OTHER_USER_HOME_FORBIDDEN),
        ("/Users/sam/Documents", policy.OTHER_USER_HOME_FORBIDDEN),
        ("/Users/alex", policy.HOME_ROOT_FORBIDDEN),
        ("/users/ALEX", policy.HOME_ROOT_FORBIDDEN),
        ("/Users/alex/.ssh", policy.SENSITIVE_PATH_FORBIDDEN),
        ("/Users/alex/.aws/sso", policy.SENSITIVE_PATH_FORBIDDEN),
        ("/Users/alex/Library/Keychains", policy.SENSITIVE_PATH_FORBIDDEN),
    ],
)
def test_macos_refuses_protected_folders(path, reason):
    assert _mac(path) == reason


@pytest.mark.unit
@pytest.mark.parametrize(
    "path",
    [
        "/Users/alex/Documents/project",
        "/Users/alex/Library/Mobile Documents/com~apple~CloudDocs/Notes",
        "/Users/alex/Library/CloudStorage/Dropbox/Work",
        "/Users/Shared/Team",
        "/Volumes/External/Projects",
        "/opt/work",
        "/private/tmp/scratch",
        "/private/var/folders/xy/T/pytest-of-alex/test0",
    ],
)
def test_macos_allows_user_folders_and_external_volumes(path):
    assert _mac(path) is None


@pytest.mark.unit
@pytest.mark.parametrize(
    ("path", "reason"),
    [
        ("/", policy.FILESYSTEM_ROOT_FORBIDDEN),
        ("/mnt", policy.FILESYSTEM_ROOT_FORBIDDEN),
        ("/etc", policy.SYSTEM_PATH_FORBIDDEN),
        ("/usr/share", policy.SYSTEM_PATH_FORBIDDEN),
        ("/proc/1", policy.SYSTEM_PATH_FORBIDDEN),
        ("/root", policy.SYSTEM_PATH_FORBIDDEN),
        ("/home", policy.SYSTEM_PATH_FORBIDDEN),
        ("/home/sam", policy.OTHER_USER_HOME_FORBIDDEN),
        ("/home/alex", policy.HOME_ROOT_FORBIDDEN),
        ("/home/alex/.gnupg", policy.SENSITIVE_PATH_FORBIDDEN),
        # Linux paths are case-sensitive, so "/ETC" is a different folder.
    ],
)
def test_linux_refuses_protected_folders(path, reason):
    assert _linux(path) == reason


@pytest.mark.unit
@pytest.mark.parametrize(
    "path",
    [
        "/home/alex/code/app",
        "/mnt/data/projects",
        "/media/alex/USB/notes",
        "/srv/repo",
        "/var/tmp/work",
        "/ETC",
    ],
)
def test_linux_allows_user_folders_and_mounts(path):
    assert _linux(path) is None


@pytest.mark.unit
@pytest.mark.parametrize(
    ("path", "reason"),
    [
        ("C:\\", policy.FILESYSTEM_ROOT_FORBIDDEN),
        ("D:\\", policy.FILESYSTEM_ROOT_FORBIDDEN),
        (r"\\nas\share", policy.FILESYSTEM_ROOT_FORBIDDEN),
        (r"C:\Windows", policy.SYSTEM_PATH_FORBIDDEN),
        (r"c:\windows\System32", policy.SYSTEM_PATH_FORBIDDEN),
        (r"C:\Program Files\App", policy.SYSTEM_PATH_FORBIDDEN),
        (r"C:\Program Files (x86)", policy.SYSTEM_PATH_FORBIDDEN),
        (r"C:\ProgramData\Vendor", policy.SYSTEM_PATH_FORBIDDEN),
        (r"C:\Users", policy.SYSTEM_PATH_FORBIDDEN),
        (r"C:\Users\Default", policy.OTHER_USER_HOME_FORBIDDEN),
        (r"C:\Users\sam\Desktop", policy.OTHER_USER_HOME_FORBIDDEN),
        (r"C:\Users\alex", policy.HOME_ROOT_FORBIDDEN),
        (
            r"C:\Users\alex\AppData\Roaming\Microsoft\Credentials",
            policy.SENSITIVE_PATH_FORBIDDEN,
        ),
        (r"C:\Users\alex\.ssh", policy.SENSITIVE_PATH_FORBIDDEN),
    ],
)
def test_windows_refuses_protected_folders(path, reason):
    assert _windows(path) == reason


@pytest.mark.unit
@pytest.mark.parametrize(
    "path",
    [
        r"D:\Projects\eigent",
        r"E:\work",
        r"C:\dev\app",
        r"C:\Users\alex\Documents\notes",
        r"C:\Users\Public\Shared Work",
        r"\\nas\share\team",
    ],
)
def test_windows_allows_other_drives_and_user_folders(path):
    assert _windows(path) is None


@pytest.mark.unit
def test_windows_uses_system_drive_from_environment():
    environ = {"SystemDrive": "D:", "SystemRoot": r"D:\Windows"}
    assert (
        policy.binding_path_refusal(
            PureWindowsPath(r"D:\Windows\Temp"),
            home=PureWindowsPath(r"D:\Users\alex"),
            system="Windows",
            environ=environ,
        )
        == policy.SYSTEM_PATH_FORBIDDEN
    )


def _hands(tmp_path: Path) -> EnvironmentHands:
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    return EnvironmentHands(
        BrainCapabilities(filesystem_scope="full", workspace_root=workspace)
    )


@pytest.mark.unit
def test_environment_hands_allows_folder_outside_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    outside = tmp_path / "other-drive" / "project"
    outside.mkdir(parents=True)

    hands = _hands(tmp_path)

    assert hands.validate_workspace_binding_path(str(outside)) == (True, None)


@pytest.mark.unit
def test_environment_hands_refuses_home_root_and_missing_folder(
    tmp_path, monkeypatch
):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))

    hands = _hands(tmp_path)

    assert hands.validate_workspace_binding_path(str(home)) == (
        False,
        policy.HOME_ROOT_FORBIDDEN,
    )
    assert hands.validate_workspace_binding_path(
        str(tmp_path / "missing")
    ) == (False, "path_not_directory")


@pytest.mark.unit
def test_environment_hands_judges_symlinks_by_target(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / ".ssh").mkdir(parents=True)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    link = tmp_path / "keys-link"
    try:
        link.symlink_to(home / ".ssh", target_is_directory=True)
    except OSError:
        pytest.skip("symlinks are not available on this runner")

    hands = _hands(tmp_path)

    assert hands.validate_workspace_binding_path(str(link)) == (
        False,
        policy.SENSITIVE_PATH_FORBIDDEN,
    )


@pytest.mark.unit
def test_environment_hands_refuses_filesystem_root(tmp_path):
    hands = _hands(tmp_path)
    root = Path(tmp_path.anchor)

    assert hands.validate_workspace_binding_path(str(root)) == (
        False,
        policy.FILESYSTEM_ROOT_FORBIDDEN,
    )


@pytest.mark.unit
def test_environment_hands_keeps_workspace_only_scope(tmp_path):
    workspace = tmp_path / "workspace"
    inside = workspace / "project"
    inside.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    hands = EnvironmentHands(
        BrainCapabilities(
            filesystem_scope="workspace_only", workspace_root=workspace
        )
    )

    assert hands.validate_workspace_binding_path(str(outside)) == (
        False,
        "filesystem_capability_denied",
    )


@pytest.mark.unit
@pytest.mark.skipif(
    platform.system() not in ("Darwin", "Linux", "Windows"),
    reason="no protected-folder rules for this platform",
)
def test_bind_route_refuses_system_folder_with_403(tmp_path):
    hands = _hands(tmp_path)
    request = SimpleNamespace(state=SimpleNamespace(hands=hands))
    system_folder = {
        "Darwin": "/System",
        "Linux": "/etc",
        "Windows": r"C:\Windows",
    }[platform.system()]
    if not Path(system_folder).is_dir():
        pytest.skip(f"{system_folder} is not present on this runner")

    with pytest.raises(HTTPException) as exc_info:
        workspace_controller._validate_bind_path(request, system_folder)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == {
        "code": "invalid_workspace_path",
        "reason": policy.SYSTEM_PATH_FORBIDDEN,
    }


MAC_APP_DATA = (MAC_HOME / ".eigent", MAC_HOME / "eigent")
WIN_APP_DATA = (WIN_HOME / ".eigent", WIN_HOME / "eigent")


@pytest.mark.unit
@pytest.mark.parametrize(
    "path",
    [
        "/Users/alex/.eigent",
        "/Users/alex/.eigent/alex",
        "/Users/alex/.eigent/alex/runtime",
        "/Users/alex/.eigent/alex/runtime/project_1/task_2",
        "/Users/alex/.eigent/workspace",
        "/Users/alex/.eigent/workspace/session-1",
        "/Users/alex/.EIGENT/alex",
        "/Users/alex/eigent",
    ],
)
def test_macos_refuses_app_data_folder(path):
    assert (
        policy.binding_path_refusal(
            PurePosixPath(path),
            home=MAC_HOME,
            system="Darwin",
            app_data_roots=MAC_APP_DATA,
        )
        == policy.APP_DATA_PATH_FORBIDDEN
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    "path",
    [
        r"C:\Users\alex\.eigent",
        r"c:\users\ALEX\.Eigent\alex\runtime",
        r"C:\Users\alex\.eigent\workspace",
        r"C:\Users\alex\eigent",
    ],
)
def test_windows_refuses_app_data_folder(path):
    assert (
        policy.binding_path_refusal(
            PureWindowsPath(path),
            home=WIN_HOME,
            system="Windows",
            environ=WIN_ENV,
            app_data_roots=WIN_APP_DATA,
        )
        == policy.APP_DATA_PATH_FORBIDDEN
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    ("path", "system", "home", "app_data", "pure"),
    [
        (
            "/Users/alex/Documents",
            "Darwin",
            MAC_HOME,
            MAC_APP_DATA,
            PurePosixPath,
        ),
        (
            "/Users/alex/eigent-notes",
            "Darwin",
            MAC_HOME,
            MAC_APP_DATA,
            PurePosixPath,
        ),
        (
            "/Users/alex/Projects/.eigent-old",
            "Darwin",
            MAC_HOME,
            MAC_APP_DATA,
            PurePosixPath,
        ),
        (
            r"C:\Users\alex\Documents",
            "Windows",
            WIN_HOME,
            WIN_APP_DATA,
            PureWindowsPath,
        ),
        (r"D:\eigent", "Windows", WIN_HOME, WIN_APP_DATA, PureWindowsPath),
    ],
)
def test_app_data_rule_keeps_neighbours_allowed(
    path, system, home, app_data, pure
):
    assert (
        policy.binding_path_refusal(
            pure(path),
            home=home,
            system=system,
            environ=WIN_ENV if system == "Windows" else None,
            app_data_roots=app_data,
        )
        is None
    )


@pytest.mark.unit
def test_home_root_keeps_its_own_reason_with_app_data_roots():
    assert (
        policy.binding_path_refusal(
            MAC_HOME,
            home=MAC_HOME,
            system="Darwin",
            app_data_roots=MAC_APP_DATA,
        )
        == policy.HOME_ROOT_FORBIDDEN
    )


@pytest.mark.unit
def test_folder_above_app_data_outside_home_is_refused():
    assert (
        policy.binding_path_refusal(
            PurePosixPath("/srv/eigent-host"),
            home=PurePosixPath("/home/alex"),
            system="Linux",
            app_data_roots=(PurePosixPath("/srv/eigent-host/data"),),
        )
        == policy.APP_DATA_PATH_FORBIDDEN
    )


def _home_with_app_data(tmp_path, monkeypatch) -> Path:
    home = tmp_path / "home"
    (home / ".eigent" / "alex" / "runtime").mkdir(parents=True)
    (home / ".eigent" / "workspace").mkdir()
    (home / "Documents").mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    return home


@pytest.mark.unit
@pytest.mark.parametrize(
    "relative",
    [".eigent", ".eigent/alex", ".eigent/alex/runtime", ".eigent/workspace"],
)
def test_environment_hands_refuses_app_data_folder(
    tmp_path, monkeypatch, relative
):
    home = _home_with_app_data(tmp_path, monkeypatch)

    assert _hands(tmp_path).validate_workspace_binding_path(
        str(home / relative)
    ) == (False, policy.APP_DATA_PATH_FORBIDDEN)


@pytest.mark.unit
def test_environment_hands_refuses_symlink_into_app_data(
    tmp_path, monkeypatch
):
    home = _home_with_app_data(tmp_path, monkeypatch)
    link = home / "Documents" / "runtime-link"
    try:
        link.symlink_to(home / ".eigent" / "alex", target_is_directory=True)
    except OSError:
        pytest.skip("symlinks are not available on this runner")

    assert _hands(tmp_path).validate_workspace_binding_path(str(link)) == (
        False,
        policy.APP_DATA_PATH_FORBIDDEN,
    )


@pytest.mark.unit
def test_environment_hands_refuses_visible_eigent_root_when_present(
    tmp_path, monkeypatch
):
    home = _home_with_app_data(tmp_path, monkeypatch)
    (home / "eigent").mkdir()

    assert _hands(tmp_path).validate_workspace_binding_path(
        str(home / "eigent")
    ) == (False, policy.APP_DATA_PATH_FORBIDDEN)


@pytest.mark.unit
def test_environment_hands_still_allows_documents_with_app_data(
    tmp_path, monkeypatch
):
    home = _home_with_app_data(tmp_path, monkeypatch)

    assert _hands(tmp_path).validate_workspace_binding_path(
        str(home / "Documents")
    ) == (True, None)


@pytest.mark.unit
def test_bind_route_refuses_app_data_folder_with_403(tmp_path, monkeypatch):
    home = _home_with_app_data(tmp_path, monkeypatch)
    request = SimpleNamespace(state=SimpleNamespace(hands=_hands(tmp_path)))

    with pytest.raises(HTTPException) as exc_info:
        workspace_controller._validate_bind_path(
            request, str(home / ".eigent")
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == {
        "code": "invalid_workspace_path",
        "reason": policy.APP_DATA_PATH_FORBIDDEN,
    }
