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

"""Destructive deletion helpers for Spaces and Projects.

The normal Space/Project service intentionally supports archival, but the UI's
Delete actions promise permanent removal. These helpers implement that
contract in one transaction and clean the dependent rows that otherwise keep
Project/Space records alive.
"""

from sqlalchemy import and_, or_
from sqlmodel import Session, delete, select

from app.domains.space.service.space_service import SpaceService
from app.model.chat.chat_history import ChatHistory
from app.model.memory import ProjectMemory, SpaceMemory
from app.model.project import Project
from app.model.space import SpaceFileIndex, SpaceFileIndexOverlay
from app.model.trigger.trigger import Trigger
from app.model.trigger.trigger_execution import TriggerExecution


class SpaceDeletionService:
    """Hard-delete Projects and Spaces together with their dependent rows."""

    @staticmethod
    def _history_user_id(user_id: int | str) -> int | str:
        # ChatHistory.user_id is still an integer for the normal auth path,
        # while Space/Project ownership is stored canonically as a string.
        return int(user_id) if str(user_id).isdigit() else user_id

    @staticmethod
    def _delete_triggers(
        *,
        user_id: str,
        db_session: Session,
        project_id: str | None = None,
        space_id: str | None = None,
    ) -> None:
        stmt = select(Trigger).where(Trigger.user_id == user_id)
        if project_id is not None:
            stmt = stmt.where(Trigger.project_id == project_id)
        if space_id is not None:
            stmt = stmt.where(Trigger.space_id == space_id)

        triggers = db_session.exec(stmt).all()
        for trigger in triggers:
            db_session.exec(
                delete(TriggerExecution).where(
                    TriggerExecution.trigger_id == trigger.id
                )
            )
            db_session.delete(trigger)

    @staticmethod
    def delete_project(
        project_id: str,
        user_id: int | str,
        db_session: Session,
        *,
        space_id: str | None = None,
        delete_histories: bool = True,
        missing_ok: bool = False,
        commit: bool = True,
    ) -> bool:
        """Permanently delete one owned Project and its server-side data.

        Returns ``True`` when a Project row existed. ``missing_ok`` is used by
        legacy history cleanup, where old history rows may pre-date the durable
        Project table but their triggers/overlays should still be removed.
        """

        canonical_user_id = SpaceService.canonical_user_id(user_id)
        history_user_id = SpaceDeletionService._history_user_id(user_id)

        stmt = select(Project).where(
            Project.id == project_id,
            Project.user_id == canonical_user_id,
        )
        if space_id is not None:
            stmt = stmt.where(Project.space_id == space_id)
        project = db_session.exec(stmt).first()

        if project is None and not missing_ok:
            raise ValueError("Project not found")

        if delete_histories:
            db_session.exec(
                delete(ChatHistory).where(
                    ChatHistory.user_id == history_user_id,
                    or_(
                        ChatHistory.project_id == project_id,
                        and_(
                            ChatHistory.project_id.is_(None),
                            ChatHistory.task_id == project_id,
                        ),
                    ),
                )
            )

        SpaceDeletionService._delete_triggers(
            user_id=canonical_user_id,
            project_id=project_id,
            db_session=db_session,
        )
        db_session.exec(
            delete(ProjectMemory).where(ProjectMemory.project_id == project_id)
        )
        db_session.exec(
            delete(SpaceFileIndexOverlay).where(
                SpaceFileIndexOverlay.project_id == project_id
            )
        )

        if project is not None:
            db_session.delete(project)

        if commit:
            db_session.commit()
        return project is not None

    @staticmethod
    def delete_space(
        space_id: str,
        user_id: int | str,
        db_session: Session,
    ) -> None:
        """Permanently delete an owned Space and every Project it contains."""

        canonical_user_id = SpaceService.canonical_user_id(user_id)
        history_user_id = SpaceDeletionService._history_user_id(user_id)
        space = SpaceService.get_space(space_id, canonical_user_id, db_session)

        projects = db_session.exec(
            select(Project).where(
                Project.user_id == canonical_user_id,
                Project.space_id == space_id,
            )
        ).all()
        for project in projects:
            SpaceDeletionService.delete_project(
                project.id,
                user_id,
                db_session,
                space_id=space_id,
                commit=False,
            )

        # Clean legacy/orphan rows that are keyed directly by Space and may
        # have been created before the durable Project model was introduced.
        db_session.exec(
            delete(ChatHistory).where(
                ChatHistory.user_id == history_user_id,
                ChatHistory.space_id == space_id,
            )
        )
        SpaceDeletionService._delete_triggers(
            user_id=canonical_user_id,
            space_id=space_id,
            db_session=db_session,
        )
        db_session.exec(
            delete(ProjectMemory).where(ProjectMemory.space_id == space_id)
        )
        db_session.exec(delete(SpaceMemory).where(SpaceMemory.space_id == space_id))
        db_session.exec(
            delete(SpaceFileIndexOverlay).where(
                SpaceFileIndexOverlay.space_id == space_id
            )
        )
        db_session.exec(
            delete(SpaceFileIndex).where(SpaceFileIndex.space_id == space_id)
        )

        db_session.delete(space)
        db_session.commit()
