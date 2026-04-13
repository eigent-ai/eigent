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

"""
Trace-aware Redis pub/sub publish helper.

When publishing events from v1 code, use publish_with_trace to inject trace_id
into the event payload. Old code paths continue to use app.core.redis_utils directly.
"""

from app.shared.context import get_trace_id


def inject_trace_into_event(event_data: dict) -> dict:
    """Add trace_id to event_data if not present. Use before publishing."""
    data = dict(event_data)
    if "trace_id" not in data:
        data["trace_id"] = get_trace_id() or ""
    return data
