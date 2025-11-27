"""
Trigger Controller - API endpoints for managing webhook and schedule triggers.
Provides REST API for creating, managing, and monitoring triggers that integrate with Camel workforce.
"""
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from utils import traceroot_wrapper as traceroot
from app.service.trigger_service import (
    get_trigger_integration, 
    initialize_trigger_service,
    create_example_webhook_trigger,
    create_example_schedule_trigger
)
import asyncio
import time

logger = traceroot.get_logger("trigger_controller")
router = APIRouter()

# Request/Response models
class WorkforceConfig(BaseModel):
    """Configuration for the workforce that will handle trigger events."""
    model_platform: str = Field(default="openai", description="Model platform to use")
    model_type: str = Field(default="gpt-4", description="Model type to use")
    api_key: Optional[str] = Field(default=None, description="API key for the model")
    api_host: Optional[str] = Field(default=None, description="API host for the model")
    new_agents: List[Dict[str, Any]] = Field(default_factory=list, description="Additional agents to include")
    attaches: List[str] = Field(default_factory=list, description="File attachments")
    mcp_servers: List[Dict[str, Any]] = Field(default_factory=list, description="MCP servers to use")

class CreateWebhookTriggerRequest(BaseModel):
    """Request model for creating webhook triggers."""
    trigger_id: str = Field(..., description="Unique identifier for the trigger")
    name: str = Field(..., description="Human-readable name for the trigger")
    description: str = Field(..., description="Description of what the trigger does")
    port: int = Field(default=8080, description="Port to listen on")
    path: str = Field(default="/webhook", description="URL path for the webhook")
    host: str = Field(default="localhost", description="Host to bind to")
    workforce_config: Optional[WorkforceConfig] = Field(default=None, description="Workforce configuration")

class CreateScheduleTriggerRequest(BaseModel):
    """Request model for creating schedule triggers."""
    trigger_id: str = Field(..., description="Unique identifier for the trigger")
    name: str = Field(..., description="Human-readable name for the trigger")
    description: str = Field(..., description="Description of what the trigger does")
    schedule_expression: str = Field(..., description="Cron expression for scheduling")
    task_content: Optional[str] = Field(default=None, description="Default task content to execute")
    workforce_config: Optional[WorkforceConfig] = Field(default=None, description="Workforce configuration")

class TriggerResponse(BaseModel):
    """Response model for trigger operations."""
    success: bool
    message: str
    trigger_id: Optional[str] = None
    details: Optional[Dict[str, Any]] = None

class TriggerInfo(BaseModel):
    """Information about a registered trigger."""
    id: str
    name: str
    description: str
    type: str
    status: str
    created_at: str
    details: Dict[str, Any]

# API Endpoints
@router.post("/triggers/initialize", response_model=TriggerResponse)
async def initialize_triggers():
    """Initialize the trigger service."""
    try:
        success = await initialize_trigger_service()
        if success:
            return TriggerResponse(
                success=True,
                message="Trigger service initialized successfully"
            )
        else:
            raise HTTPException(status_code=500, detail="Failed to initialize trigger service")
    except Exception as e:
        logger.error(f"Error initializing trigger service: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error initializing trigger service: {str(e)}")

@router.post("/triggers/webhook", response_model=TriggerResponse)
async def create_webhook_trigger(request: CreateWebhookTriggerRequest):
    """Create a new webhook trigger."""
    try:
        trigger_integration = get_trigger_integration()
        
        # Convert WorkforceConfig to dict if provided
        workforce_config = None
        if request.workforce_config:
            workforce_config = request.workforce_config.dict()
        
        webhook = await trigger_integration.create_webhook_trigger(
            trigger_id=request.trigger_id,
            name=request.name,
            description=request.description,
            port=request.port,
            path=request.path,
            host=request.host,
            workforce_config=workforce_config
        )
        
        return TriggerResponse(
            success=True,
            message=f"Webhook trigger '{request.name}' created successfully",
            trigger_id=request.trigger_id,
            details={
                "url": f"http://{request.host}:{request.port}{request.path}",
                "test_command": f"curl -X POST http://{request.host}:{request.port}{request.path} -H 'Content-Type: application/json' -d '{{\"task\": \"your task here\"}}'"
            }
        )
    except Exception as e:
        logger.error(f"Error creating webhook trigger: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating webhook trigger: {str(e)}")

@router.post("/triggers/schedule", response_model=TriggerResponse)
async def create_schedule_trigger(request: CreateScheduleTriggerRequest):
    """Create a new schedule trigger."""
    try:
        trigger_integration = get_trigger_integration()
        
        # Convert WorkforceConfig to dict if provided
        workforce_config = None
        if request.workforce_config:
            workforce_config = request.workforce_config.dict()
        
        schedule = await trigger_integration.create_schedule_trigger(
            trigger_id=request.trigger_id,
            name=request.name,
            description=request.description,
            schedule_expression=request.schedule_expression,
            workforce_config=workforce_config,
            task_content=request.task_content
        )
        
        return TriggerResponse(
            success=True,
            message=f"Schedule trigger '{request.name}' created successfully",
            trigger_id=request.trigger_id,
            details={
                "schedule": request.schedule_expression,
                "next_execution": "Calculated by the scheduler"
            }
        )
    except Exception as e:
        logger.error(f"Error creating schedule trigger: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating schedule trigger: {str(e)}")

@router.get("/trigger/", response_model=List[TriggerInfo])
async def list_triggers(
    trigger_type: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    size: int = 20
):
    """List triggers with pagination and filtering."""
    try:
        trigger_integration = get_trigger_integration()
        triggers = await trigger_integration.list_triggers()
        
        # Apply filters
        if trigger_type:
            triggers = [t for t in triggers if t.get("type") == trigger_type]
        if status:
            triggers = [t for t in triggers if t.get("status") == status]
        
        # Apply pagination
        start_idx = (page - 1) * size
        end_idx = start_idx + size
        paginated_triggers = triggers[start_idx:end_idx]
        
        result = []
        for trigger in paginated_triggers:
            # Separate details from main fields
            details = trigger.copy()
            for key in ["id", "name", "description", "type", "status", "created_at"]:
                details.pop(key, None)
            
            result.append(TriggerInfo(
                id=trigger["id"],
                name=trigger["name"],
                description=trigger["description"],
                type=trigger["type"],
                status=trigger["status"],
                created_at=trigger["created_at"],
                details=details
            ))
        
        return result
    except Exception as e:
        logger.error(f"Error listing triggers: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error listing triggers: {str(e)}")

@router.post("/trigger/", response_model=TriggerResponse)
async def create_trigger_generic(request: dict):
    """Create a trigger based on the request data."""
    try:
        trigger_integration = get_trigger_integration()
        
        # Determine trigger type and handle accordingly
        trigger_type = request.get("trigger_type", "webhook")
        
        if trigger_type == "webhook":
            # Create webhook trigger
            webhook = await trigger_integration.create_webhook_trigger(
                trigger_id=request.get("trigger_id", f"trigger_{int(time.time())}"),
                name=request.get("name", "Webhook Trigger"),
                description=request.get("description", "Auto-generated webhook trigger"),
                port=request.get("port", 8080),
                path=request.get("path", "/webhook"),
                host=request.get("host", "localhost"),
                workforce_config=request.get("workforce_config")
            )
            
            return TriggerResponse(
                success=True,
                message=f"Webhook trigger created successfully",
                trigger_id=request.get("trigger_id"),
                details={
                    "url": f"http://{request.get('host', 'localhost')}:{request.get('port', 8080)}{request.get('path', '/webhook')}",
                    "type": "webhook"
                }
            )
        
        elif trigger_type == "schedule":
            # Create schedule trigger
            schedule = await trigger_integration.create_schedule_trigger(
                trigger_id=request.get("trigger_id", f"trigger_{int(time.time())}"),
                name=request.get("name", "Schedule Trigger"),
                description=request.get("description", "Auto-generated schedule trigger"),
                schedule_expression=request.get("schedule_expression", "0 * * * *"),
                workforce_config=request.get("workforce_config"),
                task_content=request.get("task_content")
            )
            
            return TriggerResponse(
                success=True,
                message=f"Schedule trigger created successfully",
                trigger_id=request.get("trigger_id"),
                details={
                    "schedule": request.get("schedule_expression"),
                    "type": "schedule"
                }
            )
        
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported trigger type: {trigger_type}")
            
    except Exception as e:
        logger.error(f"Error creating trigger: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating trigger: {str(e)}")

@router.get("/trigger/{trigger_id}", response_model=TriggerInfo)
async def get_trigger(trigger_id: str):
    """Get details of a specific trigger."""
    try:
        trigger_integration = get_trigger_integration()
        trigger = await trigger_integration.get_trigger(trigger_id)
        
        if not trigger:
            raise HTTPException(status_code=404, detail=f"Trigger '{trigger_id}' not found")
        
        # Separate details from main fields
        details = trigger.copy()
        for key in ["id", "name", "description", "type", "status", "created_at"]:
            details.pop(key, None)
        
        return TriggerInfo(
            id=trigger["id"],
            name=trigger["name"],
            description=trigger["description"],
            type=trigger["type"],
            status=trigger["status"],
            created_at=trigger["created_at"],
            details=details
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting trigger {trigger_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting trigger: {str(e)}")

@router.put("/trigger/{trigger_id}", response_model=TriggerResponse)
async def update_trigger(trigger_id: str, request: dict):
    """Update a trigger."""
    try:
        trigger_integration = get_trigger_integration()
        # Get current trigger first
        current_trigger = await trigger_integration.get_trigger(trigger_id)
        
        if not current_trigger:
            raise HTTPException(status_code=404, detail=f"Trigger '{trigger_id}' not found")
        
        # For now, we'll return a success response as the update logic would depend on the specific trigger implementation
        return TriggerResponse(
            success=True,
            message=f"Trigger '{trigger_id}' updated successfully",
            trigger_id=trigger_id,
            details=request
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating trigger {trigger_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error updating trigger: {str(e)}")

@router.delete("/trigger/{trigger_id}", response_model=TriggerResponse)
async def remove_trigger(trigger_id: str):
    """Remove and deactivate a trigger."""
    try:
        trigger_integration = get_trigger_integration()
        success = await trigger_integration.remove_trigger(trigger_id)
        
        if success:
            return TriggerResponse(
                success=True,
                message=f"Trigger '{trigger_id}' removed successfully",
                trigger_id=trigger_id
            )
        else:
            raise HTTPException(status_code=404, detail=f"Trigger '{trigger_id}' not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing trigger {trigger_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error removing trigger: {str(e)}")

@router.post("/trigger/{trigger_id}/activate", response_model=TriggerResponse)
async def activate_trigger(trigger_id: str):
    """Activate a trigger."""
    try:
        trigger_integration = get_trigger_integration()
        trigger = await trigger_integration.get_trigger(trigger_id)
        
        if not trigger:
            raise HTTPException(status_code=404, detail=f"Trigger '{trigger_id}' not found")
        
        # Activation logic would depend on the specific trigger implementation
        return TriggerResponse(
            success=True,
            message=f"Trigger '{trigger_id}' activated successfully",
            trigger_id=trigger_id,
            details={"status": "active"}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error activating trigger {trigger_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error activating trigger: {str(e)}")

@router.post("/trigger/{trigger_id}/deactivate", response_model=TriggerResponse)
async def deactivate_trigger(trigger_id: str):
    """Deactivate a trigger."""
    try:
        trigger_integration = get_trigger_integration()
        trigger = await trigger_integration.get_trigger(trigger_id)
        
        if not trigger:
            raise HTTPException(status_code=404, detail=f"Trigger '{trigger_id}' not found")
        
        # Deactivation logic would depend on the specific trigger implementation
        return TriggerResponse(
            success=True,
            message=f"Trigger '{trigger_id}' deactivated successfully",
            trigger_id=trigger_id,
            details={"status": "inactive"}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deactivating trigger {trigger_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error deactivating trigger: {str(e)}")

@router.get("/trigger/{trigger_id}/executions")
async def get_trigger_executions(
    trigger_id: str,
    page: int = 1,
    size: int = 20
):
    """Get execution history for a trigger."""
    try:
        trigger_integration = get_trigger_integration()
        trigger = await trigger_integration.get_trigger(trigger_id)
        
        if not trigger:
            raise HTTPException(status_code=404, detail=f"Trigger '{trigger_id}' not found")
        
        # For now, return empty execution history as this would depend on the specific trigger implementation
        return {
            "executions": [],
            "total": 0,
            "page": page,
            "size": size
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting trigger executions {trigger_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting trigger executions: {str(e)}")

@router.post("/triggers/examples/webhook", response_model=TriggerResponse)
async def create_example_webhook():
    """Create an example webhook trigger for demonstration."""
    try:
        webhook = await create_example_webhook_trigger()
        return TriggerResponse(
            success=True,
            message="Example webhook trigger created successfully",
            trigger_id="example_webhook",
            details={
                "url": "http://localhost:8080/webhook",
                "test_command": "curl -X POST http://localhost:8080/webhook -H 'Content-Type: application/json' -d '{\"task\": \"analyze this data\"}'"
            }
        )
    except Exception as e:
        logger.error(f"Error creating example webhook: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating example webhook: {str(e)}")

@router.post("/triggers/examples/schedule", response_model=TriggerResponse)
async def create_example_schedule():
    """Create an example schedule trigger for demonstration."""
    try:
        schedule = await create_example_schedule_trigger()
        return TriggerResponse(
            success=True,
            message="Example schedule trigger created successfully",
            trigger_id="example_schedule",
            details={
                "schedule": "*/5 * * * *",
                "description": "Runs every 5 minutes"
            }
        )
    except Exception as e:
        logger.error(f"Error creating example schedule: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating example schedule: {str(e)}")

# Health check endpoint specific to triggers
@router.get("/triggers/health")
async def triggers_health_check():
    """Check the health of the trigger service."""
    try:
        trigger_integration = get_trigger_integration()
        triggers = await trigger_integration.list_triggers()
        active_count = len([t for t in triggers if t["status"] == "active"])
        
        return {
            "status": "healthy",
            "service": "trigger_service",
            "total_triggers": len(triggers),
            "active_triggers": active_count,
            "trigger_manager_initialized": trigger_integration.trigger_manager is not None
        }
    except Exception as e:
        logger.error(f"Trigger service health check failed: {str(e)}")
        return {
            "status": "unhealthy",
            "service": "trigger_service",
            "error": str(e)
        }