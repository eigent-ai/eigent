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

"""Which folders a Space may use as its workspace root.

A local Brain may bind folders anywhere the user can reach, including other
drives and mounted volumes. A small set of locations is always refused:
filesystem and drive roots, the home folder itself, credential stores inside
the home folder, operating-system folders, and other users' home folders.

The policy is a pure function over an already-resolved path so that every
platform's rules can be tested on any host.
"""

from collections.abc import Mapping
from pathlib import PurePath, PurePosixPath, PureWindowsPath

FILESYSTEM_ROOT_FORBIDDEN = "filesystem_root_forbidden"
HOME_ROOT_FORBIDDEN = "home_root_forbidden"
SYSTEM_PATH_FORBIDDEN = "system_path_forbidden"
OTHER_USER_HOME_FORBIDDEN = "other_user_home_forbidden"
SENSITIVE_PATH_FORBIDDEN = "sensitive_path_forbidden"

_HOME_CREDENTIAL_DIRS: dict[str, tuple[str, ...]] = {
    "common": (".ssh", ".gnupg", ".aws", ".kube", ".docker", ".config/gh"),
    "Darwin": (
        "Library/Keychains",
        "Library/Application Support/com.apple.TCC",
    ),
    "Windows": (
        "AppData/Roaming/Microsoft/Credentials",
        "AppData/Local/Microsoft/Credentials",
        "AppData/Roaming/Microsoft/Protect",
    ),
}

_POSIX_SYSTEM_ROOTS: dict[str, tuple[str, ...]] = {
    "Darwin": (
        "/System",
        "/Library",
        "/Applications",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/var",
        "/private/etc",
        "/private/var",
        "/cores",
        "/dev",
    ),
    "Linux": (
        "/etc",
        "/usr",
        "/bin",
        "/sbin",
        "/lib",
        "/lib32",
        "/lib64",
        "/libx32",
        "/boot",
        "/proc",
        "/sys",
        "/dev",
        "/run",
        "/var",
        "/root",
        "/snap",
    ),
}

# Locations under a system root that users legitimately work in.
_POSIX_EXCEPTIONS: dict[str, tuple[str, ...]] = {
    "Darwin": ("/private/var/folders", "/private/tmp"),
    "Linux": ("/var/tmp",),  # nosec B108 -- allowed path prefix, no file I/O
}

# Folders that list user profiles; only the listing itself and other users'
# profiles below it are refused. Shared and Public are meant for everyone.
_PROFILE_ROOTS: dict[str, tuple[str, ...]] = {
    "Darwin": ("/Users",),
    "Linux": ("/home",),
}
_SHARED_PROFILE_DIRS = {"shared", "public"}

# Directories that only list mounted volumes.
_MOUNT_LISTINGS: dict[str, tuple[str, ...]] = {
    "Darwin": ("/Volumes",),
    "Linux": ("/mnt", "/media"),
}


def _pure(system: str, value: str) -> PurePath:
    if system == "Windows":
        return PureWindowsPath(value)
    return PurePosixPath(value)


def _key(path: PurePath, system: str) -> tuple[str, ...]:
    parts = path.parts
    if system in ("Windows", "Darwin"):
        # Both default to case-insensitive filesystems, and resolve() does not
        # canonicalize letter case for paths typed by hand.
        return tuple(part.casefold() for part in parts)
    return tuple(parts)


def _within(child: PurePath, parent: PurePath, system: str) -> bool:
    child_key = _key(child, system)
    parent_key = _key(parent, system)
    return child_key[: len(parent_key)] == parent_key


def _same(left: PurePath, right: PurePath, system: str) -> bool:
    return _key(left, system) == _key(right, system)


def _windows_system_roots(
    environ: Mapping[str, str], system_drive: str
) -> list[str]:
    roots = [
        environ.get("SystemRoot") or environ.get("windir") or "",
        environ.get("ProgramFiles") or "",
        environ.get("ProgramFiles(x86)") or "",
        environ.get("ProgramW6432") or "",
        environ.get("ProgramData") or "",
    ]
    roots.extend(
        f"{system_drive}\\{name}"
        for name in (
            "Windows",
            "Program Files",
            "Program Files (x86)",
            "ProgramData",
            "$Recycle.Bin",
            "System Volume Information",
            "Recovery",
        )
    )
    return [root for root in roots if root]


def binding_path_refusal(
    resolved: PurePath,
    *,
    home: PurePath,
    system: str,
    environ: Mapping[str, str] | None = None,
) -> str | None:
    """Return a refusal reason for ``resolved``, or ``None`` when allowed.

    ``resolved`` and ``home`` must already be absolute and symlink-free, so a
    link that points into a protected folder is judged by its target.
    """

    environ = environ or {}
    resolved = _pure(system, str(resolved))
    home = _pure(system, str(home))

    # "/", "C:\\" and a UNC share root such as "\\\\server\\share" have no
    # parts below their anchor.
    if len(resolved.parts) <= 1:
        return FILESYSTEM_ROOT_FORBIDDEN
    for listing in _MOUNT_LISTINGS.get(system, ()):
        if _same(resolved, _pure(system, listing), system):
            return FILESYSTEM_ROOT_FORBIDDEN

    if _same(resolved, home, system):
        return HOME_ROOT_FORBIDDEN

    credential_dirs = (
        *_HOME_CREDENTIAL_DIRS["common"],
        *_HOME_CREDENTIAL_DIRS.get(system, ()),
    )
    for relative in credential_dirs:
        if _within(resolved, home / relative, system):
            return SENSITIVE_PATH_FORBIDDEN

    if _within(resolved, home, system):
        return None

    if system == "Windows":
        system_drive = (environ.get("SystemDrive") or "C:").rstrip("\\/")
        for root in _windows_system_roots(environ, system_drive):
            if _within(resolved, _pure(system, root), system):
                return SYSTEM_PATH_FORBIDDEN
    else:
        for exception in _POSIX_EXCEPTIONS.get(system, ()):
            if _within(resolved, _pure(system, exception), system):
                return None
        for root in _POSIX_SYSTEM_ROOTS.get(system, ()):
            if _within(resolved, _pure(system, root), system):
                return SYSTEM_PATH_FORBIDDEN

    if system == "Windows":
        profile_roots = [f"{resolved.drive}\\Users"] if resolved.drive else []
    else:
        profile_roots = list(_PROFILE_ROOTS.get(system, ()))
    for raw_root in profile_roots:
        profiles_root = _pure(system, raw_root)
        if not _within(resolved, profiles_root, system):
            continue
        if _same(resolved, profiles_root, system):
            return SYSTEM_PATH_FORBIDDEN
        first = resolved.parts[len(profiles_root.parts)]
        if first.casefold() not in _SHARED_PROFILE_DIRS:
            return OTHER_USER_HOME_FORBIDDEN

    return None
