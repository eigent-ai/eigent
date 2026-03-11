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
Webhook Controller

Handles incoming webhook triggers with modular app-specific processing.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select, and_, or_
from uuid import uuid4
from datetime import datetime, timezone
import json
import logging
from fastapi_limiter.depends import RateLimiter

from app.model.trigger.trigger import Trigger
from app.model.trigger.trigger_execution import TriggerExecution
from app.type.trigger_types import TriggerType, TriggerStatus, ExecutionType, ExecutionStatus
from app.component.database import session
from app.component.trigger_utils import check_rate_limits
from app.service.trigger.app_handler_service import get_app_handler

logger = logging.getLogger("server_webhook_controller")

router = APIRouter(prefix="/webhook", tags=["Webhook"])


# Trigger types that use webhooks
WEBHOOK_TRIGGER_TYPES = [TriggerType.webhook, TriggerType.slack_trigger]


@router.api_route("/trigger/{webhook_uuid}", methods=["GET", "POST"], name="webhook trigger", dependencies=[Depends(RateLimiter(times=10, seconds=60))])
async def webhook_trigger(
    webhook_uuid: str,
    request: Request,
    db_session: Session = Depends(session)
):
    """Handle incoming webhook triggers with app-specific processing."""
    try:
        # Get request body
        body = await request.body()
        try:
            input_data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            input_data = {"raw_body": body.decode()}
        
        headers = dict(request.headers)
        webhook_url = f"/webhook/trigger/{webhook_uuid}"
        
        # Find the trigger (allow active and pending_verification for verification flows)
        trigger = db_session.exec(
            select(Trigger).where(
                and_(
                    Trigger.webhook_url == webhook_url,
                    Trigger.trigger_type.in_(WEBHOOK_TRIGGER_TYPES),
                    Trigger.status.in_([TriggerStatus.active, TriggerStatus.pending_verification])
                )
            )
        ).first()
        
        if not trigger:
            logger.warning("Webhook trigger not found or inactive", extra={
                "webhook_uuid": webhook_uuid
            })
            raise HTTPException(status_code=404, detail="Webhook not found or inactive")
        
        # Get app handler based on trigger_type
        handler = get_app_handler(trigger.trigger_type)
        
        # App-specific authentication
        if handler:
            auth_result = await handler.authenticate(request, body, trigger, db_session)
            
            if not auth_result.success:
                raise HTTPException(status_code=401, detail=auth_result.reason or "Invalid signature")
            
            # Return challenge response for URL verification (e.g., Slack)
            # Don't update status yet - wait for actual events to confirm integration works
            if auth_result.data:
                logger.info("URL verification challenge received", extra={
                    "trigger_id": trigger.id,
                    "trigger_type": trigger.trigger_type.value,
                    "status": trigger.status.value
                })
                return auth_result.data
            
            # Update trigger status from pending_verification to active after receiving
            # a real event (not just URL verification) with valid signature
            if trigger.status == TriggerStatus.pending_verification:
                trigger.status = TriggerStatus.active
                db_session.add(trigger)
                db_session.commit()
                db_session.refresh(trigger)
                logger.info("Trigger status updated to active after receiving valid event", extra={
                    "trigger_id": trigger.id,
                    "trigger_type": trigger.trigger_type.value
                })
            
                # Notify Redis subscribers of successful activation
                try:
                    from app.component.redis_utils import get_redis_manager
                    redis_manager = get_redis_manager()
                    redis_manager.publish_execution_event({
                        "type": "trigger_activated",
                        "trigger_id": trigger.id,
                        "trigger_type": trigger.trigger_type.value,
                        "task_prompt": trigger.task_prompt,
                        "user_id": str(trigger.user_id),
                        "project_id": str(trigger.project_id),
                        "webhook_uuid": webhook_uuid
                    })
                except Exception as e:
                    logger.warning(f"Failed to publish activation event: {e}")
        
        # Default webhook: validate request method
        if trigger.trigger_type == TriggerType.webhook and trigger.webhook_method:
            expected_method = trigger.webhook_method.value if hasattr(trigger.webhook_method, 'value') else str(trigger.webhook_method)
            expected_method = expected_method.rstrip(',')
            if request.method.upper() != expected_method.upper():
                raise HTTPException(
                    status_code=405,
                    detail=f"Method not allowed. This webhook only accepts {expected_method} requests"
                )
        
        # Prepare request metadata for filtering and normalization
        safe_headers = {k: v for k, v in headers.items() if k.lower() not in ['authorization', 'cookie']}
        query_params = dict(request.query_params)
        body_raw = body.decode() if body else ""
        
        request_meta = {
            "headers": safe_headers,
            "query_params": query_params,
            "method": request.method,
            "url": str(request.url),
            "client_ip": request.client.host if request.client else None
        }
        
        # App-specific event filtering (pass headers and body for webhook config filtering)
        if handler:
            # For default webhook handler, pass additional context
            if trigger.trigger_type == TriggerType.webhook:
                filter_result = await handler.filter_event(
                    input_data, 
                    trigger,
                    headers=safe_headers,
                    body_raw=body_raw
                )
            else:
                filter_result = await handler.filter_event(input_data, trigger)
            
            if not filter_result.success:
                logger.debug("Event filtered", extra={
                    "trigger_id": trigger.id,
                    "reason": filter_result.reason
                })
                return {"status": "ignored", "reason": filter_result.reason}
        
        # Check rate limits
        current_time = datetime.now(timezone.utc)
        if trigger.max_executions_per_hour or trigger.max_executions_per_day:
            if not check_rate_limits(db_session, trigger):
                logger.warning("Webhook rate limit exceeded", extra={
                    "trigger_id": trigger.id
                })
                raise HTTPException(status_code=429, detail="Rate limit exceeded")
        
        # Check single execution
        if trigger.is_single_execution:
            from sqlmodel import func
            execution_count = db_session.exec(
                select(func.count(TriggerExecution.id)).where(
                    TriggerExecution.trigger_id == trigger.id
                )
            ).first()
            if execution_count > 0:
                raise HTTPException(status_code=409, detail="Single execution trigger already executed")
        
        # Normalize input data (pass request_meta for full webhook input)
        if handler:
            execution_input = handler.normalize_payload(input_data, trigger, request_meta=request_meta)
        else:
            execution_input = {
                "headers": safe_headers,
                "query_params": query_params,
                "body": input_data,
                "method": request.method,
                "url": str(request.url),
                "client_ip": request.client.host if request.client else None
            }
        
        # Determine execution type
        execution_type = handler.execution_type if handler else ExecutionType.webhook
        
        # Create execution record
        execution_id = str(uuid4())
        execution = TriggerExecution(
            trigger_id=trigger.id,
            execution_id=execution_id,
            execution_type=execution_type,
            status=ExecutionStatus.pending,
            input_data=execution_input,
            started_at=current_time
        )
        
        db_session.add(execution)
        
        # Update trigger
        trigger.last_executed_at = current_time
        trigger.last_execution_status = "pending"
        db_session.add(trigger)
        db_session.commit()
        db_session.refresh(execution)
        
        logger.info("Webhook trigger executed", extra={
            "trigger_id": trigger.id,
            "execution_id": execution_id,
            "trigger_type": trigger.trigger_type.value,
            "user_id": trigger.user_id
        })
        
        # Notify WebSocket subscribers and wait for delivery confirmation
        try:
            from app.component.redis_utils import get_redis_manager
            redis_manager = get_redis_manager()
            
            # Check if user has any active WebSocket sessions
            has_active_sessions = redis_manager.has_active_sessions_for_user(str(trigger.user_id))
            
            redis_manager.publish_execution_event({
                "type": "execution_created",
                "execution_id": execution_id,
                "trigger_id": trigger.id,
                "trigger_type": trigger.trigger_type.value,
                "task_prompt": trigger.task_prompt,
                "status": "pending",
                "input_data": execution_input,
                "user_id": str(trigger.user_id),
                "project_id": str(trigger.project_id)
            })
            
            if has_active_sessions:
                # Wait for delivery confirmation (10 second timeout)
                delivery_confirmation = await redis_manager.wait_for_delivery(
                    execution_id, 
                    timeout=10.0
                )
                
                if delivery_confirmation:
                    logger.info("Webhook delivery confirmed", extra={
                        "execution_id": execution_id,
                        "session_id": delivery_confirmation.get("session_id")
                    })
                    return {
                        "success": True,
                        "execution_id": execution_id,
                        "message": "Webhook trigger delivered to client",
                        "delivered": True,
                        "session_id": delivery_confirmation.get("session_id")
                    }
                else:
                    logger.warning("Webhook delivery confirmation timed out", extra={
                        "execution_id": execution_id,
                        "trigger_id": trigger.id
                    })
                    return {
                        "success": True,
                        "execution_id": execution_id,
                        "message": "Webhook trigger processed but delivery not confirmed",
                        "delivered": False,
                        "reason": "timeout"
                    }
            else:
                # No active sessions, execution is queued
                logger.info("No active WebSocket sessions for user", extra={
                    "execution_id": execution_id,
                    "user_id": trigger.user_id
                })
                return {
                    "success": True,
                    "execution_id": execution_id,
                    "message": "Webhook trigger processed, no active client connected",
                    "delivered": False,
                    "reason": "no_active_sessions"
                }
        except Exception as e:
            logger.warning(f"Failed to publish/confirm WebSocket event: {e}")
            return {
                "success": True,
                "execution_id": execution_id,
                "message": "Webhook trigger processed but WebSocket notification failed",
                "delivered": False,
                "reason": "websocket_notification_error"
            }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Webhook trigger processing failed", extra={
            "webhook_uuid": webhook_uuid,
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/trigger/{webhook_uuid}/info", name="webhook info")
def get_webhook_info(
    webhook_uuid: str,
    db_session: Session = Depends(session)
):
    """Get information about a webhook trigger (public endpoint)."""
    webhook_url = f"/webhook/trigger/{webhook_uuid}"
    
    trigger = db_session.exec(
        select(Trigger).where(
            and_(
                Trigger.webhook_url == webhook_url,
                Trigger.trigger_type.in_(WEBHOOK_TRIGGER_TYPES)
            )
        )
    ).first()
    
    if not trigger:
        raise HTTPException(status_code=404, detail="Webhook not found")
    
    return {
        "name": trigger.name,
        "description": trigger.description,
        "status": trigger.status.value,
        "trigger_type": trigger.trigger_type.value,
        "is_active": trigger.status == TriggerStatus.active,
        "webhook_method": trigger.webhook_method.value if trigger.webhook_method else None,
        "last_executed_at": trigger.last_executed_at.isoformat() if trigger.last_executed_at else None,
    }


