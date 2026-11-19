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

import pytest
from pydantic import ValidationError

from app.model.chat import Chat


def test_chat_defaults_auth_source_to_none(sample_chat_data):
    """Legacy api_key path: no marker, no behavior change."""
    chat = Chat(**sample_chat_data)
    assert chat.auth_source is None


def test_chat_accepts_codex_subscription_marker(sample_chat_data):
    chat = Chat(**{**sample_chat_data, "auth_source": "codex_subscription"})
    assert chat.auth_source == "codex_subscription"


def test_chat_rejects_unknown_auth_source(sample_chat_data):
    with pytest.raises(ValidationError):
        Chat(**{**sample_chat_data, "auth_source": "bogus_source"})
