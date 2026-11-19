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
"""Start Tasks with no renderer: ``/v1/tasks``.

The caller sends a prompt and a Space folder. The Brain resolves the model,
the Space and the permission profile itself; see ``app.dispatch``. Following,
answering, approving and stopping the Task use the Run routes.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import allow_cli_token, require_local_control_principal
from app.dispatch import service
from app.dispatch.lifecycle import request_shutdown

router = APIRouter(
    dependencies=[
        Depends(allow_cli_token),
        Depends(require_local_control_principal),
    ]
)


class DispatchTaskCreate(BaseModel):
    prompt: str = Field(min_length=1, max_length=200_000)
    # The Session (Project) to continue. Omitted: a new Session is created.
    project_id: str | None = Field(default=None, min_length=1, max_length=128)
    # Required for a new Session; an existing one keeps its folder.
    space_root_path: str | None = Field(default=None, max_length=4096)
    # No server default: Desktop and Brain defaults differ, so every entry
    # point states the mode it wants.
    session_mode: Literal["single-agent", "workforce"] | None = None
    # Becomes the Task id, so a retried request cannot start a second Task.
    request_id: str | None = Field(default=None, min_length=1, max_length=128)
    attachments: list[str] = Field(default_factory=list, max_length=32)
    # Model name on the Brain's configured platform and key.
    model_type: str | None = Field(default=None, min_length=1, max_length=200)
    language: str | None = Field(default=None, max_length=32)
    timezone: str | None = Field(default=None, max_length=64)


class DispatchTaskResume(BaseModel):
    request_id: str | None = Field(default=None, min_length=1, max_length=128)


def _http_error(exc: service.DispatchError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={"code": exc.code, "message": exc.message},
    )


@router.post("/v1/tasks", status_code=202, name="start task")
async def create_task(
    data: DispatchTaskCreate, request: Request
) -> dict[str, Any]:
    if not data.prompt.strip():
        raise HTTPException(
            status_code=422,
            detail={"code": "prompt_required", "message": "prompt is empty."},
        )
    try:
        return await service.start_task(
            request,
            prompt=data.prompt,
            project_id=data.project_id,
            space_root_path=data.space_root_path,
            session_mode=data.session_mode,
            request_id=data.request_id,
            attachments=data.attachments,
            model_type=data.model_type,
            language=data.language,
            timezone=data.timezone,
        )
    except service.DispatchError as exc:
        raise _http_error(exc) from exc


@router.get("/v1/tasks/{task_id}", name="task status")
async def get_task(task_id: str) -> dict[str, Any]:
    try:
        return await service.get_task(task_id)
    except service.DispatchError as exc:
        raise _http_error(exc) from exc


@router.post("/v1/tasks/{task_id}/resume", status_code=202, name="resume task")
async def resume_task(
    task_id: str, request: Request, data: DispatchTaskResume | None = None
) -> dict[str, Any]:
    try:
        return await service.resume_task(
            request,
            task_id,
            request_id=data.request_id if data else None,
        )
    except service.DispatchError as exc:
        raise _http_error(exc) from exc


@router.post("/v1/brain/shutdown", status_code=202, name="stop standalone")
async def shutdown() -> dict[str, Any]:
    """Stop a Brain that was started on its own. Desktop's cannot be."""

    if not request_shutdown():
        raise HTTPException(
            status_code=409,
            detail={
                "code": "not_standalone",
                "message": "Eigent is running inside the desktop app. "
                "Quit the app to stop it.",
            },
        )
    return {"status": "stopping"}
