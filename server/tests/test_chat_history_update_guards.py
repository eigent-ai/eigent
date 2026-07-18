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

from types import SimpleNamespace

from app.domains.chat.api.history_controller import (
    _clamp_chat_history_string_fields,
    _drop_stale_ongoing_status,
)
from app.model.chat.chat_history import ChatHistory, ChatStatus


def test_clamp_chat_history_string_fields_uses_column_limits():
    data = {
        "project_name": "p" * 200,
        "summary": "s" * 1100,
        "tokens": 42,
    }

    _clamp_chat_history_string_fields(data)

    assert len(data["project_name"]) == ChatHistory.project_name.type.length
    assert len(data["summary"]) == ChatHistory.summary.type.length
    assert data["tokens"] == 42


def test_drop_stale_ongoing_status_preserves_done_history():
    history = SimpleNamespace(status=ChatStatus.done)
    update_data = {"status": ChatStatus.ongoing.value, "tokens": 12}

    _drop_stale_ongoing_status(history, update_data)

    assert "status" not in update_data
    assert update_data["tokens"] == 12


def test_drop_stale_ongoing_status_keeps_forward_progress():
    history = SimpleNamespace(status=ChatStatus.ongoing)
    update_data = {"status": ChatStatus.done.value}

    _drop_stale_ongoing_status(history, update_data)

    assert update_data["status"] == ChatStatus.done.value
