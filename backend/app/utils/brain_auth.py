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

import base64
import json
import logging

from fastapi import Header, HTTPException

logger = logging.getLogger("brain_auth")


def decode_jwt_email(token: str) -> str | None:
    """Decode the JWT payload (without signature verification) to extract the email/sub claim."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        payload_b64 = parts[1]
        # Restore Base64 padding
        rem = len(payload_b64) % 4
        if rem:
            payload_b64 += "=" * (4 - rem)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return payload.get("email") or payload.get("sub")
    except Exception:
        return None


async def require_brain_token(authorization: str | None = Header(None)) -> str:
    """FastAPI dependency: require a Bearer token and return its email claim.

    This performs structural validation only (no signature check).  A proper
    shared-secret or JWKS verification should be added once the Brain process
    has access to the signing key.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401, detail="Authorization header required"
        )
    token = authorization[7:]
    if not token:
        raise HTTPException(
            status_code=401, detail="Authorization header required"
        )
    email = decode_jwt_email(token)
    if not email:
        raise HTTPException(
            status_code=401, detail="Invalid or malformed token"
        )
    return email
