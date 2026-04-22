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

"""
BrainCapabilities — Brain capability set, determined by deployment env. Everything revolves around what the Brain can operate.

Hand Types (capability dimensions — what the Brain can reach and control):
- filesystem: operate local files (scope: full | workspace_only | none)
- terminal: execute shell commands
- browser: control browser (CDP)
- mcp: use MCP tool protocol (all | allowlist)

Design principles:
- Brain on local/cloud VM -> full capabilities (extensible: smart home, router, car, etc.)
- Brain in sandbox/Docker -> limited capabilities
- Channel only affects message display format (Markdown/plain/Block Kit), does not determine Brain capabilities
"""

import logging
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from app.component.environment import env

logger = logging.getLogger("hands.capabilities")

# Deployment determines Brain capabilities
DEPLOYMENT_FULL = ("local", "cloud_vm", "")  # full capabilities
DEPLOYMENT_SANDBOX = ("sandbox", "docker", "container")  # limited capabilities


def _is_running_in_docker() -> bool:
    """Detect if Brain runs inside Docker/container."""
    if Path("/.dockerenv").exists():
        return True
    try:
        cgroup = Path("/proc/1/cgroup").read_text()
        return (
            "docker" in cgroup
            or "containerd" in cgroup
            or "kubepods" in cgroup
        )
    except (OSError, FileNotFoundError):
        return False


def _probe_cdp_browser() -> bool:
    """Check if CDP browser is configured/available."""
    if os.environ.get("EIGENT_CDP_URL"):
        return True
    cdp_json = Path.home() / ".eigent" / "cdp.json"
    if cdp_json.exists():
        return True
    # Electron persists CDP pool here; if present, browser capability is likely available.
    cdp_pool = Path.home() / ".eigent" / "cdp-browsers.json"
    return cdp_pool.exists()


def _is_electron_runtime() -> bool:
    """Detect whether Brain is launched by Electron desktop host."""
    return env("EIGENT_RUNTIME", "").lower().strip() == "electron"


def _can_launch_local_cdp_browser() -> bool:
    """Check if local runtime can provision a CDP browser on demand."""
    if os.environ.get("EIGENT_BRAIN_LAUNCH_BROWSER", "true").lower() in (
        "false",
        "0",
        "no",
    ):
        return False
    try:
        from app.utils.browser_launcher import _find_chrome_executable

        return _find_chrome_executable() is not None
    except Exception as e:
        logger.debug(f"Could not probe local browser executable: {e}")
        return False


@dataclass
class BrainCapabilities:
    """
    Brain capability set (detected + config), determined at startup, global singleton.

    Each field maps to a Hand Type: what the Brain can operate.
    """

    has_terminal: bool = True
    """terminal hand: can execute shell"""

    has_browser: bool = False
    """browser hand: can control CDP browser"""

    filesystem_scope: str = "full"
    """filesystem hand: full | workspace_only | none"""

    mcp_mode: str = "all"
    """mcp hand: all | allowlist"""

    mcp_allowlist: list[str] = field(default_factory=list)
    """used when mcp_mode=allowlist"""

    workspace_root: str = "~/.eigent/workspace"
    """workspace root path"""

    deployment_type: str = "local"
    """deployment type (for logging): local | cloud_vm | sandbox | docker"""

    @property
    def mode(self) -> str:
        """capability tier: full | sandbox — for IHands.mode compatibility"""
        return "full" if self._is_full else "sandbox"

    @property
    def _is_full(self) -> bool:
        return self.filesystem_scope == "full" and self.has_terminal


def detect_capabilities(config: dict | None = None) -> BrainCapabilities:
    """
    Detect Brain capabilities, two-layer decision:
    1. Deployment env: EIGENT_DEPLOYMENT_TYPE / Docker auto-detect
    2. Env var overrides: EIGENT_HANDS_*
    """
    cfg = config or {}

    # 1. Deployment env determines base capabilities
    deployment = env("EIGENT_DEPLOYMENT_TYPE") or ""
    deployment = deployment.lower().strip()

    if deployment in DEPLOYMENT_FULL:
        # local/cloud VM -> full capabilities
        in_docker = _is_running_in_docker()
        if in_docker:
            logger.info("Brain running in Docker, using limited capabilities")
            deployment = "docker"
            caps = BrainCapabilities(
                has_terminal=shutil.which("bash") is not None,
                has_browser=False,
                filesystem_scope="workspace_only",
                mcp_mode="all",  # MCP available in all deployment modes
                workspace_root=env("EIGENT_WORKSPACE", "~/.eigent/workspace"),
                deployment_type="docker",
            )
        else:
            # local/desktop: browser hand when CDP is configured/reachable,
            # Electron host is present, or local browser can be provisioned.
            has_browser = _probe_cdp_browser()
            if not has_browser and _is_electron_runtime():
                has_browser = True
            if not has_browser:
                has_browser = _can_launch_local_cdp_browser()
            if not has_browser:
                logger.warning(
                    "Browser capability disabled: no CDP config, "
                    "not running under Electron host, and no launchable browser found."
                )
            caps = BrainCapabilities(
                has_terminal=shutil.which("bash") is not None,
                has_browser=has_browser,
                filesystem_scope="full",
                mcp_mode="all",
                workspace_root=env("EIGENT_WORKSPACE", "~/.eigent/workspace"),
                deployment_type="cloud_vm"
                if deployment == "cloud_vm"
                else "local",
            )
    else:
        # sandbox / docker / container -> limited capabilities
        caps = BrainCapabilities(
            has_terminal=shutil.which("bash") is not None,
            has_browser=False,
            filesystem_scope="workspace_only",
            mcp_mode="all",  # MCP available in all deployment modes
            workspace_root=env("EIGENT_WORKSPACE", "~/.eigent/workspace"),
            deployment_type=deployment or "sandbox",
        )

    # 2. Env var overrides
    if env("EIGENT_HANDS_TERMINAL") is not None:
        caps.has_terminal = env("EIGENT_HANDS_TERMINAL", "true").lower() in (
            "1",
            "true",
            "yes",
        )
    if env("EIGENT_HANDS_BROWSER") is not None:
        caps.has_browser = env("EIGENT_HANDS_BROWSER", "false").lower() in (
            "1",
            "true",
            "yes",
        )
    if env("EIGENT_HANDS_FILESYSTEM") is not None:
        caps.filesystem_scope = env("EIGENT_HANDS_FILESYSTEM", "full")
    if env("EIGENT_HANDS_MCP") is not None:
        caps.mcp_mode = env("EIGENT_HANDS_MCP", "all")
    if env("EIGENT_CDP_URL"):
        caps.has_browser = True

    # 3. Config file overrides
    if "terminal" in cfg:
        caps.has_terminal = bool(cfg["terminal"])
    if "browser" in cfg:
        caps.has_browser = bool(cfg["browser"])
    if "filesystem" in cfg:
        caps.filesystem_scope = str(cfg["filesystem"])
    if "mcp" in cfg:
        caps.mcp_mode = str(cfg["mcp"])
    if "mcp_allowlist" in cfg:
        caps.mcp_allowlist = list(cfg["mcp_allowlist"])

    logger.info(
        "BrainCapabilities detected",
        extra={
            "deployment": caps.deployment_type,
            "mode": caps.mode,
            "terminal": caps.has_terminal,
            "browser": caps.has_browser,
            "filesystem": caps.filesystem_scope,
            "mcp": caps.mcp_mode,
        },
    )
    return caps
