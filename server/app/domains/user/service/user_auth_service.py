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

"""UserAuthService: login, refresh, logout. Follows CreditsService pattern."""

import time
from datetime import datetime

import jwt
from loguru import logger

from app.core.database import session_make
from app.core.encrypt import password_verify
from app.core.environment import env_not_empty
from app.model.user.user import Status, User

from app.shared.auth import create_access_token, create_refresh_token
from app.shared.auth.user_auth import decode_refresh_token, _get_jti
from app.shared.auth.token_blacklist import blacklist_token, is_blacklisted
from app.domains.user.schema import AuthResult


class UserAuthService:
    """User authentication operations - static methods."""

    @staticmethod
    def login(email: str, password: str) -> AuthResult:
        """Password login + credits refresh. Returns tokens or error."""
        with session_make() as s:
            user = s.exec(
                User.by(User.email == email, s=s)
            ).one_or_none()

        if not user or not password_verify(password, user.password):
            return AuthResult(success=False, error_code="AUTH_INVALID_CREDENTIALS")
        if user.status == Status.Block:
            return AuthResult(success=False, error_code="AUTH_ACCOUNT_BLOCKED")
        if not user.is_active:
            return AuthResult(success=False, error_code="AUTH_ACCOUNT_INACTIVE")

        # No credits refresh in eigent (no billing domain)

        access_token = create_access_token(user.id)
        refresh_token = create_refresh_token(user.id)
        return AuthResult(
            success=True,
            access_token=access_token,
            refresh_token=refresh_token,
            email=user.email,
        )

    @staticmethod
    async def refresh(refresh_token_str: str) -> AuthResult:
        """Exchange valid refresh_token for new token pair."""
        if not refresh_token_str:
            return AuthResult(success=False, error_code="AUTH_REFRESH_TOKEN_REQUIRED")

        user_id, jti, exp_ts = decode_refresh_token(refresh_token_str)
        if jti and await is_blacklisted(jti):
            return AuthResult(success=False, error_code="AUTH_TOKEN_REVOKED")

        with session_make() as s:
            user = s.get(User, user_id)

        if not user:
            return AuthResult(success=False, error_code="AUTH_USER_NOT_FOUND")
        if user.status == Status.Block:
            return AuthResult(success=False, error_code="AUTH_ACCOUNT_BLOCKED")
        if not user.is_active:
            return AuthResult(success=False, error_code="AUTH_ACCOUNT_INACTIVE")

        # Blacklist old refresh token
        if jti:
            ttl = max(0, exp_ts - int(time.time()))
            await blacklist_token(jti, ttl)

        access_token = create_access_token(user.id)
        new_refresh_token = create_refresh_token(user.id)
        return AuthResult(
            success=True,
            access_token=access_token,
            refresh_token=new_refresh_token,
            email=user.email,
        )

    @staticmethod
    async def logout(token: str) -> bool:
        """Revoke token by adding to blacklist."""
        if not token:
            return True
        jti = _get_jti(token)
        if jti:
            try:
                payload = jwt.decode(
                    token,
                    env_not_empty("secret_key"),
                    algorithms=["HS256"],
                    options={"verify_exp": False},
                )
                user_id = payload.get("id")
                exp = payload.get("exp")
                ttl = max(0, int(exp) - int(datetime.utcnow().timestamp())) if exp else 3600
                await blacklist_token(jti, ttl)
                logger.info("logout", extra={"user_id": user_id})
            except Exception as e:
                logger.warning("logout: token decode/blacklist failed", extra={"error": str(e)})
        return True
