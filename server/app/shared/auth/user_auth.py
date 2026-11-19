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
User auth with 1 week access token, refresh token, blacklist check, type claim.
"""

import hashlib
import uuid
from datetime import datetime, timedelta

import jwt
from fastapi import Depends, Header
from fastapi.security import OAuth2PasswordBearer
from fastapi_babel import _
from jwt.exceptions import InvalidTokenError
from sqlmodel import Session, select

from app.core import code
from app.core.database import session
from app.core.environment import env, env_not_empty
from app.model.mcp.proxy import ApiKey
from app.model.user.key import Key
from app.model.user.user import User
from app.shared.auth.token_blacklist import is_blacklisted
from app.shared.exception import NoPermissionException, TokenException

SECRET_KEY = env_not_empty("secret_key")
TOKEN_EXPIRY = timedelta(weeks=1)  # 1 week
REFRESH_EXPIRY = timedelta(days=30)
TOKEN_TYPE_USER = "user"
TOKEN_TYPE_REFRESH = "refresh"
TOKEN_AUDIENCE = env("TOKEN_AUDIENCE") or env("JWT_AUDIENCE") or "eigent-api"


def _token_issuer() -> str:
    explicit = env("TOKEN_ISSUER") or env("JWT_ISSUER") or env("token_issuer")
    if explicit:
        return explicit

    material = "|".join(
        value
        for value in (
            env("SERVER_URL", ""),
            env("VITE_BASE_URL", ""),
            env("VITE_PROXY_URL", ""),
            env("url_prefix", ""),
            env("database_url", ""),
        )
        if value
    )
    if not material:
        material = "eigent-default-token-environment"
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:24]
    return f"eigent:{digest}"


TOKEN_ISSUER = _token_issuer()


def _message(text: str) -> str:
    try:
        return _(text)
    except LookupError:
        return text


oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{env('url_prefix', '')}/v1/user/dev_login",
    auto_error=False,
)


class V1UserAuth:
    """v1 user auth context."""

    def __init__(self, id: int, expired_at: datetime):
        self.id = id
        self.expired_at = expired_at
        self._user: User | None = None

    @property
    def user(self) -> User:
        if self._user is None:
            raise NoPermissionException("未查询到登录用户")
        return self._user

    @classmethod
    def decode_token(cls, token: str) -> "V1UserAuth":
        try:
            payload = jwt.decode(
                token,
                SECRET_KEY,
                algorithms=["HS256"],
                issuer=TOKEN_ISSUER,
                audience=TOKEN_AUDIENCE,
                options={"require": ["id", "type", "jti", "iss", "aud", "exp"]},
            )
            token_type = payload.get("type", "user")
            if token_type != TOKEN_TYPE_USER:
                raise TokenException(code.token_invalid, _message("Invalid token type"))
            user_id = payload["id"]
            if payload["exp"] < int(datetime.utcnow().timestamp()):
                raise TokenException(
                    code.token_expired,
                    _message("Validate credentials expired"),
                )
            return V1UserAuth(user_id, datetime.fromtimestamp(payload["exp"]))
        except InvalidTokenError:
            raise TokenException(
                code.token_invalid,
                _message("Could not validate credentials"),
            )

    @classmethod
    def create_access_token(cls, user_id: int, expires_delta: timedelta | None = None) -> str:
        """Create access token with 1 week expiry and type: user claim (M3, M4)."""
        expire = datetime.utcnow() + (expires_delta or TOKEN_EXPIRY)
        to_encode = {
            "id": user_id,
            "type": TOKEN_TYPE_USER,
            "jti": str(uuid.uuid4()),
            "iss": TOKEN_ISSUER,
            "aud": TOKEN_AUDIENCE,
            "exp": expire,
        }
        return jwt.encode(to_encode, SECRET_KEY, algorithm="HS256")

    @classmethod
    def create_refresh_token(cls, user_id: int) -> str:
        """Create refresh token with 30d expiry (M3)."""
        expire = datetime.utcnow() + REFRESH_EXPIRY
        to_encode = {
            "id": user_id,
            "type": TOKEN_TYPE_REFRESH,
            "jti": str(uuid.uuid4()),
            "iss": TOKEN_ISSUER,
            "aud": TOKEN_AUDIENCE,
            "exp": expire,
        }
        return jwt.encode(to_encode, SECRET_KEY, algorithm="HS256")


def _get_jti(token: str) -> str | None:
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=["HS256"],
            options={
                "verify_exp": False,
                "verify_aud": False,
                "verify_iss": False,
            },
        )
        return payload.get("jti")
    except Exception:
        return None


async def decode_refresh_token(token: str) -> tuple[int, str | None, int]:
    """
    Validate refresh token, check blacklist, and return (user_id, jti, exp_timestamp).

    :raises TokenException: if invalid, wrong type, or blacklisted.
    """
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=["HS256"],
            issuer=TOKEN_ISSUER,
            audience=TOKEN_AUDIENCE,
            options={"require": ["id", "type", "jti", "iss", "aud", "exp"]},
        )
        if payload.get("type") != TOKEN_TYPE_REFRESH:
            raise TokenException(
                code.token_invalid,
                _message("Invalid token type - refresh required"),
            )
        user_id = payload["id"]
        jti = payload.get("jti")
        exp = payload["exp"]
        if jti and await is_blacklisted(jti):
            raise TokenException(code.token_blocked, _message("Token has been revoked"))
        return user_id, jti, exp
    except InvalidTokenError:
        raise TokenException(
            code.token_invalid,
            _message("Could not validate credentials"),
        )


async def auth_must(
    token: str | None = Depends(oauth2_scheme),
    db_session: Session = Depends(session),
) -> V1UserAuth:
    """Require valid user token. Raises TokenException if invalid or blacklisted."""
    if not token:
        raise TokenException(code.token_need, _message("Token required"))
    model = V1UserAuth.decode_token(token)
    jti = _get_jti(token)
    if jti and await is_blacklisted(jti):
        raise TokenException(code.token_blocked, _message("Token has been revoked"))
    user = db_session.get(User, model.id)
    if not user:
        raise TokenException(code.token_invalid, _message("User not found"))
    model._user = user
    return model


def create_access_token(user_id: int) -> str:
    """Convenience: create access token with default 1 week expiry."""
    return V1UserAuth.create_access_token(user_id)


def create_refresh_token(user_id: int) -> str:
    """Create refresh token for token renewal."""
    return V1UserAuth.create_refresh_token(user_id)


async def auth_optional(
    token: str | None = Depends(oauth2_scheme),
    db_session: Session = Depends(session),
) -> V1UserAuth | None:
    """Optional auth. Returns None if no token or invalid. Catches TokenException only (L5)."""
    if token is None:
        return None
    try:
        return await auth_must(token, db_session)
    except TokenException:
        return None


async def key_must(headers: ApiKey = Header(), db_session: Session = Depends(session)) -> Key:
    """Validate API key from request headers."""
    model = db_session.exec(select(Key).where(Key.value == headers.api_key)).one_or_none()
    if model is None:
        raise TokenException(
            code.token_invalid,
            _message(f"Could not validate key credentials: {headers.api_key}"),
        )
    return model
