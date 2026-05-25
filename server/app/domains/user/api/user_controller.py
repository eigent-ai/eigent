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
from app.model.user.user import User, UserIn, UserOut, UserProfile, BillingSummaryOut
from app.model.user.user_stat import UserStat, UserStatActionIn, UserStatOut
from app.model.user.user_credits_record import CreditsChannel, UserCreditsRecord
from app.model.pay.order import Order, OrderStatus, OrderType
from app.model.config.plan import Plan
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


def _available_credit_amount(record: UserCreditsRecord) -> int:
    return max(0, (record.amount or 0) - (record.balance or 0))


@router.get("/user/billing-summary", name="get billing summary", response_model=BillingSummaryOut)
def get_billing_summary(db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)):
    user: User = auth.user
    db_session.refresh(user)

    daily_record = UserCreditsRecord.get_daily_balance(user.id)
    credits_daily = _available_credit_amount(daily_record) if daily_record else 0

    monthly_records = db_session.exec(
        select(UserCreditsRecord).where(
            UserCreditsRecord.user_id == user.id,
            UserCreditsRecord.channel == CreditsChannel.monthly,
            UserCreditsRecord.used == False,
        )
    ).all()
    credits_monthly = sum(_available_credit_amount(record) for record in monthly_records)

    credits_permanent = UserCreditsRecord.get_permanent_credits(user.id)
    credits_total = user.credits + credits_daily + credits_monthly

    subscription_mode = "free"
    plan_name = "Free"
    if user.email.endswith("@local.eigent.ai"):
        subscription_mode = "local"
        plan_name = "Local"

    latest_plan_order = db_session.exec(
        select(Order)
        .where(
            Order.user_id == user.id,
            Order.order_type == OrderType.plan,
            Order.status == OrderStatus.success,
        )
        .order_by(Order.created_at.desc())
    ).first()

    if latest_plan_order:
        subscription_mode = "paid"
        plan_name = (latest_plan_order.extra or {}).get("plan_name", plan_name)
        if latest_plan_order.plan_id:
            plan = db_session.get(Plan, latest_plan_order.plan_id)
            if plan:
                plan_name = plan.name

    return BillingSummaryOut(
        email=user.email,
        subscription_mode=subscription_mode,
        plan_name=plan_name,
        credits_total=credits_total,
        credits_daily=credits_daily,
        credits_monthly=credits_monthly,
        credits_permanent=credits_permanent,
    )
