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

"""ChatService: task ownership, file validation, history grouping. No billing in eigent."""

from collections import defaultdict
from datetime import datetime
from typing import Dict, List

from loguru import logger
from sqlmodel import Session, case, desc, func, select

from app.core.database import session_make
from app.model.chat.chat_history import ChatHistory, ChatHistoryOut, ChatStatus
from app.model.chat.chat_history_grouped import GroupedHistoryResponse, ProjectGroup
from app.model.trigger.trigger import Trigger
from app.domains.chat.schema import TaskOwnershipCheckReq, FileValidationReq, FileValidationResult

ALLOWED_EXTENSIONS = {
    "jpg", "jpeg", "png", "gif", "webp",
    "pdf", "txt", "md", "csv",
    "json", "xml", "yaml", "yml",
    "doc", "docx", "xls", "xlsx",
    "zip",
}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


class ChatService:
    """Chat domain business logic - static methods, self-managed session."""

    @staticmethod
    def verify_task_ownership(req: TaskOwnershipCheckReq) -> bool:
        """Check if task_id belongs to user_id."""
        with session_make() as s:
            h = s.exec(
                select(ChatHistory)
                .where(ChatHistory.task_id == req.task_id, ChatHistory.user_id == req.user_id)
            ).first()
            return h is not None

    @staticmethod
    def validate_file(req: FileValidationReq) -> FileValidationResult:
        """Validate filename extension and file size."""
        if not req.filename:
            return FileValidationResult(valid=False, error="Filename is required")
        ext = req.filename.rsplit(".", 1)[-1].lower() if "." in req.filename else ""
        if ext not in ALLOWED_EXTENSIONS:
            return FileValidationResult(
                valid=False,
                error=f"File type '.{ext}' is not allowed. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
            )
        if req.file_size > MAX_FILE_SIZE:
            return FileValidationResult(
                valid=False,
                error=f"File size ({req.file_size} bytes) exceeds max {MAX_FILE_SIZE // (1024 * 1024)} MB",
            )
        return FileValidationResult(valid=True)

    @staticmethod
    async def reconcile_if_needed(
        history: ChatHistory, status_changed_to_done: bool, trace_id: str | None = None
    ) -> None:
        """No-op: eigent does not have billing/credits."""
        return None

    @staticmethod
    def upload_file(
        user_id: int, task_id: str, filename: str, file_content: bytes, file_type: str | None, s: Session
    ) -> "ChatFile":
        """Validate, upload to S3, and create ChatFile record. Caller must commit."""
        from app.model.chat.chat_file import ChatFile, ChatFileIn

        validation = ChatService.validate_file(FileValidationReq(filename=filename, file_size=len(file_content)))
        if not validation.valid:
            raise ValueError(validation.error or "Invalid file")

        file_info = ChatFileIn.save_file_to_s3(
            user_id=user_id,
            task_id=task_id,
            filename=filename,
            file_content=file_content,
            file_type=file_type,
        )
        chat_file = ChatFile(
            user_id=user_id,
            task_id=task_id,
            filename=file_info["filename"],
            file_size=file_info["file_size"],
            file_type=file_info["file_type"],
            s3_key=file_info["s3_key"],
            s3_bucket=file_info["s3_bucket"],
        )
        s.add(chat_file)
        s.commit()
        s.refresh(chat_file)
        return chat_file

    @staticmethod
    def is_real_task(history: ChatHistory) -> bool:
        """Check if a task is a real task vs a placeholder/trigger-created task."""
        if history.spend and history.spend > 0:
            return True
        if history.tokens and history.tokens > 0:
            return True
        if (
            history.model_platform
            and history.model_platform != "none"
            and history.model_type
            and history.model_type != "none"
            and history.installed_mcp
            and history.installed_mcp != "none"
        ):
            return True
        if history.question and history.question.startswith("Project created via trigger:"):
            return False
        return True

    @staticmethod
    def _build_project_data(
        histories: list[ChatHistory],
        trigger_count_map: dict[str, int],
        include_tasks: bool,
        project_id_override: str | None = None,
    ) -> list[ProjectGroup]:
        """Build ProjectGroup list from histories. Shared by grouped list and single project endpoints."""
        project_map: Dict[str, Dict] = defaultdict(
            lambda: {
                "project_id": "",
                "project_name": None,
                "total_tokens": 0,
                "task_count": 0,
                "latest_task_date": "",
                "last_prompt": None,
                "tasks": [],
                "total_completed_tasks": 0,
                "total_ongoing_tasks": 0,
                "average_tokens_per_task": 0,
                "total_triggers": 0,
            }
        )

        for history in histories:
            project_id = project_id_override or (history.project_id if history.project_id else history.task_id)
            project_data = project_map[project_id]

            if not project_data["project_id"]:
                project_data["project_id"] = project_id
                project_data["project_name"] = history.project_name or f"Project {project_id}"
                project_data["latest_task_date"] = history.created_at.isoformat() if history.created_at else ""
                project_data["last_prompt"] = history.question

            if include_tasks and ChatService.is_real_task(history):
                project_data["tasks"].append(ChatHistoryOut(**history.model_dump()))

            if ChatService.is_real_task(history):
                project_data["task_count"] += 1
                project_data["total_tokens"] += history.tokens or 0

                if history.status == ChatStatus.done:
                    project_data["total_completed_tasks"] += 1
                elif history.status == ChatStatus.ongoing:
                    project_data["total_ongoing_tasks"] += 1

                if history.created_at:
                    task_date = history.created_at.isoformat()
                    if not project_data["latest_task_date"] or task_date > project_data["latest_task_date"]:
                        project_data["latest_task_date"] = task_date
                        project_data["last_prompt"] = history.question

        projects = []
        for project_data in project_map.values():
            if include_tasks:
                project_data["tasks"].sort(key=lambda x: (x.created_at is None, x.created_at or ""), reverse=False)
            pid = project_data["project_id"]
            project_data["total_triggers"] = trigger_count_map.get(pid, 0)
            projects.append(ProjectGroup(**project_data))

        projects.sort(key=lambda x: x.latest_task_date, reverse=True)
        return projects

    @staticmethod
    def get_grouped_histories(user_id: int, include_tasks: bool, s: Session) -> GroupedHistoryResponse:
        """Get all chat histories grouped by project for a user."""
        stmt = (
            select(ChatHistory)
            .where(ChatHistory.user_id == user_id)
            .order_by(
                desc(case((ChatHistory.created_at.is_(None), 0), else_=1)),
                desc(ChatHistory.created_at),
                desc(ChatHistory.id),
            )
        )
        histories = s.exec(stmt).all()

        trigger_count_stmt = (
            select(Trigger.project_id, func.count(Trigger.id).label("count"))
            .where(Trigger.user_id == str(user_id))
            .group_by(Trigger.project_id)
        )
        trigger_counts = s.exec(trigger_count_stmt).all()
        trigger_count_map = {project_id: count for project_id, count in trigger_counts}

        projects = ChatService._build_project_data(histories, trigger_count_map, include_tasks)
        return GroupedHistoryResponse(projects=projects)

    @staticmethod
    def get_grouped_project(user_id: int, project_id: str, include_tasks: bool, s: Session) -> ProjectGroup | None:
        """Get a single project group by project_id."""
        stmt = (
            select(ChatHistory)
            .where(ChatHistory.user_id == user_id)
            .where(ChatHistory.project_id == project_id)
            .order_by(
                desc(case((ChatHistory.created_at.is_(None), 0), else_=1)),
                desc(ChatHistory.created_at),
                desc(ChatHistory.id),
            )
        )
        histories = s.exec(stmt).all()
        if not histories:
            return None

        trigger_count_stmt = (
            select(func.count(Trigger.id)).where(Trigger.user_id == str(user_id)).where(Trigger.project_id == project_id)
        )
        trigger_count = s.exec(trigger_count_stmt).first() or 0
        trigger_count_map = {project_id: trigger_count}

        projects = ChatService._build_project_data(histories, trigger_count_map, include_tasks, project_id_override=project_id)
        return projects[0] if projects else None
