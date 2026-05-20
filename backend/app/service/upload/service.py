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

import asyncio
import hashlib
import json
import logging
import os
import tempfile
import time
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import httpx

from app.component.environment import env
from app.model.chat import Chat
from app.service.upload.user_uploads import UploadIdError, resolve_user_upload
from app.utils.server.url import normalize_server_url
from app.utils.workspace_paths import workspace_state_root

logger = logging.getLogger("brain_upload_service")

EXCLUDED_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".eigent",
    "target",
    "coverage",
}
EXCLUDED_FILES = {
    ".DS_Store",
    ".note_register",
}
HTTP_TIMEOUT = httpx.Timeout(60.0)
HTTP_LIMITS = httpx.Limits(max_keepalive_connections=10, max_connections=20)
MTIME_EPSILON_SECONDS = 2.0


@dataclass(frozen=True)
class PartialUploadContext:
    session_id: str
    raw_server_url: str
    authorization: str
    task_output_root: Path
    task_start_time: float
    camel_log_dir: Path


@dataclass(frozen=True)
class _BaseUploadContext:
    task_id: str
    project_id: str
    email: str
    session_id: str


@dataclass(frozen=True)
class FullUploadContext(_BaseUploadContext):
    server_url: str
    authorization: str
    task_output_root: Path
    task_start_time: float
    camel_log_dir: Path
    user_upload_ids: tuple[str, ...]


@dataclass(frozen=True)
class SkippedUploadContext(_BaseUploadContext):
    skip_reason: str


UploadContext = FullUploadContext | SkippedUploadContext


@dataclass
class UploadItem:
    kind: Literal[
        "user_upload", "workspace_artifact", "camel_logs", "artifact_manifest"
    ]
    relative_path: str
    display_name: str
    size: int
    status: Literal[
        "pending",
        "uploading",
        "done",
        "failed",
        "missing",
        "cancelled",
        "invalid",
    ]
    error: str | None = None
    sha256: str | None = None
    remote_key: str | None = None


@dataclass
class UploadState:
    task_id: str
    project_id: str
    email: str
    session_id: str
    started_at: float
    completed_at: float | None
    items: list[UploadItem] = field(default_factory=list)
    overall_status: Literal[
        "pending", "running", "succeeded", "partial", "failed", "skipped"
    ] = "running"
    truncated: bool = False
    skipped_paths: list[str] = field(default_factory=list)
    skip_reason: str | None = None

    @classmethod
    def from_context(cls, ctx: FullUploadContext) -> "UploadState":
        return cls(
            task_id=ctx.task_id,
            project_id=ctx.project_id,
            email=ctx.email,
            session_id=ctx.session_id,
            started_at=time.time(),
            completed_at=None,
        )

    @classmethod
    def skipped_from(cls, ctx: SkippedUploadContext) -> "UploadState":
        now = time.time()
        return cls(
            task_id=ctx.task_id,
            project_id=ctx.project_id,
            email=ctx.email,
            session_id=ctx.session_id,
            started_at=now,
            completed_at=now,
            overall_status="skipped",
            skip_reason=ctx.skip_reason,
        )

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "project_id": self.project_id,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "overall_status": self.overall_status,
            "truncated": self.truncated,
            "skipped_paths": list(self.skipped_paths),
            "skip_reason": self.skip_reason,
            "items": [item.__dict__.copy() for item in self.items],
        }


class BrainUploadService:
    _instance: "BrainUploadService | None" = None

    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task] = {}
        self._states: dict[str, UploadState] = {}
        self._http_client: httpx.AsyncClient | None = None

    @classmethod
    def singleton(cls) -> "BrainUploadService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def finalize_at_task_end(
        cls, options: Chat, task_lock, request
    ) -> UploadContext:
        task_id = (
            getattr(task_lock, "current_task_id", None) or options.task_id
        )
        partial = getattr(task_lock, "upload_context_partial", None)
        session_id = (
            getattr(partial, "session_id", None)
            or getattr(task_lock, "session_id", "")
            or getattr(getattr(request, "state", None), "session_id", "")
        )
        base = {
            "task_id": task_id,
            "project_id": options.project_id,
            "email": getattr(task_lock, "email", None) or options.email,
            "session_id": session_id,
        }
        if partial is None:
            return SkippedUploadContext(**base, skip_reason="missing_context")

        server_url = normalize_server_url(
            partial.raw_server_url or env("SERVER_URL", "")
        )
        if not server_url:
            return SkippedUploadContext(**base, skip_reason="no_server_url")

        authorization = partial.authorization
        if not authorization and request is not None:
            authorization = request.headers.get("Authorization", "")
        if not authorization:
            return SkippedUploadContext(**base, skip_reason="no_authorization")

        return FullUploadContext(
            **base,
            server_url=server_url,
            authorization=authorization,
            task_output_root=partial.task_output_root,
            task_start_time=partial.task_start_time,
            camel_log_dir=partial.camel_log_dir,
            user_upload_ids=tuple(
                getattr(task_lock, "user_upload_ids_by_task", {}).get(
                    task_id, []
                )
            ),
        )

    def register_and_start(self, ctx: UploadContext, task_id: str) -> None:
        self._prune_states()
        if isinstance(ctx, SkippedUploadContext):
            self._states[task_id] = UploadState.skipped_from(ctx)
            return
        state = UploadState.from_context(ctx)
        self._states[ctx.task_id] = state
        task = asyncio.create_task(
            self._run(ctx, state), name=f"upload-{ctx.task_id}"
        )
        self._tasks[ctx.task_id] = task
        task.add_done_callback(self._make_task_done_callback(ctx.task_id))

    def get_state(self, task_id: str) -> UploadState | None:
        self._prune_states()
        return self._states.get(task_id)

    def _make_task_done_callback(self, task_id: str):
        def _done(_: asyncio.Task) -> None:
            self._tasks.pop(task_id, None)
            self._prune_states()

        return _done

    def _prune_states(self, now: float | None = None) -> None:
        if not self._states:
            return
        ttl = self._state_ttl_seconds()
        cutoff = (time.time() if now is None else now) - ttl
        stale_task_ids = [
            task_id
            for task_id, state in self._states.items()
            if state.completed_at is not None and state.completed_at < cutoff
        ]
        for task_id in stale_task_ids:
            self._states.pop(task_id, None)

    def _state_ttl_seconds(self) -> int:
        raw = env("WORKSPACE_UPLOAD_STATE_TTL_SECONDS", "3600")
        try:
            return max(0, int(raw))
        except ValueError:
            return 3600

    def _get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(
                timeout=HTTP_TIMEOUT,
                limits=HTTP_LIMITS,
            )
        return self._http_client

    async def close(self) -> None:
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None

    async def _run(self, ctx: FullUploadContext, state: UploadState) -> None:
        try:
            await self._upload_user_files(ctx, state)
            await self._upload_workspace_artifacts(ctx, state)
            await self._upload_camel_logs(ctx, state)
            self._set_terminal_status(state)
            state.completed_at = time.time()
            await self._upload_artifact_manifest(ctx, state)
            self._set_terminal_status(state)
        except asyncio.CancelledError:
            state.overall_status = "partial"
            raise
        except Exception as exc:
            state.overall_status = "failed"
            logger.exception("upload failed: %s", exc)
        finally:
            state.completed_at = time.time()
            await asyncio.to_thread(self._write_artifact_manifest, ctx, state)

    def _set_terminal_status(self, state: UploadState) -> None:
        if any(
            item.status in {"failed", "missing", "invalid", "cancelled"}
            for item in state.items
        ):
            state.overall_status = "partial"
        else:
            state.overall_status = "succeeded"

    async def _upload_user_files(
        self, ctx: FullUploadContext, state: UploadState
    ) -> None:
        for upload_id in ctx.user_upload_ids:
            try:
                abs_path, original_filename = resolve_user_upload(
                    upload_id, ctx.session_id
                )
            except UploadIdError as exc:
                state.items.append(
                    UploadItem(
                        kind="user_upload",
                        relative_path=upload_id,
                        display_name=upload_id,
                        size=0,
                        status="invalid",
                        error=str(exc),
                    )
                )
                continue
            if not abs_path.exists() or not abs_path.is_file():
                state.items.append(
                    UploadItem(
                        kind="user_upload",
                        relative_path=upload_id,
                        display_name=original_filename,
                        size=0,
                        status="missing",
                    )
                )
                continue
            await self._upload_item(
                ctx,
                state,
                "user_upload",
                abs_path,
                original_filename,
                original_filename,
            )

    async def _upload_workspace_artifacts(
        self, ctx: FullUploadContext, state: UploadState
    ) -> None:
        root = ctx.task_output_root
        if not root.exists() or not root.is_dir():
            return
        for path in self._enumerate_workspace_files(ctx, state):
            rel = path.relative_to(root).as_posix()
            await self._upload_item(
                ctx,
                state,
                "workspace_artifact",
                path,
                rel,
                path.name,
            )

    async def _upload_camel_logs(
        self, ctx: FullUploadContext, state: UploadState
    ) -> None:
        log_dir = ctx.camel_log_dir
        if not log_dir.exists() or not log_dir.is_dir():
            return
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            zip_path = Path(tmp.name)
        try:
            await asyncio.to_thread(self._zip_dir, log_dir, zip_path)
            item = UploadItem(
                kind="camel_logs",
                relative_path="camel_logs.zip",
                display_name="camel_logs.zip",
                size=zip_path.stat().st_size,
                status="uploading",
                sha256=self._sha256(zip_path),
            )
            state.items.append(item)
            try:
                await asyncio.shield(
                    self._upload_logs_to_server(ctx, zip_path)
                )
                item.status = "done"
            except Exception as exc:
                item.status = "failed"
                item.error = str(exc)
        finally:
            try:
                zip_path.unlink(missing_ok=True)
            except OSError:
                pass

    async def _upload_artifact_manifest(
        self, ctx: FullUploadContext, state: UploadState
    ) -> None:
        manifest_path = await asyncio.to_thread(
            self._write_artifact_manifest, ctx, state
        )
        item = UploadItem(
            kind="artifact_manifest",
            relative_path=manifest_path.name,
            display_name="artifact_manifest.json",
            size=manifest_path.stat().st_size,
            status="uploading",
            sha256=self._sha256(manifest_path),
        )
        state.items.append(item)
        try:
            remote_key = await asyncio.shield(
                self._upload_to_server(ctx, manifest_path, item.display_name)
            )
            item.remote_key = remote_key
            item.status = "done"
        except Exception as exc:
            item.status = "failed"
            item.error = str(exc)
        finally:
            await asyncio.to_thread(self._write_artifact_manifest, ctx, state)

    def _enumerate_workspace_files(
        self, ctx: FullUploadContext, state: UploadState
    ) -> Iterable[Path]:
        max_file_size = int(
            env("WORKSPACE_UPLOAD_MAX_FILE_SIZE", str(500 * 1024 * 1024))
        )
        max_total_size = int(
            env("WORKSPACE_UPLOAD_MAX_TOTAL_SIZE", str(2 * 1024 * 1024 * 1024))
        )
        max_file_count = int(env("WORKSPACE_UPLOAD_MAX_FILE_COUNT", "500"))
        max_walk_entries = int(
            env("WORKSPACE_UPLOAD_MAX_WALK_ENTRIES", "20000")
        )
        candidates: list[Path] = []
        walked = 0
        root = ctx.task_output_root
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
            for filename in filenames:
                if filename in EXCLUDED_FILES:
                    continue
                walked += 1
                if walked > max_walk_entries:
                    state.truncated = True
                    return self._select_candidates(
                        candidates, root, state, max_file_count, max_total_size
                    )
                path = Path(dirpath) / filename
                try:
                    stat = path.stat()
                    if stat.st_mtime < (
                        ctx.task_start_time - MTIME_EPSILON_SECONDS
                    ):
                        continue
                    if stat.st_size > max_file_size:
                        state.skipped_paths.append(
                            path.relative_to(root).as_posix()
                        )
                        continue
                except OSError:
                    continue
                candidates.append(path)
        candidates = self._filter_gitignore(root, candidates)
        return self._select_candidates(
            candidates, root, state, max_file_count, max_total_size
        )

    def _select_candidates(
        self,
        candidates: list[Path],
        root: Path,
        state: UploadState,
        max_file_count: int,
        max_total_size: int,
    ) -> list[Path]:
        selected: list[Path] = []
        total = 0
        for path in sorted(
            candidates, key=lambda p: p.stat().st_mtime, reverse=True
        ):
            try:
                size = path.stat().st_size
            except OSError:
                continue
            if (
                len(selected) >= max_file_count
                or total + size > max_total_size
            ):
                state.truncated = True
                try:
                    state.skipped_paths.append(
                        path.relative_to(root).as_posix()
                    )
                except ValueError:
                    pass
                continue
            selected.append(path)
            total += size
        return selected

    def _filter_gitignore(
        self, root: Path, candidates: list[Path]
    ) -> list[Path]:
        gitignore = root / ".gitignore"
        if not gitignore.exists():
            return candidates
        try:
            import pathspec

            spec = pathspec.PathSpec.from_lines(
                "gitwildmatch",
                gitignore.read_text(
                    encoding="utf-8", errors="ignore"
                ).splitlines(),
            )
            return [
                p
                for p in candidates
                if not spec.match_file(str(p.relative_to(root)))
            ]
        except Exception:
            logger.warning("Failed to apply .gitignore filter", exc_info=True)
            return candidates

    async def _upload_item(
        self,
        ctx: FullUploadContext,
        state: UploadState,
        kind: Literal["user_upload", "workspace_artifact"],
        abs_path: Path,
        relative_path: str,
        display_name: str,
    ) -> None:
        item = UploadItem(
            kind=kind,
            relative_path=relative_path,
            display_name=display_name,
            size=abs_path.stat().st_size,
            status="uploading",
            sha256=self._sha256(abs_path),
        )
        state.items.append(item)
        try:
            remote_key = await asyncio.shield(
                self._upload_to_server(ctx, abs_path, display_name)
            )
            item.remote_key = remote_key
            item.status = "done"
        except asyncio.CancelledError:
            item.status = "cancelled"
            raise
        except Exception as exc:
            item.status = "failed"
            item.error = str(exc)

    async def _upload_to_server(
        self, ctx: FullUploadContext, abs_path: Path, display_name: str
    ) -> str | None:
        with abs_path.open("rb") as fp:
            files = {"file": (display_name, fp, "application/octet-stream")}
            data = {"task_id": ctx.task_id}
            client = self._get_http_client()
            resp = await client.post(
                f"{ctx.server_url}/chat/files/upload",
                data=data,
                files=files,
                headers={"Authorization": ctx.authorization},
            )
            resp.raise_for_status()
            return self._extract_remote_key(resp)

    async def _upload_logs_to_server(
        self, ctx: FullUploadContext, zip_path: Path
    ) -> None:
        with zip_path.open("rb") as fp:
            files = {"file": ("camel_logs.zip", fp, "application/zip")}
            data = {"task_id": ctx.task_id}
            client = self._get_http_client()
            resp = await client.post(
                f"{ctx.server_url}/chat/logs",
                data=data,
                files=files,
                headers={"Authorization": ctx.authorization},
            )
            resp.raise_for_status()

    def _zip_dir(self, source: Path, target: Path) -> None:
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in source.rglob("*"):
                if path.is_file():
                    zf.write(path, path.relative_to(source))

    def _write_artifact_manifest(
        self, ctx: FullUploadContext, state: UploadState
    ) -> Path:
        path = (
            workspace_state_root(ctx.email)
            / "tasks"
            / f"{ctx.task_id}.artifacts.json"
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "version": 1,
            "task_id": ctx.task_id,
            "project_id": ctx.project_id,
            "workspace_name": ctx.task_output_root.name,
            "task_start_time": ctx.task_start_time,
            "created_at": state.started_at,
            "completed_at": state.completed_at,
            "overall_status": state.overall_status,
            "truncated": state.truncated,
            "skipped_paths": list(state.skipped_paths),
            "items": [item.__dict__.copy() for item in state.items],
        }
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(path)
        return path

    def _sha256(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as fp:
            for chunk in iter(lambda: fp.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _extract_remote_key(self, resp: httpx.Response) -> str | None:
        try:
            data = resp.json()
        except ValueError:
            return None
        if not isinstance(data, dict):
            return None
        for key in ("s3_key", "key", "path"):
            value = data.get(key)
            if isinstance(value, str) and value:
                return value
        return None
