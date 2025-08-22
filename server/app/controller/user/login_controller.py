from fastapi import APIRouter, Depends, HTTPException
from fastapi_babel import _
from sqlmodel import Session
from app.component import code
from app.component.auth import Auth
from app.component.database import session
from app.component.encrypt import password_verify
from app.component.stack_auth import StackAuth
from app.exception.exception import UserException
from app.model.user.user import LoginByPasswordIn, LoginResponse, Status, User, RegisterIn
from pydantic import BaseModel
from loguru import logger
from app.component.environment import env
from datetime import datetime
import jwt


router = APIRouter(tags=["Login/Registration"])


class RefreshTokenRequest(BaseModel):
    refresh_token: str


@router.post("/login", name="login by email or password")
async def by_password(data: LoginByPasswordIn, session: Session = Depends(session)) -> LoginResponse:
    """
    User login with email and password
    """
    user = User.by(User.email == data.email, s=session).one_or_none()
    if not user or not password_verify(data.password, user.password):
        raise UserException(code.password, _("Account or password error"))
    return LoginResponse(
        access_token=Auth.create_access_token(user.id),
        refresh_token=Auth.create_refresh_token(user.id),
        email=user.email
    )


@router.post("/login-by_stack", name="login by stack")
async def by_stack_auth(
    token: str,
    type: str = "signup",
    invite_code: str | None = None,
    session: Session = Depends(session),
):
    try:
        stack_id = await StackAuth.user_id(token)
        info = await StackAuth.user_info(token)
    except Exception as e:
        logger.error(e)
        raise HTTPException(500, detail=_(f"{e}"))
    user = User.by(User.stack_id == stack_id, s=session).one_or_none()

    if not user:
        # Only signup can create user
        if type != "signup":
            raise UserException(code.error, _("User not found"))
        with session as s:
            try:
                user = User(
                    username=info["username"] if "username" in info else None,
                    nickname=info["display_name"],
                    email=info["primary_email"],
                    avatar=info["profile_image_url"],
                    stack_id=stack_id,
                )
                s.add(user)
                s.commit()
                session.refresh(user)
                return LoginResponse(
        access_token=Auth.create_access_token(user.id),
        refresh_token=Auth.create_refresh_token(user.id),
        email=user.email
    )
            except Exception as e:
                s.rollback()
                logger.error(f"Failed to register: {e}")
                raise UserException(code.error, _("Failed to register"))
    else:
        if user.status == Status.Block:
            raise UserException(code.error, _("Your account has been blocked."))
        return LoginResponse(
        access_token=Auth.create_access_token(user.id),
        refresh_token=Auth.create_refresh_token(user.id),
        email=user.email
    )


@router.post("/register", name="register by email/password")
async def register(data: RegisterIn, session: Session = Depends(session)):
    # Check if email is already registered
    if User.by(User.email == data.email, s=session).one_or_none():
        raise UserException(code.error, _("Email already registered"))

    with session as s:
        try:
            user = User(
                email=data.email,
                password=data.password,
            )
            s.add(user)
            s.commit()
            s.refresh(user)
        except Exception as e:
            s.rollback()
            logger.error(f"Failed to register: {e}")
            raise UserException(code.error, _("Failed to register"))
    return {"status": "success"}


@router.post("/refresh", name="refresh access token")
async def refresh_token(data: RefreshTokenRequest, session: Session = Depends(session)) -> LoginResponse:
    """
    Refresh the access token using a valid refresh token.
    """
    try:
        # Decode the refresh token
        payload = jwt.decode(data.refresh_token, Auth.SECRET_KEY, algorithms=["HS256"])
        
        # Verify it's a refresh token
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
            
        # Check if expired
        if payload["exp"] < int(datetime.now().timestamp()):
            raise HTTPException(status_code=401, detail="Refresh token expired")
            
        # Get the user
        user_id = payload["id"]
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
            
        # Check if user is blocked
        if user.status == Status.Block:
            raise HTTPException(status_code=401, detail="User account is blocked")
            
        # Generate new tokens
        return LoginResponse(
            access_token=Auth.create_access_token(user.id),
            refresh_token=Auth.create_refresh_token(user.id),
            email=user.email
        )
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
