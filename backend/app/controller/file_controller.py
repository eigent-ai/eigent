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

import json
import logging
import mimetypes
import re
import time
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.component.environment import env
from app.utils.file_utils import list_files, resolve_under_base

router = APIRouter()
file_logger = logging.getLogger("file_controller")

# Config
MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50MB
MAX_FILES_PER_SESSION = 20
WORKSPACE_ROOT = env("EIGENT_WORKSPACE", "~/.eigent/workspace")
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _get_eigent_root() -> Path:
    """Base root for eigent storage (~/eigent). Do NOT use env file_save_path
    here: chat overwrites it to task path, which would break list/stream."""
    eigent = Path.home() / "eigent"
    if eigent.exists():
        return eigent
    dot_eigent = Path.home() / ".eigent"
    if dot_eigent.exists():
        return dot_eigent
    return eigent  # default to ~/eigent


def _get_workspace_root() -> Path:
    return Path(WORKSPACE_ROOT).expanduser()


def _validate_session_id(session_id: str) -> str:
    normalized = (session_id or "").strip()
    if not SESSION_ID_PATTERN.fullmatch(normalized):
        raise ValueError("Invalid X-Session-ID")
    return normalized


def _get_session_uploads_dir(session_id: str) -> Path:
    root = _get_workspace_root().resolve()
    validated = _validate_session_id(session_id)
    uploads_dir = (root / validated / "uploads").resolve()
    try:
        uploads_dir.relative_to(root)
    except ValueError as exc:
        raise ValueError("Invalid X-Session-ID") from exc
    return uploads_dir


def _count_session_uploads(session_id: str) -> int:
    uploads_dir = _get_session_uploads_dir(session_id)
    if not uploads_dir.exists():
        return 0
    return len(list(uploads_dir.iterdir()))


@router.post("/files")
async def upload_file(
    file: Annotated[UploadFile, File()],
    x_session_id: Annotated[str | None, Header(alias="X-Session-ID")] = None,
) -> dict:
    """
    Upload file. Requires X-Session-ID header.
    Returns file_id for message attachments reference.
    """
    if not x_session_id:
        raise HTTPException(
            status_code=400,
            detail="X-Session-ID header is required for file upload",
        )
    try:
        validated_session_id = _validate_session_id(x_session_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="Invalid X-Session-ID"
        ) from exc

    # Check session file count limit
    count = _count_session_uploads(validated_session_id)
    if count >= MAX_FILES_PER_SESSION:
        raise HTTPException(
            status_code=429,
            detail=f"Maximum {MAX_FILES_PER_SESSION} files per session",
        )

    # Read and validate size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File size exceeds {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB limit",
        )

    # Generate safe filename
    timestamp = int(time.time() * 1000)
    safe_name = "".join(
        c if c.isalnum() or c in "._-" else "_"
        for c in (file.filename or "file")
    )
    stored_name = f"{safe_name}_{timestamp}"

    # Write to disk
    uploads_dir = _get_session_uploads_dir(validated_session_id)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    target_path = uploads_dir / stored_name
    target_path.write_bytes(content)

    file_id = f"upload://{stored_name}"
    file_logger.info(
        f"File uploaded: session={validated_session_id}, file_id={file_id}, size={len(content)}"
    )

    return {
        "file_id": file_id,
        "filename": file.filename or "file",
        "size": len(content),
    }


def _sanitize_email(email: str) -> str:
    """Sanitize email for use in path (match chat_controller logic)."""
    return re.sub(r'[\\/*?:"<>|\s]', "_", email.split("@")[0]).strip(".")


def _normalize_relative_path(path: str) -> str:
    """Normalize relative path to URL-safe POSIX style."""
    return path.replace("\\", "/")


def _get_project_root(email: str, project_id: str) -> Path:
    """Get project root path: ~/eigent/{email}/project_{project_id}/."""
    root = _get_eigent_root()
    email_sanitized = _sanitize_email(email)
    return root / email_sanitized / f"project_{project_id}"


def _resolve_project_root(email: str, project_id: str) -> Path:
    """
    Resolve project root, preferring the email-scoped path but falling back to
    any local project_{project_id} directory when the stored email differs from
    the current login identity.
    """
    preferred = _get_project_root(email, project_id)
    if preferred.exists():
        return preferred

    root = _get_eigent_root()
    candidate_name = f"project_{project_id}"
    try:
        for child in root.iterdir():
            if not child.is_dir():
                continue
            candidate = child / candidate_name
            if candidate.exists():
                file_logger.info(
                    "Resolved project root via fallback lookup: %s -> %s",
                    preferred,
                    candidate,
                )
                return candidate
    except FileNotFoundError:
        pass
    except Exception as e:
        file_logger.warning("project root fallback lookup failed: %s", e)

    return preferred


def _resolve_widget_file(widget_dir: Path, file_name: str) -> Path:
    normalized = (file_name or "").strip().replace("\\", "/")
    if not normalized:
        raise ValueError("Widget manifest entry is empty")
    candidate = (widget_dir / normalized).resolve()
    widget_root = widget_dir.resolve()
    try:
        candidate.relative_to(widget_root)
    except ValueError as exc:
        raise ValueError(
            "Widget manifest entry must stay inside widget/"
        ) from exc
    if not candidate.is_file():
        raise FileNotFoundError(normalized)
    return candidate


def _read_widget_html(
    widget_dir: Path, manifest: dict[str, Any], key: str
) -> tuple[str, str]:
    file_name = manifest.get(key)
    if not isinstance(file_name, str):
        raise ValueError(f"Widget manifest field '{key}' must be a string")
    file_path = _resolve_widget_file(widget_dir, file_name)
    return file_path.read_text(encoding="utf-8"), file_path.as_posix()


def _widget_preview_url(email: str, project_id: str, file_path: str) -> str:
    return (
        f"/files/preview/{quote(email, safe='')}/"
        f"{quote(project_id, safe='')}/{quote(file_path, safe='/')}"
    )


@router.get("/projects/{project_id}/widget")
async def get_project_widget(
    project_id: str,
    email: str = Query(..., description="User email"),
) -> dict:
    """
    Load the active project's generated widget folder.
    Reads only project_root/widget/{widget.json, preview entry, full entry}.
    """
    if not project_id or not email:
        raise HTTPException(
            status_code=400,
            detail="project_id and email are required",
        )

    project_root = _resolve_project_root(email, project_id)
    widget_dir = (project_root / "widget").resolve()
    try:
        widget_dir.relative_to(project_root.resolve())
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="Invalid widget path"
        ) from exc

    if not widget_dir.is_dir():
        return {"exists": False}

    manifest_path = widget_dir / "widget.json"
    if not manifest_path.is_file():
        raise HTTPException(
            status_code=400,
            detail="widget/widget.json is required",
        )

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail="widget/widget.json is invalid JSON",
        ) from exc

    if not isinstance(manifest, dict):
        raise HTTPException(
            status_code=400,
            detail="widget/widget.json must contain an object",
        )

    try:
        preview_html, preview_path = _read_widget_html(
            widget_dir, manifest, "preview"
        )
        entry_html, entry_path = _read_widget_html(
            widget_dir, manifest, "entry"
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Widget file not found: {exc}",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    widget_stat = manifest_path.stat()
    updated_at = manifest.get("updatedAt") or str(widget_stat.st_mtime)

    preview_rel = (
        Path(preview_path).relative_to(project_root.resolve()).as_posix()
    )
    entry_rel = Path(entry_path).relative_to(project_root.resolve()).as_posix()

    return {
        "exists": True,
        "manifest": manifest,
        "previewHtml": preview_html,
        "entryHtml": entry_html,
        "previewUrl": _widget_preview_url(email, project_id, preview_rel),
        "entryUrl": _widget_preview_url(email, project_id, entry_rel),
        "updatedAt": updated_at,
    }


@router.get("/files")
async def list_project_files(
    project_id: str = Query(..., description="Project ID"),
    email: str = Query(..., description="User email"),
    task_id: str | None = Query(
        None, description="Optional task ID to scope listing"
    ),
) -> list[dict]:
    """
    List files in project working directory (Brain storage).
    Used by Web mode when ipcRenderer is unavailable.
    Returns [{filename, url}] where url can be used to fetch file content.
    """
    if not project_id or not email:
        raise HTTPException(
            status_code=400,
            detail="project_id and email are required",
        )
    project_root = _resolve_project_root(email, project_id)
    list_dir = str(project_root)
    if task_id:
        list_dir = str(project_root / f"task_{task_id}")
    if not Path(list_dir).exists():
        file_logger.debug(
            "list_project_files: path does not exist: %s",
            list_dir,
        )
        return []
    base_path = str(project_root.resolve())
    try:
        paths = list_files(list_dir, base=base_path, max_entries=500)
    except Exception as e:
        file_logger.warning("list_project_files failed: %s", e)
        return []
    result: list[dict] = []
    for abs_path in paths:
        try:
            rel = _normalize_relative_path(
                Path(abs_path).relative_to(base_path).as_posix()
            )
            # URL-encode the relative path for stream endpoint
            path_param = quote(rel, safe="")
            result.append(
                {
                    "filename": Path(abs_path).name,
                    "url": f"/files/stream?path={path_param}&project_id={quote(project_id)}&email={quote(email)}",
                    "relativePath": rel,
                }
            )
        except (ValueError, OSError):
            continue
    return result


@router.get("/files/stream")
async def stream_file(
    path: str = Query(..., description="Relative path from project root"),
    project_id: str = Query(..., description="Project ID"),
    email: str = Query(..., description="User email"),
):
    """
    Stream file content. Path must be relative to project root.
    Used by Web mode to fetch file content for display.
    """
    if not path or not project_id or not email:
        raise HTTPException(
            status_code=400,
            detail="path, project_id and email are required",
        )
    project_root = _resolve_project_root(email, project_id)
    # Resolve path and ensure it stays under project root (security)
    try:
        resolved = resolve_under_base(path, str(project_root.resolve()))
    except Exception as e:
        file_logger.warning("stream_file path validation failed: %s", e)
        raise HTTPException(status_code=400, detail="Invalid path") from e
    p = Path(resolved)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    media_type, _ = mimetypes.guess_type(str(p))
    if not media_type:
        media_type = "application/octet-stream"
    # content_disposition_type=inline: display in iframe instead of triggering download
    return FileResponse(
        path=str(p),
        filename=p.name,
        media_type=media_type,
        content_disposition_type="inline",
    )


@router.get("/files/preview/{email}/{project_id}/{file_path:path}")
async def preview_file(
    email: str,
    project_id: str,
    file_path: str,
):
    """
    Preview file content with a path-based URL so relative references inside
    HTML/CSS/JS resolve against the project directory structure.
    """
    if not file_path or not project_id or not email:
        raise HTTPException(
            status_code=400,
            detail="file_path, project_id and email are required",
        )

    project_root = _resolve_project_root(email, project_id)
    try:
        resolved = resolve_under_base(file_path, str(project_root.resolve()))
    except Exception as e:
        file_logger.warning("preview_file path validation failed: %s", e)
        raise HTTPException(status_code=400, detail="Invalid path") from e

    p = Path(resolved)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    media_type, _ = mimetypes.guess_type(str(p))
    if not media_type:
        media_type = "application/octet-stream"

    return FileResponse(
        path=str(p),
        filename=p.name,
        media_type=media_type,
        content_disposition_type="inline",
    )
