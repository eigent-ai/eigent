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
