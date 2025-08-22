from datetime import datetime, timedelta

import arrow


def to_date(time: str, format: str | None = None):
    try:
        if format:
            return arrow.get(time, format).date()
        else:
            return arrow.get(time).date()
    except Exception as e:
        return None


def monday_start_time() -> datetime:
    # 获取当前时间
    now = datetime.now()
    # 计算今天是本周的第几天（星期一是0，星期天是6）
    weekday = now.weekday()
    # 计算本周一的日期
    monday = now - timedelta(days=weekday)
    # 设置时间为 0 点
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)
