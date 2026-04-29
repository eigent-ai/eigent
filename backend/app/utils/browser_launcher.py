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
Browser launcher for Web mode: ensures a CDP-capable browser is running
when Electron is not available (e.g. web + brain mode).

Previously, Electron provided the CDP browser via remote-debugging-port.
In web mode, Brain launches Chrome/Chromium directly.
"""

import logging
import os
import platform
import socket
import subprocess
from pathlib import Path
from urllib.parse import urlparse

logger = logging.getLogger("browser_launcher")

# Default CDP port (must match browser_port in Chat model)
DEFAULT_CDP_PORT = 9222
LOCAL_CDP_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def is_local_cdp_host(host: str | None) -> bool:
    """Return whether the CDP endpoint host points at the local machine."""
    if not host:
        return True
    return host.lower() in LOCAL_CDP_HOSTS


def normalize_cdp_url(
    cdp_url: str,
    *,
    default_host: str = "127.0.0.1",
    default_port: int = DEFAULT_CDP_PORT,
) -> tuple[str, str, int]:
    """Normalize a CDP endpoint into ``scheme://host:port`` form."""
    parsed = urlparse(cdp_url)
    scheme = parsed.scheme or "http"
    host = parsed.hostname or default_host
    port = parsed.port or default_port
    return f"{scheme}://{host}:{port}", host, port


def is_cdp_url_available(cdp_url: str) -> bool:
    """Check whether a CDP endpoint is reachable."""
    normalized, host, port = normalize_cdp_url(cdp_url)
    if is_local_cdp_host(host):
        return _is_cdp_available(port)

    try:
        import httpx

        r = httpx.get(f"{normalized}/json/version", timeout=2.0)
        return r.status_code == 200
    except Exception:
        return False


def _is_port_in_use(port: int) -> bool:
    """Check if a port is in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def _is_cdp_available(port: int) -> bool:
    """Check if a CDP-capable browser is listening on the port."""
    try:
        import httpx

        r = httpx.get(f"http://127.0.0.1:{port}/json/version", timeout=2.0)
        return r.status_code == 200
    except Exception:
        return False


def _find_chrome_executable() -> str | None:
    """Find Chrome or Chromium executable for launching with CDP."""
    system = platform.system()

    # 1. Try Playwright's Chromium (most reliable, cross-platform)
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            path = p.chromium.executable_path
            if path and Path(path).exists():
                logger.debug(f"Using Playwright Chromium: {path}")
                return path
    except Exception as e:
        logger.debug(f"Playwright Chromium not available: {e}")

    # 2. Platform-specific paths
    if system == "Darwin":
        candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        ]
    elif system == "Linux":
        candidates = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
        ]
    elif system == "Windows":
        candidates = [
            os.path.expandvars(
                r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"
            ),
            os.path.expandvars(
                r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
            ),
        ]
    else:
        candidates = []

    for path in candidates:
        if path and Path(path).exists():
            logger.debug(f"Using system Chrome: {path}")
            return path

    # 3. Try executable from PATH
    for name in ("google-chrome", "chromium", "chromium-browser", "chrome"):
        exe = _which(name)
        if exe:
            return exe

    return None


def _which(name: str) -> str | None:
    """Find executable in PATH."""
    for path in os.environ.get("PATH", "").split(os.pathsep):
        exe = Path(path) / name
        if exe.exists():
            return str(exe)
    return None


def _launch_browser(
    executable: str, port: int, user_data_dir: str
) -> subprocess.Popen | None:
    """Launch browser with CDP enabled. Returns process or None on failure."""
    profile_dir = Path(user_data_dir).expanduser()
    profile_dir.mkdir(parents=True, exist_ok=True)

    args = [
        executable,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
        "about:blank",
    ]

    try:
        proc = subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        logger.info(
            f"[BROWSER LAUNCHER] Launched browser on port {port} (PID={proc.pid})"
        )
        return proc
    except Exception as e:
        logger.error(
            f"[BROWSER LAUNCHER] Failed to launch: {e}", exc_info=True
        )
        return None


def ensure_cdp_browser_available(port: int = DEFAULT_CDP_PORT) -> bool:
    """
    Ensure a CDP-capable browser is running on the given port.

    If no browser is listening, attempts to launch Chrome/Chromium.
    Used in web mode when Electron is not available to provide CDP.

    Returns:
        True if CDP is available (either already running or newly launched),
        False otherwise.
    """
    # Check if auto-launch is disabled
    if os.environ.get("EIGENT_BRAIN_LAUNCH_BROWSER", "true").lower() in (
        "false",
        "0",
        "no",
    ):
        logger.debug("[BROWSER LAUNCHER] Auto-launch disabled by env")
        return _is_cdp_available(port)

    # Already available
    if _is_cdp_available(port):
        logger.debug(
            f"[BROWSER LAUNCHER] CDP already available on port {port}"
        )
        return True

    # Port in use but not CDP (e.g. another service)
    if _is_port_in_use(port):
        logger.warning(
            f"[BROWSER LAUNCHER] Port {port} in use but not CDP. "
            "Another service may be using it."
        )
        return False

    # Launch browser
    executable = _find_chrome_executable()
    if not executable:
        logger.error(
            "[BROWSER LAUNCHER] No Chrome/Chromium found. "
            "Run: playwright install chromium"
        )
        return False

    user_data_dir = os.path.expanduser(
        f"~/.eigent/browser_profiles/cdp_brain_{port}"
    )
    proc = _launch_browser(executable, port, user_data_dir)
    if not proc:
        return False

    # Poll for readiness (max 10s)
    import time

    for _ in range(20):
        time.sleep(0.5)
        if _is_cdp_available(port):
            logger.info(f"[BROWSER LAUNCHER] CDP ready on port {port}")
            return True

    logger.warning(
        "[BROWSER LAUNCHER] Browser launched but CDP not ready after 10s"
    )
    return False
