"""Code-owned mapping from assembled tools to permission operations."""

from __future__ import annotations

import hashlib
import os
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
        commands = _argument_values(arguments, _COMMAND_KEYS)
        resources.extend(
            "terminal-command:sha256:"
            + hashlib.sha256(command.encode("utf-8")).hexdigest()
            for command in commands
        )
    return tuple(dict.fromkeys(resources))


def _risk_tags(
    *,
    operation: str,
    arguments: dict[str, Any],
    workspace_root: str | Path | None,
) -> tuple[str, ...]:
    if operation not in {"filesystem.write", "filesystem.delete"}:
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
        if ".git" in parts and "hooks" in parts:
            tags.add("untrusted_hook")
        if ".eigent" in parts:
            tags.add("policy_control_plane")
    return tuple(sorted(tags))
