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

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.utils.knowledge_base import add_entry, get_entries, delete_entry

router = APIRouter(prefix="/knowledge", tags=["Knowledge Base"])


class KnowledgeAddIn(BaseModel):
    """Request body for adding a knowledge entry."""

    project_id: str = Field(..., description="Project ID (scope for this entry)")
    content: str = Field(..., min_length=1, description="Content to store as long-term memory")


class KnowledgeAddOut(BaseModel):
    """Response after adding a knowledge entry."""

    id: int
    project_id: str
    message: str = "Knowledge entry added"


class KnowledgeEntryOut(BaseModel):
    """A single knowledge entry."""

    id: int
    project_id: str
    content: str
    created_at: float


@router.post("", name="add knowledge", response_model=KnowledgeAddOut)
async def knowledge_add(body: KnowledgeAddIn):
    """Add a knowledge entry for long-term memory (issue #1099)."""
    try:
        entry_id = add_entry(project_id=body.project_id, content=body.content)
        return KnowledgeAddOut(id=entry_id, project_id=body.project_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("", name="list knowledge")
async def knowledge_list(
    project_id: str = Query(..., description="Project ID"),
    query: str | None = Query(None, description="Optional keyword filter"),
    limit: int = Query(50, ge=1, le=200, description="Max entries to return"),
):
    """List knowledge entries for a project, optionally filtered by keyword."""
    try:
        entries = get_entries(project_id=project_id, query=query, limit=limit)
        return {"project_id": project_id, "entries": entries}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{entry_id}", name="delete knowledge")
async def knowledge_delete(
    entry_id: int,
    project_id: str = Query(..., description="Project ID"),
):
    """Delete a knowledge entry by id (scoped to project)."""
    try:
        deleted = delete_entry(project_id=project_id, entry_id=entry_id)
        if not deleted:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge entry {entry_id} not found for project {project_id}",
            )
        return {"deleted": True, "id": entry_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
