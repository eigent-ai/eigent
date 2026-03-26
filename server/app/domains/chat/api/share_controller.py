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

"""Chat Share controller with auth and task ownership on create."""

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from starlette.responses import StreamingResponse

from app.core.database import session
from app.model.chat.chat_share import ChatHistoryShareOut, ChatShare, ChatShareIn
from app.model.chat.chat_step import ChatStep
from app.model.chat.chat_history import ChatHistory

from app.shared.auth import auth_must
from app.domains.chat.service import ChatService
from app.domains.chat.schema import TaskOwnershipCheckReq
from itsdangerous import BadTimeSignature, SignatureExpired

router = APIRouter(prefix="/chat", tags=["V1 Chat Share"])


@router.get("/share/info/{token}", name="Get shared chat info", response_model=ChatHistoryShareOut)
def get_share_info(token: str, db_session: Session = Depends(session)):
    try:
        task_id = ChatShare.verify_token(token, False)
    except (SignatureExpired, BadTimeSignature):
        raise HTTPException(status_code=400, detail="Share link is invalid or has expired.")
    stmt = select(ChatHistory).where(ChatHistory.task_id == task_id)
    history = db_session.exec(stmt).one_or_none()
    if not history:
        raise HTTPException(status_code=404, detail="Chat history not found.")
    return history


@router.get("/share/playback/{token}", name="Playback shared chat via SSE")
async def share_playback(token: str, db_session: Session = Depends(session), delay_time: float = 0):
    if delay_time > 5:
        delay_time = 5
    try:
        task_id = ChatShare.verify_token(token, False)
    except SignatureExpired:
        raise HTTPException(status_code=400, detail="Share link has expired.")
    except BadTimeSignature:
        raise HTTPException(status_code=400, detail="Share link is invalid.")

    async def event_generator():
        stmt = select(ChatStep).where(ChatStep.task_id == task_id).order_by(ChatStep.id)
        steps = db_session.exec(stmt).all()
        if not steps:
            yield f"data: {json.dumps({'error': 'No steps found for this task.'})}\n\n"
            return
        for s in steps:
            step_data = {
                "id": s.id,
                "task_id": s.task_id,
                "step": s.step,
                "data": s.data,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            yield f"data: {json.dumps(step_data)}\n\n"
            if delay_time > 0 and s.step != "create_agent":
                await asyncio.sleep(delay_time)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/share", name="Generate sharable link for a task(1 day expiration)")
def create_share_link(
    data: ChatShareIn,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    if not ChatService.verify_task_ownership(TaskOwnershipCheckReq(task_id=data.task_id, user_id=auth.user.id)):
        raise HTTPException(status_code=403, detail="Task not found or access denied.")
    share_token = ChatShare.generate_token(data.task_id)
    return {"share_token": share_token}
