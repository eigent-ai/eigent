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
from app.workspace_config import canonical_json

_PATH_KEYS = (
    "path",
    "paths",
    "filepath",
    "file_path",
    "file_paths",
    "filename",
    "directory",
    "directory_path",
    "folder",
    "folder_path",
    "cwd",
    "working_directory",
    "dest",
    "destination",
    "destination_path",
    "target",
    "target_path",
    "output",
    "output_path",
    "image_path",
    "html_file_path",
)
_URL_KEYS = ("url", "target_url", "endpoint")
_COMMAND_KEYS = ("command", "cmd", "script")
_NON_PATH_VALUE_KEYS = frozenset(
    {
        "argv",
        "body",
        "content",
        "data",
        "description",
        "message",
        "payload",
        "prompt",
        "query",
        "text",
    }
)
_CREDENTIAL_PATH_PARTS = frozenset(
    {".aws", ".azure", ".gnupg", ".kube", ".ssh"}
)
_CONTROL_PLANE_FILENAMES = frozenset(
    {
        "desktop-instance-id",
        "policy.sqlite3",
        "policy.sqlite3-journal",
        "policy.sqlite3-shm",
        "policy.sqlite3-wal",
        "run-journal.sqlite3",
        "run-journal.sqlite3-journal",
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
_PRIVILEGE_EXECUTABLES = frozenset({"doas", "pkexec", "sudo"})
_DESTRUCTIVE_EXECUTABLES = frozenset(
    {
        "kill",
        "killall",
        "pkill",
        "reboot",
        "rm",
        "rmdir",
        "shutdown",
        "shred",
        "unlink",
    }
)
_EXTERNAL_ACTION_HINT_KEYS = (
    "action",
    "action_id",
    "action_name",
    "intent",
    "method",
    "operation",
    "operation_name",
)
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
    if safety_class is ToolSafetyClass.INTERNAL_CONTROL:
        return "agent.control"
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
    if not resources and operation in {"mcp.tool.write", "connector.write"}:
        # Opaque MCP/connector calls often have no path or URL to bind a
        # durable rule to. Give them a code-owned, exact tool identity target
        # so the user can allow this one registered tool for a Run or Space
        # without granting every mcp.tool.write operation.
        resources = (
            _opaque_tool_identity_resource(
                operation=operation,
                tool_name=tool_name,
                toolkit_name=toolkit_name,
            ),
        )
    risk_tags = _risk_tags(
        tool_name=tool_name,
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
        external_side_effect=safety_class
        not in {ToolSafetyClass.SAFE_READ, ToolSafetyClass.INTERNAL_CONTROL},
        idempotency_key=idempotency_key,
        run_id=run_id,
        attempt_id=attempt_id,
        environment_spec_digest=environment_spec_digest,
        risk_tags=risk_tags,
    )


def _opaque_tool_identity_resource(
    *, operation: str, tool_name: str, toolkit_name: str | None
) -> str:
    identity = canonical_json(
        {
            "operation": operation,
            "tool_name": tool_name.strip(),
            "toolkit_name": (toolkit_name or "").strip(),
        }
    )
    return (
        "tool-identity:sha256:"
        + hashlib.sha256(identity.encode("utf-8")).hexdigest()
    )


def _argument_values(
    arguments: dict[str, Any], keys: tuple[str, ...]
) -> tuple[str, ...]:
    normalized_keys = {_normalized_argument_key(key) for key in keys}
    values: list[str] = []
    stack: list[dict[str, Any]] = [arguments]
    while stack:
        current = stack.pop()
        for key, value in current.items():
            if isinstance(value, dict):
                stack.append(value)
            elif isinstance(value, (list, tuple)):
                stack.extend(item for item in value if isinstance(item, dict))
            if _normalized_argument_key(key) not in normalized_keys:
                continue
            if isinstance(value, (list, tuple)):
                values.extend(
                    str(item)
                    for item in value
                    if item is not None and not isinstance(item, dict)
                )
            elif value is not None and not isinstance(value, dict):
                values.append(str(value))
    return tuple(dict.fromkeys(item for item in values if item.strip()))


def _argument_string_leaves(
    arguments: dict[str, Any],
) -> tuple[tuple[str, str], ...]:
    """Return nested string leaves with their immediate normalized key.

    Permission targets cannot depend on every toolkit choosing one of a
    finite set of path key spellings. The key is retained only so obvious
    prose/blob fields can be excluded from the structural fallback.
    """

    leaves: list[tuple[str, str]] = []
    stack: list[tuple[str, Any]] = [
        (_normalized_argument_key(key), value)
        for key, value in arguments.items()
    ]
    while stack:
        key, value = stack.pop()
        if isinstance(value, dict):
            stack.extend(
                (_normalized_argument_key(child_key), child_value)
                for child_key, child_value in value.items()
            )
        elif isinstance(value, (list, tuple)):
            stack.extend((key, item) for item in value)
        elif isinstance(value, (str, os.PathLike)):
            text = os.fspath(value).strip()
            if text:
                leaves.append((key, text))
    return tuple(leaves)


def _looks_like_filesystem_path(value: str) -> bool:
    """Conservatively identify a value whose complete value is a path.

    This deliberately does not search prose for path-looking fragments: a
    file body that mentions ``/etc/hosts`` is content, not an action target.
    Unknown argument keys still become targets when their value is an
    absolute/home/relative path, contains a path separator, names a sensitive
    control file, or has a conventional filename suffix.
    """

    text = value.strip().strip("'\"")
    if not text or "\x00" in text or "\n" in text or "\r" in text:
        return False
    if len(text) > 4096 or re.match(r"^[a-z][a-z0-9+.-]*://", text, re.I):
        return False
    normalized = text.replace("\\", "/")
    lowered_name = Path(normalized).name.lower()
    if lowered_name in _CONTROL_PLANE_FILENAMES:
        return True
    if lowered_name in _AUTO_EXECUTED_WORKSPACE_FILENAMES:
        return True
    if any(
        marker in normalized.lower()
        for marker in _AUTO_EXECUTED_WORKSPACE_PATHS
    ):
        return True
    if re.match(
        r"^(?:/|~/|\./|\.\./|\$HOME/|\$\{HOME\}/|[A-Za-z]:/|//)",
        normalized,
    ):
        return True
    has_path_separator = "/" in normalized
    has_whitespace = any(character.isspace() for character in text)
    suffix = Path(lowered_name).suffix
    has_clean_suffix = bool(
        suffix
        and len(suffix) <= 17
        and re.search(r"[a-z]", suffix, re.I)
        and not any(character.isspace() for character in suffix)
    )
    if has_path_separator:
        return not has_whitespace or has_clean_suffix
    return has_clean_suffix and not has_whitespace


def _looks_like_filesystem_key(key: str) -> bool:
    tokens = frozenset(key.split("_"))
    return bool(
        tokens
        & {
            "dir",
            "directory",
            "file",
            "filename",
            "folder",
            "path",
        }
    ) or key in {"cwd", "dest", "destination", "dst", "output", "target"}


def _filesystem_path_values(arguments: dict[str, Any]) -> tuple[str, ...]:
    """Extract explicit and structurally path-like argument values."""

    values = list(_argument_values(arguments, _PATH_KEYS))
    command_keys = {
        _normalized_argument_key(key) for key in (*_COMMAND_KEYS, *_URL_KEYS)
    }
    for key, value in _argument_string_leaves(arguments):
        if key in _NON_PATH_VALUE_KEYS or key in command_keys:
            continue
        if _looks_like_filesystem_key(key) or _looks_like_filesystem_path(
            value
        ):
            values.append(value)
    return tuple(dict.fromkeys(values))


def _normalized_argument_key(value: object) -> str:
    text = str(value).strip()
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", text)
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def _target_resources(
    *, operation: str, arguments: dict[str, Any]
) -> tuple[str, ...]:
    resources = list(_filesystem_path_values(arguments))
    resources.extend(_argument_values(arguments, _URL_KEYS))
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
        executable = (
            words[index].replace(chr(92), "/").rsplit("/", 1)[-1].lower()
        )
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
    executable = words[index].replace(chr(92), "/").rsplit("/", 1)[-1].lower()
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


_SHELL_OPERATOR_TOKEN = re.compile(r"(&&|[|][|]|[;|&])")


def _shell_segments(words: tuple[str, ...]) -> tuple[tuple[str, ...], ...]:
    segments: list[tuple[str, ...]] = []
    current: list[str] = []
    for word in words:
        pieces = _SHELL_OPERATOR_TOKEN.split(word)
        for piece in pieces:
            if not piece:
                continue
            if _SHELL_OPERATOR_TOKEN.fullmatch(piece):
                if current:
                    segments.append(tuple(current))
                    current = []
                continue
            current.append(piece)
    if current:
        segments.append(tuple(current))
    return tuple(segments)


def _expanded_shell_words(
    words: tuple[str, ...],
) -> tuple[tuple[str, ...], ...]:
    assignments: dict[str, str] = {}
    expanded_segments: list[tuple[str, ...]] = []
    for segment in _shell_segments(words):
        expanded: list[str] = []
        for word in segment:
            name, separator, value = word.partition("=")
            if separator and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
                assignments[name] = value
            resolved = word
            for variable, replacement in assignments.items():
                resolved = resolved.replace(f"${{{variable}}}", replacement)
                resolved = resolved.replace(f"${variable}", replacement)
            expanded.append(resolved)
        expanded_segments.append(tuple(expanded))
    return tuple(expanded_segments)


def _is_control_plane_sequence(words: tuple[str, ...]) -> bool:
    expanded_segments = _expanded_shell_words(words)
    in_eigent_directory = False
    for segment in expanded_segments:
        segment_mentions_eigent = any(
            ".eigent" in word.lower().replace(chr(92), "/") for word in segment
        )
        executable = (
            segment[0].lstrip("(").replace(chr(92), "/").rsplit("/", 1)[-1]
            if segment
            else ""
        )
        if executable.lower() in {"cd", "pushd"} and segment_mentions_eigent:
            in_eigent_directory = True
        for word in segment:
            raw = word.lower().replace(chr(92), "/")
            compact = re.sub(r"[^a-z0-9_]+", "", raw)
            if "eigentlocalcontrolcapability" in compact:
                return True
            if ".eigent" not in raw and not in_eigent_directory:
                continue
            if re.search(r"run.*journal.*sqlite", compact) or re.search(
                r"policy.*sqlite", compact
            ):
                return True
    return False


def _auto_executed_path(value: str) -> bool:
    normalized = value.strip('"\x27').replace(chr(92), "/").lower()
    if normalized.rsplit("/", 1)[-1] in _AUTO_EXECUTED_WORKSPACE_FILENAMES:
        return True
    return any(
        marker in normalized for marker in _AUTO_EXECUTED_WORKSPACE_PATHS
    )


def _terminal_executes_untrusted_workspace_code(
    words: tuple[str, ...],
) -> bool:
    for segment in _shell_segments(words):
        if not segment:
            continue
        executable = (
            segment[0].replace(chr(92), "/").rsplit("/", 1)[-1].lower()
        )
        if executable in {"make", "gmake", "pytest", "tox", "nox"}:
            return True
        if executable in {"python", "python3"} and len(segment) >= 3:
            if segment[1:3] == ("-m", "pytest"):
                return True
        for index, token in enumerate(segment):
            if token in {">", ">>", "1>", "1>>"} and index + 1 < len(segment):
                if _auto_executed_path(segment[index + 1]):
                    return True
            if token.startswith(">") and _auto_executed_path(
                token.lstrip(">")
            ):
                return True
    return False


def _terminal_obvious_risk_tags(
    arguments: dict[str, Any],
) -> frozenset[str]:
    """Classify explicit high-risk shell intent without prompting on prose.

    Auto reviewer permits ordinary terminal work, so commands whose argv
    directly expresses deletion, privilege escalation, remote publication or
    downloaded-code execution must remain user-reviewed.
    """

    tags: set[str] = set()
    for words in _command_word_sequences(arguments):
        for segment in _shell_segments(words):
            if not segment:
                continue
            executable = (
                segment[0]
                .lstrip("(")
                .replace(chr(92), "/")
                .rsplit("/", 1)[-1]
                .lower()
            )
            lowered = tuple(word.lower() for word in segment[1:])
            if executable in _PRIVILEGE_EXECUTABLES:
                tags.add("privilege_escalation")
            if executable in _DESTRUCTIVE_EXECUTABLES:
                tags.add("permanent_delete")
            if executable == "git" and lowered:
                subcommand = next(
                    (word for word in lowered if not word.startswith("-")),
                    "",
                )
                if subcommand == "push":
                    tags.add("external_publish")
                if (
                    subcommand == "clean"
                    or (subcommand == "reset" and "--hard" in lowered)
                    or (
                        subcommand == "branch"
                        and any(word in {"-d", "-D"} for word in segment[1:])
                    )
                ):
                    tags.add("permanent_delete")
            if (
                (executable == "npm" and "publish" in lowered)
                or (executable == "cargo" and "publish" in lowered)
                or (executable == "docker" and "push" in lowered)
                or (executable == "twine" and "upload" in lowered)
            ):
                tags.add("external_publish")
            if executable in {"curl", "http", "httpie"} and any(
                word
                in {
                    "-d",
                    "--data",
                    "--data-ascii",
                    "--data-binary",
                    "--data-raw",
                    "-f",
                    "--form",
                    "-t",
                    "--upload-file",
                }
                or word.upper() in {"POST", "PUT", "PATCH", "DELETE"}
                for word in lowered
            ):
                tags.add("external_send")
    command_text = "\n".join(_command_texts(arguments))
    if re.search(r"[|]\s*(?:ba|da|k|z)?sh(?:\s|$)", command_text, re.I):
        tags.add("untrusted_script")
    return frozenset(tags)


def _external_tool_obvious_risk_tags(
    *, tool_name: str, arguments: dict[str, Any]
) -> frozenset[str]:
    """Recognize explicit side-effect verbs in MCP/connector action IDs."""

    hints = [tool_name]
    hints.extend(_argument_values(arguments, _EXTERNAL_ACTION_HINT_KEYS))
    tokens = {
        token
        for hint in hints
        for token in re.split(
            r"[^a-z0-9]+",
            re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", hint).lower(),
        )
        if token
    }
    tags: set[str] = set()
    if tokens & {
        "delete",
        "destroy",
        "purge",
        "remove",
        "revoke",
        "terminate",
    }:
        tags.add("permanent_delete")
    if tokens & {"invite", "notify", "post", "send"}:
        tags.add("external_send")
    if tokens & {"deploy", "publish", "release"}:
        tags.add("external_publish")
    if tokens & {"charge", "finance", "pay", "payment", "purchase", "refund"}:
        tags.add("finance")
    return frozenset(tags)


def _risk_tags(
    *,
    tool_name: str,
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
    for raw_path in _filesystem_path_values(arguments):
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
            _terminal_executes_untrusted_workspace_code(words)
            for words in command_sequences
        ):
            tags.add("untrusted_script")
        if any(
            f"/{part}/" in command_text or f"~/{part}/" in command_text
            for part in _CREDENTIAL_PATH_PARTS
        ):
            tags.add("credential_export")
        tags.update(_terminal_obvious_risk_tags(arguments))
    if operation in {"mcp.tool.write", "connector.write"}:
        tags.update(
            _external_tool_obvious_risk_tags(
                tool_name=tool_name,
                arguments=arguments,
            )
        )
    return tuple(sorted(tags))
