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
from app.component.environment import env
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_login_controller")


router = APIRouter(tags=["Login/Registration"])


@router.post("/login", name="login by email or password")
@traceroot.trace()
async def by_password(data: LoginByPasswordIn, session: Session = Depends(session)) -> LoginResponse:
    """
    User login with email and password
    """
    logger.info(f"Login attempt for email: {data.email}")
    user = User.by(User.email == data.email, s=session).one_or_none()
    if not user or not password_verify(data.password, user.password):
        logger.warning(f"Failed login attempt for email: {data.email}")
        raise UserException(code.password, _("Account or password error"))
    logger.info(f"Successful login for user: {user.id}")
    return LoginResponse(token=Auth.create_access_token(user.id), email=user.email)


@router.post("/login-by_stack", name="login by stack")
@traceroot.trace()
async def by_stack_auth(
    token: str,
    type: str = "signup",
    invite_code: str | None = None,
    session: Session = Depends(session),
):
    logger.info(f"Stack auth attempt, type: {type}")
    try:
        stack_id = await StackAuth.user_id(token)
        info = await StackAuth.user_info(token)
        logger.debug(f"Stack auth successful for stack_id: {stack_id}")
    except Exception as e:
        logger.error(f"Stack auth failed: {e}", exc_info=True)
        raise HTTPException(500, detail=_(f"{e}"))
    user = User.by(User.stack_id == stack_id, s=session).one_or_none()

    if not user:
        # Only signup can create user
        if type != "signup":
            logger.warning(f"User not found for stack_id: {stack_id}, type: {type}")
            raise UserException(code.error, _("User not found"))
        logger.info(f"Creating new user via stack auth: {info.get('primary_email')}")
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
                logger.info(f"New user registered via stack auth: {user.id}")
                return LoginResponse(token=Auth.create_access_token(user.id), email=user.email)
            except Exception as e:
                s.rollback()
                logger.error(f"Failed to register via stack auth: {e}", exc_info=True)
                raise UserException(code.error, _("Failed to register"))
    else:
        if user.status == Status.Block:
            logger.warning(f"Blocked user attempted login: {user.id}")
            raise UserException(code.error, _("Your account has been blocked."))
        logger.info(f"Existing user logged in via stack auth: {user.id}")
        return LoginResponse(token=Auth.create_access_token(user.id), email=user.email)


@router.post("/register", name="register by email/password")
@traceroot.trace()
async def register(data: RegisterIn, session: Session = Depends(session)):
    logger.info(f"Registration attempt for email: {data.email}")
    # Check if email is already registered
    if User.by(User.email == data.email, s=session).one_or_none():
        logger.warning(f"Registration failed - email already exists: {data.email}")
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
            logger.info(f"New user registered: {user.id}, email: {user.email}")
        except Exception as e:
            s.rollback()
            logger.error(f"Failed to register user: {e}", exc_info=True)
            raise UserException(code.error, _("Failed to register"))
    return {"status": "success"}
