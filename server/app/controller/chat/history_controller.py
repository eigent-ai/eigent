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
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from app.model.trigger.trigger import Trigger
from sqlmodel import Session, case, desc, select, func

from app.component.auth import Auth, auth_must
from app.component.database import session
from app.model.chat.chat_history import (
    ChatHistory,
    ChatHistoryIn,
    ChatHistoryOut,
    ChatHistoryUpdate,
    ChatStatus,
)
from app.model.chat.chat_history_grouped import (
    GroupedHistoryResponse,
    ProjectGroup,
)

logger = logging.getLogger("server_chat_history")

router = APIRouter(prefix="/chat", tags=["Chat History"])

def is_real_task(history: ChatHistory) -> bool:
    """
    Check if a task is a real task vs a placeholder/trigger-created task.
    Excludes placeholder tasks created during trigger creation.
    """
    # Has actual token usage
    if history.tokens and history.tokens > 0:
        return True
    
    # Has real model configuration (not placeholder "none" values)
    if (history.model_platform and history.model_platform != "none" and
        history.model_type and history.model_type != "none" and
        history.installed_mcp and history.installed_mcp != "none"):
        return True
    
    # Check if question starts with trigger placeholder prefix
    if history.question and history.question.startswith("Project created via trigger:"):
        return False
    
    # Default to real task if no placeholder indicators
    return True

@router.post("/history", name="save chat history", response_model=ChatHistoryOut)
def create_chat_history(data: ChatHistoryIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Save new chat history."""
    user_id = auth.user.id

    try:
        data.user_id = user_id
        chat_history = ChatHistory(**data.model_dump())
        session.add(chat_history)
        session.commit()
        session.refresh(chat_history)
        logger.info(
            "Chat history created", extra={"user_id": user_id, "history_id": chat_history.id, "task_id": data.task_id}
        )
        return chat_history
    except Exception as e:
        session.rollback()
        logger.error(
            "Chat history creation failed",
            extra={"user_id": user_id, "task_id": data.task_id, "error": str(e)},
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/histories", name="get chat history")
def list_chat_history(session: Session = Depends(session), auth: Auth = Depends(auth_must)) -> Page[ChatHistoryOut]:
    """List chat histories for current user."""
    user_id = auth.user.id

    # Order by created_at descending, but fallback to id descending for old records without timestamps
    # This ensures newer records with timestamps come first, followed by old records ordered by id
    stmt = (
        select(ChatHistory)
        .where(ChatHistory.user_id == user_id)
        .order_by(
            desc(case((ChatHistory.created_at.is_(None), 0), else_=1)),  # Non-null created_at first
            desc(ChatHistory.created_at),  # Then by created_at descending
            desc(ChatHistory.id),  # Finally by id descending for records with same/null created_at
        )
    )

    result = paginate(session, stmt)
    total = result.total if hasattr(result, "total") else 0
    logger.debug("Chat histories listed", extra={"user_id": user_id, "total": total})
    return result


@router.get("/histories/grouped", name="get grouped chat history")
def list_grouped_chat_history(
    include_tasks: Optional[bool] = Query(True, description="Whether to include individual tasks in groups"),
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must)
) -> GroupedHistoryResponse:
    """List chat histories grouped by project_id for current user."""
    user_id = auth.user.id

    # Get all histories for the user, ordered by creation time
    stmt = (
        select(ChatHistory)
        .where(ChatHistory.user_id == user_id)
        .order_by(
            desc(case((ChatHistory.created_at.is_(None), 0), else_=1)),  # Non-null created_at first
            desc(ChatHistory.created_at),  # Then by created_at descending
            desc(ChatHistory.id)  # Finally by id descending for records with same/null created_at
        )
    )

    histories = session.exec(stmt).all()

    # Get trigger counts per project
    trigger_count_stmt = (
        select(Trigger.project_id, func.count(Trigger.id).label('count'))
        .where(Trigger.user_id == str(user_id))
        .group_by(Trigger.project_id)
    )
    trigger_counts = session.exec(trigger_count_stmt).all()
    trigger_count_map = {project_id: count for project_id, count in trigger_counts}

    # Group histories by project_id
    project_map = defaultdict(lambda: {
        'project_id': '',
        'project_name': None,
        'total_tokens': 0,
        'task_count': 0,
        'latest_task_date': '',
        'last_prompt': None,
        'tasks': [],
        'total_completed_tasks': 0,
        'total_ongoing_tasks': 0,
        'average_tokens_per_task': 0,
        'total_triggers': 0
    })
    
    for history in histories:
        # Use project_id if available, fallback to task_id
        project_id = history.project_id if history.project_id else history.task_id
        project_data = project_map[project_id]

        # Initialize project data
        if not project_data['project_id']:
            project_data['project_id'] = project_id
            project_data['project_name'] = history.project_name or f"Project {project_id}"
            project_data['latest_task_date'] = history.created_at.isoformat() if history.created_at else ''
            project_data['last_prompt'] = history.question  # Set the most recent question

        # Convert to ChatHistoryOut format
        history_out = ChatHistoryOut(**history.model_dump())

        # Add task to project if requested (only real tasks)
        if include_tasks and is_real_task(history):
            project_data['tasks'].append(history_out)

        # Update project statistics (only for real tasks)
        if is_real_task(history):
            project_data['task_count'] += 1
            project_data['total_tokens'] += history.tokens or 0

            if history.status == ChatStatus.done:
                project_data['total_completed_tasks'] += 1
            elif history.status == ChatStatus.ongoing:
                project_data['total_ongoing_tasks'] += 1
            
            # Update latest task date and last prompt
            if history.created_at:
                task_date = history.created_at.isoformat()
                if not project_data['latest_task_date'] or task_date > project_data['latest_task_date']:
                    project_data['latest_task_date'] = task_date
                    project_data['last_prompt'] = history.question

    # Convert to ProjectGroup objects and sort
    projects = []
    for project_data in project_map.values():
        # Sort tasks within each project by creation date (oldest first)
        if include_tasks:
            project_data['tasks'].sort(key=lambda x: (x.created_at is None, x.created_at or ''), reverse=False)
        
        # Set trigger count from trigger_count_map
        project_id = project_data['project_id']
        project_data['total_triggers'] = trigger_count_map.get(project_id, 0)
        
        project_group = ProjectGroup(**project_data)
        projects.append(project_group)

    # Sort projects by latest task date (newest first)
    projects.sort(key=lambda x: x.latest_task_date, reverse=True)

    response = GroupedHistoryResponse(projects=projects)
    
    logger.debug("Grouped chat histories listed", extra={
        "user_id": user_id, 
        "total_projects": response.total_projects,
        "total_tasks": response.total_tasks,
        "include_tasks": include_tasks
    })
    
    return response


@router.get("/histories/grouped/{project_id}", name="get single grouped project")
def get_grouped_project(
    project_id: str,
    include_tasks: Optional[bool] = Query(True, description="Whether to include individual tasks in the project"),
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must)
) -> ProjectGroup:
    """Get a single project group by project_id for current user."""
    user_id = auth.user.id

    # Get all histories for the specific project
    stmt = (
        select(ChatHistory)
        .where(ChatHistory.user_id == user_id)
        .where(ChatHistory.project_id == project_id)
        .order_by(
            desc(case((ChatHistory.created_at.is_(None), 0), else_=1)),
            desc(ChatHistory.created_at),
            desc(ChatHistory.id)
        )
    )

    histories = session.exec(stmt).all()

    if not histories:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get trigger count for this project
    trigger_count_stmt = (
        select(func.count(Trigger.id))
        .where(Trigger.user_id == str(user_id))
        .where(Trigger.project_id == project_id)
    )
    trigger_count = session.exec(trigger_count_stmt).first() or 0

    # Build project data
    project_data = {
        'project_id': project_id,
        'project_name': None,
        'total_tokens': 0,
        'task_count': 0,
        'latest_task_date': '',
        'last_prompt': None,
        'tasks': [],
        'total_completed_tasks': 0,
        'total_ongoing_tasks': 0,
        'average_tokens_per_task': 0,
        'total_triggers': trigger_count
    }

    for history in histories:
        # Initialize project name from first history
        if not project_data['project_name']:
            project_data['project_name'] = history.project_name or f"Project {project_id}"
            project_data['latest_task_date'] = history.created_at.isoformat() if history.created_at else ''
            project_data['last_prompt'] = history.question

        # Convert to ChatHistoryOut format
        history_out = ChatHistoryOut(**history.model_dump())

        # Add task to project if requested (only real tasks)
        if include_tasks and is_real_task(history):
            project_data['tasks'].append(history_out)

        # Update project statistics (only for real tasks)
        if is_real_task(history):
            project_data['task_count'] += 1
            project_data['total_tokens'] += history.tokens or 0

            if history.status == ChatStatus.done:
                project_data['total_completed_tasks'] += 1
            elif history.status == ChatStatus.ongoing:
                project_data['total_ongoing_tasks'] += 1

            # Update latest task date and last prompt
            if history.created_at:
                task_date = history.created_at.isoformat()
                if not project_data['latest_task_date'] or task_date > project_data['latest_task_date']:
                    project_data['latest_task_date'] = task_date
                    project_data['last_prompt'] = history.question

    # Sort tasks within the project by creation date (oldest first)
    if include_tasks:
        project_data['tasks'].sort(key=lambda x: (x.created_at is None, x.created_at or ''), reverse=False)

    project_group = ProjectGroup(**project_data)

    logger.debug("Single grouped project retrieved", extra={
        "user_id": user_id,
        "project_id": project_id,
        "task_count": project_group.task_count,
        "include_tasks": include_tasks
    })

    return project_group


@router.delete("/history/{history_id}", name="delete chat history")
def delete_chat_history(history_id: str, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Delete chat history."""
    user_id = auth.user.id
    history = session.exec(select(ChatHistory).where(ChatHistory.id == history_id)).first()

    if not history:
        logger.warning("Chat history not found for deletion", extra={"user_id": user_id, "history_id": history_id})
        raise HTTPException(status_code=404, detail="Chat History not found")

    if history.user_id != user_id:
        logger.warning(
            "Unauthorized deletion attempt",
            extra={"user_id": user_id, "history_id": history_id, "owner_id": history.user_id},
        )
        raise HTTPException(status_code=403, detail="You are not allowed to delete this chat history")

    try:
        session.delete(history)
        session.commit()
        logger.info("Chat history deleted", extra={"user_id": user_id, "history_id": history_id})
        return Response(status_code=204)
    except Exception as e:
        session.rollback()
        logger.error(
            "Chat history deletion failed",
            extra={"user_id": user_id, "history_id": history_id, "error": str(e)},
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/history/{history_id}", name="update chat history", response_model=ChatHistoryOut)
def update_chat_history(
    history_id: int, data: ChatHistoryUpdate, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    """Update chat history."""
    user_id = auth.user.id
    history = session.exec(select(ChatHistory).where(ChatHistory.id == history_id)).first()

    if not history:
        logger.warning("Chat history not found for update", extra={"user_id": user_id, "history_id": history_id})
        raise HTTPException(status_code=404, detail="Chat History not found")

    if history.user_id != user_id:
        logger.warning(
            "Unauthorized update attempt",
            extra={"user_id": user_id, "history_id": history_id, "owner_id": history.user_id},
        )
        raise HTTPException(status_code=403, detail="You are not allowed to update this chat history")

    try:
        update_data = data.model_dump(exclude_unset=True)
        history.update_fields(update_data)
        history.save(session)
        session.refresh(history)
        logger.info(
            "Chat history updated",
            extra={"user_id": user_id, "history_id": history_id, "fields_updated": list(update_data.keys())},
        )
        return history
    except Exception as e:
        logger.error(
            "Chat history update failed",
            extra={"user_id": user_id, "history_id": history_id, "error": str(e)},
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/project/{project_id}/name", name="update project name")
def update_project_name(
    project_id: str, new_name: str, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    """Update project name for all tasks in a project."""
    user_id = auth.user.id

    # Get all histories for this project
    stmt = select(ChatHistory).where(ChatHistory.project_id == project_id).where(ChatHistory.user_id == user_id)

    histories = session.exec(stmt).all()

    if not histories:
        logger.warning("No histories found for project", extra={"user_id": user_id, "project_id": project_id})
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    try:
        # Update all histories for this project
        for history in histories:
            history.project_name = new_name
            session.add(history)

        session.commit()

        logger.info(
            "Project name updated",
            extra={"user_id": user_id, "project_id": project_id, "new_name": new_name, "updated_count": len(histories)},
        )

        return Response(status_code=200)
    except Exception as e:
        session.rollback()
        logger.error(
            "Project name update failed",
            extra={"user_id": user_id, "project_id": project_id, "error": str(e)},
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Internal server error")
