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
"""Meetings: local recordings and notes that can be added to any Space.

See ``docs/meeting-notes-plan.md``. Everything here stays on this computer
under :func:`app.utils.workspace_paths.meetings_root` and is never synced.
"""

from app.meetings.note import (
    DEFAULT_NOTE_TEMPLATE,
    format_offset,
    meeting_file_name,
    render_space_copy,
)
from app.meetings.space_copy import (
    MeetingCopyConflictError,
    MeetingCopyPathError,
    content_digest,
    write_space_copy,
)
from app.meetings.store import (
    MEETING_STATUSES,
    Meeting,
    MeetingNotFoundError,
    MeetingSpaceLink,
    MeetingStore,
    TypedNote,
    get_meeting_store,
    reset_meeting_store,
)

__all__ = [
    "DEFAULT_NOTE_TEMPLATE",
    "MEETING_STATUSES",
    "Meeting",
    "MeetingCopyConflictError",
    "MeetingCopyPathError",
    "MeetingNotFoundError",
    "MeetingSpaceLink",
    "MeetingStore",
    "TypedNote",
    "content_digest",
    "format_offset",
    "get_meeting_store",
    "meeting_file_name",
    "render_space_copy",
    "reset_meeting_store",
    "write_space_copy",
]
