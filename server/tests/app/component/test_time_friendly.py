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

from datetime import date, datetime
from unittest.mock import patch

from app.component.time_friendly import monday_start_time, to_date


def test_to_date_iso_format_string():
    result = to_date("2026-01-15")
    assert result == date(2026, 1, 15)


def test_to_date_iso_datetime_string():
    result = to_date("2026-03-20T14:30:00")
    assert result == date(2026, 3, 20)


def test_to_date_custom_format():
    result = to_date("15/01/2026", "DD/MM/YYYY")
    assert result == date(2026, 1, 15)


def test_to_date_custom_format_us_style():
    result = to_date("01-15-2026", "MM-DD-YYYY")
    assert result == date(2026, 1, 15)


def test_to_date_invalid_date_returns_none():
    result = to_date("not-a-date")
    assert result is None


def test_to_date_empty_string_returns_none():
    result = to_date("")
    assert result is None


def test_to_date_wrong_format_returns_none():
    result = to_date("2026-01-15", "DD/MM/YYYY")
    assert result is None


def test_to_date_partial_date():
    result = to_date("2026-01")
    assert result is None or isinstance(result, date)


def test_monday_start_time_returns_datetime():
    result = monday_start_time()
    assert isinstance(result, datetime)


def test_monday_start_time_is_midnight():
    result = monday_start_time()
    assert result.hour == 0
    assert result.minute == 0
    assert result.second == 0
    assert result.microsecond == 0


def test_monday_start_time_day_is_monday():
    result = monday_start_time()
    assert result.weekday() == 0


def test_monday_start_time_not_in_future():
    result = monday_start_time()
    assert result <= datetime.now()


def test_monday_start_time_within_current_week():
    result = monday_start_time()
    now = datetime.now()
    days_diff = (now - result).days
    assert 0 <= days_diff <= 6
