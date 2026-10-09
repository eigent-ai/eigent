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
"""Expiring grants that let a URL read one project's files.

The renderer shows Brain files through <img>, <iframe> and media elements,
which cannot send the Desktop capability header. It asks the authenticated
API for a grant instead and puts the grant in the file URL. A grant is signed
with a key that lives only in this process, so restarting the Brain revokes
every grant it issued.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass

from fastapi import HTTPException, Path, Query, Request

from app.auth.local_control import desktop_control_configured

FILE_ACCESS_TTL_SECONDS = 60 * 60
_GRANT_VERSION = 1
_signing_key = secrets.token_bytes(32)


@dataclass(frozen=True)
class FileAccessScope:
    """The project file root a grant can read."""

    email: str
    project_id: str
    space_id: str | None = None
    user_id: str | None = None

    @classmethod
    def of(
        cls,
        email: str,
        project_id: str,
        space_id: str | None = None,
        user_id: str | None = None,
    ) -> FileAccessScope:
        return cls(
            email=email,
            project_id=project_id,
            space_id=space_id or None,
            user_id=user_id or None,
        )


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(body: str) -> str:
    digest = hmac.new(
        _signing_key, body.encode("ascii"), hashlib.sha256
    ).digest()
    return _b64encode(digest)


def issue_file_access_grant(
    scope: FileAccessScope,
    *,
    now: float | None = None,
    ttl_seconds: int = FILE_ACCESS_TTL_SECONDS,
) -> tuple[str, int]:
    """Return a URL-safe grant for ``scope`` and its expiry (epoch seconds)."""

    expires_at = int(time.time() if now is None else now) + ttl_seconds
    payload = {
        "v": _GRANT_VERSION,
        "exp": expires_at,
        "email": scope.email,
        "project_id": scope.project_id,
        "space_id": scope.space_id,
        "user_id": scope.user_id,
    }
    body = _b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    )
    return f"{body}.{_sign(body)}", expires_at


def read_file_access_grant(
    grant: str | None, *, now: float | None = None
) -> FileAccessScope | None:
    """Return the scope of a valid, unexpired grant, otherwise None."""

    body, _, signature = (grant or "").partition(".")
    if not body or not signature:
        return None
    try:
        expected = _sign(body)
    except UnicodeEncodeError:
        return None
    if not hmac.compare_digest(signature.encode(), expected.encode()):
        return None
    try:
        payload = json.loads(_b64decode(body))
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return None
    if not isinstance(payload, dict) or payload.get("v") != _GRANT_VERSION:
        return None
    expires_at = payload.get("exp")
    if not isinstance(expires_at, int):
        return None
    if expires_at <= (time.time() if now is None else now):
        return None
    email = payload.get("email")
    project_id = payload.get("project_id")
    space_id = payload.get("space_id")
    user_id = payload.get("user_id")
    if not all(
        isinstance(value, str) and value for value in (email, project_id)
    ):
        return None
    if not all(isinstance(value, str | None) for value in (space_id, user_id)):
        return None
    return FileAccessScope.of(email, project_id, space_id, user_id)


def _file_access_denied() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={
            "code": "file_access_required",
            "message": "A valid file access grant is required.",
        },
    )


async def require_file_stream_access(
    request: Request,
    project_id: str = Query(..., description="Project ID"),
    email: str = Query(..., description="User email"),
    space_id: str | None = Query(None, description="Optional Space ID"),
    user_id: str | None = Query(
        None, description="Optional canonical user ID"
    ),
    access: str | None = Query(
        None, description="Grant from POST /files/access"
    ),
) -> None:
    """Require a grant for exactly this file root on Desktop.

    A Brain without the Desktop boundary keeps its router-level auth alone.
    """

    if not desktop_control_configured(request):
        return
    scope = read_file_access_grant(access)
    if scope != FileAccessScope.of(email, project_id, space_id, user_id):
        raise _file_access_denied()


async def require_file_preview_access(
    request: Request,
    access: str = Path(..., description="Grant from POST /files/access"),
) -> FileAccessScope:
    """Resolve a preview URL's file root from its grant.

    The grant is a path segment so relative links inside a previewed HTML
    page resolve to URLs that carry it too.
    """

    desktop_control_configured(request)
    scope = read_file_access_grant(access)
    if scope is None:
        raise _file_access_denied()
    return scope
