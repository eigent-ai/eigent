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

"""v1 Logout - token blacklist, audit log."""

from datetime import datetime

import jwt
from fastapi import APIRouter, Depends
from loguru import logger

from app.core.environment import env_not_empty
from app.shared.auth.token_blacklist import blacklist_token
from app.shared.auth.user_auth import _get_jti, oauth2_scheme

router = APIRouter(prefix="/user", tags=["V1 Auth"])


@router.post("/logout", name="logout")
async def logout(token: str = Depends(oauth2_scheme)):
    """Revoke current token. Requires Bearer token."""
    if not token:
        logger.info("logout: no token provided")
        return {"success": True, "message": "No token to revoke"}
    jti = _get_jti(token)
    user_id = None
    if jti:
        try:
            payload = jwt.decode(
                token, env_not_empty("secret_key"), algorithms=["HS256"], options={"verify_exp": False}
            )
            user_id = payload.get("id")
            exp = payload.get("exp")
            ttl = max(0, int(exp) - int(datetime.utcnow().timestamp())) if exp else 3600
            await blacklist_token(jti, ttl)
        except Exception as e:
            logger.warning("logout: token decode/blacklist failed", extra={"error": str(e)})
    jti_safe = (jti[:8] + "...") if jti and len(jti) >= 8 else (jti or None)
    logger.info("logout", extra={"user_id": user_id, "jti_preview": jti_safe})
    return {"success": True, "message": "Logged out"}
