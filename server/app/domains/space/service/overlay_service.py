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

from datetime import datetime, timezone
from uuid import uuid4

from sqlmodel import Session, select

from app.domains.space.service.apply_service import (
    normalize_overlay_path,
    space_write_lock,
)
from app.domains.space.service.space_service import SpaceService
from app.model.project import Project
from app.model.space import (
    OVERLAY_SOURCE_PATH_METADATA_KEY,
    OVERLAY_SOURCE_ROOT_METADATA_KEY,
    SpaceFileIndexOverlay,
    SpaceOverlayDiscardResponse,
    SpaceOverlayListResponse,
    SpaceOverlayOut,
    SpaceOverlayWriteIn,
    SpaceProjectRefreshIn,
    SpaceProjectRefreshResponse,
)


class PendingOverlayError(ValueError):
    def __init__(self, run_ids: list[str]) -> None:
        self.run_ids = run_ids
        super().__init__("Project has pending overlay changes")


class SpaceOverlayService:
    @staticmethod
    def _get_owned_project(
        space_id: str,
        project_id: str,
        user_id: int | str,
        s: Session,
    ) -> Project:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        SpaceService.get_space(space_id, canonical_user_id, s)
        project = s.exec(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == canonical_user_id,
                Project.space_id == space_id,
            )
        ).first()
        if not project:
            raise ValueError("Project not found")
        return project

    @staticmethod
    def list_overlays(
        space_id: str,
        project_id: str,
        user_id: int | str,
        s: Session,
        *,
        run_id: str | None = None,
    ) -> SpaceOverlayListResponse:
        SpaceOverlayService._get_owned_project(space_id, project_id, user_id, s)
        query = select(SpaceFileIndexOverlay).where(
            SpaceFileIndexOverlay.space_id == space_id,
            SpaceFileIndexOverlay.project_id == project_id,
        )
        if run_id:
            query = query.where(SpaceFileIndexOverlay.run_id == run_id)
        rows = s.exec(query.order_by(SpaceFileIndexOverlay.id)).all()
        return SpaceOverlayListResponse(
            space_id=space_id,
            project_id=project_id,
            overlays=[
                SpaceOverlayOut(
                    id=row.id,
                    space_id=row.space_id,
                    project_id=row.project_id,
                    run_id=row.run_id,
                    path=row.path,
                    status=row.status,
                    hash=row.hash,
                    base_hash=row.base_hash,
                    base_snapshot_id=row.base_snapshot_id,
                    size=row.size,
                    mode=row.mode,
                    metadata=row.metadata_json,
                )
                for row in rows
            ],
        )

    @staticmethod
    def record_overlay_write(
        space_id: str,
        project_id: str,
        data: SpaceOverlayWriteIn,
        user_id: int | str,
        s: Session,
    ) -> SpaceOverlayOut:
        SpaceOverlayService._get_owned_project(space_id, project_id, user_id, s)
        path = normalize_overlay_path(data.path)
        metadata = dict(data.metadata or {})
        source_path = data.source_path or metadata.get(OVERLAY_SOURCE_PATH_METADATA_KEY)
        source_root = data.source_root or metadata.get(OVERLAY_SOURCE_ROOT_METADATA_KEY)
        if data.status != "deleted":
            if not source_path:
                raise ValueError("Overlay source_path is required")
            if not source_root:
                raise ValueError("Overlay source_root is required")
        if source_path:
            metadata[OVERLAY_SOURCE_PATH_METADATA_KEY] = source_path
        if source_root:
            # Same-FS bridge assumption: Apply currently resolves this Brain-local
            # absolute path on the same machine. Cloud Brain must replace it with
            # an opaque file handle or a server-readable content reference.
            metadata[OVERLAY_SOURCE_ROOT_METADATA_KEY] = source_root

        with space_write_lock(space_id):
            existing = s.exec(
                select(SpaceFileIndexOverlay).where(
                    SpaceFileIndexOverlay.space_id == space_id,
                    SpaceFileIndexOverlay.project_id == project_id,
                    SpaceFileIndexOverlay.run_id == data.run_id,
                    SpaceFileIndexOverlay.path == path,
                )
            ).first()
            row = existing or SpaceFileIndexOverlay(
                space_id=space_id,
                project_id=project_id,
                run_id=data.run_id,
                path=path,
                status=data.status,
                base_hash=data.base_hash,
                base_snapshot_id=data.base_snapshot_id,
            )
            if existing is None:
                row.base_hash = data.base_hash
                row.base_snapshot_id = data.base_snapshot_id
                row.status = data.status
            else:
                row.status = SpaceOverlayService._next_overlay_status(
                    existing.status,
                    data.status,
                    existing.base_hash,
                )
            row.hash = None if data.status == "deleted" else data.hash
            row.size = data.size
            row.mode = data.mode
            row.modified_at = (
                datetime.fromisoformat(data.modified_at)
                if data.modified_at
                else datetime.now(timezone.utc)
            )
            row.metadata_json = {
                **(row.metadata_json or {}),
                **metadata,
            }
            s.add(row)
            s.commit()
            s.refresh(row)
            return SpaceOverlayOut(
                id=row.id,
                space_id=row.space_id,
                project_id=row.project_id,
                run_id=row.run_id,
                path=row.path,
                status=row.status,
                hash=row.hash,
                base_hash=row.base_hash,
                base_snapshot_id=row.base_snapshot_id,
                size=row.size,
                mode=row.mode,
                metadata=row.metadata_json,
            )

    @staticmethod
    def _next_overlay_status(
        existing_status: str,
        incoming_status: str,
        base_hash: str | None,
    ) -> str:
        if incoming_status == "deleted":
            return "deleted"
        if existing_status == "added":
            return "added"
        if existing_status == "deleted":
            return "added" if base_hash is None else "modified"
        if existing_status == "modified" and incoming_status == "added":
            return "modified"
        return incoming_status

    @staticmethod
    def discard_overlays(
        space_id: str,
        project_id: str,
        user_id: int | str,
        s: Session,
        *,
        run_id: str | None = None,
        paths: list[str] | None = None,
    ) -> SpaceOverlayDiscardResponse:
        SpaceOverlayService._get_owned_project(space_id, project_id, user_id, s)
        normalized_paths = [normalize_overlay_path(path) for path in paths or []]
        query = select(SpaceFileIndexOverlay).where(
            SpaceFileIndexOverlay.space_id == space_id,
            SpaceFileIndexOverlay.project_id == project_id,
        )
        if run_id:
            query = query.where(SpaceFileIndexOverlay.run_id == run_id)
        if normalized_paths:
            query = query.where(SpaceFileIndexOverlay.path.in_(normalized_paths))
        rows = s.exec(query).all()
        run_ids = sorted({row.run_id for row in rows})
        with space_write_lock(space_id):
            for row in rows:
                s.delete(row)
            s.commit()
        return SpaceOverlayDiscardResponse(
            space_id=space_id,
            project_id=project_id,
            discarded=len(rows),
            run_ids=run_ids,
        )

    @staticmethod
    def refresh_project(
        space_id: str,
        project_id: str,
        data: SpaceProjectRefreshIn,
        user_id: int | str,
        s: Session,
    ) -> SpaceProjectRefreshResponse:
        project = SpaceOverlayService._get_owned_project(
            space_id, project_id, user_id, s
        )
        pending_rows = s.exec(
            select(SpaceFileIndexOverlay).where(
                SpaceFileIndexOverlay.space_id == space_id,
                SpaceFileIndexOverlay.project_id == project_id,
            )
        ).all()
        if pending_rows and not data.force:
            raise PendingOverlayError(sorted({row.run_id for row in pending_rows}))
        base_snapshot_id = f"snapshot_{uuid4().hex}"
        project.metadata_json = {
            **(project.metadata_json or {}),
            "baseSnapshotId": base_snapshot_id,
            "refreshedAt": datetime.now(timezone.utc).isoformat(),
        }
        s.add(project)
        s.commit()
        return SpaceProjectRefreshResponse(
            kind="refreshed",
            space_id=space_id,
            project_id=project_id,
            base_snapshot_id=base_snapshot_id,
        )
