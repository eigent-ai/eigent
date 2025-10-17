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
    email = data.email
    user = User.by(User.email == email, s=session).one_or_none()
    
    if not user:
        logger.warning("Login failed: user not found", extra={"email": email})
        raise UserException(code.password, _("Account or password error"))
    
    if not password_verify(data.password, user.password):
        logger.warning("Login failed: invalid password", extra={"user_id": user.id, "email": email})
        raise UserException(code.password, _("Account or password error"))
    
    logger.info("User login successful", extra={"user_id": user.id, "email": email})
    return LoginResponse(token=Auth.create_access_token(user.id), email=user.email)


@router.post("/login-by_stack", name="login by stack")
@traceroot.trace()
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
        logger.error("Stack auth failed", extra={"type": type, "error": str(e)}, exc_info=True)
        raise HTTPException(500, detail=_("Authentication failed"))
    
    user = User.by(User.stack_id == stack_id, s=session).one_or_none()

    if not user:
        if type != "signup":
            logger.warning("Stack auth signup blocked: user not found", extra={"stack_id": stack_id, "type": type})
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
                s.refresh(user)
                logger.info("New user registered via stack", extra={"user_id": user.id, "email": user.email, "stack_id": stack_id})
                return LoginResponse(token=Auth.create_access_token(user.id), email=user.email)
            except Exception as e:
                s.rollback()
                logger.error("Stack auth registration failed", extra={"stack_id": stack_id, "error": str(e)}, exc_info=True)
                raise UserException(code.error, _("Failed to register"))
    else:
        if user.status == Status.Block:
            logger.warning("Blocked user login attempt", extra={"user_id": user.id, "stack_id": stack_id})
            raise UserException(code.error, _("Your account has been blocked."))
        
        logger.info("User login via stack successful", extra={"user_id": user.id, "email": user.email, "stack_id": stack_id})
        return LoginResponse(token=Auth.create_access_token(user.id), email=user.email)


@router.post("/register", name="register by email/password")
@traceroot.trace()
async def register(data: RegisterIn, session: Session = Depends(session)):
    email = data.email
    
    if User.by(User.email == email, s=session).one_or_none():
        logger.warning("Registration failed: email already exists", extra={"email": email})
        raise UserException(code.error, _("Email already registered"))

    with session as s:
        try:
            user = User(
                email=email,
                password=data.password,
            )
            s.add(user)
            s.commit()
            s.refresh(user)
            logger.info("User registered successfully", extra={"user_id": user.id, "email": email})
        except Exception as e:
            s.rollback()
            logger.error("User registration failed", extra={"email": email, "error": str(e)}, exc_info=True)
            raise UserException(code.error, _("Failed to register"))
    
    return {"status": "success"}