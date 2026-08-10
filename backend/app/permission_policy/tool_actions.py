"""Code-owned mapping from assembled tools to permission operations."""

from __future__ import annotations

import hashlib
import os
import re
import shlex
from pathlib import Path
from typing import Any

from app.permission_policy.models import ActionDescriptor
from app.run_policy import ToolSafetyClass

_PATH_KEYS = (
    "path",
    "paths",
    "file_path",
    "file_paths",
    "filename",
    "directory",
    "directory_path",
    "folder",
    "folder_path",
    "cwd",
    "working_directory",
    "destination",
    "destination_path",
    "target_path",
    "output_path",
    "image_path",
    "html_file_path",
)
_URL_KEYS = ("url", "target_url", "endpoint")
_COMMAND_KEYS = ("command", "cmd", "script")
_CREDENTIAL_PATH_PARTS = frozenset(
    {".aws", ".azure", ".gnupg", ".kube", ".ssh"}
)
_CONTROL_PLANE_FILENAMES = frozenset(
    {
        "desktop-instance-id",
        "policy.sqlite3",
        "run-journal.sqlite3",
        "run-journal.sqlite3-shm",
        "run-journal.sqlite3-wal",
    }
)
_GIT_EXECUTION_COMMAND_MARKERS = (
    ".git/config",
    ".git\\config",
    ".git/hooks",
    ".git\\hooks",
    "core.hookspath",
)
_AUTO_EXECUTED_WORKSPACE_FILENAMES = frozenset(
    {
        ".envrc",
        "conftest.py",
        "deno.json",
        "deno.jsonc",
        "gnumakefile",
        "gemfile",
        "justfile",
        "makefile",
        "noxfile.py",
        "package.json",
        "pyproject.toml",
        "pytest.ini",
        "rakefile",
        "vagrantfile",
        "procfile",
        "tasks.py",
        "dodo.py",
        "setup.cfg",
        "setup.py",
        "tox.ini",
        "docker-compose.yml",
        "docker-compose.yaml",
        ".pre-commit-config.yaml",
        ".pre-commit-config.yml",
    }
)
_AUTO_EXECUTED_WORKSPACE_PATHS = (
    ".devcontainer/",
    ".github/workflows/",
    ".vscode/launch.json",
    ".vscode/tasks.json",
    "node_modules/.bin/",
)
_COMMAND_WRAPPERS = frozenset({"command", "env", "nohup", "sudo"})
_SHELL_EXECUTABLES = frozenset({"bash", "dash", "ksh", "sh", "zsh"})
_BROWSER_READ_NAMES = frozenset(
    {
        "browser_console_view",
        "browser_get_page_snapshot",
        "browser_sheet_read",
        "get_website_content",
        "read_page",
        "screenshot",
    }
)


def operation_for_tool(
    tool_name: str,
    safety_class: ToolSafetyClass,
    *,
    toolkit_name: str | None = None,
) -> str:
    name = tool_name.strip().lower()
    toolkit = (toolkit_name or "").strip().lower()
    if "workspace git" in toolkit or "workspacegit" in toolkit:
        return (
            "git.read"
            if safety_class is ToolSafetyClass.SAFE_READ
            else "git.local_write"
        )
    if name in _BROWSER_READ_NAMES:
        return "browser.read"
    if "browser" in toolkit or name.startswith("browser_"):
        return "browser.interact"
    if name in {"read_file", "read_files", "view_image"}:
        return "filesystem.read"
    if name in {"delete_file", "remove_file", "unlink"}:
        return "filesystem.delete"
    if "file" in toolkit or name in {"write_file", "edit_file"}:
        return (
            "filesystem.read"
            if safety_class is ToolSafetyClass.SAFE_READ
            else "filesystem.write"
        )
    if "terminal" in toolkit or name in {"shell_exec", "execute_command"}:
        return "terminal.execute"
    if "mcp" in toolkit:
        return (
            "mcp.tool.read"
            if safety_class is ToolSafetyClass.SAFE_READ
            else "mcp.tool.write"
        )
    if "connector" in toolkit:
        return (
            "connector.read"
            if safety_class is ToolSafetyClass.SAFE_READ
            else "connector.write"
        )
    return (
        "mcp.tool.read"
        if safety_class is ToolSafetyClass.SAFE_READ
        else "mcp.tool.write"
    )


def build_tool_action_descriptor(
    *,
    action_id: str,
    tool_name: str,
    toolkit_name: str | None,
    safety_class: ToolSafetyClass,
    arguments: dict[str, Any],
    run_id: str,
    attempt_id: str,
    environment_spec_digest: str,
    idempotency_key: str | None,
    workspace_root: str | Path | None = None,
) -> ActionDescriptor:
    operation = operation_for_tool(
        tool_name, safety_class, toolkit_name=toolkit_name
    )
    resources = _target_resources(
        operation=operation,
        arguments=arguments,
    )
    risk_tags = _risk_tags(
        operation=operation,
        arguments=arguments,
        workspace_root=workspace_root,
    )
    return ActionDescriptor(
        action_id=action_id,
        tool_name=tool_name,
        operation=operation,
        safety_class=safety_class,
        normalized_arguments=dict(arguments),
        target_resources=resources,
        external_side_effect=safety_class is not ToolSafetyClass.SAFE_READ,
        idempotency_key=idempotency_key,
        run_id=run_id,
        attempt_id=attempt_id,
        environment_spec_digest=environment_spec_digest,
        risk_tags=risk_tags,
    )


def _argument_values(
    arguments: dict[str, Any], keys: tuple[str, ...]
) -> tuple[str, ...]:
    values: list[str] = []
    for key in keys:
        value = arguments.get(key)
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            values.extend(str(item) for item in value if item is not None)
        else:
            values.append(str(value))
    return tuple(dict.fromkeys(item for item in values if item.strip()))


def _target_resources(
    *, operation: str, arguments: dict[str, Any]
) -> tuple[str, ...]:
    resources = list(_argument_values(arguments, (*_PATH_KEYS, *_URL_KEYS)))
    if operation == "terminal.execute":
        commands = _canonical_command_resource_texts(arguments)
        resources.extend(
            "terminal-command:sha256:"
            + hashlib.sha256(command.encode("utf-8")).hexdigest()
            for command in commands
        )
    return tuple(dict.fromkeys(resources))


def _canonical_command_resource_texts(
    arguments: dict[str, Any],
) -> tuple[str, ...]:
    """Normalize equivalent string/argv shapes for policy matching only."""

    normalized: list[str] = []
    for command in _argument_values(arguments, _COMMAND_KEYS):
        try:
            normalized.append(shlex.join(shlex.split(command)))
        except ValueError:
            normalized.append(command)
    argv = arguments.get("argv")
    if isinstance(argv, (list, tuple)) and argv:
        normalized.append(shlex.join(str(item) for item in argv))
    return tuple(dict.fromkeys(normalized))


def _command_texts(arguments: dict[str, Any]) -> tuple[str, ...]:
    commands = list(_argument_values(arguments, _COMMAND_KEYS))
    argv = arguments.get("argv")
    if isinstance(argv, (list, tuple)) and argv:
        commands.append(shlex.join(str(item) for item in argv))
    return tuple(dict.fromkeys(commands))


def _command_word_sequences(
    arguments: dict[str, Any],
) -> tuple[tuple[str, ...], ...]:
    sequences: list[tuple[str, ...]] = []
    for command in _argument_values(arguments, _COMMAND_KEYS):
        try:
            words = tuple(shlex.split(command))
        except ValueError:
            words = tuple(command.split())
        if words:
            sequences.extend(_nested_command_sequences(words))
    argv = arguments.get("argv")
    if isinstance(argv, (list, tuple)) and argv:
        sequences.extend(
            _nested_command_sequences(tuple(str(item) for item in argv))
        )
    return tuple(sequences)


def _nested_command_sequences(
    words: tuple[str, ...],
) -> tuple[tuple[str, ...], ...]:
    sequences = [words]
    index = 0
    while index < len(words):
        executable = words[index].replace("\\", "/").rsplit("/", 1)[-1].lower()
        if executable not in _COMMAND_WRAPPERS:
            break
        index += 1
        if executable == "env":
            while index < len(words):
                token = words[index]
                if "=" in token and not token.startswith("-"):
                    index += 1
                    continue
                if not token.startswith("-"):
                    break
                option = token.split("=", 1)[0]
                index += 1
                if (
                    option in {"-u", "--unset", "-C", "--chdir"}
                    and "=" not in token
                ):
                    index += 1
        elif executable == "sudo":
            while index < len(words) and words[index].startswith("-"):
                token = words[index]
                option = token.split("=", 1)[0]
                index += 1
                if (
                    option in {"-u", "--user", "-g", "--group", "-h", "--host"}
                    and "=" not in token
                ):
                    index += 1
        else:
            while index < len(words) and words[index].startswith("-"):
                index += 1
    if index >= len(words):
        return tuple(sequences)
    executable = words[index].replace("\\", "/").rsplit("/", 1)[-1].lower()
    if executable in _SHELL_EXECUTABLES:
        for option_index in range(index + 1, len(words) - 1):
            option = words[option_index]
            if option.startswith("-") and "c" in option[1:]:
                try:
                    nested = tuple(shlex.split(words[option_index + 1]))
                except ValueError:
                    nested = tuple(words[option_index + 1].split())
                if nested:
                    sequences.extend(_nested_command_sequences(nested))
                break
    return tuple(sequences)


def _is_control_plane_word(word: str) -> bool:
    if any(character.isspace() for character in word):
        return False
    compact = re.sub(r"[^a-z0-9_]+", "", word.lower())
    return bool(
        re.search(r"run.*journal.*sqlite", compact)
        or re.search(r"policy.*sqlite", compact)
        or re.search(r"eigent.*local.*control.*capability", compact)
    )


def _is_control_plane_sequence(words: tuple[str, ...]) -> bool:
    if any(_is_control_plane_word(word) for word in words):
        return True
    normalized = [
        re.sub(r"[^a-z0-9_]+", "", word.lower()) for word in words
    ]
    invokes_sqlite = any(
        token == "sqlite3" or token.endswith("sqlite3")
        for token in normalized
    )
    combined = "".join(normalized)
    return invokes_sqlite and (
        "runjournal" in combined
        or "policysqlite" in combined
        or "eigentlocalcontrolcapability" in combined
    )


def _risk_tags(
    *,
    operation: str,
    arguments: dict[str, Any],
    workspace_root: str | Path | None,
) -> tuple[str, ...]:
    if operation not in {
        "filesystem.write",
        "filesystem.delete",
        "terminal.execute",
        "mcp.tool.write",
        "connector.write",
        "skill.script.execute",
    }:
        return ()
    root = (
        Path(workspace_root).expanduser().resolve(strict=False)
        if workspace_root is not None
        else None
    )
    tags: set[str] = set()
    for raw_path in _argument_values(arguments, _PATH_KEYS):
        expanded = Path(os.path.expandvars(raw_path)).expanduser()
        candidate = (
            expanded.resolve(strict=False)
            if expanded.is_absolute() or root is None
            else (root / expanded).resolve(strict=False)
        )
        parts = {part.lower() for part in candidate.parts}
        if root is None or not candidate.is_relative_to(root):
            tags.add("new_filesystem_root")
        if parts & _CREDENTIAL_PATH_PARTS:
            tags.add("credential_export")
        if ".git" in parts and ({"hooks", "config"} & parts):
            tags.add("untrusted_hook")
        if candidate.name.lower() in _AUTO_EXECUTED_WORKSPACE_FILENAMES:
            tags.add("untrusted_script")
        normalized_path = candidate.as_posix().lower()
        if any(
            marker in normalized_path
            for marker in _AUTO_EXECUTED_WORKSPACE_PATHS
        ):
            tags.add("untrusted_script")
        lowered_parts = tuple(part.lower() for part in candidate.parts)
        if ".eigent" in lowered_parts:
            eigent_index = lowered_parts.index(".eigent")
            if (
                len(lowered_parts) > eigent_index + 1
                and lowered_parts[eigent_index + 1] == "skills"
            ):
                tags.add("untrusted_script")
        if ".eigent" in parts and candidate.name.lower() in (
            _CONTROL_PLANE_FILENAMES
        ):
            tags.add("policy_control_plane")
    command_text = (
        "\n".join(_command_texts(arguments)).lower()
        if operation in {"terminal.execute", "skill.script.execute"}
        else ""
    )
    command_sequences = (
        _command_word_sequences(arguments) if command_text else ()
    )
    if command_text:
        if any(
            _is_control_plane_sequence(words) for words in command_sequences
        ):
            tags.add("policy_control_plane")
        if any(
            re.sub(r"[^a-z0-9]+", "", marker)
            in re.sub(r"[^a-z0-9]+", "", word.lower())
            for marker in _GIT_EXECUTION_COMMAND_MARKERS
            for words in command_sequences
            for word in words
        ):
            tags.add("untrusted_hook")
        if any(
            marker in command_text
            for marker in _AUTO_EXECUTED_WORKSPACE_PATHS
        ):
            tags.add("untrusted_script")
        if any(
            f"/{part}/" in command_text or f"~/{part}/" in command_text
            for part in _CREDENTIAL_PATH_PARTS
        ):
            tags.add("credential_export")
    return tuple(sorted(tags))
