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

"""Trigger Execution controller. Uses TriggerCrudService for REST, WebSocket handled locally."""

from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from sqlmodel import Session, select, desc, and_
from typing import Optional, Dict, Any
from datetime import datetime, timezone
from loguru import logger
import asyncio

from app.model.trigger.trigger_execution import (
    TriggerExecution,
    TriggerExecutionIn,
    TriggerExecutionOut,
    TriggerExecutionUpdate,
)
from app.model.trigger.trigger import Trigger
from app.model.user.user import User
from app.shared.types.trigger_types import ExecutionStatus, ExecutionType
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth
from app.core.database import session
from app.core.redis_utils import get_redis_manager
from app.domains.trigger.service.trigger_crud_service import TriggerCrudService

# Store active WebSocket connections per session (WebSocket objects only, metadata in Redis)
active_websockets: Dict[str, WebSocket] = {}
_pubsub_task = None

router = APIRouter(prefix="/execution", tags=["Trigger Executions"])


def _raise_on_error(result: dict) -> None:
    """Convert service error dict to HTTPException."""
    if result["success"]:
        return
    raise HTTPException(status_code=result.get("status_code", 500), detail=result.get("error", "Internal server error"))


@router.post("/", name="create trigger execution", response_model=TriggerExecutionOut)
async def create_trigger_execution(
    data: TriggerExecutionIn,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    """Create a new trigger execution."""
    try:
        result = TriggerCrudService.create_execution(data, auth.id, db_session)
        _raise_on_error(result)
        return result["execution"]
    except HTTPException:
        raise
    except Exception as e:
        db_session.rollback()
        logger.error("Trigger execution creation failed", extra={"user_id": auth.id, "trigger_id": data.trigger_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/", name="list executions")
def list_executions(
    trigger_id: Optional[int] = None,
    status: Optional[ExecutionStatus] = None,
    execution_type: Optional[ExecutionType] = None,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
) -> Page[TriggerExecutionOut]:
    """List trigger executions for current user."""
    user_id = auth.id
    user_trigger_ids = db_session.exec(select(Trigger.id).where(Trigger.user_id == str(user_id))).all()
    if not user_trigger_ids:
        return Page(items=[], total=0, page=1, size=50, pages=0)

    conditions = [TriggerExecution.trigger_id.in_(user_trigger_ids)]
    if trigger_id:
        if trigger_id not in user_trigger_ids:
            raise HTTPException(status_code=404, detail="Trigger not found")
        conditions.append(TriggerExecution.trigger_id == trigger_id)
    if status is not None:
        conditions.append(TriggerExecution.status == status)
    if execution_type:
        conditions.append(TriggerExecution.execution_type == execution_type)

    stmt = select(TriggerExecution).where(and_(*conditions)).order_by(desc(TriggerExecution.created_at))
    return paginate(db_session, stmt)


@router.get("/{execution_id}", name="get execution", response_model=TriggerExecutionOut)
def get_execution(
    execution_id: str,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    """Get a specific execution by execution ID."""
    execution = db_session.exec(
        select(TriggerExecution).join(Trigger).where(
            and_(TriggerExecution.execution_id == execution_id, Trigger.user_id == str(auth.id))
        )
    ).first()
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    return execution


@router.put("/{execution_id}", name="update execution", response_model=TriggerExecutionOut)
async def update_execution(
    execution_id: str,
    data: TriggerExecutionUpdate,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    """Update a trigger execution."""
    try:
        result = TriggerCrudService.update_execution(execution_id, data, auth.id, db_session)
        _raise_on_error(result)
        return result["execution"]
    except HTTPException:
        raise
    except Exception as e:
        db_session.rollback()
        logger.error("Execution update failed", extra={"user_id": auth.id, "execution_id": execution_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{execution_id}", name="delete execution")
def delete_execution(
    execution_id: str,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    """Delete a trigger execution."""
    execution = db_session.exec(
        select(TriggerExecution).join(Trigger).where(
            and_(TriggerExecution.execution_id == execution_id, Trigger.user_id == str(auth.id))
        )
    ).first()
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    try:
        db_session.delete(execution)
        db_session.commit()
        return Response(status_code=204)
    except Exception as e:
        db_session.rollback()
        logger.error("Execution deletion failed", extra={"user_id": auth.id, "execution_id": execution_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{execution_id}/retry", name="retry execution", response_model=TriggerExecutionOut)
def retry_execution(
    execution_id: str,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    """Retry a failed execution."""
    try:
        result = TriggerCrudService.retry_execution(execution_id, auth.id, db_session)
        _raise_on_error(result)
        return result["execution"]
    except HTTPException:
        raise
    except Exception as e:
        db_session.rollback()
        logger.error("Execution retry failed", extra={"user_id": auth.id, "execution_id": execution_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


# ---- WebSocket (kept in controller due to process-level state) ----

@router.websocket("/subscribe")
async def subscribe_executions(websocket: WebSocket):
    """Subscribe to trigger execution events via WebSocket.
    
    Client sends: {"type": "subscribe", "session_id": "unique-session-id", "auth_token": "bearer-token"}
    Client acknowledges execution: {"type": "ack", "execution_id": "exec-id"}
    
    Server sends: {"type": "execution_created", "execution_id": "...", ...}
    Server sends: {"type": "heartbeat", "timestamp": "..."}
    """
    # Ensure pub/sub listener is started in THIS worker process
    await start_pubsub_listener()
    
    await websocket.accept()
    session_id = None
    user_id = None
    ws_db_session = None

    try:
        # Create database session manually for WebSocket
        from app.core.database import session_make
        ws_db_session = session_make()
        # Wait for subscription message
        data = await websocket.receive_json()
        
        if data.get("type") != "subscribe" or not data.get("session_id"):
            await websocket.send_json({
                "type": "error",
                "message": "Invalid subscription. Send {type: 'subscribe', session_id: 'your-session-id', auth_token: 'bearer-token'}"
            })
            await websocket.close()
            return
        
        session_id = data["session_id"]
        auth_token = data.get("auth_token")
        
        # Authenticate user
        if not auth_token:
            await websocket.send_json({
                "type": "error",
                "message": "Authentication required. Provide 'auth_token' in subscription message"
            })
            await websocket.close()
            return
        
        try:
            from app.shared.auth.user_auth import V1UserAuth, _get_jti
            from app.shared.auth.token_blacklist import is_blacklisted as _is_blacklisted
            # Decode token and check blacklist
            auth = V1UserAuth.decode_token(auth_token)
            jti = _get_jti(auth_token)
            if jti and await _is_blacklisted(jti):
                raise Exception("Token has been revoked")
            user = ws_db_session.get(User, auth.id)
            if not user:
                raise Exception("User not found")
            auth._user = user
            user_id = auth.id
            logger.info(f"User authenticated for WebSocket {user_id} and {session_id}", extra={
                "user_id": user_id,
                "session_id": session_id
            })
        except Exception as e:
            await websocket.send_json({
                "type": "error",
                "message": "Authentication failed"
            })
            await websocket.close()
            logger.warning("WebSocket authentication failed", extra={
                "session_id": session_id,
                "error": str(e)
            })
            return
        
        # Register session in Redis and store WebSocket reference
        redis_manager = get_redis_manager()
        redis_manager.store_session(session_id, str(user_id))
        active_websockets[session_id] = websocket
        
        logger.info(f"WebSocket session registered", extra={
            "session_id": session_id,
            "user_id": user_id,
            "total_active": len(active_websockets)
        })
        
        await websocket.send_json({
            "type": "connected",
            "session_id": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        logger.info("Client subscribed to executions", extra={
            "session_id": session_id,
            "user_id": user_id,
            "total_sessions": len(active_websockets),
            "all_session_ids": list(active_websockets.keys())
        })
        
        # Handle incoming messages (acknowledgments)
        async def handle_messages():
            while True:
                try:
                    msg = await websocket.receive_json()
                    
                    if msg.get("type") == "ack" and msg.get("execution_id"):
                        execution_id = msg["execution_id"]
                        
                        # Remove from pending in Redis
                        redis_manager.remove_pending_execution(session_id, execution_id)
                        
                        # Update execution status to running
                        execution = ws_db_session.exec(
                            select(TriggerExecution).where(
                                TriggerExecution.execution_id == execution_id
                            )
                        ).first()
                        
                        if execution and execution.status == ExecutionStatus.pending:
                            execution.status = ExecutionStatus.running
                            execution.started_at = datetime.now(timezone.utc)
                            ws_db_session.add(execution)
                            ws_db_session.commit()
                            
                            logger.info("Execution acknowledged and started", extra={
                                "session_id": session_id,
                                "execution_id": execution_id
                            })
                            
                            await websocket.send_json({
                                "type": "ack_confirmed",
                                "execution_id": execution_id,
                                "status": "running"
                            })
                    
                    elif msg.get("type") == "ping":
                        # Publish pong through Redis pub/sub
                        redis_manager.publish_execution_event({
                            "type": "pong",
                            "session_id": session_id,
                            "user_id": str(user_id),
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        })
                        
                except WebSocketDisconnect:
                    break
        
        # Start heartbeat task
        async def send_heartbeat():
            while True:
                await asyncio.sleep(30)
                try:
                    await websocket.send_json({
                        "type": "heartbeat",
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    })
                except:
                    break
        
        # Run both tasks concurrently
        await asyncio.gather(
            handle_messages(),
            send_heartbeat(),
            return_exceptions=True
        )
        
    except WebSocketDisconnect as e:
        logger.info("Client disconnected", extra={
            "session_id": session_id,
            "disconnect_code": getattr(e, 'code', None),
            "reason": "websocket_disconnect"
        })
    except Exception as e:
        logger.error("WebSocket error", extra={"session_id": session_id, "error": str(e)}, exc_info=True)
    finally:
        # Mark pending executions as missed
        if session_id:
            redis_manager = get_redis_manager()
            
            # Clean up session from Redis and local WebSocket dict
            redis_manager.remove_session(session_id)
            if session_id in active_websockets:
                del active_websockets[session_id]
            logger.info("Session cleaned up", extra={"session_id": session_id})
        
        # Close database session
        if ws_db_session:
            ws_db_session.close()


async def handle_pubsub_message(event_data: Dict[str, Any]):
    """Handle execution events from Redis pub/sub.
    
    This function is called by each worker when a message is published.
    Each worker will send the message to its own local WebSocket connections.
    """
    try:
        event_type = event_data.get("type")
        logger.info(f"[PUBSUB] Received event from Redis: {event_type}", extra={
            "event_type": event_type,
            "execution_id": event_data.get("execution_id"),
            "user_id": event_data.get("user_id")
        })
        
        # Handle pong events - send only to the specific session
        if event_type == "pong":
            target_session_id = event_data.get("session_id")
            if target_session_id and target_session_id in active_websockets:
                try:
                    ws = active_websockets[target_session_id]
                    await ws.send_json({
                        "type": "pong",
                        "timestamp": event_data.get("timestamp")
                    })
                    logger.debug("Pong sent via Redis pub/sub", extra={
                        "session_id": target_session_id
                    })
                except Exception as e:
                    logger.error("Failed to send pong", extra={
                        "session_id": target_session_id,
                        "error": str(e)
                    })
            return
        
        execution_id = event_data.get("execution_id")
        event_user_id = event_data.get("user_id")
        
        if not event_user_id:
            logger.warning("Event missing user_id, cannot filter subscribers", extra={
                "execution_id": execution_id
            })
            return
        
        # Get user sessions from Redis
        redis_manager = get_redis_manager()
        user_session_ids = redis_manager.get_user_sessions(event_user_id)
        
        # Get user sessions from Redis and match with local connections
        logger.debug(f"User has {len(user_session_ids)} active session(s)", extra={
            "user_id": event_user_id,
            "session_count": len(user_session_ids)
        })
        
        # Only notify sessions that are connected to THIS worker
        local_sessions = set(active_websockets.keys()) & user_session_ids
        
        if not local_sessions:
            logger.debug("No local WebSocket connections for this user", extra={
                "user_id": event_user_id,
                "execution_id": execution_id
            })
            return  # No local connections for this user
        
        logger.info(f"Broadcasting execution to {len(local_sessions)} WebSocket(s)", extra={
            "execution_id": execution_id,
            "user_id": event_user_id,
            "session_count": len(local_sessions)
        })
        
        disconnected_sessions = []
        notified_count = 0
        
        for session_id in local_sessions:
            try:
                ws = active_websockets.get(session_id)
                if not ws:
                    disconnected_sessions.append(session_id)
                    continue
                
                # Send execution event
                await ws.send_json(event_data)
                notified_count += 1
                
                # Track as pending if it's a new execution
                if event_data.get("type") == "execution_created" and execution_id:
                    redis_manager.add_pending_execution(session_id, execution_id)
                    # Confirm delivery for webhook to proceed
                    redis_manager.confirm_delivery(execution_id, session_id)
                    
                logger.debug("Notified session of execution", extra={
                    "session_id": session_id,
                    "user_id": event_user_id,
                    "execution_id": execution_id
                })
                
            except Exception as e:
                logger.error("Failed to notify session", extra={
                    "session_id": session_id,
                    "error": str(e)
                })
                disconnected_sessions.append(session_id)
                
        # Clean up disconnected sessions
        for session_id in disconnected_sessions:
            redis_manager.remove_session(session_id)
            if session_id in active_websockets:
                del active_websockets[session_id]
        
        if notified_count > 0:
            logger.debug("Execution event broadcast complete", extra={
                "execution_id": execution_id,
                "user_id": event_user_id,
                "sessions_notified": notified_count
            })
    
    except Exception as e:
        logger.error(f"Error handling pub/sub message: {str(e)}", extra={
            "error": str(e),
            "error_type": type(e).__name__,
            "event_data": event_data
        }, exc_info=True)


async def start_pubsub_listener():
    """Start the Redis pub/sub listener for this worker."""
    global _pubsub_task
    
    if _pubsub_task is not None:
        return  # Already started
    
    import os
    logger.info(f"[PID {os.getpid()}] Starting Redis pub/sub listener for execution events")
    redis_manager = get_redis_manager()
    
    async def run_subscriber():
        try:
            await redis_manager.subscribe_to_execution_events(handle_pubsub_message)
        except Exception as e:
            logger.error("Pub/sub listener crashed", extra={"error": str(e)}, exc_info=True)
    
    _pubsub_task = asyncio.create_task(run_subscriber())