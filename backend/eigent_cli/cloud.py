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
"""Talk to the Eigent server: sign in from a terminal and use remote links.

Remote mode steers a Task that runs on a desktop from another machine. The
server relays commands to that desktop and stores its events. Nothing here
talks to a local Eigent.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

import httpx

from eigent_cli.client import (
    EXIT_FAILED,
    EXIT_UNREACHABLE,
    CliError,
    _detail_message,
    cli_dir,
    parse_sse,
)

SERVER_URL_ENV = "EIGENT_SERVER_URL"
DEFAULT_SERVER_URL = "https://dev.eigent.ai"
API_PREFIX = "/api/v1"
SOURCE_CHANNEL = "cli"
LINK_TOKEN_HEADER = "X-Remote-Control-Token"

# The server answers some account errors with HTTP 200 and a numeric code.
_TOKEN_EXPIRED_CODE = 12
_TOKEN_ERROR_CODES = {11, 12, 13, 14}

SIGN_IN_HINT = "Sign in with: eigent login"


def account_path() -> Path:
    return cli_dir() / "account.json"


def links_path() -> Path:
    return cli_dir() / "remote-links.json"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_private(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
    os.replace(tmp, path)


def normalize_server_url(url: str) -> str:
    value = url.strip().rstrip("/")
    if not value.startswith(("http://", "https://")):
        raise CliError(f"Not a server address: {url!r}")
    # Accept the address with or without the API path.
    for suffix in (API_PREFIX, "/api"):
        if value.endswith(suffix):
            value = value[: -len(suffix)]
    return value


@dataclass
class Account:
    server_url: str
    access_token: str
    refresh_token: str
    email: str | None = None

    def save(self) -> None:
        _write_private(
            account_path(),
            {
                "server_url": self.server_url,
                "access_token": self.access_token,
                "refresh_token": self.refresh_token,
                "email": self.email,
                "saved_at": time.time(),
            },
        )


def load_account() -> Account | None:
    data = _read_json(account_path())
    if not data.get("access_token") or not data.get("server_url"):
        return None
    return Account(
        server_url=str(data["server_url"]),
        access_token=str(data["access_token"]),
        refresh_token=str(data.get("refresh_token") or ""),
        email=data.get("email"),
    )


def forget_account() -> bool:
    try:
        account_path().unlink()
    except OSError:
        return False
    return True


def default_server_url(explicit: str | None = None) -> str:
    return normalize_server_url(
        explicit or os.environ.get(SERVER_URL_ENV) or DEFAULT_SERVER_URL
    )


# --------------------------------------------------------- remote links


@dataclass(frozen=True)
class RemoteLink:
    """A remote link this machine can use: the link's id and its token."""

    session_id: str
    link_token: str
    title: str = ""
    space_name: str = ""


def load_links() -> dict[str, RemoteLink]:
    links = {}
    for session_id, entry in _read_json(links_path()).items():
        if isinstance(entry, dict) and entry.get("link_token"):
            links[session_id] = RemoteLink(
                session_id=session_id,
                link_token=str(entry["link_token"]),
                title=str(entry.get("title") or ""),
                space_name=str(entry.get("space_name") or ""),
            )
    return links


def save_link(link: RemoteLink) -> None:
    data = _read_json(links_path())
    data[link.session_id] = {
        "link_token": link.link_token,
        "title": link.title,
        "space_name": link.space_name,
    }
    _write_private(links_path(), data)


def forget_link(session_id: str) -> None:
    data = _read_json(links_path())
    if data.pop(session_id, None) is not None:
        _write_private(links_path(), data)


def parse_link_url(url: str) -> tuple[str, str]:
    """Split a remote link, ``.../remote-control/<id>#t=<token>``."""

    parts = urlsplit(url.strip())
    segments = [segment for segment in parts.path.split("/") if segment]
    fragment = dict(
        pair.split("=", 1) for pair in parts.fragment.split("&") if "=" in pair
    )
    token = unquote(fragment.get("t", ""))
    if len(segments) < 2 or segments[-2] != "remote-control" or not token:
        raise CliError(
            "That is not a remote link. Copy the whole link from the Eigent "
            "app, including the part after #."
        )
    return segments[-1], token


def resolve_link(reference: str | None) -> RemoteLink:
    """Find a saved link by id or unique prefix; the only one if omitted."""

    links = load_links()
    if not links:
        raise CliError(
            "No remote link on this machine yet. Create one with: "
            "eigent remote connect"
        )
    if reference is None:
        if len(links) == 1:
            return next(iter(links.values()))
        raise CliError(
            "More than one remote link is saved. Say which one with "
            "--link ID (see: eigent remote list)."
        )
    if reference in links:
        return links[reference]
    matches = [
        link for key, link in links.items() if key.startswith(reference)
    ]
    if len(matches) == 1:
        return matches[0]
    raise CliError(
        f"No saved remote link matches {reference!r}. See: eigent remote list"
    )


# --------------------------------------------------------------- client


class CloudClient:
    """HTTP client for the Eigent server with sign-in and token refresh."""

    def __init__(
        self,
        server_url: str,
        account: Account | None = None,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 30.0,
    ):
        self.server_url = normalize_server_url(server_url)
        self.account = account
        self._http = httpx.Client(
            base_url=self.server_url + API_PREFIX,
            headers={"X-Channel": "cli"},
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> CloudClient:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # ---------------------------------------------------------- plumbing

    def _headers(self, link: RemoteLink | None) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self.account is not None:
            headers["Authorization"] = f"Bearer {self.account.access_token}"
        if link is not None:
            headers[LINK_TOKEN_HEADER] = link.link_token
        return headers

    def _send(
        self,
        method: str,
        path: str,
        *,
        link: RemoteLink | None = None,
        **kwargs: Any,
    ) -> httpx.Response:
        try:
            return self._http.request(
                method, path, headers=self._headers(link), **kwargs
            )
        except httpx.TransportError as exc:
            raise CliError(
                f"Cannot reach the Eigent server at {self.server_url} "
                f"({exc}).",
                EXIT_UNREACHABLE,
            ) from exc

    @staticmethod
    def _account_error_code(response: httpx.Response) -> int | None:
        """The numeric code of an account error sent with HTTP 200."""

        if response.status_code != 200:
            return None
        try:
            body = response.json()
        except ValueError:
            return None
        code = body.get("code") if isinstance(body, dict) else None
        if isinstance(code, int) and code in _TOKEN_ERROR_CODES:
            return code
        return None

    def _token_rejected(self, response: httpx.Response) -> bool:
        if self._account_error_code(response) is not None:
            return True
        if response.status_code != 401:
            return False
        code, _message = _detail_message(response)
        # 401 REMOTE_LOGIN_REQUIRED is also what an expired token looks like
        # on a remote link route.
        return code in {None, "REMOTE_LOGIN_REQUIRED"}

    def refresh(self) -> bool:
        """Trade the refresh token for a new pair. False when it is spent."""

        account = self.account
        if account is None or not account.refresh_token:
            return False
        try:
            response = self._http.post(
                "/user/refresh",
                json={"refresh_token": account.refresh_token},
            )
        except httpx.TransportError:
            return False
        if response.status_code != 200:
            return False
        try:
            body = response.json()
        except ValueError:
            return False
        if not isinstance(body, dict) or not body.get("access_token"):
            return False
        account.access_token = str(body["access_token"])
        # The server rotates the refresh token; the old one stops working.
        account.refresh_token = str(
            body.get("refresh_token") or account.refresh_token
        )
        account.email = body.get("email") or account.email
        account.save()
        return True

    def _raise_for(self, response: httpx.Response) -> None:
        if self._account_error_code(response) is not None:
            raise CliError(
                "Your sign-in is no longer valid. " + SIGN_IN_HINT,
                EXIT_UNREACHABLE,
            )
        if response.status_code < 400:
            return
        code, message = _detail_message(response)
        if response.status_code == 401:
            raise CliError(
                "The server did not accept your sign-in. " + SIGN_IN_HINT,
                EXIT_UNREACHABLE,
            )
        if code == "BRIDGE_OFFLINE":
            raise CliError(
                "That desktop is offline. Open the Eigent app on it and "
                "sign in to the same account.",
                EXIT_UNREACHABLE,
            )
        if code == "REMOTE_LOGIN_USER_MISMATCH":
            raise CliError(
                "This remote link belongs to another account.",
                EXIT_UNREACHABLE,
            )
        if response.status_code == 410:
            raise CliError(
                "This remote link has expired or was turned off. Create a "
                "new one with: eigent remote connect",
                EXIT_UNREACHABLE,
            )
        raise CliError(f"{message} (HTTP {response.status_code})", EXIT_FAILED)

    def request(
        self,
        method: str,
        path: str,
        *,
        link: RemoteLink | None = None,
        signed_in: bool = True,
        **kwargs: Any,
    ) -> Any:
        if signed_in and self.account is None:
            raise CliError(
                "You are not signed in. " + SIGN_IN_HINT, EXIT_UNREACHABLE
            )
        response = self._send(method, path, link=link, **kwargs)
        if signed_in and self._token_rejected(response) and self.refresh():
            response = self._send(method, path, link=link, **kwargs)
        self._raise_for(response)
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

    # ----------------------------------------------------------- sign-in

    def start_device_sign_in(self, client_name: str) -> dict[str, Any]:
        return self.post(
            "/cli/auth/device",
            json={"client_name": client_name},
            signed_in=False,
        )

    def poll_device_sign_in(self, device_code: str) -> dict[str, Any] | str:
        """Tokens once approved; otherwise the reason there are none yet."""

        response = self._send(
            "POST", "/cli/auth/device/token", json={"device_code": device_code}
        )
        if response.status_code == 200:
            return response.json()
        code, message = _detail_message(response)
        if code in {"authorization_pending", "slow_down"}:
            return code
        if code == "access_denied":
            raise CliError("The sign-in was refused.", EXIT_UNREACHABLE)
        if code == "expired_token":
            raise CliError(
                "The sign-in code expired before it was approved. Run "
                "eigent login again.",
                EXIT_UNREACHABLE,
            )
        raise CliError(f"{message} (HTTP {response.status_code})")

    def approve_device_sign_in(self, user_code: str) -> dict[str, Any]:
        return self.post(
            "/cli/auth/device/approve", json={"user_code": user_code}
        )

    # ------------------------------------------------------ remote links

    def list_links(
        self, include_inactive: bool = False
    ) -> list[dict[str, Any]]:
        body = self.get(
            "/remote-control/sessions",
            params={"include_inactive": include_inactive},
        )
        return list((body or {}).get("items") or [])

    def list_desktops(self) -> list[dict[str, Any]]:
        return list(
            (self.get("/remote-control/desktops") or {}).get("items") or []
        )

    def list_spaces(self) -> list[dict[str, Any]]:
        body = self.get("/spaces")
        return list(body) if isinstance(body, list) else []

    def create_link(
        self, desktop_instance_id: str, space_id: str | None, hours: int
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "desktop_instance_id": desktop_instance_id,
            "title": "Eigent CLI",
            "expires_in_seconds": hours * 3600,
        }
        if space_id:
            body["space_id"] = space_id
        return self.post("/remote-control/sessions", json=body)

    def link_info(self, link: RemoteLink) -> dict[str, Any]:
        return self.get(
            f"/remote-control/sessions/{link.session_id}", link=link
        )

    def revoke_link(self, link: RemoteLink) -> None:
        self.request(
            "DELETE", f"/remote-control/sessions/{link.session_id}", link=link
        )

    def link_sessions(self, link: RemoteLink) -> list[dict[str, Any]]:
        body = self.get(
            f"/remote-control/sessions/{link.session_id}/projects", link=link
        )
        return list((body or {}).get("items") or [])

    def set_target(self, link: RemoteLink, project_id: str) -> dict[str, Any]:
        return self.request(
            "PATCH",
            f"/remote-control/sessions/{link.session_id}/target",
            link=link,
            json={"project_id": project_id},
        )

    def snapshot(
        self, link: RemoteLink, project_id: str, event_limit: int = 1000
    ) -> dict[str, Any]:
        return self.get(
            f"/remote-control/sessions/{link.session_id}/snapshot",
            link=link,
            params={"project_id": project_id, "event_limit": event_limit},
        )

    def events_after(
        self, link: RemoteLink, project_id: str, cursor: int, limit: int = 1000
    ) -> dict[str, Any]:
        return self.get(
            f"/remote-control/sessions/{link.session_id}/events",
            link=link,
            params={
                "project_id": project_id,
                "after_cursor": cursor,
                "limit": limit,
            },
        )

    def send_command(
        self,
        link: RemoteLink,
        command_type: str,
        payload: dict[str, Any],
        *,
        target: dict[str, Any],
        client_request_id: str,
    ) -> dict[str, Any]:
        return self.post(
            f"/remote-control/sessions/{link.session_id}/commands",
            link=link,
            json={
                "client_request_id": client_request_id,
                "source_channel": SOURCE_CHANNEL,
                "type": command_type,
                "payload": payload,
                "target_project_id": target.get("project_id"),
                "target_task_id": target.get("task_id"),
                "target_brain_session_id": target.get("brain_session_id"),
            },
        )

    def stream_events(
        self, link: RemoteLink, project_id: str, cursor: int
    ) -> Iterator[tuple[str, dict[str, Any]]]:
        """Yield (frame name, data) from the server's HTTP event stream.

        Transport errors propagate as httpx errors so the caller can
        reconnect from the last cursor it saw.
        """

        if self.account is None:
            raise CliError(
                "You are not signed in. " + SIGN_IN_HINT, EXIT_UNREACHABLE
            )
        for attempt in (1, 2):
            headers = {**self._headers(link), "Accept": "text/event-stream"}
            with self._http.stream(
                "GET",
                f"/remote-control/sessions/{link.session_id}/events/stream",
                params={"project_id": project_id, "after_cursor": cursor},
                headers=headers,
                timeout=httpx.Timeout(30.0, read=60.0),
            ) as response:
                if response.status_code >= 400:
                    response.read()
                    if (
                        attempt == 1
                        and self._token_rejected(response)
                        and self.refresh()
                    ):
                        continue
                    self._raise_for(response)
                yield from parse_sse(response.iter_lines())
                return
