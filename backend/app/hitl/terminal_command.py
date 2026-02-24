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
_SHELL_OPERATOR_RE = re.compile(r"\s*(?:&&|\|\||[;|\n])\s*")

# Regex to detect heredoc start:  <<DELIM  <<'DELIM'  <<"DELIM"  <<-DELIM
_HEREDOC_START_RE = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?")

# Pattern for KEY=VALUE environment variable assignments (e.g. after `env`)
_ENV_VAR_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def _strip_heredoc_bodies(command: str) -> str:
    """Remove heredoc body content from a command string.

    Heredoc bodies are stdin data, not shell commands, so they should
    not be scanned for dangerous tokens.  Only the shell command line
    (before the ``<<DELIM`` operator) is kept.

    Args:
        command: Full shell command string, possibly containing heredocs.

    Returns:
        The command with heredoc bodies removed.
    """
    lines = command.split("\n")
    result_lines: list[str] = []
    heredoc_delim: str | None = None

    for line in lines:
        if heredoc_delim is not None:
            # Inside heredoc body — skip until closing delimiter
            if line.strip() == heredoc_delim:
                heredoc_delim = None
            continue

        match = _HEREDOC_START_RE.search(line)
        if match:
            heredoc_delim = match.group(1)
            # Keep the command portion before the heredoc operator
            result_lines.append(line[: match.start()])
        else:
            result_lines.append(line)

    return "\n".join(result_lines)


def split_compound_command(command: str) -> list[str]:
    """Split a command string on shell operators (&&, ||, ;, |).

    Args:
        command: Shell command string, possibly compound.

    Returns:
        List of individual simple commands.
    """
    return [
        part.strip()
        for part in _SHELL_OPERATOR_RE.split(command)
        if part.strip()
    ]


def extract_effective_command(simple_command: str) -> str | None:
    """Find the effective executable in a simple command.

    Strips wrapper commands (env, nohup, bash …) and path prefixes
    to return the first real command token.

    Args:
        simple_command: A single (non-compound) command string.

    Returns:
        Basename of the effective command, or None if empty.
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
    """Check whether any sub-command is dangerous and requires approval.

    Splits on shell operators, strips heredoc bodies, then checks the
    effective executable of each sub-command against DANGEROUS_COMMAND_TOKENS.

    Args:
        command: Full shell command string, possibly compound.

    Returns:
        True if at least one sub-command is dangerous.
    """
    command = _strip_heredoc_bodies(command)
    for sub_cmd in split_compound_command(command):
        # First non-wrapper token, e.g. "env sudo rm -rf /" → "sudo"
        effective = extract_effective_command(sub_cmd)
        if effective and effective in DANGEROUS_COMMAND_TOKENS:
            return True
    return False


def validate_cd_within_working_dir(
    command: str, working_directory: str
) -> tuple[bool, str | None]:
    """Validate that no ``cd`` sub-command escapes working_directory.

    Args:
        command: Full shell command string, possibly compound.
        working_directory: Allowed root directory.

    Returns:
        (True, None) if allowed, (False, error_message) if not.
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
