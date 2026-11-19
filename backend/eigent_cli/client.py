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
"""Find the local Brain and talk to its Run API."""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

CLI_TOKEN_HEADER = "X-Eigent-CLI-Token"
BRAIN_URL_ENV = "EIGENT_BRAIN_URL"
CLI_TOKEN_ENV = "EIGENT_CLI_TOKEN"

# Exit codes. Click uses 2 for usage errors.
EXIT_COMPLETED = 0
EXIT_FAILED = 1
EXIT_USAGE = 2
EXIT_WAITING = 3
EXIT_CANCELLED = 4
EXIT_DEADLINE = 5
EXIT_INTERRUPTED = 6
EXIT_UNREACHABLE = 7

TERMINAL_STATUS_EXIT = {
    "completed": EXIT_COMPLETED,
    "failed": EXIT_FAILED,
    "cancelled": EXIT_CANCELLED,
    "timed_out": EXIT_DEADLINE,
}

ENABLE_HINT = (
    "turn on CLI access by setting EIGENT_CLI_ACCESS=1 (in your environment "
    "or in ~/.eigent/.env) and restarting Eigent."
)


class CliError(Exception):
    def __init__(self, message: str, exit_code: int = EXIT_FAILED):
        super().__init__(message)
        self.message = message
        self.exit_code = exit_code


def cli_dir() -> Path:
    return Path.home() / ".eigent" / "cli"


@dataclass(frozen=True)
class Connection:
    base_url: str
    token: str | None


def _read_brain_info() -> dict[str, Any] | None:
    try:
        info = json.loads(
            (cli_dir() / "brain.json").read_text(encoding="utf-8")
        )
    except (OSError, ValueError):
        return None
    return info if isinstance(info, dict) else None


def _read_token_file() -> str | None:
    try:
        token = (cli_dir() / "token").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return token or None


def resolve_connection(url: str | None = None) -> Connection:
    """Use --url or EIGENT_BRAIN_URL, else the address the Brain published."""

    base_url = url or os.environ.get(BRAIN_URL_ENV)
    if not base_url:
        info = _read_brain_info()
        port = info.get("port") if info else None
        if not isinstance(port, int):
            raise CliError(
                "No running Eigent with CLI access was found. Start one "
                "with: eigent brain start. To use the app instead: "
                + ENABLE_HINT,
                EXIT_UNREACHABLE,
            )
        host = str(info.get("host") or "127.0.0.1")
        if host in {"0.0.0.0", "::", ""}:
            host = "127.0.0.1"
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        base_url = f"http://{host}:{port}"
    token = os.environ.get(CLI_TOKEN_ENV) or _read_token_file()
    return Connection(base_url=base_url.rstrip("/"), token=token)


def _detail_message(response: httpx.Response) -> tuple[str | None, str]:
    try:
        body = response.json()
    except ValueError:
        return None, response.text.strip() or response.reason_phrase
    detail = body.get("detail", body) if isinstance(body, dict) else body
    if isinstance(detail, dict):
        code = detail.get("code")
        message = detail.get("message") or code or json.dumps(detail)
        return (str(code) if code else None), str(message)
    return None, str(detail)


class BrainClient:
    def __init__(
        self,
        connection: Connection,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 30.0,
    ):
        headers = {"X-Channel": "cli"}
        if connection.token:
            headers[CLI_TOKEN_HEADER] = connection.token
        self.base_url = connection.base_url
        self._http = httpx.Client(
            base_url=connection.base_url,
            headers=headers,
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> BrainClient:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def _unreachable(self, exc: Exception) -> CliError:
        return CliError(
            f"Cannot reach Eigent at {self.base_url} ({exc}). "
            "Is it running? Start it with: eigent brain start",
            EXIT_UNREACHABLE,
        )

    def _raise_for_status(self, response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        code, message = _detail_message(response)
        if code == "cli_access_disabled":
            raise CliError(
                "CLI access is turned off in this Eigent. To use it, "
                + ENABLE_HINT,
                EXIT_UNREACHABLE,
            )
        if response.status_code in {401, 403} or code in {
            "local_control_auth_unconfigured",
            "local_control_capability_unconfigured",
        }:
            hint = (
                ""
                if self._http.headers.get(CLI_TOKEN_HEADER)
                else " No CLI token was found. To get one, " + ENABLE_HINT
            )
            raise CliError(
                f"Eigent refused the request: {message.rstrip('.')}.{hint}",
                EXIT_UNREACHABLE,
            )
        raise CliError(f"{message} (HTTP {response.status_code})")

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = self._http.request(method, path, **kwargs)
        except httpx.TransportError as exc:
            raise self._unreachable(exc) from exc
        self._raise_for_status(response)
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            return response.text

    def get(self, path: str, **kwargs: Any) -> Any:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> Any:
        return self.request("POST", path, **kwargs)

    def stream_events(
        self, run_id: str, after_sequence: int
    ) -> Iterator[tuple[str, dict[str, Any]]]:
        """Yield (event name, data) from the durable Run stream.

        The Brain replays from SQLite after ``after_sequence``, so a
        reconnect with the last seen sequence loses nothing. Transport errors
        propagate as httpx errors so the caller can reconnect.
        """

        headers = {"Accept": "text/event-stream"}
        if after_sequence > 0:
            headers["Last-Event-ID"] = str(after_sequence)
        with self._http.stream(
            "GET",
            f"/runs/{run_id}/stream",
            params={"after_sequence": after_sequence},
            headers=headers,
            # The Brain sends a heartbeat every 15 seconds.
            timeout=httpx.Timeout(30.0, read=60.0),
        ) as response:
            if response.status_code >= 400:
                response.read()
                self._raise_for_status(response)
            yield from parse_sse(response.iter_lines())


def parse_sse(lines: Iterator[str]) -> Iterator[tuple[str, dict[str, Any]]]:
    event = "message"
    data: list[str] = []
    for raw in lines:
        line = raw.rstrip("\r")
        if not line:
            if data:
                try:
                    payload = json.loads("\n".join(data))
                except ValueError:
                    payload = {"raw": "\n".join(data)}
                yield (
                    event,
                    payload
                    if isinstance(payload, dict)
                    else {"value": payload},
                )
            event, data = "message", []
            continue
        if line.startswith(":"):
            continue
        field, _, value = line.partition(":")
        value = value[1:] if value.startswith(" ") else value
        if field == "event":
            event = value
        elif field == "data":
            data.append(value)
    if data:
        try:
            payload = json.loads("\n".join(data))
        except ValueError:
            payload = {"raw": "\n".join(data)}
        if isinstance(payload, dict):
            yield event, payload
