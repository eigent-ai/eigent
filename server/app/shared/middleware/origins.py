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

from __future__ import annotations

import ipaddress
import os
from urllib.parse import urlparse

REMOTE_ORIGIN_KEYS = (
    "REMOTE_CONTROL_WEB_ORIGIN",
    "VITE_REMOTE_CONTROL_WEB_ORIGIN",
    "VITE_SITE_URL",
)
DEFAULT_LOCAL_DEV_HOSTS = ("localhost", "127.0.0.1")
DEFAULT_LOCAL_DEV_WS_HOSTS = {"localhost", "127.0.0.1", "::1"}
DEFAULT_LOCAL_DEV_PORTS = (3001, 5173, 5174)


def csv_values(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def truthy(value: str | None) -> bool:
    return str(value or "").lower() in {"1", "true", "yes", "on"}


def configured_remote_origins() -> list[str]:
    seen: set[str] = set()
    origins: list[str] = []
    for key in REMOTE_ORIGIN_KEYS:
        for origin in csv_values(os.getenv(key)):
            if origin not in seen:
                seen.add(origin)
                origins.append(origin)
    return origins


def local_dev_ports() -> set[int]:
    raw_ports = csv_values(os.getenv("REMOTE_CONTROL_LOCAL_DEV_PORTS"))
    if not raw_ports:
        return set(DEFAULT_LOCAL_DEV_PORTS)

    ports: set[int] = set()
    for raw_port in raw_ports:
        try:
            port = int(raw_port)
        except ValueError:
            continue
        if 0 < port <= 65535:
            ports.add(port)
    return ports or set(DEFAULT_LOCAL_DEV_PORTS)


def local_dev_cors_origins() -> list[str]:
    origins: list[str] = []
    for host in DEFAULT_LOCAL_DEV_HOSTS:
        for port in sorted(local_dev_ports()):
            origins.append(f"http://{host}:{port}")
    return origins


def is_local_dev_origin(origin: str | None) -> bool:
    if not origin:
        return False
    try:
        parsed = urlparse(origin)
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"}:
        return False

    host = parsed.hostname
    if not host:
        return False

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if port not in local_dev_ports():
        return False

    if host in DEFAULT_LOCAL_DEV_WS_HOSTS:
        return True

    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.is_loopback or address.is_private
