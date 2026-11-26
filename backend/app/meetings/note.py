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
"""Render a meeting note as the Markdown file added to a Space."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.meetings.store import Meeting

# The first version has one note format (plan §4.6). The person fills it in;
# writing it from a transcript comes with the on-device model (plan §8).
DEFAULT_NOTE_TEMPLATE = (
    "## Summary\n\n\n"
    "## Decisions\n\n\n"
    "## Action items\n\n\n"
    "## Open questions\n\n"
)

MEETINGS_FOLDER = "Meetings"
_MAX_TITLE_CHARS = 80
# Characters that are invalid in a file name on macOS, Windows or Linux.
_UNSAFE_NAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')


def format_offset(ms: int) -> str:
    """Format a position in the meeting as ``m:ss`` or ``h:mm:ss``."""

    total_seconds = max(0, int(ms) // 1000)
    hours, rest = divmod(total_seconds, 3600)
    minutes, seconds = divmod(rest, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def _safe_title(title: str) -> str:
    cleaned = _UNSAFE_NAME_CHARS.sub(" ", title)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().strip(".").strip()
    if len(cleaned) > _MAX_TITLE_CHARS:
        cleaned = cleaned[:_MAX_TITLE_CHARS].rstrip()
    return cleaned or "Meeting"


def meeting_date(started_at: float) -> str:
    return datetime.fromtimestamp(started_at).strftime("%Y-%m-%d")


def meeting_file_name(title: str, started_at: float) -> str:
    """``Meetings/<YYYY-MM-DD> <title>.md`` relative to the Space folder."""

    return (
        f"{MEETINGS_FOLDER}/{meeting_date(started_at)} {_safe_title(title)}.md"
    )


def render_space_copy(meeting: Meeting) -> str:
    """Return the Markdown written into a Space for ``meeting``.

    The output depends only on the meeting, so its digest tells whether the
    note changed since it was added to a Space.
    """

    started = datetime.fromtimestamp(meeting.started_at)
    lines = [
        "---",
        f"title: {json.dumps(meeting.title, ensure_ascii=False)}",
        f"date: {started.isoformat(timespec='minutes')}",
        f"duration: {json.dumps(format_offset(meeting.duration_ms))}",
        f"meeting_id: {meeting.id}",
        "---",
        "",
        f"# {meeting.title}",
        "",
    ]
    note = meeting.note_markdown.strip()
    if note:
        lines.extend([note, ""])
    if meeting.typed_notes:
        lines.extend(["## Your notes", ""])
        for typed in meeting.typed_notes:
            text = " ".join(typed.text.split())
            lines.append(f"- [{format_offset(typed.at_ms)}] {text}")
        lines.append("")
    return "\n".join(lines)
