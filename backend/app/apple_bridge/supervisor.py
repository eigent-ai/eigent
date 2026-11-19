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

"""Starts, watches and talks to the Apple Intelligence bridge.

The bridge is started on first need, never at backend startup. The backend
hands it a random token on stdin and keeps stdin open; the bridge prints its
port, serves only requests carrying the token, and exits when stdin closes or
after ten idle minutes.
"""

from __future__ import annotations

import atexit
import logging
import secrets
import subprocess  # nosec B404 -- starts the bundled bridge binary, no shell
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final

import httpx

from app.apple_bridge.platform_support import (
    BRIDGE_MISSING,
    NOT_APPLE_SILICON,
    NOT_MACOS,
    ON_DEVICE_MODEL,
    PROVIDER_ID,
    bridge_binary_path,
    platform_unsupported_reason,
)

logger = logging.getLogger("apple_bridge")

BRIDGE_UNAVAILABLE: Final = "bridge_unavailable"

UNAVAILABLE_MESSAGES: Final[dict[str, str]] = {
    NOT_MACOS: "Apple Intelligence is only available on macOS.",
    NOT_APPLE_SILICON: "Apple Intelligence needs a Mac with Apple silicon.",
    BRIDGE_MISSING: "Apple Intelligence is not available in this build.",
    BRIDGE_UNAVAILABLE: "The Apple Intelligence helper stopped responding.",
    "unsupported_os": "Apple Intelligence in Eigent requires macOS 26 or later.",
    "not_eligible": "This Mac doesn't support Apple Intelligence.",
    "apple_intelligence_off": "Turn on Apple Intelligence in System Settings.",
    "model_not_ready": "The Apple Intelligence model is still downloading.",
}


class AppleBridgeUnavailableError(RuntimeError):
    """Apple Intelligence cannot serve requests. Never fall back silently."""

    def __init__(self, reason: str, message: str | None = None) -> None:
        self.reason = reason
        super().__init__(
            message
            or UNAVAILABLE_MESSAGES.get(
                reason, "Apple Intelligence is not available."
            )
        )


@dataclass(frozen=True)
class BridgeEndpoint:
    base_url: str
    token: str

    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


def default_bridge_command() -> list[str]:
    """The bridge command on this machine, or why there is none."""
    reason = platform_unsupported_reason()
    if reason is not None:
        raise AppleBridgeUnavailableError(reason)
    binary = bridge_binary_path()
    if binary is None:
        raise AppleBridgeUnavailableError(BRIDGE_MISSING)
    return [str(binary)]


class AppleBridgeSupervisor:
    """Owns one bridge process for this backend."""

    def __init__(
        self,
        command: Callable[[], list[str]] = default_bridge_command,
        *,
        clock: Callable[[], float] = time.monotonic,
        start_timeout: float = 20.0,
        max_crashes: int = 3,
        crash_window: float = 300.0,
        health_ttl: float = 30.0,
    ) -> None:
        self._command = command
        self._clock = clock
        self._start_timeout = start_timeout
        self._max_crashes = max_crashes
        self._crash_window = crash_window
        self._health_ttl = health_ttl
        self._lock = threading.RLock()
        self._process: subprocess.Popen[str] | None = None
        self._endpoint: BridgeEndpoint | None = None
        self._crashes: deque[float] = deque()
        self._health: tuple[float, dict[str, Any]] | None = None

    # -- lifecycle ---------------------------------------------------------

    def endpoint(self) -> BridgeEndpoint:
        """The running bridge, started if needed."""
        with self._lock:
            if self._process is not None:
                exit_code = self._process.poll()
                if exit_code is None and self._endpoint is not None:
                    return self._endpoint
                # Exit code 0 is the bridge's own idle stop, not a crash.
                self._forget(crashed=exit_code not in (0, None))
            self._check_restart_allowed()
            command = self._command()
            return self._start(command)

    def reset(self) -> None:
        """Forget earlier crashes, for the Settings card's Try again."""
        with self._lock:
            self._crashes.clear()
            self._health = None

    def stop(self) -> None:
        with self._lock:
            process = self._process
            self._process = None
            self._endpoint = None
            self._health = None
        if process is not None:
            _terminate(process)

    def _start(self, command: list[str]) -> BridgeEndpoint:
        token = secrets.token_urlsafe(32)
        try:
            process = subprocess.Popen(  # nosec B603 -- fixed binary, no shell
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                close_fds=True,
            )
        except OSError as exc:
            self._crashes.append(self._clock())
            raise AppleBridgeUnavailableError(BRIDGE_UNAVAILABLE) from exc

        try:
            assert process.stdin is not None  # nosec B101 -- set by PIPE
            # stdin stays open: the bridge exits when this backend goes away.
            process.stdin.write(token + "\n")
            process.stdin.flush()
            port = self._read_port(process)
        except (OSError, ValueError, TimeoutError) as exc:
            _terminate(process)
            self._crashes.append(self._clock())
            logger.warning(
                "Apple bridge failed to start: %s", type(exc).__name__
            )
            raise AppleBridgeUnavailableError(BRIDGE_UNAVAILABLE) from exc

        self._process = process
        self._endpoint = BridgeEndpoint(f"http://127.0.0.1:{port}/v1", token)
        logger.info("Apple bridge started on 127.0.0.1:%s", port)
        return self._endpoint

    def _read_port(self, process: subprocess.Popen[str]) -> int:
        stdout = process.stdout
        if stdout is None:
            raise ValueError("bridge stdout is not a pipe")
        lines: list[str] = []
        reader = threading.Thread(
            target=lambda: lines.append(stdout.readline()), daemon=True
        )
        reader.start()
        reader.join(self._start_timeout)
        if not lines:
            raise TimeoutError("bridge did not report a port")
        port = int(lines[0].strip())
        if not 0 < port < 65536:
            raise ValueError("bridge reported an invalid port")
        return port

    def _forget(self, *, crashed: bool) -> None:
        if crashed:
            self._crashes.append(self._clock())
            logger.warning("Apple bridge exited unexpectedly")
        self._process = None
        self._endpoint = None
        self._health = None

    def _check_restart_allowed(self) -> None:
        now = self._clock()
        while self._crashes and now - self._crashes[0] > self._crash_window:
            self._crashes.popleft()
        if len(self._crashes) >= self._max_crashes:
            raise AppleBridgeUnavailableError(BRIDGE_UNAVAILABLE)
        if self._crashes:
            backoff = min(2 ** (len(self._crashes) - 1), 10)
            if now - self._crashes[-1] < backoff:
                raise AppleBridgeUnavailableError(
                    BRIDGE_UNAVAILABLE,
                    "The Apple Intelligence helper is restarting. Try again "
                    "in a few seconds.",
                )

    # -- requests ----------------------------------------------------------

    def health(self, *, refresh: bool = False) -> dict[str, Any]:
        """`GET /v1/health`, cached for `health_ttl` seconds."""
        with self._lock:
            cached = self._health
            if (
                not refresh
                and cached is not None
                and self._process is not None
                and self._process.poll() is None
                and self._clock() - cached[0] < self._health_ttl
            ):
                return cached[1]
        endpoint = self.endpoint()
        try:
            response = httpx.get(
                f"{endpoint.base_url}/health",
                headers=endpoint.headers(),
                timeout=10.0,
                trust_env=False,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise AppleBridgeUnavailableError(BRIDGE_UNAVAILABLE) from exc
        if not isinstance(payload, dict):
            raise AppleBridgeUnavailableError(BRIDGE_UNAVAILABLE)
        with self._lock:
            self._health = (self._clock(), payload)
        return payload

    def test_generation(self) -> dict[str, Any]:
        """A short generation for the Settings card's Test button."""
        endpoint = self.endpoint()
        started = time.monotonic()
        try:
            response = httpx.post(
                f"{endpoint.base_url}/chat/completions",
                headers=endpoint.headers(),
                json={
                    "model": ON_DEVICE_MODEL,
                    "messages": [
                        {
                            "role": "user",
                            "content": "Reply with the single word: ready",
                        }
                    ],
                    "max_tokens": 16,
                },
                # The first request loads the model.
                timeout=120.0,
                trust_env=False,
            )
        except httpx.HTTPError as exc:
            raise AppleBridgeUnavailableError(BRIDGE_UNAVAILABLE) from exc
        elapsed_ms = int((time.monotonic() - started) * 1000)
        if response.status_code == 200:
            return {"ok": True, "elapsed_ms": elapsed_ms}
        code, message = _error_details(response)
        return {
            "ok": False,
            "elapsed_ms": elapsed_ms,
            "code": code,
            "message": message,
        }


def _error_details(response: httpx.Response) -> tuple[str, str]:
    try:
        error = response.json().get("error", {})
        code = str(error.get("code") or "generation_failed")
        message = str(error.get("message") or "")
    except (ValueError, AttributeError):
        code, message = "generation_failed", ""
    return code, message or UNAVAILABLE_MESSAGES.get(
        code, "Apple Intelligence couldn't answer."
    )


def _terminate(process: subprocess.Popen[str]) -> None:
    try:
        if process.stdin is not None:
            process.stdin.close()
    except OSError:
        pass
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()


def apple_intelligence_status(
    supervisor: AppleBridgeSupervisor, *, refresh: bool = False
) -> dict[str, Any]:
    """Provider status for Settings. Never raises.

    Off macOS this returns `not_macos` without starting anything, so the
    renderer can hide the provider.
    """
    if refresh:
        supervisor.reset()
    try:
        health = supervisor.health(refresh=refresh)
    except AppleBridgeUnavailableError as exc:
        return _status(available=False, reason=exc.reason, message=str(exc))
    except Exception:  # The status call must never break Settings.
        logger.exception("Apple Intelligence status check failed")
        return _status(
            available=False,
            reason=BRIDGE_UNAVAILABLE,
            message=UNAVAILABLE_MESSAGES[BRIDGE_UNAVAILABLE],
        )

    models = []
    for raw in health.get("models") or []:
        if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
            continue
        context_size = raw.get("context_size")
        capabilities = raw.get("capabilities")
        models.append(
            {
                "id": raw["id"],
                "available": raw.get("status") == "available",
                "reason": raw.get("reason")
                if isinstance(raw.get("reason"), str)
                else None,
                "context_size": context_size
                if isinstance(context_size, int)
                else None,
                "capabilities": [
                    item for item in capabilities if isinstance(item, str)
                ]
                if isinstance(capabilities, list)
                else [],
            }
        )
    on_device = next(
        (model for model in models if model["id"] == ON_DEVICE_MODEL), None
    )
    if on_device is None:
        return _status(
            available=False,
            reason=BRIDGE_UNAVAILABLE,
            message=UNAVAILABLE_MESSAGES[BRIDGE_UNAVAILABLE],
        )
    if on_device["available"]:
        return _status(
            available=True, reason=None, message=None, models=models
        )
    reason = on_device["reason"] or "unavailable"
    return _status(
        available=False,
        reason=reason,
        message=UNAVAILABLE_MESSAGES.get(
            reason, "Apple Intelligence is not available."
        ),
        models=models,
    )


def _status(
    *,
    available: bool,
    reason: str | None,
    message: str | None,
    models: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "provider": PROVIDER_ID,
        "available": available,
        "reason": reason,
        "message": message,
        "models": models or [],
    }


_supervisor: AppleBridgeSupervisor | None = None
_supervisor_lock = threading.Lock()


def get_apple_bridge_supervisor() -> AppleBridgeSupervisor:
    global _supervisor
    with _supervisor_lock:
        if _supervisor is None:
            _supervisor = AppleBridgeSupervisor()
            atexit.register(_supervisor.stop)
        return _supervisor
