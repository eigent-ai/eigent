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

"""v1 admin auth with type: admin claim and blacklist check."""

import uuid
from datetime import datetime, timedelta

import jwt
from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer, SecurityScopes
from fastapi_babel import _
from jwt.exceptions import InvalidTokenError
from sqlmodel import Session

from app.core import code
from app.core.database import session
from app.core.environment import env, env_not_empty
from app.shared.exception import NoPermissionException, TokenException
from app.model.user.admin import Admin

from app.shared.auth.token_blacklist import is_blacklisted

SECRET_KEY = env_not_empty("secret_key")
TOKEN_EXPIRY = timedelta(hours=1)
TOKEN_TYPE_ADMIN = "admin"

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{env('url_prefix', '')}/v1/user/login",
    auto_error=False,
)


class V1AdminAuth:
    """v1 admin auth context."""

    def __init__(self, admin_id: int, expired_at: datetime):
        self.admin_id = admin_id
        self.expired_at = expired_at
        self._admin: Admin | None = None

    @property
    def user(self) -> Admin:
        if self._admin is None:
            raise NoPermissionException(_("Admin user not found"))
        return self._admin

    def can(self, *args: str) -> bool:
        if len(args) == 0:
            return True
        for item in self.user.roles:
            if set(item.permissions) & set(args):
                return True
        return False

    def check_permission(self, security_scopes: SecurityScopes, request: Request, db_session: Session) -> None:
        if not self.can(*security_scopes.scopes):
            raise NoPermissionException(_("Your are not authorized to access this function"))

    @classmethod
    def decode_token(cls, token: str) -> "V1AdminAuth":
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            token_type = payload.get("type", "admin")
            if token_type != TOKEN_TYPE_ADMIN:
                raise TokenException(code.token_invalid, _("Invalid token type - admin required"))
            admin_id = payload["admin_id"]
            if payload["exp"] < int(datetime.utcnow().timestamp()):
                raise TokenException(code.token_expired, _("Validate credentials expired"))
            return V1AdminAuth(admin_id, datetime.fromtimestamp(payload["exp"]))
        except InvalidTokenError:
            raise TokenException(code.token_invalid, _("Could not validate credentials"))

    @classmethod
    def create_access_token(cls, admin_id: int, expires_delta: timedelta | None = None) -> str:
        """Create admin token with type: admin claim."""
        expire = datetime.utcnow() + (expires_delta or TOKEN_EXPIRY)
        to_encode = {
            "admin_id": admin_id,
            "type": TOKEN_TYPE_ADMIN,
            "jti": str(uuid.uuid4()),
            "exp": expire,
        }
        return jwt.encode(to_encode, SECRET_KEY, algorithm="HS256")


def _get_jti(token: str) -> str | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"], options={"verify_exp": False})
        return payload.get("jti")
    except Exception:
        return None


async def admin_must(
    security_scopes: SecurityScopes,
    request: Request,
    token: str = Depends(oauth2_scheme),
    db_session: Session = Depends(session),
) -> V1AdminAuth:
    """Require valid admin token. Raises TokenException if invalid or blacklisted."""
    if not token:
        raise TokenException(code.token_need, _("Token required"))
    model = V1AdminAuth.decode_token(token)
    jti = _get_jti(token)
    if jti and await is_blacklisted(jti):
        raise TokenException(code.token_blocked, _("Token has been revoked"))
    admin = db_session.get(Admin, model.admin_id)
    if not admin:
        raise TokenException(code.token_invalid, _("Admin not found"))
    model._admin = admin
    model.check_permission(security_scopes, request, db_session)
    return model
