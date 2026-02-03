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

"""
Skill management controller for handling skill file operations.
"""
import logging
import os
from pathlib import Path
from typing import List
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

logger = logging.getLogger("skill_controller")

router = APIRouter()


class SkillInfo(BaseModel):
    """Skill file information"""
    name: str
    size: int
    created_at: float
    modified_at: float


def get_skills_directory() -> Path:
    """Get the skills directory path"""
    # Find project root
    current = Path(__file__).resolve()
    for _ in range(10):
        if (current / "package.json").exists():
            return current / "skills"
        current = current.parent
    # Fallback to default
    return Path.cwd() / "skills"


@router.get("/skills")
async def list_skills() -> List[SkillInfo]:
    """
    List all skill files in the skills directory
    
    Returns:
        List of skill file information
    """
    try:
        skills_dir = get_skills_directory()
        
        if not skills_dir.exists():
            skills_dir.mkdir(parents=True, exist_ok=True)
            return []
        
        skills = []
        for file_path in skills_dir.iterdir():
            if file_path.is_file() and not file_path.name.startswith('.'):
                stat = file_path.stat()
                skills.append(SkillInfo(
                    name=file_path.name,
                    size=stat.st_size,
                    created_at=stat.st_ctime,
                    modified_at=stat.st_mtime
                ))
        
        # Sort by modified time (newest first)
        skills.sort(key=lambda x: x.modified_at, reverse=True)
        return skills
        
    except Exception as e:
        logger.error(f"Failed to list skills: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/skills/{skill_name}")
async def get_skill(skill_name: str):
    """
    Get skill file content
    
    Args:
        skill_name: Name of the skill file
        
    Returns:
        Skill file content
    """
    try:
        skills_dir = get_skills_directory()
        skill_path = skills_dir / skill_name
        
        # Security check: prevent path traversal
        if not skill_path.resolve().is_relative_to(skills_dir.resolve()):
            raise HTTPException(status_code=403, detail="Invalid skill name")
        
        if not skill_path.exists():
            raise HTTPException(status_code=404, detail="Skill not found")
        
        return FileResponse(
            skill_path,
            media_type="text/markdown",
            filename=skill_name
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get skill {skill_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/skills/upload")
async def upload_skill(file: UploadFile = File(...)):
    """
    Upload a new skill file
    
    Args:
        file: Skill file to upload
        
    Returns:
        Success message with skill info
    """
    try:
        # Validate file extension
        if not file.filename:
            raise HTTPException(status_code=400, detail="Invalid filename")
        
        # Allow markdown and text files
        allowed_extensions = {'.md', '.txt', '.markdown'}
        file_ext = Path(file.filename).suffix.lower()
        if file_ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
            )
        
        skills_dir = get_skills_directory()
        skills_dir.mkdir(parents=True, exist_ok=True)
        
        skill_path = skills_dir / file.filename
        
        # Read and write file
        content = await file.read()
        skill_path.write_bytes(content)
        
        stat = skill_path.stat()
        return JSONResponse(
            content={
                "success": True,
                "message": "Skill uploaded successfully",
                "skill": {
                    "name": file.filename,
                    "size": stat.st_size,
                    "created_at": stat.st_ctime,
                    "modified_at": stat.st_mtime
                }
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload skill: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/skills/{skill_name}")
async def delete_skill(skill_name: str):
    """
    Delete a skill file
    
    Args:
        skill_name: Name of the skill file to delete
        
    Returns:
        Success message
    """
    try:
        skills_dir = get_skills_directory()
        skill_path = skills_dir / skill_name
        
        # Security check: prevent path traversal
        if not skill_path.resolve().is_relative_to(skills_dir.resolve()):
            raise HTTPException(status_code=403, detail="Invalid skill name")
        
        if not skill_path.exists():
            raise HTTPException(status_code=404, detail="Skill not found")
        
        skill_path.unlink()
        
        return JSONResponse(
            content={
                "success": True,
                "message": f"Skill {skill_name} deleted successfully"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete skill {skill_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
