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
"""Authenticated local Meetings API (``docs/meeting-notes-plan.md``).

Meetings live on this computer only. Logs here never include titles,
notes or transcript text (plan §6).
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.auth import require_local_control_principal
from app.meetings import (
    Meeting,
    MeetingCopyConflictError,
    MeetingCopyPathError,
    MeetingNotFoundError,
    MeetingSpaceLink,
    MeetingStore,
    TypedNote,
    content_digest,
    get_meeting_store,
    meeting_file_name,
    render_space_copy,
    write_space_copy,
)
from app.utils.workspace_resolver import get_workspace_resolver

router = APIRouter(dependencies=[Depends(require_local_control_principal)])
logger = logging.getLogger(__name__)

# Audio the first version accepts, by file extension (plan §4.2). ``webm`` is
# what the renderer's recorder writes.
RECORDING_EXTENSIONS = {
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mp4": "audio/mp4",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
}
MAX_RECORDING_BYTES = 2 * 1024 * 1024 * 1024
_CHUNK_BYTES = 1024 * 1024
_MAX_TYPED_NOTES = 2000


class CreateMeetingBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    started_at: float | None = None


class TypedNoteBody(BaseModel):
    at_ms: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=4000)


class UpdateMeetingBody(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    status: Literal["ready", "interrupted", "failed"] | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    ended_at: float | None = None
    typed_notes: list[TypedNoteBody] | None = Field(
        default=None, max_length=_MAX_TYPED_NOTES
    )
    note_markdown: str | None = Field(default=None, max_length=200_000)


class SpaceIdentityBody(BaseModel):
    email: str = Field(min_length=1)
    user_id: str | int | None = None
    overwrite: bool = False


def _store() -> MeetingStore:
    return get_meeting_store()


def _not_found(meeting_id: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={
            "code": "meeting_not_found",
            "message": f"No meeting {meeting_id}.",
        },
    )


def _get_meeting(store: MeetingStore, meeting_id: str) -> Meeting:
    try:
        return store.get(meeting_id)
    except MeetingNotFoundError as exc:
        raise _not_found(meeting_id) from exc


def _link_payload(meeting: Meeting, link: MeetingSpaceLink) -> dict:
    current = content_digest(render_space_copy(meeting))
    return {
        "space_id": link.space_id,
        "relative_path": link.relative_path,
        "written_at": link.written_at,
        "changed_since_added": current != link.digest,
    }


def _meeting_payload(store: MeetingStore, meeting: Meeting) -> dict:
    data = meeting.to_dict()
    data["spaces"] = [
        _link_payload(meeting, link) for link in store.links(meeting.id)
    ]
    return data


def _recording_extension(file_name: str | None) -> str:
    extension = Path(file_name or "").suffix.lower()
    if extension not in RECORDING_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail={
                "code": "meeting_recording_format_unsupported",
                "message": "Use an m4a, mp3, wav, ogg, webm or mp4 file.",
            },
        )
    return extension


async def _save_recording(
    store: MeetingStore,
    meeting_id: str,
    upload: UploadFile,
    base_name: str,
) -> Meeting:
    extension = _recording_extension(upload.filename)
    folder = store.recording_dir(meeting_id)
    folder.mkdir(parents=True, exist_ok=True)
    file_name = f"{base_name}{extension}"
    partial = folder / f".{file_name}.partial"
    size = 0
    try:
        with partial.open("wb") as handle:
            while chunk := await upload.read(_CHUNK_BYTES):
                size += len(chunk)
                if size > MAX_RECORDING_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail={
                            "code": "meeting_recording_too_large",
                            "message": "The recording is larger than 2 GB.",
                        },
                    )
                handle.write(chunk)
        partial.replace(folder / file_name)
    finally:
        partial.unlink(missing_ok=True)
    return store.attach_recording(meeting_id, file_name=file_name, size=size)


def _space_root(space_id: str, body: SpaceIdentityBody) -> Path:
    binding = get_workspace_resolver().store.get_binding(
        body.email, space_id, body.user_id
    )
    if binding is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "workspace_binding_not_found",
                "message": "The Space has no local folder.",
            },
        )
    root = Path(binding.workspace_root).expanduser()
    if not root.is_dir():
        raise HTTPException(
            status_code=409,
            detail={
                "code": "workspace_binding_unavailable",
                "message": "The Space's folder is unavailable.",
            },
        )
    return root.resolve()


@router.get("/meetings/capabilities")
async def meeting_capabilities():
    """What this build can do. The Apple bridge adds the rest (plan §5.1)."""

    return {
        "recording": {"microphone": True, "system_audio": False},
        "live_transcript": False,
        "note_writing": False,
        "import_extensions": sorted(RECORDING_EXTENSIONS),
    }


@router.get("/meetings")
async def list_meetings(q: Annotated[str | None, Query()] = None):
    store = _store()
    meetings = store.list_meetings(q)
    links = store.links_for([meeting.id for meeting in meetings])
    items = []
    for meeting in meetings:
        data = meeting.to_dict()
        data["spaces"] = [
            _link_payload(meeting, link) for link in links[meeting.id]
        ]
        items.append(data)
    return {"items": items}


@router.post("/meetings", status_code=201)
async def create_meeting(body: CreateMeetingBody):
    store = _store()
    meeting = store.create(
        title=body.title.strip(),
        source="microphone",
        status="recording",
        started_at=body.started_at,
    )
    logger.info("Meeting started: %s", meeting.id)
    return _meeting_payload(store, meeting)


@router.post("/meetings/import", status_code=201)
async def import_meeting(
    file: Annotated[UploadFile, File()],
    title: Annotated[str | None, Form(max_length=200)] = None,
):
    _recording_extension(file.filename)
    store = _store()
    fallback = Path(file.filename or "").stem.strip() or "Imported recording"
    meeting = store.create(
        title=(title or "").strip() or fallback[:200],
        source="import",
        status="ready",
    )
    try:
        meeting = await _save_recording(store, meeting.id, file, "import")
    except BaseException:
        store.delete(meeting.id)
        raise
    meeting = store.update(meeting.id, ended_at=time.time())
    logger.info("Meeting imported: %s", meeting.id)
    return _meeting_payload(store, meeting)


@router.get("/meetings/{meeting_id}")
async def get_meeting(meeting_id: str):
    store = _store()
    return _meeting_payload(store, _get_meeting(store, meeting_id))


@router.patch("/meetings/{meeting_id}")
async def update_meeting(meeting_id: str, body: UpdateMeetingBody):
    store = _store()
    _get_meeting(store, meeting_id)
    typed = (
        [
            TypedNote(at_ms=item.at_ms, text=item.text)
            for item in body.typed_notes
        ]
        if body.typed_notes is not None
        else None
    )
    meeting = store.update(
        meeting_id,
        title=body.title.strip() if body.title else None,
        status=body.status,
        duration_ms=body.duration_ms,
        ended_at=body.ended_at,
        typed_notes=typed,
        note_markdown=body.note_markdown,
    )
    return _meeting_payload(store, meeting)


@router.delete("/meetings/{meeting_id}")
async def delete_meeting(meeting_id: str):
    store = _store()
    meeting = _get_meeting(store, meeting_id)
    kept = [link.space_id for link in store.links(meeting.id)]
    store.delete(meeting.id)
    logger.info("Meeting deleted: %s", meeting.id)
    # Space copies are Space files and stay where they are (plan §6).
    return {"deleted": True, "space_copies_kept": kept}


@router.post("/meetings/{meeting_id}/recording")
async def upload_recording(
    meeting_id: str, file: Annotated[UploadFile, File()]
):
    store = _store()
    _get_meeting(store, meeting_id)
    meeting = await _save_recording(store, meeting_id, file, "microphone")
    return _meeting_payload(store, meeting)


@router.get("/meetings/{meeting_id}/recording")
async def get_recording(meeting_id: str):
    store = _store()
    meeting = _get_meeting(store, meeting_id)
    path = store.recording_path(meeting)
    if path is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "meeting_recording_not_found",
                "message": "This meeting has no recording.",
            },
        )
    return FileResponse(
        path,
        media_type=RECORDING_EXTENSIONS.get(
            path.suffix.lower(), "application/octet-stream"
        ),
    )


@router.post("/meetings/{meeting_id}/spaces/{space_id}")
async def add_meeting_to_space(
    meeting_id: str, space_id: str, body: SpaceIdentityBody
):
    """Copy the note into the Space folder as a Markdown file (plan §4.5)."""

    store = _store()
    meeting = _get_meeting(store, meeting_id)
    root = _space_root(space_id, body)
    link = store.get_link(meeting.id, space_id)
    relative_path = (
        link.relative_path
        if link is not None
        else meeting_file_name(meeting.title, meeting.started_at)
    )
    try:
        digest = write_space_copy(
            root,
            relative_path,
            render_space_copy(meeting),
            known_digest=link.digest if link is not None else None,
            overwrite=body.overwrite,
        )
    except MeetingCopyConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "meeting_copy_conflict",
                "reason": exc.reason,
                "relative_path": exc.relative_path,
                "message": (
                    "The file in the Space was changed. Replace it only"
                    " after the person confirms."
                ),
            },
        ) from exc
    except MeetingCopyPathError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "meeting_copy_path_invalid",
                "message": "The note's path is outside the Space folder.",
            },
        ) from exc
    store.save_link(
        meeting.id, space_id, relative_path=relative_path, digest=digest
    )
    logger.info("Meeting %s added to Space %s", meeting.id, space_id)
    return _meeting_payload(store, store.get(meeting.id))


@router.delete("/meetings/{meeting_id}/spaces/{space_id}")
async def remove_meeting_from_space(meeting_id: str, space_id: str):
    """Forget the link. The file stays in the Space (plan §4.5)."""

    store = _store()
    meeting = _get_meeting(store, meeting_id)
    if not store.delete_link(meeting.id, space_id):
        raise HTTPException(
            status_code=404,
            detail={
                "code": "meeting_space_link_not_found",
                "message": "The meeting was not added to this Space.",
            },
        )
    return _meeting_payload(store, store.get(meeting.id))
