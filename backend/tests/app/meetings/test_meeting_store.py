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

from datetime import datetime

import pytest

from app.meetings import (
    DEFAULT_NOTE_TEMPLATE,
    MeetingCopyConflictError,
    MeetingCopyPathError,
    MeetingNotFoundError,
    MeetingStore,
    TypedNote,
    content_digest,
    format_offset,
    meeting_file_name,
    render_space_copy,
    write_space_copy,
)


def test_store_keeps_meetings_under_its_root(tmp_path):
    store = MeetingStore(tmp_path / "meetings")

    meeting = store.create(title="Weekly sync")

    assert (tmp_path / "meetings" / "meetings.sqlite").is_file()
    assert meeting.status == "recording"
    assert meeting.note_markdown == DEFAULT_NOTE_TEMPLATE
    assert not meeting.note_edited
    assert store.recording_dir(meeting.id) == (
        tmp_path / "meetings" / "recordings" / meeting.id
    )


def test_update_saves_notes_and_marks_the_note_edited(tmp_path):
    store = MeetingStore(tmp_path)
    meeting = store.create(title="Planning")

    updated = store.update(
        meeting.id,
        status="ready",
        duration_ms=125_000,
        typed_notes=[TypedNote(at_ms=61_000, text="Ship on Friday")],
        note_markdown="## Summary\n\nAgreed the plan.\n",
    )

    assert updated.status == "ready"
    assert updated.duration_ms == 125_000
    assert updated.typed_notes == (TypedNote(61_000, "Ship on Friday"),)
    assert updated.note_edited
    assert store.get(meeting.id) == updated


def test_list_is_newest_first_and_searches_titles_and_notes(tmp_path):
    store = MeetingStore(tmp_path)
    older = store.create(title="Budget review", started_at=1_000)
    newer = store.create(title="Design crit", started_at=2_000)
    store.update(
        older.id, typed_notes=[TypedNote(at_ms=0, text="Hire 2 engineers")]
    )

    assert [m.id for m in store.list_meetings()] == [newer.id, older.id]
    assert [m.id for m in store.list_meetings("design")] == [newer.id]
    assert [m.id for m in store.list_meetings("engineers")] == [older.id]
    # LIKE wildcards in the query are matched literally.
    assert store.list_meetings("%") == []


def test_reopening_the_store_marks_unfinished_recordings_interrupted(
    tmp_path,
):
    store = MeetingStore(tmp_path)
    meeting = store.create(title="Call")
    store.update(meeting.id, typed_notes=[TypedNote(1_000, "kept")])

    reopened = MeetingStore(tmp_path)

    recovered = reopened.get(meeting.id)
    assert recovered.status == "interrupted"
    assert recovered.typed_notes == (TypedNote(1_000, "kept"),)


def test_delete_removes_the_recording_and_links(tmp_path):
    store = MeetingStore(tmp_path)
    meeting = store.create(title="Call")
    folder = store.recording_dir(meeting.id)
    folder.mkdir(parents=True)
    (folder / "microphone.webm").write_bytes(b"audio")
    store.attach_recording(meeting.id, file_name="microphone.webm", size=5)
    store.save_link(
        meeting.id, "space-1", relative_path="Meetings/a.md", digest="x"
    )

    store.delete(meeting.id)

    assert not folder.exists()
    assert store.get_link(meeting.id, "space-1") is None
    with pytest.raises(MeetingNotFoundError):
        store.get(meeting.id)


def test_ids_that_are_not_meeting_ids_are_rejected(tmp_path):
    store = MeetingStore(tmp_path)

    with pytest.raises(MeetingNotFoundError):
        store.get("../meetings")
    with pytest.raises(MeetingNotFoundError):
        store.recording_dir("../../etc")


def test_attach_recording_rejects_paths(tmp_path):
    store = MeetingStore(tmp_path)
    meeting = store.create(title="Call")

    with pytest.raises(ValueError):
        store.attach_recording(meeting.id, file_name="../x.webm", size=1)


def test_format_offset():
    assert format_offset(0) == "0:00"
    assert format_offset(61_500) == "1:01"
    assert format_offset(3_725_000) == "1:02:05"


def test_file_name_is_dated_and_safe():
    started = datetime(2026, 11, 18, 10, 30).timestamp()

    assert meeting_file_name("Q4 / plan: draft?", started) == (
        "Meetings/2026-11-18 Q4 plan draft.md"
    )
    assert (
        meeting_file_name("...", started) == "Meetings/2026-11-18 Meeting.md"
    )


def test_render_space_copy_has_front_matter_note_and_typed_notes(tmp_path):
    store = MeetingStore(tmp_path)
    meeting = store.create(
        title='Kickoff "alpha"',
        started_at=datetime(2026, 11, 18, 9, 5).timestamp(),
    )
    meeting = store.update(
        meeting.id,
        duration_ms=90_000,
        note_markdown="## Summary\n\nWe start Monday.\n",
        typed_notes=[TypedNote(30_000, "Ask legal\nabout terms")],
    )

    rendered = render_space_copy(meeting)

    assert rendered.startswith('---\ntitle: "Kickoff \\"alpha\\""\n')
    assert "date: 2026-11-18T09:05\n" in rendered
    assert 'duration: "1:30"\n' in rendered
    assert f"meeting_id: {meeting.id}\n" in rendered
    assert "## Summary\n\nWe start Monday." in rendered
    assert "## Your notes\n\n- [0:30] Ask legal about terms\n" in rendered
    # Rendering is deterministic, so digests compare edits.
    assert render_space_copy(meeting) == rendered


def test_space_copy_writes_and_never_overwrites_edits_silently(tmp_path):
    space = tmp_path / "space"
    space.mkdir()

    digest = write_space_copy(
        space, "Meetings/a.md", "first", known_digest=None
    )
    assert (space / "Meetings" / "a.md").read_text() == "first"
    assert digest == content_digest("first")

    # The note changed and the Space file is still what Eigent wrote.
    digest = write_space_copy(
        space, "Meetings/a.md", "second", known_digest=digest
    )
    assert (space / "Meetings" / "a.md").read_text() == "second"

    # The person edited the copy in the Space: ask before replacing it.
    (space / "Meetings" / "a.md").write_text("edited in the Space")
    with pytest.raises(MeetingCopyConflictError) as conflict:
        write_space_copy(space, "Meetings/a.md", "third", known_digest=digest)
    assert conflict.value.reason == "edited"
    assert (space / "Meetings" / "a.md").read_text() == "edited in the Space"

    write_space_copy(
        space,
        "Meetings/a.md",
        "third",
        known_digest=digest,
        overwrite=True,
    )
    assert (space / "Meetings" / "a.md").read_text() == "third"


def test_space_copy_does_not_take_over_a_file_it_did_not_write(tmp_path):
    space = tmp_path / "space"
    (space / "Meetings").mkdir(parents=True)
    (space / "Meetings" / "a.md").write_text("someone else's file")

    with pytest.raises(MeetingCopyConflictError) as conflict:
        write_space_copy(space, "Meetings/a.md", "note", known_digest=None)

    assert conflict.value.reason == "exists"


@pytest.mark.parametrize(
    "relative_path", ["../outside.md", "/abs.md", "Meetings/../../x.md"]
)
def test_space_copy_stays_inside_the_space(tmp_path, relative_path):
    space = tmp_path / "space"
    space.mkdir()

    with pytest.raises(MeetingCopyPathError):
        write_space_copy(space, relative_path, "x", known_digest=None)

    assert not (tmp_path / "outside.md").exists()
