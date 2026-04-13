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

"""v1 Login - 1h access token, refresh token, rate limit."""

import time

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi_babel import _
from loguru import logger
from pydantic import BaseModel
from sqlmodel import Session

from app.core import code
from app.core.database import session
from app.core.encrypt import password_verify
from app.core.environment import env
from app.model.user.user import LoginByPasswordIn, LoginResponse, Status, User
from app.shared.auth import create_access_token, create_refresh_token
from app.shared.auth.token_blacklist import blacklist_token
from app.shared.auth.user_auth import decode_refresh_token
from app.shared.exception import TokenException, UserException
from app.shared.middleware.rate_limit import login_rate_limiter

router = APIRouter(prefix="/user", tags=["V1 Login"])


@router.post("/dev_login", name="dev login (Swagger only)", include_in_schema=True)
async def dev_login(username: str | None = Form(default=None), password: str | None = Form(default=None)):
    """Debug-only login for Swagger Authorize. Accepts OAuth2 password form."""
    if env("debug", "") != "on":
        raise HTTPException(status_code=404)
    return {"access_token": create_access_token(1), "token_type": "bearer"}


@router.post("/auto-login", name="auto login for local mode")
async def auto_login(db_session: Session = Depends(session)) -> LoginResponse:
    """Auto login for fully local mode. Returns most recently active user or creates default."""
    user = User.by(
        User.status == Status.Normal,
        order_by=User.updated_at.desc(),
        limit=1,
        s=db_session,
    ).one_or_none()

    if not user:
        with db_session as s:
            try:
                user = User(
                    email="admin@local.eigent.ai",
                    username="admin",
                    nickname="Admin",
                    avatar="",
                    fullname="",
                    work_desc="",
                )
                s.add(user)
                s.commit()
                s.refresh(user)
                logger.info("Default admin user created", extra={"user_id": user.id})
            except Exception as e:
                s.rollback()
                logger.error("Failed to create default admin user", extra={"error": str(e)}, exc_info=True)
                raise UserException(code.error, _("Failed to create default user"))

    logger.info("Auto login successful", extra={"user_id": user.id, "email": user.email})
    return LoginResponse(token=create_access_token(user.id), email=user.email)


class RefreshTokenIn(BaseModel):
    refresh_token: str


@router.post("/login", name="login by email or password", dependencies=[login_rate_limiter])
async def by_password(data: LoginByPasswordIn, db_session: Session = Depends(session)) -> dict:
    """User login with email and password. Returns access_token (1h) and refresh_token (30d)."""
    user = User.by(User.email == data.email, s=db_session).one_or_none()
    if not user or not password_verify(data.password, user.password):
        raise UserException(code.password, _("Account or password error"))
    if user.status == Status.Block:
        raise UserException(code.error, _("Your account has been blocked."))
    if not user.is_active:
        raise UserException(code.error, _("Please activate your account via the email link."))

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "email": user.email,
    }


@router.post("/refresh", name="refresh tokens", dependencies=[login_rate_limiter])
async def refresh(data: RefreshTokenIn, db_session: Session = Depends(session)) -> dict:
    """Exchange valid refresh_token for new access_token and refresh_token."""
    if not data.refresh_token:
        raise TokenException(code.token_need, _("Refresh token required"))
    user_id, jti, exp_ts = await decode_refresh_token(data.refresh_token)
    user = db_session.get(User, user_id)
    if not user:
        raise TokenException(code.token_invalid, _("User not found"))
    if user.status == Status.Block:
        raise UserException(code.error, _("Your account has been blocked."))
    if not user.is_active:
        raise UserException(code.error, _("Please activate your account via the email link."))
    if jti:
        ttl = max(0, exp_ts - int(time.time()))
        await blacklist_token(jti, ttl)
    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "email": user.email,
    }
