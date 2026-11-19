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

import json
import logging
from pathlib import Path

logger = logging.getLogger("mcp_config")

MCP_CONFIG_DIR = Path.home() / ".eigent"
MCP_CONFIG_PATH = MCP_CONFIG_DIR / "mcp.json"


def _normalize_args(args) -> list[str]:
    """Normalize args to list of strings."""
    if args is None:
        return []
    if isinstance(args, str):
        try:
            parsed = json.loads(args)
            return (
                [str(x) for x in parsed]
                if isinstance(parsed, list)
                else [args]
            )
        except json.JSONDecodeError:
            return [x.strip() for x in args.split(",") if x.strip()]
    if isinstance(args, list):
        return [str(x) for x in args]
    return []


def _normalize_mcp(mcp: dict) -> dict:
    """Normalize MCP server config."""
    out = dict(mcp)
    if "args" in out:
        out["args"] = _normalize_args(out["args"])
    return out


def get_mcp_config_path() -> Path:
    return MCP_CONFIG_PATH


def read_mcp_config() -> dict:
    """Read MCP config from ~/.eigent/mcp.json."""
    if not MCP_CONFIG_PATH.exists():
        default = {"mcpServers": {}}
        write_mcp_config(default)
        return default
    try:
        data = MCP_CONFIG_PATH.read_text(encoding="utf-8")
        parsed = json.loads(data)
        if not isinstance(parsed.get("mcpServers"), dict):
            return {"mcpServers": {}}
        for name, server in parsed["mcpServers"].items():
            if isinstance(server, dict):
                parsed["mcpServers"][name] = _normalize_mcp(server)
        return parsed
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to read MCP config: %s, using default", e)
        return {"mcpServers": {}}


def write_mcp_config(config: dict) -> None:
    """Write MCP config to ~/.eigent/mcp.json."""
    MCP_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    MCP_CONFIG_PATH.write_text(
        json.dumps(config, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def add_mcp(name: str, mcp: dict) -> None:
    """Add MCP server to config."""
    config = read_mcp_config()
    if name not in config["mcpServers"]:
        config["mcpServers"][name] = _normalize_mcp(mcp)
        write_mcp_config(config)


def remove_mcp(name: str) -> None:
    """Remove MCP server from config."""
    config = read_mcp_config()
    if name in config["mcpServers"]:
        del config["mcpServers"][name]
        write_mcp_config(config)


def update_mcp(name: str, mcp: dict) -> None:
    """Update MCP server in config."""
    config = read_mcp_config()
    config["mcpServers"][name] = _normalize_mcp(mcp)
    write_mcp_config(config)
