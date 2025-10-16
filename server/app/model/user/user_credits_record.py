from enum import IntEnum
from typing import Optional
from pydantic import BaseModel
from sqlmodel import Relationship, SQLModel, Field, Column, col, select, Session
from sqlalchemy_utils import ChoiceType
from sqlalchemy import Boolean, SmallInteger, text
from app.model.abstract.model import AbstractModel, DefaultTimes
from datetime import date, datetime, timedelta
from app.model.user.key import ModelType
from app.component.database import session_make
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("user_credits_record")


class CreditsChannel(IntEnum):
    register = 1  # 注册赠送
    invite = 2  # 邀请赠送
    daily = 3  # 每日刷新积分
    monthly = 4  # 每月刷新积分
    paid = 5  # 付费积分
    addon = 6  # 加量包
    consume = 7  # 任务消费


class CreditsPriority(IntEnum):
    daily = 1  # 每日刷新积分
    monthly = 2  # 每月刷新积分
    paid = 3  # 付费积分
    addon = 4  # 加量包


class CreditsPoint(IntEnum):
    register = 1000
    invite = 500
    special_register = 1500  # 1000 register + 500 invite credit


class UserCreditsRecord(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    invite_by: int = Field(default=None, nullable=True, description="invite by user id")
    invite_code: str = Field(default="", max_length=255)
    amount: int = Field(default=0)
    balance: int = Field(default=0)
    channel: CreditsChannel = Field(
        default=CreditsChannel.register.value, sa_column=Column(ChoiceType(CreditsChannel, SmallInteger()))
    )
    source_id: int = Field(default=0, description="source id")
    remark: str = Field(default="", max_length=255)
    expire_at: datetime = Field(default=None, nullable=True, description="Expiration time")
    used: bool = Field(
        default=False,
        sa_column=Column(Boolean, server_default=text("false")),
        description="Is this record used/expired",
    )
    used_at: datetime = Field(default=None, nullable=True, description="Time when this record was used/expired")

    @classmethod
    def get_permanent_credits(cls, user_id: int) -> int:
        """
        获取可用的token总量，直接用SQL聚合sum
        Returns:
            int: 可用的token总量
        """
        session = session_make()
        from sqlalchemy import func

        statement = (
            select(func.sum(UserCreditsRecord.amount))
            .where(UserCreditsRecord.user_id == user_id)
            .where(
                UserCreditsRecord.channel.in_(
                    [
                        CreditsChannel.register,
                        CreditsChannel.invite,
                        CreditsChannel.paid,
                        CreditsChannel.addon,
                        CreditsChannel.monthly,
                    ]
                )
            )
            .where(UserCreditsRecord.used == False)
            .where((UserCreditsRecord.expire_at.is_(None)) | (col(UserCreditsRecord.expire_at) > datetime.now()))
        )
        result = session.exec(statement).first()
        return result or 0

    @classmethod
    def get_temp_credits(cls, user_id: int) -> tuple[int, date]:
        """
        1. 获取可用的临时token总量，需要通过credits 然后根据model_type来计算
        2. 每天只允许赠送一次临时的量

        Returns:
            int: 可用的临时token总量
        """
        session = session_make()
        statement = (
            select(UserCreditsRecord)
            .where(UserCreditsRecord.user_id == user_id)
            .where(UserCreditsRecord.channel == CreditsChannel.daily)
            .where(UserCreditsRecord.used == False)
            .where(UserCreditsRecord.expire_at.is_not(None))
            .where(col(UserCreditsRecord.expire_at) > datetime.now())
        )
        record: UserCreditsRecord = session.exec(statement).first()
        if record is None:
            return 0, None
        return record.amount - record.balance, record.expire_at

    @classmethod
    def consume_credits(cls, user_id: int, amount: int, session: Session, source_id: int = 0, remark: str = ""):
        """
        消耗积分，优先消耗每日积分（daily），再消耗monthly、paid、addon等。
        消耗时更新UserCreditsRecord的balance字段，记录已消耗积分数。
        同时生成积分消耗记录，更新用户积分credits字段（不包括每日积分）。
        避免重复生成积分消耗记录和重复扣减积分。
        """

        # 检查是否已有积分消耗记录
        existing_consume_record = None
        if source_id > 0:
            existing_consume_record = session.exec(
                select(UserCreditsRecord)
                .where(UserCreditsRecord.user_id == user_id)
                .where(UserCreditsRecord.channel == CreditsChannel.consume)
                .where(UserCreditsRecord.source_id == source_id)
            ).first()

        if existing_consume_record:
            # 如果新amount更大，需要额外消耗积分
            if amount > 0:
                existing_consume_record.amount -= amount
                session.add(existing_consume_record)
                # 直接处理额外的积分消耗，不生成新的消耗记录
                cls._consume_credits_internal_update(user_id, amount, session, source_id, remark)
            # 如果新amount更小，需要退还积分（这里可以根据业务需求决定是否实现）
            else:
                # 暂时不实现退还逻辑，可以根据需要添加
                pass

            session.commit()
            return

        # 没有现有记录，执行正常的积分消耗流程
        cls._consume_credits_internal(user_id, amount, session, source_id, remark)

    @classmethod
    def _consume_credits_internal(
        cls, user_id: int, amount: int, session: Session, source_id: int = 0, remark: str = ""
    ):
        """
        内部积分消耗逻辑，处理实际的积分扣减
        """
        from app.model.user.user import User

        remain = amount
        now = datetime.now()
        consumed_from_daily = 0
        consumed_from_other = 0

        # 优先消耗daily
        statement = (
            select(UserCreditsRecord)
            .where(UserCreditsRecord.user_id == user_id)
            .where(UserCreditsRecord.channel == CreditsChannel.daily)
            .where(UserCreditsRecord.used == False)
            .where(UserCreditsRecord.expire_at.is_not(None))
            .where(col(UserCreditsRecord.expire_at) > now)
            .order_by(UserCreditsRecord.expire_at)
        )
        daily_records = session.exec(statement).first()
        if daily_records:
            can_consume = daily_records.amount - daily_records.balance
            use = min(remain, can_consume)
            daily_records.balance += use
            session.add(daily_records)
            remain -= use
            consumed_from_daily = use
            if remain == 0:
                # 生成积分消耗记录
                consume_record = UserCreditsRecord(
                    user_id=user_id,
                    amount=-amount,
                    channel=CreditsChannel.consume,
                    source_id=source_id,
                    remark=remark or f"Consumed {amount} credits (daily: {consumed_from_daily})",
                )
                session.add(consume_record)
                session.commit()
                return

        # 若daily不够，继续消耗monthly/paid/addon
        if remain > 0:
            statement = (
                select(UserCreditsRecord)
                .where(UserCreditsRecord.user_id == user_id)
                .where(
                    UserCreditsRecord.channel.in_(
                        [
                            CreditsChannel.monthly,
                            CreditsChannel.paid,
                            CreditsChannel.addon,
                            CreditsChannel.register,
                            CreditsChannel.invite,
                        ]
                    )
                )
                .where(UserCreditsRecord.used == False)
                .where((UserCreditsRecord.expire_at.is_(None)) | (col(UserCreditsRecord.expire_at) > now))
                .order_by(UserCreditsRecord.expire_at)
            )
            other_records = session.exec(statement).all()
            for record in other_records:
                can_consume = record.amount - record.balance
                if can_consume <= 0:
                    continue
                use = min(remain, can_consume)
                record.balance += use
                session.add(record)
                remain -= use
                consumed_from_other += use
                if remain == 0:
                    break

        # 更新用户积分字段（只扣除非每日积分消耗的部分）
        if consumed_from_other > 0:
            user = session.exec(select(User).where(User.id == user_id)).first()
            if user:
                user.credits -= consumed_from_other
                session.add(user)

        # 生成积分消耗记录
        consume_record = UserCreditsRecord(
            user_id=user_id,
            amount=-amount,
            channel=CreditsChannel.consume,
            source_id=source_id,
            remark=remark or f"Consumed {amount} credits (daily: {consumed_from_daily}, other: {consumed_from_other})",
        )
        session.add(consume_record)
        session.commit()

        if remain > 0:
            raise Exception(f"Insufficient credits: need {amount}, remain {remain}")

    @classmethod
    def _consume_credits_internal_update(
        cls, user_id: int, amount: int, session: Session, source_id: int = 0, remark: str = ""
    ):
        """
        内部积分消耗逻辑（更新模式），处理实际的积分扣减但不生成新的消耗记录
        用于更新现有消耗记录时的额外积分消耗
        """
        from app.model.user.user import User

        remain = amount
        now = datetime.now()
        consumed_from_daily = 0
        consumed_from_other = 0

        # 优先消耗daily
        statement = (
            select(UserCreditsRecord)
            .where(UserCreditsRecord.user_id == user_id)
            .where(UserCreditsRecord.channel == CreditsChannel.daily)
            .where(UserCreditsRecord.used == False)
            .where(UserCreditsRecord.expire_at.is_not(None))
            .where(col(UserCreditsRecord.expire_at) > now)
            .order_by(UserCreditsRecord.expire_at)
        )
        daily_records = session.exec(statement).first()
        if daily_records:
            can_consume = daily_records.amount - daily_records.balance
            use = min(remain, can_consume)
            daily_records.balance += use
            session.add(daily_records)
            remain -= use
            consumed_from_daily = use
            if remain == 0:
                # 不生成新的消耗记录，只更新现有记录
                return

        # 若daily不够，继续消耗monthly/paid/addon
        if remain > 0:
            statement = (
                select(UserCreditsRecord)
                .where(UserCreditsRecord.user_id == user_id)
                .where(
                    UserCreditsRecord.channel.in_(
                        [
                            CreditsChannel.monthly,
                            CreditsChannel.paid,
                            CreditsChannel.addon,
                            CreditsChannel.register,
                            CreditsChannel.invite,
                        ]
                    )
                )
                .where(UserCreditsRecord.used == False)
                .where((UserCreditsRecord.expire_at.is_(None)) | (col(UserCreditsRecord.expire_at) > now))
                .order_by(UserCreditsRecord.expire_at)
            )
            other_records = session.exec(statement).all()
            for record in other_records:
                can_consume = record.amount - record.balance
                if can_consume <= 0:
                    continue
                use = min(remain, can_consume)
                record.balance += use
                session.add(record)
                remain -= use
                consumed_from_other += use
                if remain == 0:
                    break
        logger.info(f"consumed_from_other: {consumed_from_other}")
        # 更新用户积分字段（只扣除非每日积分消耗的部分）
        if consumed_from_other > 0:
            user = session.exec(select(User).where(User.id == user_id)).first()
            if user:
                user.credits -= consumed_from_other
                session.add(user)

        # 不生成新的消耗记录，因为现有记录已经在主函数中更新了

        if remain > 0:
            raise Exception(f"Insufficient credits: need {amount}, remain {remain}")

    @classmethod
    def get_daily_balance_sum(cls, user_id: int) -> int:
        """
        获取用户所有每日积分（daily channel）的balance字段之和
        """
        session = session_make()
        statement = (
            select(UserCreditsRecord.balance)
            .where(UserCreditsRecord.user_id == user_id)
            .where(UserCreditsRecord.channel == CreditsChannel.daily)
        )
        balances = session.exec(statement).all()
        return sum(balances) if balances else 0

    @classmethod
    def get_daily_balance(cls, user_id: int) -> int:
        """
        获取用户当前的每日积分数据
        """
        session = session_make()
        statement = (
            select(UserCreditsRecord)
            .where(UserCreditsRecord.user_id == user_id)
            .where(UserCreditsRecord.channel == CreditsChannel.daily)
            .where(UserCreditsRecord.used == False)
        )
        record = session.exec(statement).first()
        return record


class UserCreditsRecordWithChatOut(BaseModel):
    """扩展的积分记录输出模型，包含聊天历史信息"""

    amount: int
    balance: int
    channel: CreditsChannel
    source_id: int
    expire_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    # 聊天历史相关字段（当channel为consume且source_id有效时）
    chat_project_name: Optional[str] = None
    chat_tokens: Optional[int] = None


class UserCreditsRecordOut(BaseModel):
    amount: int
    balance: int
    channel: CreditsChannel
    source_id: int
    remark: str
    expire_at: datetime | None
    created_at: datetime
    updated_at: datetime | None
