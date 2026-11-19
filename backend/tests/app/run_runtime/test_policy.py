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

from __future__ import annotations

import pytest

from app.run_policy import (
    RunTimeoutPolicy,
    TimeoutOutcome,
    TimeoutScope,
    ToolSafetyClass,
    automatic_tool_replay_allowed,
)


def test_timeout_policy_validates_independent_scopes():
    policy = RunTimeoutPolicy(
        policy_version="v3",
        default_activity_timeout_ms=1_000,
        activity_timeout_by_type={"model_request": 2_000},
        tool_timeout_by_class={"safe_read": 500},
        approval_expiry_action="keep_pending",
    )
    assert RunTimeoutPolicy.from_dict(policy.to_dict()) == policy
    with pytest.raises(ValueError, match="positive"):
        RunTimeoutPolicy(default_activity_timeout_ms=0)


def test_timeout_outcome_requires_scope_specific_identity():
    with pytest.raises(ValueError, match="tool_call_id"):
        TimeoutOutcome(
            scope=TimeoutScope.TOOL,
            policy_version="v1",
            reason="deadline",
            started_at=1,
            ended_at=2,
            run_id="run-1",
        )
    with pytest.raises(ValueError, match="activity_id"):
        TimeoutOutcome(
            scope=TimeoutScope.ACTIVITY,
            policy_version="v1",
            reason="deadline",
            started_at=1,
            ended_at=2,
            run_id="run-1",
        )


def test_external_side_effect_replay_policy_is_fail_closed():
    assert automatic_tool_replay_allowed(
        ToolSafetyClass.SAFE_READ, idempotency_key=None
    )
    assert automatic_tool_replay_allowed(
        ToolSafetyClass.IDEMPOTENT_WRITE, idempotency_key="key-1"
    )
    assert not automatic_tool_replay_allowed(
        ToolSafetyClass.INTERNAL_CONTROL, idempotency_key=None
    )
    assert not automatic_tool_replay_allowed(
        ToolSafetyClass.IDEMPOTENT_WRITE, idempotency_key=None
    )
    assert not automatic_tool_replay_allowed(
        ToolSafetyClass.UNSAFE_WRITE, idempotency_key="ignored"
    )
