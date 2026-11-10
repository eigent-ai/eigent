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

from unittest.mock import patch

from app.run_runtime.timeout_config import (
    normalize_optional_timeout_seconds,
    optional_timeout_seconds_from_env,
)


def test_non_positive_timeout_disables_outer_guard():
    assert normalize_optional_timeout_seconds(0) is None
    assert normalize_optional_timeout_seconds(-1) is None


def test_positive_timeout_preserves_explicit_hard_limit():
    assert normalize_optional_timeout_seconds(3600) == 3600


def test_invalid_override_falls_back_to_unbounded_default():
    with (
        patch("app.run_runtime.timeout_config.env", return_value="invalid"),
        patch("app.run_runtime.timeout_config.logger") as logger,
    ):
        assert optional_timeout_seconds_from_env("LONG_RUN_LIMIT") is None

    logger.warning.assert_called_once()


def test_invalid_override_can_fall_back_to_stall_watchdog():
    with patch("app.run_runtime.timeout_config.env", return_value="invalid"):
        assert (
            optional_timeout_seconds_from_env(
                "LONG_RUN_STALL_LIMIT",
                default=1800,
            )
            == 1800
        )
