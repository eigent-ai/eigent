from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from app.workspace_bundle import mcp_destination
from app.workspace_bundle.mcp_destination import (
    McpDestinationError,
    inspect_bundle_mcp_destination,
)
from app.workspace_config import canonical_digest


def _inspect(server: dict, *, secret_slots: tuple[str, ...] = ()):
    content = json.dumps({"mcpServers": {"demo": server}}).encode()
    return inspect_bundle_mcp_destination(
        revision_id="bundle@1",
        mcp_id="demo",
        definition_ref="bundle://mcp/demo.json",
        definition_digest=hashlib.sha256(content).hexdigest(),
        content=content,
        secret_slots=secret_slots,
    )


def test_npx_symlink_cannot_bypass_exact_package_requirement(
    tmp_path: Path,
    monkeypatch,
):
    target = tmp_path / "npm-cli.js"
    target.write_text("#!/bin/sh\n", encoding="utf-8")
    target.chmod(0o755)
    alias = tmp_path / "npx"
    alias.symlink_to(target)
    monkeypatch.setattr(
        mcp_destination.shutil,
        "which",
        lambda command: str(alias) if command == "npx" else None,
    )

    unpinned = _inspect(
        {
            "command": "npx",
            "args": ["some-package"],
            "env": {"TOKEN": "slot://TOKEN"},
        },
        secret_slots=("TOKEN",),
    )
    assert unpinned["attestation_digest"] is None
    assert unpinned["availability_issue"] == "mcp_destination_unpinned"

    pinned = _inspect(
        {
            "command": "npx",
            "args": ["some-package@1.2.3"],
            "env": {"TOKEN": "slot://TOKEN"},
        },
        secret_slots=("TOKEN",),
    )
    assert pinned["attestation_digest"]
    assert pinned["executable_command"] == str(target.resolve())


@pytest.mark.parametrize(
    "server",
    [
        {"command": "python\nrm", "args": []},
        {"command": "python", "args": ["hello\x00world"]},
        {"command": "python", "env": {"BAD-NAME": "value"}},
        {"url": "https://example.test/mcp", "headers": {"Bad Header": "x"}},
    ],
)
def test_destination_rejects_control_characters_and_invalid_sink_names(server):
    with pytest.raises(McpDestinationError):
        _inspect(server)


def test_public_headers_are_disclosed_by_name_and_digest_only():
    destination = _inspect(
        {
            "url": "https://example.test/mcp",
            "headers": {
                "X-Workspace": "public-workspace",
                "Authorization": "slot://TOKEN",
            },
        },
        secret_slots=("TOKEN",),
    )

    assert destination["destination_kind"] == "http_secret_unavailable"
    assert destination["availability_issue"] == (
        "mcp_secret_http_transport_unavailable"
    )
    assert destination["public_headers"] == [
        {
            "name": "X-Workspace",
            "value_digest": canonical_digest("public-workspace"),
        }
    ]
    assert "public-workspace" not in repr(destination)
