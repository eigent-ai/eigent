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
"""Local-first event store for durable agent execution logging."""

from app.event_store.config import get_event_db_path
from app.event_store.schema import SCHEMA_VERSION, EventEnvelope
from app.event_store.sqlite_store import SQLiteTranscriptStore

__all__ = [
    "EventEnvelope",
    "SQLiteTranscriptStore",
    "SCHEMA_VERSION",
    "get_event_db_path",
]
