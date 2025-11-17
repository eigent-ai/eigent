from fastapi import APIRouter, Depends, HTTPException, Response, Query
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from app.model.chat.chat_history import ChatHistoryOut, ChatHistoryIn, ChatHistory, ChatHistoryUpdate, ChatStatus
from app.model.chat.chat_history_grouped import ProjectGroup, GroupedHistoryResponse
from fastapi_babel import _
from sqlmodel import Session, select, desc, case
from app.component.auth import Auth, auth_must
from app.component.database import session
from utils import traceroot_wrapper as traceroot
from typing import Optional, Dict, List
from collections import defaultdict

logger = traceroot.get_logger("server_chat_history")

router = APIRouter(prefix="/chat", tags=["Chat History"])


@router.post("/history", name="save chat history", response_model=ChatHistoryOut)
@traceroot.trace()
def create_chat_history(data: ChatHistoryIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Save new chat history."""
    user_id = auth.user.id
    
    try:
        data.user_id = user_id
        chat_history = ChatHistory(**data.model_dump())
        session.add(chat_history)
        session.commit()
        session.refresh(chat_history)
        logger.info("Chat history created", extra={"user_id": user_id, "history_id": chat_history.id, "task_id": data.task_id})
        return chat_history
    except Exception as e:
        session.rollback()
        logger.error("Chat history creation failed", extra={"user_id": user_id, "task_id": data.task_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/histories", name="get chat history")
@traceroot.trace()
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
            desc(ChatHistory.id)  # Finally by id descending for records with same/null created_at
        )
    )
    
    result = paginate(session, stmt)
    total = result.total if hasattr(result, 'total') else 0
    logger.debug("Chat histories listed", extra={"user_id": user_id, "total": total})
    return result


@router.get("/histories/grouped", name="get grouped chat history")
@traceroot.trace()
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
    
    # Group histories by project_id
    project_map: Dict[str, Dict] = defaultdict(lambda: {
        'project_id': '',
        'project_name': None,
        'total_tokens': 0,
        'task_count': 0,
        'latest_task_date': '',
        'last_prompt': None,
        'tasks': [],
        'total_completed_tasks': 0,
        'total_ongoing_tasks': 0,
        'average_tokens_per_task': 0
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
        
        # Add task to project if requested
        if include_tasks:
            project_data['tasks'].append(history_out)
        
        # Update project statistics
        project_data['task_count'] += 1
        project_data['total_tokens'] += history.tokens or 0

        # Count completed and failed tasks
        # ChatStatus.ongoing = 1, ChatStatus.done = 2
        if history.status == ChatStatus.done:
            project_data['total_completed_tasks'] += 1
        elif history.status == ChatStatus.ongoing:
            project_data['total_ongoing_tasks'] += 1
        else:
            # Only count as failed if not ongoing and not done
            project_data['total_failed_tasks'] += 1
        
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


@router.delete("/history/{history_id}", name="delete chat history")
@traceroot.trace()
def delete_chat_history(history_id: str, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Delete chat history."""
    user_id = auth.user.id
    history = session.exec(select(ChatHistory).where(ChatHistory.id == history_id)).first()
    
    if not history:
        logger.warning("Chat history not found for deletion", extra={"user_id": user_id, "history_id": history_id})
        raise HTTPException(status_code=404, detail="Chat History not found")
    
    if history.user_id != user_id:
        logger.warning("Unauthorized deletion attempt", extra={"user_id": user_id, "history_id": history_id, "owner_id": history.user_id})
        raise HTTPException(status_code=403, detail="You are not allowed to delete this chat history")
    
    try:
        session.delete(history)
        session.commit()
        logger.info("Chat history deleted", extra={"user_id": user_id, "history_id": history_id})
        return Response(status_code=204)
    except Exception as e:
        session.rollback()
        logger.error("Chat history deletion failed", extra={"user_id": user_id, "history_id": history_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/history/{history_id}", name="update chat history", response_model=ChatHistoryOut)
@traceroot.trace()
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
        logger.warning("Unauthorized update attempt", extra={"user_id": user_id, "history_id": history_id, "owner_id": history.user_id})
        raise HTTPException(status_code=403, detail="You are not allowed to update this chat history")

    try:
        update_data = data.model_dump(exclude_unset=True)
        history.update_fields(update_data)
        history.save(session)
        session.refresh(history)
        logger.info("Chat history updated", extra={"user_id": user_id, "history_id": history_id, "fields_updated": list(update_data.keys())})
        return history
    except Exception as e:
        logger.error("Chat history update failed", extra={"user_id": user_id, "history_id": history_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/project/{project_id}/name", name="update project name")
@traceroot.trace()
def update_project_name(
    project_id: str,
    new_name: str,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must)
):
    """Update project name for all tasks in a project."""
    user_id = auth.user.id

    # Get all histories for this project
    stmt = (
        select(ChatHistory)
        .where(ChatHistory.project_id == project_id)
        .where(ChatHistory.user_id == user_id)
    )

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

        logger.info("Project name updated", extra={
            "user_id": user_id,
            "project_id": project_id,
            "new_name": new_name,
            "updated_count": len(histories)
        })

        return Response(status_code=200)
    except Exception as e:
        session.rollback()
        logger.error("Project name update failed", extra={"user_id": user_id, "project_id": project_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")