from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlmodel import Session, select
from app.component.auth import Auth, auth_must
from app.component.database import session
from app.model.user.privacy import UserPrivacy, UserPrivacySettings
from app.model.user.user import User, UserIn, UserOut, UserProfile
from app.model.user.user_stat import UserStat, UserStatActionIn, UserStatOut
from app.model.chat.chat_history import ChatHistory
from app.model.mcp.mcp_user import McpUser
from app.model.config.config import Config
from app.model.chat.chat_snpshot import ChatSnapshot
from app.model.user.user_credits_record import UserCreditsRecord
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_user_controller")

router = APIRouter(tags=["User"])


@router.get("/user", name="user info", response_model=UserOut)
@traceroot.trace()
def get(auth: Auth = Depends(auth_must), session: Session = Depends(session)):
    """Get current user information and refresh credits."""
    user: User = auth.user
    user.refresh_credits_on_active(session)
    logger.debug("User info retrieved", extra={"user_id": user.id})
    return user


@router.put("/user", name="update user info", response_model=UserOut)
@traceroot.trace()
def put(data: UserIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Update user basic information."""
    model = auth.user
    model.username = data.username
    model.save(session)
    logger.info("User info updated", extra={"user_id": model.id, "username": data.username})
    return model


@router.put("/user/profile", name="update user profile", response_model=UserProfile)
@traceroot.trace()
def put_profile(data: UserProfile, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Update user profile details."""
    model = auth.user
    model.nickname = data.nickname
    model.fullname = data.fullname
    model.work_desc = data.work_desc
    model.save(session)
    logger.info("User profile updated", extra={"user_id": model.id, "nickname": data.nickname})
    return model


@router.get("/user/privacy", name="get user privacy")
@traceroot.trace()
def get_privacy(session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Get user privacy settings."""
    user_id = auth.user.id
    stmt = select(UserPrivacy).where(UserPrivacy.user_id == user_id)
    model = session.exec(stmt).one_or_none()

    if not model:
        logger.debug("Privacy settings not found, returning defaults", extra={"user_id": user_id})
        return UserPrivacySettings.default_settings()
    
    logger.debug("Privacy settings retrieved", extra={"user_id": user_id})
    return model.pricacy_setting


@router.put("/user/privacy", name="update user privacy")
@traceroot.trace()
def put_privacy(data: UserPrivacySettings, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Update user privacy settings."""
    user_id = auth.user.id
    stmt = select(UserPrivacy).where(UserPrivacy.user_id == user_id)
    model = session.exec(stmt).one_or_none()
    default_settings = UserPrivacySettings.default_settings()

    if model:
        model.pricacy_setting = {**model.pricacy_setting, **data.model_dump()}
        model.save(session)
        logger.info("Privacy settings updated", extra={"user_id": user_id})
    else:
        model = UserPrivacy(user_id=user_id, pricacy_setting={**default_settings, **data.model_dump()})
        model.save(session)
        logger.info("Privacy settings created", extra={"user_id": user_id})

    return model.pricacy_setting


@router.get("/user/current_credits", name="get user current credits")
@traceroot.trace()
def get_user_credits(auth: Auth = Depends(auth_must), session: Session = Depends(session)):
    """Get user's current credit balance."""
    user = auth.user
    user.refresh_credits_on_active(session)
    credits = user.credits
    daily_credits: UserCreditsRecord | None = UserCreditsRecord.get_daily_balance(user.id)
    current_daily_credits = 0
    if daily_credits:
        current_daily_credits = daily_credits.amount - daily_credits.balance
        credits += current_daily_credits if current_daily_credits > 0 else 0
    
    logger.debug("Credits retrieved", extra={"user_id": user.id, "total_credits": credits, "daily_credits": current_daily_credits})
    return {"credits": credits, "daily_credits": current_daily_credits}


@router.get("/user/stat", name="get user stat", response_model=UserStatOut)
@traceroot.trace()
def get_user_stat(auth: Auth = Depends(auth_must), session: Session = Depends(session)):
    """Get current user's operation statistics."""
    user_id = auth.user.id
    stat = session.exec(select(UserStat).where(UserStat.user_id == user_id)).first()
    data = UserStatOut()
    
    if stat:
        data = UserStatOut(**stat.model_dump())
    else:
        data = UserStatOut(user_id=user_id)
    
    data.task_queries = ChatHistory.count(ChatHistory.user_id == user_id, s=session)
    mcp = McpUser.count(McpUser.user_id == user_id, s=session)
    tool: list = session.exec(
        select(func.count("*")).where(Config.user_id == user_id).group_by(Config.config_group)
    ).all()
    tool = tool.__len__()
    data.mcp_install_count = mcp + tool
    data.storage_used = ChatSnapshot.caclDir(ChatSnapshot.get_user_dir(user_id))
    
    logger.debug("User stats retrieved", extra={
        "user_id": user_id,
        "task_queries": data.task_queries,
        "mcp_install_count": data.mcp_install_count,
        "storage_used": data.storage_used
    })
    return data


@router.post("/user/stat", name="record user stat")
@traceroot.trace()
def record_user_stat(
    data: UserStatActionIn,
    auth: Auth = Depends(auth_must),
    session: Session = Depends(session),
):
    """Record or update current user's operation statistics."""
    data.user_id = auth.user.id
    stat = UserStat.record_action(session, data)
    logger.info("User stat recorded", extra={"user_id": data.user_id, "action": data.action if hasattr(data, 'action') else "unknown"})
    return stat