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

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlmodel import Session, select

from app.core.database import session
from app.model.chat.chat_history import ChatHistory
from app.model.chat.chat_snpshot import ChatSnapshot
from app.model.config.config import Config
from app.model.mcp.mcp_user import McpUser
from app.model.user.privacy import UserPrivacy, UserPrivacySettings
from app.model.user.user import User, UserIn, UserOut, UserProfile
from app.model.user.user_stat import UserStat, UserStatActionIn, UserStatOut
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth

router = APIRouter(tags=["User"])


@router.get("/user", name="user info", response_model=UserOut)
def get(db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)):
    user: User = auth.user
    db_session.refresh(user)
    return user


@router.put("/user", name="update user info", response_model=UserOut)
def put(data: UserIn, db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)):
    model = auth.user
    model.username = data.username
    model.save(db_session)
    return model


@router.put("/user/profile", name="update user profile", response_model=UserProfile)
def put_profile(data: UserProfile, db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)):
    model = auth.user
    model.nickname = data.nickname
    model.fullname = data.fullname
    model.work_desc = data.work_desc
    model.save(db_session)
    return model


@router.get("/user/privacy", name="get user privacy")
def get_privacy(db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)):
    user_id = auth.id
    stmt = select(UserPrivacy).where(UserPrivacy.user_id == user_id)
    model = db_session.exec(stmt).one_or_none()
    if not model:
        return UserPrivacySettings.default_settings()
    return UserPrivacySettings(**model.pricacy_setting).to_response()


@router.put("/user/privacy", name="update user privacy")
def put_privacy(
    data: UserPrivacySettings, db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)
):
    user_id = auth.id
    stmt = select(UserPrivacy).where(UserPrivacy.user_id == user_id)
    model = db_session.exec(stmt).one_or_none()
    default_settings = UserPrivacySettings.default_settings()

    if model:
        model.pricacy_setting = {**model.pricacy_setting, **data.model_dump(exclude_unset=True)}
        model.save(db_session)
    else:
        model = UserPrivacy(
            user_id=user_id, pricacy_setting={**default_settings, **data.model_dump(exclude_unset=True)}
        )
        model.save(db_session)

    return UserPrivacySettings(**model.pricacy_setting).to_response()


@router.get("/user/stat", name="get user stat", response_model=UserStatOut)
def get_user_stat(db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)):
    stat = db_session.exec(select(UserStat).where(UserStat.user_id == auth.id)).first()
    data = UserStatOut()
    if stat:
        data = UserStatOut(**stat.model_dump())
    else:
        data = UserStatOut(user_id=auth.id)
    data.task_queries = ChatHistory.count(ChatHistory.user_id == auth.id, s=db_session)
    mcp = McpUser.count(McpUser.user_id == auth.id, s=db_session)
    tool: list = db_session.exec(
        select(func.count("*")).where(Config.user_id == auth.id).group_by(Config.config_group)
    ).all()
    tool = tool.__len__()
    data.mcp_install_count = mcp + tool
    data.storage_used = ChatSnapshot.caclDir(ChatSnapshot.get_user_dir(auth.id))
    return data


@router.post("/user/stat", name="record user stat")
def record_user_stat(
    data: UserStatActionIn,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    data.user_id = auth.id
    stat = UserStat.record_action(db_session, data)
    return stat
