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

import inspect


def test_grouped_history_has_total_failed_tasks_key():
    """The defaultdict factory must include total_failed_tasks."""
    from app.controller.chat.history_controller import list_grouped_chat_history

    source = inspect.getsource(list_grouped_chat_history)
    assert '"total_failed_tasks"' in source and "0" in source, (
        "defaultdict factory is missing total_failed_tasks key"
    )
