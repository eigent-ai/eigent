"""Code-owned mapping from assembled tools to permission operations."""

from __future__ import annotations

from typing import Any

from app.permission_policy.models import ActionDescriptor
from app.run_policy import ToolSafetyClass

_PATH_KEYS = ("path", "file_path", "directory", "cwd", "working_directory")
_URL_KEYS = ("url", "target_url", "endpoint")
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
) -> ActionDescriptor:
    resources = tuple(
        str(arguments[key])
        for key in (*_PATH_KEYS, *_URL_KEYS)
        if arguments.get(key) is not None
    )
    return ActionDescriptor(
        action_id=action_id,
        tool_name=tool_name,
        operation=operation_for_tool(
            tool_name, safety_class, toolkit_name=toolkit_name
        ),
        safety_class=safety_class,
        normalized_arguments=dict(arguments),
        target_resources=resources,
        external_side_effect=safety_class is not ToolSafetyClass.SAFE_READ,
        idempotency_key=idempotency_key,
        run_id=run_id,
        attempt_id=attempt_id,
        environment_spec_digest=environment_spec_digest,
    )
