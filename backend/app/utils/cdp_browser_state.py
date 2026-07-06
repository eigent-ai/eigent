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

import logging
import time
from typing import Any

from fastapi import Request

from app.component.environment import env
from app.utils.browser_launcher import (
    _is_cdp_available,
    is_cdp_url_available,
    is_local_cdp_host,
    normalize_cdp_url,
)

logger = logging.getLogger("cdp_browser_state")

_web_cdp_browser_meta_by_owner: dict[str, dict[str, Any]] = {}


def browser_owner_key(request: Request | None) -> str:
    auth = getattr(getattr(request, "state", None), "brain_auth", None)
    user_id = getattr(auth, "user_id", None)
    if user_id and user_id != "local":
        return str(user_id)

    # Bridge release fallback: NoneAuth still emits "local", while the
    # frontend already sends X-User-ID. Phase B auth will make this token-only.
    if request is not None:
        header_user_id = request.headers.get("x-user-id")
        if header_user_id:
            return header_user_id
    return "local"


def build_web_cdp_browser(
    endpoint: str,
    *,
    is_external: bool,
    name: str | None = None,
    added_at: int | None = None,
    resource_session_id: str | None = None,
    managed_by: str = "local",
) -> dict[str, Any]:
    normalized_endpoint, host, port = normalize_cdp_url(endpoint)
    default_location = (
        str(port) if is_local_cdp_host(host) else f"{host}:{port}"
    )
    browser_name = name or (
        f"External Browser ({default_location})"
        if is_external
        else f"Managed Browser ({default_location})"
    )
    browser_id = resource_session_id or (
        f"web-cdp-{port}"
        if is_local_cdp_host(host)
        else f"web-cdp-{host.replace('.', '-')}-{port}"
    )
    return {
        "id": browser_id,
        "port": port,
        "endpoint": normalized_endpoint,
        "host": host,
        "isExternal": is_external,
        "name": browser_name,
        "addedAt": added_at or int(time.time() * 1000),
        "resourceSessionId": resource_session_id,
        "managedBy": managed_by,
    }


def get_connected_cdp_endpoint(owner_key: str) -> str | None:
    if owner_key in _web_cdp_browser_meta_by_owner:
        return _web_cdp_browser_meta_by_owner[owner_key].get("endpoint")
    cdp_url = env("EIGENT_CDP_URL")
    if cdp_url:
        return cdp_url
    return None


def get_connected_cdp_endpoint_for_request(
    request: Request | None,
) -> str | None:
    return get_connected_cdp_endpoint(browser_owner_key(request))


def get_connected_cdp_meta(owner_key: str) -> dict[str, Any] | None:
    return _web_cdp_browser_meta_by_owner.get(owner_key)


def get_connected_cdp_port(owner_key: str) -> int | None:
    cdp_url = get_connected_cdp_endpoint(owner_key)
    if not cdp_url:
        return None
    try:
        _, _, port = normalize_cdp_url(cdp_url)
        return port
    except Exception:
        logger.warning("Invalid EIGENT_CDP_URL: %s", cdp_url)
        return None


def set_connected_cdp_browser(
    owner_key: str,
    endpoint: str,
    *,
    is_external: bool,
    name: str | None = None,
    resource_session_id: str | None = None,
    managed_by: str = "local",
) -> dict[str, Any]:
    normalized_endpoint, _, _ = normalize_cdp_url(endpoint)
    browser = build_web_cdp_browser(
        normalized_endpoint,
        is_external=is_external,
        name=name,
        resource_session_id=resource_session_id,
        managed_by=managed_by,
    )
    _web_cdp_browser_meta_by_owner[owner_key] = browser
    return browser


def clear_connected_cdp_browser(owner_key: str) -> None:
    _web_cdp_browser_meta_by_owner.pop(owner_key, None)


def clear_connected_cdp_browser_for_request(request: Request | None) -> None:
    clear_connected_cdp_browser(browser_owner_key(request))


def is_cdp_endpoint_available(endpoint: str) -> bool:
    _, host, port = normalize_cdp_url(endpoint)
    if is_local_cdp_host(host):
        return _is_cdp_available(port)

    return is_cdp_url_available(endpoint)


def list_connected_cdp_browsers(owner_key: str) -> list[dict[str, Any]]:
    meta = _web_cdp_browser_meta_by_owner.get(owner_key)
    endpoint = get_connected_cdp_endpoint(owner_key)
    if endpoint is None:
        return []

    if not is_cdp_endpoint_available(endpoint):
        if meta and meta.get("endpoint") == endpoint:
            clear_connected_cdp_browser(owner_key)
        return []

    if meta and meta.get("endpoint") == endpoint:
        return [meta]

    return [build_web_cdp_browser(endpoint, is_external=True)]
