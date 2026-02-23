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

"""Command safety utilities for dangerous command detection."""

import os
import re

# Dangerous commands that require user approval (issue #1306)
DANGEROUS_COMMAND_TOKENS = frozenset(
    {
        # System Administration
        "sudo",
        "su",
        "reboot",
        "shutdown",
        "halt",
        "poweroff",
        "init",
        # File System
        "rm",
        "chown",
        "chgrp",
        "chmod",
        "umount",
        "mount",
        # Disk Operations
        "dd",
        "mkfs",
        "fdisk",
        "parted",
        "fsck",
        "mkswap",
        "swapon",
        "swapoff",
        # Process Management
        "service",
        "systemctl",
        "systemd",
        "kill",
        "pkill",
        "killall",
        # Network Configuration
        "iptables",
        "ip6tables",
        "ifconfig",
        "route",
        "iptables-save",
        # Cron/Scheduling
        "crontab",
        "at",
        "batch",
        # User/Kernel Management
        "useradd",
        "userdel",
        "usermod",
        "passwd",
        "chpasswd",
        "newgrp",
        "modprobe",
        "rmmod",
        "insmod",
        "lsmod",
    }
)

# Commands that wrap/prefix the real command
_WRAPPER_COMMANDS = frozenset(
    {
        "env",
        "bash",
        "sh",
        "nohup",
        "time",
        "nice",
        "command",
        "exec",
        "xargs",
    }
)

# Regex to split on shell operators: &&, ||, ;, |
# Note: this is intentionally naive about quoted strings — false positives
# (flagging safe commands) are acceptable for a safety check.
_SHELL_OPERATOR_RE = re.compile(r"\s*(?:&&|\|\||[;|])\s*")

# Pattern for KEY=VALUE environment variable assignments (e.g. after `env`)
_ENV_VAR_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def split_compound_command(command: str) -> list[str]:
    """Split a command string on shell operators (&&, ||, ;, |).

    Returns a list of individual simple commands.
    """
    return [
        part.strip()
        for part in _SHELL_OPERATOR_RE.split(command)
        if part.strip()
    ]


def extract_effective_command(simple_command: str) -> str | None:
    """Given a single (non-compound) command string, strip through wrapper
    commands and path prefixes to find the effective command token.

    Returns the basename of the effective command, or None if empty.
    """
    parts = simple_command.strip().split()
    if not parts:
        return None
    idx = 0
    while idx < len(parts):
        token = parts[idx]
        # Strip surrounding quotes: "rm -> rm
        token = token.strip("\"'")
        # Strip path prefix: /usr/bin/sudo -> sudo
        basename = token.rsplit("/", 1)[-1]
        if basename in _WRAPPER_COMMANDS:
            idx += 1
            # Skip flags and their arguments (e.g. -c "cmd", -n 19),
            # KEY=VALUE pairs (e.g. env FOO=bar), and pure numbers.
            while idx < len(parts):
                arg = parts[idx]
                if arg.startswith("-"):
                    idx += 1
                    # Short flags like -n, -c may take a value argument;
                    # skip the next non-flag token as the argument.
                    if (
                        idx < len(parts)
                        and not parts[idx].startswith("-")
                        and len(arg) == 2
                    ):
                        idx += 1
                elif _ENV_VAR_RE.match(arg):
                    idx += 1
                else:
                    break
            continue
        return basename
    return None


def is_dangerous_command(command: str) -> bool:
    """Return True if any sub-command in a (possibly compound) command
    is considered dangerous and requires user approval.

    Scans ALL tokens in each sub-command for dangerous command names.
    This is intentionally conservative — false positives (e.g. ``echo rm``)
    are acceptable because the user simply clicks "approve", whereas false
    negatives would let dangerous commands run without approval.
    """
    for sub_cmd in split_compound_command(command):
        for token in sub_cmd.strip().split():
            # Strip quotes and path prefix
            cleaned = token.strip("\"'")
            basename = cleaned.rsplit("/", 1)[-1]
            if basename in DANGEROUS_COMMAND_TOKENS:
                return True
    return False


def validate_cd_within_working_dir(
    command: str, working_directory: str
) -> tuple[bool, str | None]:
    """Validate that no cd sub-command in a (possibly compound) command
    escapes working_directory.

    Returns (True, None) if allowed, (False, error_message) if not.
    """
    for sub_cmd in split_compound_command(command):
        parts = sub_cmd.strip().split()
        if not parts:
            continue
        # Check if this sub-command is a cd
        basename = parts[0].rsplit("/", 1)[-1]
        if basename != "cd":
            continue
        target = parts[1] if len(parts) > 1 else ""
        # cd with no args or "cd ~" -> home; treat as potential escape
        if not target or target == "~":
            target = os.path.expanduser("~")
        elif target == "-":
            # "cd -" is previous dir; cannot validate statically, allow it
            continue
        try:
            work_real = os.path.realpath(os.path.abspath(working_directory))
            if os.path.isabs(target):
                resolved = os.path.realpath(os.path.abspath(target))
            else:
                resolved = os.path.realpath(
                    os.path.abspath(os.path.join(work_real, target))
                )
            if os.path.commonpath([resolved, work_real]) != work_real:
                return (
                    False,
                    f"cd not allowed: path would escape working directory "
                    f"({working_directory}).",
                )
        except (OSError, ValueError):
            return False, "cd not allowed: invalid path."
    return True, None
