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


router = APIRouter(tags=["User"])


@router.get("/user", name="user info", response_model=UserOut)
def get(auth: Auth = Depends(auth_must), session: Session = Depends(session)):
    # 获取用户信息时触发积分刷新
    user: User = auth.user
    user.refresh_credits_on_active(session)
    return user


@router.put("/user", name="update user info", response_model=UserOut)
def put(data: UserIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    model = auth.user
    model.username = data.username
    model.save(session)
    return model


@router.put("/user/profile", name="update user profile", response_model=UserProfile)
def put_profile(data: UserProfile, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    model = auth.user
    model.nickname = data.nickname
    model.fullname = data.fullname
    model.work_desc = data.work_desc
    model.save(session)
    return model


@router.get("/user/privacy", name="get user privacy")
def get_privacy(session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    user_id = auth.user.id
    stmt = select(UserPrivacy).where(UserPrivacy.user_id == user_id)
    model = session.exec(stmt).one_or_none()

    if not model:
        return UserPrivacySettings.default_settings()
    return model.privacy_setting


@router.put("/user/privacy", name="update user privacy")
def put_privacy(data: UserPrivacySettings, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    user_id = auth.user.id
    stmt = select(UserPrivacy).where(UserPrivacy.user_id == user_id)
    model = session.exec(stmt).one_or_none()
    default_settings = UserPrivacySettings.default_settings()

    if model:
        model.privacy_setting = {**model.privacy_setting, **data.model_dump()}
        model.save(session)
    else:
        model = UserPrivacy(user_id=user_id, privacy_setting={**default_settings, **data.model_dump()})
        model.save(session)

    return model.privacy_setting


@router.get("/user/current_credits", name="get user current credits")
def get_user_credits(auth: Auth = Depends(auth_must), session: Session = Depends(session)):
    user = auth.user
    user.refresh_credits_on_active(session)
    credits = user.credits
    daily_credits: UserCreditsRecord | None = UserCreditsRecord.get_daily_balance(user.id)
    current_daily_credits = 0
    if daily_credits:
        current_daily_credits = daily_credits.amount - daily_credits.balance
        credits += current_daily_credits if current_daily_credits > 0 else 0
    return {"credits": credits, "daily_credits": current_daily_credits}


@router.get("/user/stat", name="get user stat", response_model=UserStatOut)
def get_user_stat(auth: Auth = Depends(auth_must), session: Session = Depends(session)):
    """Get current user's operation statistics."""
    stat = session.exec(select(UserStat).where(UserStat.user_id == auth.user.id)).first()
    data = UserStatOut()
    if stat:
        data = UserStatOut(**stat.model_dump())
    else:
        data = UserStatOut(user_id=auth.user.id)
    data.task_queries = ChatHistory.count(ChatHistory.user_id == auth.user.id, s=session)
    mcp = McpUser.count(McpUser.user_id == auth.user.id, s=session)
    tool: list = session.exec(
        select(func.count("*")).where(Config.user_id == auth.user.id).group_by(Config.config_group)
    ).all()
    tool = tool.__len__()
    data.mcp_install_count = mcp + tool
    data.storage_used = ChatSnapshot.caclDir(ChatSnapshot.get_user_dir(auth.user.id))
    return data


@router.post("/user/stat", name="record user stat")
def record_user_stat(
    data: UserStatActionIn,
    auth: Auth = Depends(auth_must),
    session: Session = Depends(session),
):
    """Record or update current user's operation statistics."""
    data.user_id = auth.user.id
    stat = UserStat.record_action(session, data)
    return stat
