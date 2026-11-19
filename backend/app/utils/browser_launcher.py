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

import json
import logging
import os
import platform
import socket
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import quote, urlparse

logger = logging.getLogger("browser_launcher")

# Default CDP port (must match browser_port in Chat model)
DEFAULT_CDP_PORT = 9222
FALLBACK_CDP_PORT_START = 9223
FALLBACK_CDP_PORT_END = 9299
LOCAL_CDP_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
EIGENT_EMBEDDED_BROWSER_TARGET_PREFIX = "about:blank#eigent-browser-toolkit="
_embedded_target_claim_lock = threading.Lock()


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
    raw_url = cdp_url.strip()
    if raw_url.isdigit():
        port = int(raw_url)
        return f"http://{default_host}:{port}", default_host, port

    parsed = urlparse(raw_url if "://" in raw_url else f"http://{raw_url}")
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
        if r.status_code != 200:
            return False
        return _is_supported_cdp_version(r.json(), normalized)
    except Exception:
        return False


def _embedded_browser_targets(cdp_url: str) -> list[dict]:
    normalized, host, _ = normalize_cdp_url(cdp_url)
    if not is_local_cdp_host(host):
        return []
    try:
        import httpx

        response = httpx.get(f"{normalized}/json/list", timeout=2.0)
        if response.status_code != 200:
            return []
        targets = response.json()
    except Exception:
        return []
    if not isinstance(targets, list):
        return []
    return [target for target in targets if isinstance(target, dict)]


def has_eigent_embedded_browser_target(
    cdp_url: str,
    target_url: str | None = None,
) -> bool:
    """Return whether Electron exposes an Eigent-owned browser WebView.

    Electron's debugging endpoint also exposes the main Eigent renderer.  A
    reachable CDP socket alone is therefore not sufficient authorization for
    Browser Toolkit: the host must have pre-created a browser WebContentsView
    in the isolated ``persist:user_login`` partition.  Those views use the
    marker URL below until assigned and navigated by a browser session.
    """

    if target_url is not None and not target_url.startswith(
        EIGENT_EMBEDDED_BROWSER_TARGET_PREFIX
    ):
        return False
    return any(
        target.get("type") in {"page", "webview"}
        and (
            str(target.get("url") or "") == target_url
            if target_url is not None
            else str(target.get("url") or "").startswith(
                EIGENT_EMBEDDED_BROWSER_TARGET_PREFIX
            )
        )
        for target in _embedded_browser_targets(cdp_url)
    )


def _is_camel_blank_target_url(url: str) -> bool:
    """Mirror the upstream Browser Toolkit's generic blank-page matcher."""
    return (
        url == ""
        or url == "about:blank"
        or url.startswith("about:blank?")
        or url.startswith("data:")
    )


def claim_eigent_embedded_browser_target(
    cdp_url: str,
    target_url: str,
    session_id: str,
) -> str:
    """Atomically convert one exact Electron WebView into a session target.

    Electron's global CDP endpoint also exposes the Eigent renderer.  The
    Browser Toolkit must therefore never select the first page.  Unclaimed
    WebViews use a hash marker which upstream CAMEL does not regard as a blank
    page.  Under a process-wide bring-up lock we navigate the exact page-level
    CDP target to one unique query marker; it becomes the only blank candidate
    that CAMEL may adopt for this session.
    """

    normalized, host, _ = normalize_cdp_url(cdp_url)
    if not is_local_cdp_host(host):
        raise RuntimeError("Electron embedded browser CDP must be local")
    if not target_url.startswith(EIGENT_EMBEDDED_BROWSER_TARGET_PREFIX):
        raise RuntimeError("Invalid Electron embedded browser target marker")

    claimed_url = (
        f"about:blank?eigent_browser_session={quote(str(session_id), safe='')}"
    )
    with _embedded_target_claim_lock:
        targets = _embedded_browser_targets(normalized)
        target = next(
            (
                item
                for item in targets
                if item.get("type") in {"page", "webview"}
                and str(item.get("url") or "") == target_url
            ),
            None,
        )
        if target is None:
            raise RuntimeError(
                "Reserved Electron browser target is no longer available"
            )

        ambiguous = [
            str(item.get("url") or "")
            for item in targets
            if item is not target
            and item.get("type") in {"page", "webview"}
            and _is_camel_blank_target_url(str(item.get("url") or ""))
        ]
        if ambiguous:
            raise RuntimeError(
                "Electron CDP exposes an ambiguous blank target; refusing "
                "to risk attaching Browser Toolkit to the wrong page"
            )

        websocket_url = str(target.get("webSocketDebuggerUrl") or "")
        if not websocket_url:
            raise RuntimeError(
                "Reserved Electron browser target has no page CDP socket"
            )

        from websockets.sync.client import connect

        command = {
            "id": 1,
            "method": "Page.navigate",
            "params": {"url": claimed_url},
        }
        with connect(
            websocket_url,
            open_timeout=2,
            close_timeout=1,
        ) as websocket:
            websocket.send(json.dumps(command))
            while True:
                response = json.loads(websocket.recv(timeout=2))
                if response.get("id") == 1:
                    break
        if response.get("error"):
            raise RuntimeError(
                "Could not claim reserved Electron browser target"
            )

        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline:
            if any(
                item.get("type") in {"page", "webview"}
                and str(item.get("url") or "") == claimed_url
                for item in _embedded_browser_targets(normalized)
            ):
                return claimed_url
            time.sleep(0.02)

    raise RuntimeError("Electron browser target claim did not become visible")


def _is_port_in_use(port: int) -> bool:
    """Check if a port is in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def _is_cdp_available(port: int) -> bool:
    """Check if a Playwright-compatible CDP browser is listening."""
    try:
        import httpx

        r = httpx.get(f"http://127.0.0.1:{port}/json/version", timeout=2.0)
        if r.status_code != 200:
            return False
        return _is_supported_cdp_version(r.json(), f"http://127.0.0.1:{port}")
    except Exception:
        return False


def _is_supported_cdp_version(data: dict, endpoint: str) -> bool:
    """Reject CDP endpoints that Playwright cannot manage."""
    browser = str(data.get("Browser") or "")
    user_agent = str(data.get("User-Agent") or "")
    websocket_url = data.get("webSocketDebuggerUrl")
    combined = f"{browser} {user_agent}"

    if not websocket_url:
        logger.debug(
            "[BROWSER LAUNCHER] CDP endpoint has no browser websocket"
        )
        return False

    if "Electron" in combined:
        logger.warning(
            "[BROWSER LAUNCHER] Ignoring Electron DevTools endpoint at %s; "
            "Browser Agent requires a managed Chrome/Chromium CDP browser.",
            endpoint,
        )
        return False

    if not any(
        token in combined
        for token in ("Chrome/", "Chromium", "HeadlessChrome/")
    ):
        logger.warning(
            "[BROWSER LAUNCHER] Ignoring unsupported CDP endpoint at %s: %s",
            endpoint,
            browser or user_agent or "unknown browser",
        )
        return False

    if not _supports_browser_context_management(str(websocket_url), endpoint):
        return False

    return True


def _supports_browser_context_management(
    websocket_url: str,
    endpoint: str,
) -> bool:
    """Probe the browser-level CDP socket for Playwright compatibility."""
    try:
        from websockets.sync.client import connect

        command = {
            "id": 1,
            "method": "Browser.setDownloadBehavior",
            "params": {"behavior": "default"},
        }
        with connect(websocket_url, open_timeout=2, close_timeout=1) as ws:
            ws.send(json.dumps(command))
            response = json.loads(ws.recv(timeout=2))
    except Exception as exc:
        logger.warning(
            "[BROWSER LAUNCHER] Could not validate CDP capabilities at %s: %s",
            endpoint,
            exc,
        )
        return False

    error = response.get("error")
    if error:
        message = error.get("message") if isinstance(error, dict) else error
        logger.warning(
            "[BROWSER LAUNCHER] Ignoring CDP endpoint at %s; "
            "it does not support browser context management: %s",
            endpoint,
            message,
        )
        return False

    return True


def _candidate_ports(preferred_port: int):
    yield preferred_port
    for port in range(FALLBACK_CDP_PORT_START, FALLBACK_CDP_PORT_END + 1):
        if port != preferred_port:
            yield port


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


def ensure_cdp_browser_endpoint(
    preferred_port: int = DEFAULT_CDP_PORT,
) -> str | None:
    """
    Ensure a managed CDP browser exists and return its endpoint.

    If the preferred port is occupied by Electron's own DevTools endpoint, use
    the next available local port instead of handing that endpoint to
    Playwright.
    """
    for port in _candidate_ports(preferred_port):
        if _is_cdp_available(port):
            return f"http://127.0.0.1:{port}"

        if _is_port_in_use(port):
            logger.warning(
                "[BROWSER LAUNCHER] Port %s is occupied by a non-managed "
                "or unsupported CDP endpoint; trying another port.",
                port,
            )
            continue

        if ensure_cdp_browser_available(port):
            return f"http://127.0.0.1:{port}"

    logger.error(
        "[BROWSER LAUNCHER] No available CDP browser port in %s-%s",
        preferred_port,
        FALLBACK_CDP_PORT_END,
    )
    return None
