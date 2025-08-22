from enum import Enum
from sqlmodel import Field, Column, SQLModel, SmallInteger, Session
from sqlalchemy import JSON
from app.model.abstract.model import AbstractModel, DefaultTimes
from pydantic import BaseModel


class OrderType(int, Enum):
    single = 1  # 单次/加量包
    plan = 2  # 套餐订阅
    addon = 3  # 加量包
    other = 99  # 其他


class OrderAddonPrice(str, Enum):
    addon_200: 20
    addon_500: 50


class OrderStatus(int, Enum):
    pending = 1  # 等待支付
    success = 2  # 支付成功
    cancel = -1  # 放弃支付
    refund = 3


class Order(AbstractModel, DefaultTimes, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    order_type: OrderType = Field(sa_column=Column(SmallInteger))
    price: int = 0
    status: OrderStatus = Field(OrderStatus.pending, sa_column=Column(SmallInteger))
    payment_method: str = Field(default="", max_length=32)
    stripe_id: str = Field(max_length=1024)
    third_party_id: str | None = Field(default=None, max_length=1024)
    plan_id: int | None = Field(default=None, foreign_key="plan.id")
    period: str | None = Field(default=None, max_length=16)
    buy_type: int | None = Field(default=None)  # 仅加量包/次数包
    use_num: int | None = Field(default=None)
    left_num: int | None = Field(default=None)
    extra: dict = Field(default_factory=dict, sa_column=Column(JSON))

    def mark_success(self, third_party_id: str | None = None, s: Session = None):
        self.status = OrderStatus.success
        if third_party_id:
            self.third_party_id = third_party_id
        if s:
            s.add(self)
            s.commit()

    def mark_failed(self, s: Session = None):
        self.status = OrderStatus.cancel
        if s:
            s.add(self)
            s.commit()

    def mark_pending(self, s: Session = None):
        self.status = OrderStatus.pending
        if s:
            s.add(self)
            s.commit()

    @classmethod
    def create_addon_order(
        cls, user_id: int, buy_type: int, price: int, payment_method: str, stripe_id: str, s: Session
    ):
        order = cls(
            user_id=user_id,
            order_type=OrderType.addon,
            buy_type=buy_type,
            use_num=buy_type,
            left_num=buy_type,
            price=price,
            status=OrderStatus.pending,
            payment_method=payment_method,
            stripe_id=stripe_id,
        )
        s.add(order)
        s.commit()
        return order

    @classmethod
    def create_plan_order(
        cls,
        user_id: int,
        plan_id: int,
        period: str,
        price: int,
        payment_method: str,
        stripe_id: str,
        plan_name: str,
        s: Session,
    ):
        order = cls(
            user_id=user_id,
            order_type=OrderType.plan,
            plan_id=plan_id,
            period=period,
            price=price,
            status=OrderStatus.pending,
            payment_method=payment_method,
            stripe_id=stripe_id,
            extra={"plan_name": plan_name},
        )
        s.add(order)
        s.commit()
        return order


class PlanPeriod(str, Enum):
    monthly = "monthly"
    yearly = "yearly"


class PlanKey(str, Enum):
    plus = "plus"
    pro = "pro"


class PlanOrderCreate(BaseModel):
    plan_key: PlanKey
    period: PlanPeriod


class AddonPlanKey(str, Enum):
    addon_200 = "addon_29.90"
    addon_500 = "addon_69.90"


class OrderAddonCreate(BaseModel):
    plan_key: AddonPlanKey
