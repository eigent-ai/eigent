"""Secret-free MCP destination review and attestation contracts."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import unicodedata
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from app.workspace_config import canonical_digest

MCP_DESTINATION_ATTESTATION_PREFIX = "__eigent_mcp_destination_attestation_v1:"
MCP_SECRET_BINDING_ATTESTATION_PREFIX = "__eigent_mcp_secret_bindings_v1:"
MAX_MCP_ARGUMENTS = 64
MAX_MCP_ARGUMENT_CHARS = 512
_ENVIRONMENT_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
_HEADER_NAME = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")


class McpDestinationError(ValueError):
    pass


def attestation_grant(digest: str) -> str:
    if len(digest) != 64 or set(digest) - set("0123456789abcdef"):
        raise McpDestinationError("MCP destination attestation is invalid")
    return MCP_DESTINATION_ATTESTATION_PREFIX + digest


def attestation_from_grants(grants: tuple[str, ...] | list[str]) -> str | None:
    matches = [
        item.removeprefix(MCP_DESTINATION_ATTESTATION_PREFIX)
        for item in grants
        if item.startswith(MCP_DESTINATION_ATTESTATION_PREFIX)
    ]
    if len(matches) != 1:
        return None
    try:
        attestation_grant(matches[0])
    except McpDestinationError:
        return None
    return matches[0]


def secret_binding_grant(digest: str) -> str:
    if len(digest) != 64 or set(digest) - set("0123456789abcdef"):
        raise McpDestinationError("MCP secret binding attestation is invalid")
    return MCP_SECRET_BINDING_ATTESTATION_PREFIX + digest


def secret_binding_attestation_from_grants(
    grants: tuple[str, ...] | list[str],
) -> str | None:
    matches = [
        item.removeprefix(MCP_SECRET_BINDING_ATTESTATION_PREFIX)
        for item in grants
        if item.startswith(MCP_SECRET_BINDING_ATTESTATION_PREFIX)
    ]
    if len(matches) != 1:
        return None
    try:
        secret_binding_grant(matches[0])
    except McpDestinationError:
        return None
    return matches[0]


def secret_binding_attestation(
    *,
    mcp_id: str,
    bindings: list[dict[str, Any]],
) -> str:
    prefix = f"mcp_secret:{mcp_id}:"
    normalized = sorted(
        (
            {
                "requirement_key": str(item["requirement_key"]),
                "secret_ref": str(item["secret_ref"]),
                "binding_version": int(item["binding_version"]),
                "account_scope_digest": str(item["account_scope_digest"]),
            }
            for item in bindings
            if str(item.get("requirement_key", "")).startswith(prefix)
        ),
        key=lambda item: item["requirement_key"],
    )
    return canonical_digest({"mcp_id": mcp_id, "bindings": normalized})


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _contains_control(value: str) -> bool:
    return any(unicodedata.category(character) == "Cc" for character in value)


def _has_exact_package_pin(invoked_name: str, args: list[str]) -> bool:
    package_args = [item for item in args if not item.startswith("-")]
    if invoked_name == "uvx":
        return any(
            re.fullmatch(r"[^=\s]+==[^*<>=~!,\s]+", item) is not None
            for item in package_args
        )
    for item in package_args:
        separator = item.rfind("@")
        if separator <= 0:
            continue
        version = item[separator + 1 :]
        if re.fullmatch(
            r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?",
            version,
        ):
            return True
    return False


def _system_executable(command: str, args: list[str]) -> dict[str, Any] | None:
    candidate = command if os.path.isabs(command) else shutil.which(command)
    if not candidate:
        return None
    try:
        path = Path(candidate).resolve(strict=True)
        if not path.is_file() or not os.access(path, os.X_OK):
            return None
        invoked_name = Path(command).name or Path(candidate).name
        if invoked_name in {"npx", "uvx"} and not _has_exact_package_pin(
            invoked_name, args
        ):
            return None
        stat = path.stat()
        return {
            "path": str(path),
            "digest": _file_digest(path),
            "stat_identity": {
                "device": stat.st_dev,
                "inode": stat.st_ino,
                "size": stat.st_size,
                "mtime_ns": stat.st_mtime_ns,
            },
        }
    except OSError:
        return None


def registry_unavailable_destination(
    *,
    mcp_id: str,
    definition_ref: str,
    secret_slots: tuple[str, ...],
) -> dict[str, Any]:
    return {
        "mcp_id": mcp_id,
        "definition_ref": definition_ref,
        "definition_digest": None,
        "destination_kind": "registry_unavailable",
        "executable_command": None,
        "argument_preview": [],
        "cwd_scope": None,
        "public_environment": [],
        "public_headers": [],
        "endpoint_url": None,
        "secret_slots": sorted(secret_slots),
        "secret_environment_bindings": [],
        "attestation_digest": None,
        "requires_secret_confirmation": bool(secret_slots),
        "availability_issue": "registry_mcp_unmaterialized",
    }


def inspect_bundle_mcp_destination(
    *,
    revision_id: str,
    mcp_id: str,
    definition_ref: str,
    definition_digest: str,
    content: bytes,
    secret_slots: tuple[str, ...],
    executable_assets_by_ref: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if hashlib.sha256(content).hexdigest() != definition_digest:
        raise McpDestinationError("MCP definition digest mismatch")
    try:
        document = json.loads(content)
        server = document["mcpServers"][mcp_id]
    except Exception as exc:
        raise McpDestinationError("MCP definition is invalid") from exc
    if not isinstance(server, dict):
        raise McpDestinationError("MCP definition is invalid")

    declared_slots = set(secret_slots)
    mappings: list[dict[str, str]] = []
    public_environment: list[dict[str, Any]] = []
    public_headers: list[dict[str, Any]] = []
    for category in ("env", "headers"):
        values = server.get(category, {})
        if not isinstance(values, dict):
            raise McpDestinationError("MCP destination mapping is invalid")
        for name, value in values.items():
            if (
                not isinstance(name, str)
                or not isinstance(value, str)
                or _contains_control(name)
            ):
                raise McpDestinationError("MCP destination mapping is invalid")
            if category == "env" and not _ENVIRONMENT_NAME.fullmatch(name):
                raise McpDestinationError(
                    "MCP environment variable name is invalid"
                )
            if category == "headers" and not _HEADER_NAME.fullmatch(name):
                raise McpDestinationError("MCP header name is invalid")
            if not value.startswith("slot://"):
                if len(value) > 4096:
                    raise McpDestinationError(
                        "MCP public destination value is invalid"
                    )
                # Values are deliberately never persisted in the review
                # descriptor. The UI only needs to disclose that a public
                # value is configured; the digest binds it without revealing
                # it.
                public_value = {
                    "name": name,
                    "value_digest": canonical_digest(value),
                }
                if category == "env":
                    public_environment.append(public_value)
                else:
                    public_headers.append(public_value)
                continue
            slot = value.removeprefix("slot://")
            if slot not in declared_slots:
                raise McpDestinationError(
                    "MCP destination references an undeclared secret slot"
                )
            mappings.append({"category": category, "name": name, "slot": slot})
    if {item["slot"] for item in mappings} != declared_slots:
        raise McpDestinationError(
            "MCP destination does not map every declared secret slot"
        )

    command = server.get("command")
    endpoint = server.get("url")
    if bool(command) == bool(endpoint):
        raise McpDestinationError(
            "MCP destination must declare exactly one command or URL"
        )
    executable_command: str | None = None
    executable_asset_ref: str | None = None
    executable_digest: str | None = None
    executable_stat_identity: dict[str, int] | None = None
    argument_preview: list[str] = []
    cwd_scope: str | None = None
    endpoint_url: str | None = None
    if command:
        if (
            not isinstance(command, str)
            or len(command) > 4096
            or _contains_control(command)
        ):
            raise McpDestinationError("MCP executable command is invalid")
        args = server.get("args", [])
        if (
            not isinstance(args, list)
            or len(args) > MAX_MCP_ARGUMENTS
            or any(
                not isinstance(item, str)
                or len(item) > MAX_MCP_ARGUMENT_CHARS
                or _contains_control(item)
                for item in args
            )
        ):
            raise McpDestinationError("MCP argument list is invalid")
        executable_command = command
        argument_preview = list(args)
        destination_kind = "stdio"
        definition_relative = PurePosixPath(
            definition_ref.removeprefix("bundle://")
        )
        cwd = server.get("cwd")
        if cwd is None:
            cwd_relative = definition_relative.parent
        elif isinstance(cwd, str) and cwd.startswith("${PLUGIN_ROOT}"):
            suffix = cwd.removeprefix("${PLUGIN_ROOT}").lstrip("/")
            cwd_relative = definition_relative.parent / suffix
        elif isinstance(cwd, str) and not PurePosixPath(cwd).is_absolute():
            cwd_relative = definition_relative.parent / cwd
        else:
            raise McpDestinationError("MCP working directory is invalid")
        if any(part in {"", ".", ".."} for part in cwd_relative.parts):
            raise McpDestinationError("MCP working directory is invalid")
        cwd_scope = f"bundle://{cwd_relative.as_posix()}"
        executable_relative: PurePosixPath | None = None
        if command.startswith("${PLUGIN_ROOT}/"):
            executable_relative = (
                definition_relative.parent
                / command.removeprefix("${PLUGIN_ROOT}/")
            )
        elif command.startswith("./"):
            executable_relative = definition_relative.parent / command[2:]
        if executable_relative is not None:
            if any(
                part in {"", ".", ".."} for part in executable_relative.parts
            ):
                raise McpDestinationError(
                    "MCP executable asset path is invalid"
                )
            executable_asset_ref = f"bundle://{executable_relative.as_posix()}"
            executable_asset = (executable_assets_by_ref or {}).get(
                executable_asset_ref
            )
            if executable_asset and executable_asset.get("executable") is True:
                executable_digest = str(executable_asset.get("content_digest"))
        if executable_asset_ref is None:
            system = _system_executable(command, argument_preview)
            if system is not None:
                executable_command = system["path"]
                executable_digest = system["digest"]
                executable_stat_identity = system["stat_identity"]
    else:
        if not isinstance(endpoint, str) or len(endpoint) > 4096:
            raise McpDestinationError("MCP endpoint URL is invalid")
        parsed = urlsplit(endpoint)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise McpDestinationError(
                "MCP endpoint must not contain credentials, query, or fragment"
            )
        host = parsed.hostname.lower()
        port = f":{parsed.port}" if parsed.port is not None else ""
        endpoint_url = urlunsplit(
            (parsed.scheme.lower(), host + port, parsed.path or "/", "", "")
        )
        destination_kind = "http"

    header_secrets = [
        item for item in mappings if item["category"] == "headers"
    ]
    stable_stdio = bool(executable_digest)
    availability_issue: str | None = None
    if secret_slots and (destination_kind != "stdio" or header_secrets):
        destination_kind = "http_secret_unavailable"
        availability_issue = "mcp_secret_http_transport_unavailable"
    elif secret_slots and not stable_stdio:
        destination_kind = "stdio_unstable"
        availability_issue = "mcp_destination_unpinned"

    descriptor = {
        "revision_id": revision_id,
        "mcp_id": mcp_id,
        "definition_ref": definition_ref,
        "definition_digest": definition_digest,
        "destination_kind": destination_kind,
        "executable_command": executable_command,
        "executable_asset_ref": executable_asset_ref,
        "executable_digest": executable_digest,
        "executable_stat_identity": executable_stat_identity,
        "argument_preview": argument_preview,
        "cwd_scope": cwd_scope,
        "public_environment": sorted(
            public_environment,
            key=lambda item: item["name"],
        ),
        "public_headers": sorted(
            public_headers,
            key=lambda item: item["name"],
        ),
        "endpoint_url": endpoint_url,
        "secret_slots": sorted(declared_slots),
        "secret_environment_bindings": sorted(
            (
                {
                    "slot_id": item["slot"],
                    "environment_variable": item["name"],
                }
                for item in mappings
                if item["category"] == "env"
            ),
            key=lambda item: (
                item["slot_id"],
                item["environment_variable"],
            ),
        ),
    }
    attestation_digest = (
        canonical_digest(descriptor) if availability_issue is None else None
    )
    return {
        **{
            key: value
            for key, value in descriptor.items()
            if key != "revision_id"
        },
        "attestation_digest": attestation_digest,
        "requires_secret_confirmation": bool(secret_slots),
        "availability_issue": availability_issue,
    }
