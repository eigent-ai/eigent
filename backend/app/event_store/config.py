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
"""Configuration for the local event store database."""

from __future__ import annotations

import os
from pathlib import Path


def get_event_db_path() -> Path:
    """Return the path to the local SQLite event log database.

    Resolution order:
    1. ``EIGENT_EVENT_DB_PATH`` environment variable (if set)
    2. ``~/.eigent/data/event_log.db`` (default)

    Parent directories are created automatically.
    """
    override = os.environ.get("EIGENT_EVENT_DB_PATH")
    if override:
        db_path = Path(override)
    else:
        db_path = (
            Path(os.path.expanduser("~")) / ".eigent" / "data" / "event_log.db"
        )

    db_path.parent.mkdir(parents=True, exist_ok=True)
    return db_path
