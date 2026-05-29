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

import logging
from datetime import datetime
from uuid import uuid4

from sqlalchemy import or_
from sqlmodel import Session, select

from app.domains.space.service.folder_binding import (
    normalize_folder_root_reference,
    same_folder_reference,
)
from app.model.chat.chat_history import ChatHistory
from app.model.project import (
    Project,
    ProjectIn,
    ProjectOut,
    ProjectUpdate,
    ProjectWorkdirMode,
)
from app.model.space import Space, SpaceIn, SpaceOut, SpaceSourceType, SpaceStatus, SpaceUpdate

_LOGGER = logging.getLogger(__name__)


class SpaceHasProjectsError(ValueError):
    def __init__(self, project_count: int, projects: list[dict[str, str]]) -> None:
        self.project_count = project_count
        self.projects = projects
        super().__init__(
            f"Space has {project_count} project(s); archive or delete them first"
        )


class SpaceService:
    PROJECT_DISPLAY_NAME_MAX = 255

    @staticmethod
    def _project_name_is_placeholder(name: str | None, project_id: str) -> bool:
        normalized = (name or "").strip().lower()
        return (
            not normalized
            or normalized in {"new project", "new space"}
            or normalized == f"project {project_id}".lower()
        )

    @staticmethod
    def _history_project_display_name(history: ChatHistory) -> str | None:
        for value in (history.project_name, history.question):
            candidate = (value or "").strip()
            if candidate and not SpaceService._project_name_is_placeholder(
                candidate,
                history.project_id or history.task_id,
            ):
                return candidate[: SpaceService.PROJECT_DISPLAY_NAME_MAX]
        return None

    @staticmethod
    def _backfill_project_names_from_history(
        projects: list[Project],
        *,
        user_id: str,
        s: Session,
    ) -> None:
        placeholder_projects = [
            project
            for project in projects
            if SpaceService._project_name_is_placeholder(
                project.name,
                project.id,
            )
        ]
        if not placeholder_projects:
            return

        project_ids = [project.id for project in placeholder_projects]
        history_user_id = int(user_id) if str(user_id).isdigit() else user_id
        histories = s.exec(
            select(ChatHistory)
            .where(
                ChatHistory.user_id == history_user_id,
                or_(
                    ChatHistory.project_id.in_(project_ids),
                    ChatHistory.task_id.in_(project_ids),
                ),
            )
            .order_by(ChatHistory.created_at.desc(), ChatHistory.id.desc())
        ).all()
        name_by_project_id: dict[str, str] = {}
        for history in histories:
            if history.project_id in project_ids:
                project_id = history.project_id
            elif history.task_id in project_ids:
                project_id = history.task_id
            else:
                continue
            if project_id in name_by_project_id:
                continue
            display_name = SpaceService._history_project_display_name(history)
            if display_name:
                name_by_project_id[project_id] = display_name

        changed = False
        now = datetime.now()
        for project in placeholder_projects:
            display_name = name_by_project_id.get(project.id)
            if not display_name:
                continue
            project.name = display_name
            project.updated_at = now
            s.add(project)
            changed = True

        if changed:
            s.commit()

    SPACE_SOURCE_TYPES = {"blank", "folder", "legacy"}
    SPACE_STATUSES = {"active", "disconnected", "archived"}
    PROJECT_MODES = {"single-agent", "workforce"}
    PROJECT_STATUSES = {"active", "archived"}
    PROJECT_WORKDIR_MODES = {"worktree", "copy", "direct-write", "artifact-only"}

    @staticmethod
    def canonical_user_id(user_id: int | str) -> str:
        return str(user_id)

    @staticmethod
    def _default_project_workdir_mode(space: Space) -> str:
        if space.source_type == SpaceSourceType.FOLDER:
            return ProjectWorkdirMode.DIRECT_WRITE
        return ProjectWorkdirMode.ARTIFACT_ONLY

    @staticmethod
    def legacy_space_id(user_id: int | str) -> str:
        return f"legacy_{SpaceService.canonical_user_id(user_id)}"

    @staticmethod
    def ensure_legacy_space(user_id: int | str, s: Session) -> Space:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        space_id = SpaceService.legacy_space_id(canonical_user_id)
        space = s.get(Space, space_id)
        if space:
            return space

        space = Space(
            id=space_id,
            user_id=canonical_user_id,
            name="Legacy Space",
            description="Projects migrated from the pre-Space app model.",
            source_type=SpaceSourceType.LEGACY,
            metadata_json={"legacy": True, "schemaVersion": 1},
        )
        s.add(space)
        s.commit()
        s.refresh(space)
        return space

    @staticmethod
    def _get_owned_space(space_id: str, user_id: int | str, s: Session) -> Space:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        space = s.get(Space, space_id)
        if not space or space.user_id != canonical_user_id:
            raise ValueError("Space not found")
        return space

    @staticmethod
    def _validate_space_payload(source_type: str | None = None, status: str | None = None) -> None:
        if source_type is not None and source_type not in SpaceService.SPACE_SOURCE_TYPES:
            raise ValueError("Invalid Space source_type")
        if status is not None and status not in SpaceService.SPACE_STATUSES:
            raise ValueError("Invalid Space status")

    @staticmethod
    def _prepare_space_root(
        data: SpaceIn, user_id: str, s: Session
    ) -> tuple[str | None, dict | None]:
        if data.source_type == SpaceSourceType.FOLDER:
            root_ref = normalize_folder_root_reference(data.root_path or "")
            existing_spaces = s.exec(
                select(Space).where(
                    Space.user_id == user_id,
                    Space.source_type == SpaceSourceType.FOLDER,
                    Space.status != SpaceStatus.ARCHIVED,
                )
            ).all()
            for existing in existing_spaces:
                if existing.root_path and same_folder_reference(existing.root_path, root_ref):
                    raise ValueError("Folder is already bound to another Space")
                if (
                    existing.root_fingerprint
                    and data.root_fingerprint
                    and existing.root_fingerprint == data.root_fingerprint
                ):
                    raise ValueError("Folder is already bound to another Space")
            return root_ref, data.root_fingerprint

        if data.root_path or data.root_fingerprint:
            raise ValueError("root_path is only valid for folder Spaces")
        return None, None

    @staticmethod
    def _assert_folder_not_bound_to_other_space(
        *,
        user_id: str,
        root_path: str,
        space_id: str,
        s: Session,
    ) -> None:
        existing_spaces = s.exec(
            select(Space).where(
                Space.user_id == user_id,
                Space.source_type == SpaceSourceType.FOLDER,
                Space.status != SpaceStatus.ARCHIVED,
                Space.id != space_id,
            )
        ).all()
        for existing in existing_spaces:
            if existing.root_path and same_folder_reference(existing.root_path, root_path):
                raise ValueError("Folder is already bound to another Space")

    @staticmethod
    def _folder_identity_matches(
        previous: dict | None, current: dict
    ) -> bool:
        if not previous:
            return True
        if previous.get("kind") != current.get("kind"):
            return False
        for key in ("device", "inode"):
            if previous.get(key) is not None and previous.get(key) != current.get(key):
                return False
        return True

    @staticmethod
    def _validate_project_payload(
        mode: str | None = None,
        status: str | None = None,
        workdir_mode: str | None = None,
    ) -> None:
        if mode is not None and mode not in SpaceService.PROJECT_MODES:
            raise ValueError("Invalid Project mode")
        if status is not None and status not in SpaceService.PROJECT_STATUSES:
            raise ValueError("Invalid Project status")
        if workdir_mode is not None and workdir_mode not in SpaceService.PROJECT_WORKDIR_MODES:
            raise ValueError("Invalid Project workdir_mode")

    @staticmethod
    def create_space(data: SpaceIn, user_id: int | str, s: Session) -> Space:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        SpaceService._validate_space_payload(data.source_type, data.status)
        root_path, root_fingerprint = SpaceService._prepare_space_root(data, canonical_user_id, s)
        space = Space(
            id=data.id or f"space_{uuid4().hex}",
            user_id=canonical_user_id,
            name=data.name,
            description=data.description,
            source_type=data.source_type,
            root_path=root_path,
            root_fingerprint=root_fingerprint,
            status=data.status,
            schema_version=data.schema_version,
            metadata_json=data.metadata,
        )
        s.add(space)
        s.commit()
        s.refresh(space)
        return space

    @staticmethod
    def get_space(space_id: str, user_id: int | str, s: Session) -> Space:
        return SpaceService._get_owned_space(space_id, user_id, s)

    @staticmethod
    def delete_space(space_id: str, user_id: int | str, s: Session) -> None:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        space = SpaceService._get_owned_space(space_id, canonical_user_id, s)
        projects = s.exec(
            select(Project).where(
                Project.user_id == canonical_user_id,
                Project.space_id == space_id,
            )
        ).all()
        if projects:
            raise SpaceHasProjectsError(
                len(projects),
                [
                    {"id": project.id, "name": project.name}
                    for project in projects[:10]
                ],
            )
        s.delete(space)
        s.commit()

    @staticmethod
    def archive_space(space_id: str, user_id: int | str, s: Session) -> Space:
        space = SpaceService._get_owned_space(space_id, user_id, s)
        space.status = SpaceStatus.ARCHIVED
        s.add(space)
        s.commit()
        s.refresh(space)
        return space

    @staticmethod
    def unarchive_space(space_id: str, user_id: int | str, s: Session) -> Space:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        space = SpaceService._get_owned_space(space_id, canonical_user_id, s)
        if space.source_type == SpaceSourceType.FOLDER and space.root_path:
            SpaceService._assert_folder_not_bound_to_other_space(
                user_id=canonical_user_id,
                root_path=space.root_path,
                space_id=space.id,
                s=s,
            )
        space.status = SpaceStatus.ACTIVE
        s.add(space)
        s.commit()
        s.refresh(space)
        return space

    @staticmethod
    def relocate_space(
        space_id: str,
        root_path: str,
        user_id: int | str,
        s: Session,
        *,
        force: bool = False,
        root_fingerprint: dict | None = None,
    ) -> Space:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        space = SpaceService._get_owned_space(space_id, canonical_user_id, s)
        if space.source_type != SpaceSourceType.FOLDER:
            raise ValueError("Only folder Spaces can be relocated")

        # Reference-only mode: the server never stats the new root path.
        # Identity comparison uses the client-supplied fingerprint when
        # available; without one we fall back to a string-equality check so
        # the operation still degrades gracefully on cloud Brain deployments
        # where fingerprints are unavailable.
        root_ref = normalize_folder_root_reference(root_path)
        if not force:
            if root_fingerprint and space.root_fingerprint:
                if not SpaceService._folder_identity_matches(
                    space.root_fingerprint, root_fingerprint
                ):
                    raise ValueError(
                        "Relocated folder identity does not match this Space"
                    )
            elif space.root_path and not same_folder_reference(
                space.root_path, root_ref
            ):
                # No fingerprint available on either side: require the caller
                # to acknowledge the change with force=True.
                raise ValueError(
                    "Relocated folder identity cannot be verified; "
                    "supply root_fingerprint or use force=True"
                )
        SpaceService._assert_folder_not_bound_to_other_space(
            user_id=canonical_user_id,
            root_path=root_ref,
            space_id=space.id,
            s=s,
        )
        space.root_path = root_ref
        if root_fingerprint:
            space.root_fingerprint = root_fingerprint
        space.status = SpaceStatus.ACTIVE
        s.add(space)
        s.commit()
        s.refresh(space)
        return space

    @staticmethod
    def ensure_project(
        user_id: int | str,
        project_id: str,
        space_id: str | None,
        project_name: str | None,
        s: Session,
        *,
        description: str | None = None,
        mode: str | None = None,
        workdir_mode: str | None = None,
        metadata: dict | None = None,
    ) -> Project:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        SpaceService._validate_project_payload(mode=mode, workdir_mode=workdir_mode)
        target_space_id = space_id or SpaceService.legacy_space_id(canonical_user_id)
        legacy_space_id = SpaceService.legacy_space_id(canonical_user_id)
        space = s.get(Space, target_space_id)
        if not space and target_space_id == legacy_space_id:
            space = SpaceService.ensure_legacy_space(canonical_user_id, s)
        elif not space:
            raise ValueError("Space not found")
        if space.user_id != canonical_user_id:
            raise ValueError("Space not found")

        project = s.exec(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == canonical_user_id,
            )
        ).first()
        display_name = (project_name or "").strip()
        if project:
            changed = False
            if display_name and SpaceService._project_name_is_placeholder(
                project.name,
                project.id,
            ):
                project.name = display_name[:255]
                changed = True
            # Persist mode the first time we learn it. We do NOT silently
            # overwrite an existing mode mid-Project -- mode switches must be
            # explicit (via update_project) so reload state matches what the
            # user last set in the UI.
            if mode and not project.mode:
                project.mode = mode
                changed = True
            if workdir_mode and project.workdir_mode != workdir_mode:
                project.workdir_mode = workdir_mode
                changed = True
            if metadata:
                project.metadata_json = {
                    **(project.metadata_json or {}),
                    **metadata,
                }
                changed = True
            if changed:
                project.updated_at = datetime.now()
                s.add(project)
                s.commit()
                s.refresh(project)
            return project

        project = Project(
            id=project_id,
            user_id=canonical_user_id,
            space_id=target_space_id,
            name=display_name[:255] or f"Project {project_id}",
            description=description,
            mode=mode,
            workdir_mode=workdir_mode
            or SpaceService._default_project_workdir_mode(space),
            metadata_json=metadata,
        )
        s.add(project)
        s.commit()
        s.refresh(project)
        return project

    @staticmethod
    def list_spaces(user_id: int | str, s: Session) -> list[SpaceOut]:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        SpaceService.ensure_legacy_space(canonical_user_id, s)
        spaces = s.exec(
            select(Space)
            .where(Space.user_id == canonical_user_id)
            .order_by(Space.updated_at.desc())
        ).all()
        return [SpaceOut.from_model(space) for space in spaces]

    @staticmethod
    def list_projects(space_id: str, user_id: int | str, s: Session) -> list[ProjectOut]:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        SpaceService._get_owned_space(space_id, canonical_user_id, s)
        projects = s.exec(
            select(Project)
            .where(Project.user_id == canonical_user_id, Project.space_id == space_id)
            .order_by(Project.created_at.desc(), Project.id.desc())
        ).all()
        try:
            SpaceService._backfill_project_names_from_history(
                projects,
                user_id=canonical_user_id,
                s=s,
            )
        except Exception:
            s.rollback()
            _LOGGER.warning(
                "Failed to backfill project display names while listing projects",
                exc_info=True,
                extra={
                    "space_id": space_id,
                    "user_id": canonical_user_id,
                },
            )
        return [ProjectOut.from_model(project) for project in projects]

    @staticmethod
    def create_project(
        space_id: str,
        data: ProjectIn,
        user_id: int | str,
        s: Session,
    ) -> Project:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        space = SpaceService._get_owned_space(space_id, canonical_user_id, s)
        SpaceService._validate_project_payload(data.mode, data.status, data.workdir_mode)

        project_id = data.id or f"project_{uuid4().hex}"
        project = Project(
            id=project_id,
            user_id=canonical_user_id,
            space_id=space_id,
            name=(data.name or "").strip() or f"Project {project_id}",
            description=data.description,
            mode=data.mode,
            status=data.status,
            workdir_mode=data.workdir_mode
            or SpaceService._default_project_workdir_mode(space),
            metadata_json=data.metadata,
        )
        s.add(project)
        s.commit()
        s.refresh(project)
        return project

    @staticmethod
    def update_space(space_id: str, data: SpaceUpdate, user_id: int | str, s: Session) -> Space:
        space = SpaceService._get_owned_space(space_id, user_id, s)
        SpaceService._validate_space_payload(status=data.status)
        update_data = data.model_dump(exclude_unset=True)
        metadata = update_data.pop("metadata", None)
        for key, value in update_data.items():
            setattr(space, key, value)
        if metadata is not None:
            space.metadata_json = {
                **(space.metadata_json or {}),
                **metadata,
            }
        s.add(space)
        s.commit()
        s.refresh(space)
        return space

    @staticmethod
    def update_project(
        space_id: str,
        project_id: str,
        data: ProjectUpdate,
        user_id: int | str,
        s: Session,
    ) -> Project:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        SpaceService._get_owned_space(space_id, canonical_user_id, s)
        SpaceService._validate_project_payload(status=data.status, workdir_mode=data.workdir_mode)
        project = s.exec(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == canonical_user_id,
                Project.space_id == space_id,
            )
        ).first()
        if not project:
            raise ValueError("Project not found")

        update_data = data.model_dump(exclude_unset=True)
        metadata = update_data.pop("metadata", None)
        for key, value in update_data.items():
            if key == "name" and isinstance(value, str):
                value = value.strip() or project.name
            setattr(project, key, value)
        if metadata is not None:
            project.metadata_json = {
                **(project.metadata_json or {}),
                **metadata,
            }
        s.add(project)
        s.commit()
        s.refresh(project)
        return project

    @staticmethod
    def promote_project(
        space_id: str,
        project_id: str,
        user_id: int | str,
        s: Session,
    ) -> Project:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        target_space = SpaceService._get_owned_space(space_id, canonical_user_id, s)
        if target_space.status != SpaceStatus.ACTIVE:
            raise ValueError("Cannot promote into an inactive Space")
        if target_space.source_type != SpaceSourceType.FOLDER:
            raise ValueError("Promote target must be a folder Space")

        project = s.exec(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == canonical_user_id,
            )
        ).first()
        if not project:
            raise ValueError("Project not found")

        previous_metadata = project.metadata_json or {}
        previous_space_id = project.space_id
        project.space_id = space_id
        project.workdir_mode = ProjectWorkdirMode.COPY
        project.metadata_json = {
            **previous_metadata,
            "promotedFromSpaceId": previous_metadata.get("promotedFromSpaceId")
            or previous_space_id,
        }
        s.add(project)
        s.commit()
        s.refresh(project)
        return project
