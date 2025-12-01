from pydantic import BaseModel, model_validator
from typing import List, Optional
from datetime import datetime
from app.model.chat.chat_history import ChatHistoryOut


class ProjectGroup(BaseModel):
    """Project group response model for grouped history"""
    project_id: str
    project_name: Optional[str] = None
    total_tokens: int = 0
    task_count: int = 0
    latest_task_date: str
    last_prompt: Optional[str] = None
    tasks: List[ChatHistoryOut] = []
    # Additional project-level metadata
    total_completed_tasks: int = 0
    total_ongoing_tasks: int = 0
    average_tokens_per_task: int = 0

    @model_validator(mode="after")
    def calculate_averages(self):
        """Calculate average tokens per task"""
        if self.task_count > 0:
            self.average_tokens_per_task = round(self.total_tokens / self.task_count)
        else:
            self.average_tokens_per_task = 0
        return self


class GroupedHistoryResponse(BaseModel):
    """Response model for grouped history data"""
    projects: List[ProjectGroup]
    total_projects: int = 0
    total_tasks: int = 0
    total_tokens: int = 0

    @model_validator(mode="after")
    def calculate_totals(self):
        """Calculate total projects, tasks, and tokens"""
        self.total_projects = len(self.projects)
        self.total_tasks = sum(project.task_count for project in self.projects)
        self.total_tokens = sum(project.total_tokens for project in self.projects)
        return self


class HistoryApiOptions(BaseModel):
    """Options for history API requests"""
    grouped: Optional[bool] = False
    include_tasks: Optional[bool] = True