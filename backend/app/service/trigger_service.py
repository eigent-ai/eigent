import asyncio
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable, Any
from camel.triggers.trigger_manager import TriggerManager
from camel.triggers import WebhookTrigger, TriggerEvent, TriggerType
from camel.triggers.schedule_trigger import ScheduleTrigger
from camel.societies.workforce import Workforce
from camel.tasks.task import Task
from utils import traceroot_wrapper as traceroot
from app.service.chat_service import construct_workforce
from app.model.chat import Chat
from app.service.task import (
    get_or_create_task_lock,
    ActionStartData,
    Action
)
import uuid

logger = traceroot.get_logger("trigger_service")

# Global trigger manager instance
global_trigger_manager: Optional[TriggerManager] = None
active_workforces: Dict[str, Workforce] = {}
registered_triggers: Dict[str, Dict] = {}

class TriggerWorkforceIntegration:
    """Integration layer between triggers and Camel workforce."""
    
    def __init__(self):
        self.trigger_manager = None
        self.active_triggers = {}
        
    async def initialize_trigger_manager(self):
        """Initialize the global trigger manager."""
        if self.trigger_manager is None:
            self.trigger_manager = TriggerManager()
            logger.info("Trigger manager initialized successfully")
        return self.trigger_manager
    
    async def create_webhook_trigger(
        self, 
        trigger_id: str,
        name: str,
        description: str,
        port: int,
        path: str,
        host: str = "localhost",
        workforce_config: Optional[Dict] = None
    ) -> WebhookTrigger:
        """Create and register a webhook trigger connected to workforce."""
        
        webhook = WebhookTrigger(
            trigger_id=trigger_id,
            name=name,
            description=description,
            port=port,
            path=path,
            host=host,
        )
        
        # Create the handler that integrates with workforce
        async def webhook_handler(event: TriggerEvent):
            await self._handle_trigger_event(event, workforce_config, "webhook")
        
        webhook.add_callback(webhook_handler)
        
        if self.trigger_manager:
            await self.trigger_manager.register_trigger(webhook)
            self.active_triggers[trigger_id] = {
                "trigger": webhook,
                "type": "webhook",
                "config": workforce_config
            }
            
            # Store in global registry
            registered_triggers[trigger_id] = {
                "id": trigger_id,
                "name": name,
                "description": description,
                "type": "webhook",
                "port": port,
                "path": path,
                "host": host,
                "workforce_config": workforce_config,
                "created_at": datetime.now().isoformat(),
                "status": "active"
            }
            
            logger.info(f"Webhook trigger '{name}' registered successfully at http://{host}:{port}{path}")
        
        return webhook
    
    async def create_schedule_trigger(
        self,
        trigger_id: str,
        name: str, 
        description: str,
        schedule_expression: str,
        workforce_config: Optional[Dict] = None,
        task_content: Optional[str] = None
    ) -> ScheduleTrigger:
        """Create and register a schedule trigger connected to workforce."""
        
        schedule = ScheduleTrigger(
            trigger_id=trigger_id,
            name=name,
            description=description,
            schedule=schedule_expression
        )
        
        # Create the handler that integrates with workforce
        async def schedule_handler(event: TriggerEvent):
            # For scheduled tasks, we can include the task content in the event
            if task_content:
                event.payload["scheduled_task"] = task_content
            await self._handle_trigger_event(event, workforce_config, "schedule")
        
        schedule.add_callback(schedule_handler)
        
        if self.trigger_manager:
            await self.trigger_manager.register_trigger(schedule)
            self.active_triggers[trigger_id] = {
                "trigger": schedule,
                "type": "schedule",
                "config": workforce_config
            }
            
            # Store in global registry
            registered_triggers[trigger_id] = {
                "id": trigger_id,
                "name": name,
                "description": description,
                "type": "schedule",
                "schedule": schedule_expression,
                "workforce_config": workforce_config,
                "task_content": task_content,
                "created_at": datetime.now().isoformat(),
                "status": "active"
            }
            
            logger.info(f"Schedule trigger '{name}' registered successfully with schedule: {schedule_expression}")
        
        return schedule
    
    async def _handle_trigger_event(self, event: TriggerEvent, workforce_config: Optional[Dict], trigger_type: str):
        """Handle trigger events by creating and executing workforce tasks."""
        try:
            logger.info(f"Processing {trigger_type} trigger event: {event.trigger_id}")
            logger.debug(f"Event payload: {event.payload}")
            
            # Extract task content from the event
            task_content = None
            if "task" in event.payload:
                if isinstance(event.payload["task"], str):
                    task_content = event.payload["task"]
                elif isinstance(event.payload["task"], dict):
                    task_content = json.dumps(event.payload["task"])
            elif "scheduled_task" in event.payload:
                task_content = event.payload["scheduled_task"]
            elif "message" in event.payload:
                task_content = event.payload["message"]
            else:
                # Create a default task based on the trigger type and payload
                if trigger_type == "webhook":
                    task_content = f"Process webhook data: {json.dumps(event.payload)}"
                else:
                    task_content = f"Execute scheduled task: {json.dumps(event.payload)}"
            
            if not task_content:
                logger.warning(f"No task content found in {trigger_type} trigger event")
                return
            
            # Generate a unique project ID for this trigger execution
            project_id = f"trigger_{event.trigger_id}_{uuid.uuid4().hex[:8]}"
            
            # Create a Chat configuration for the workforce
            # Use default values or from workforce_config if provided
            chat_config = Chat(
                project_id=project_id,
                task_id=f"task_{uuid.uuid4().hex[:8]}",
                question=task_content,
                model_platform=workforce_config.get("model_platform", "openai") if workforce_config else "openai",
                model_type=workforce_config.get("model_type", "gpt-4") if workforce_config else "gpt-4",
                api_key=workforce_config.get("api_key", "") if workforce_config else "",
                api_host=workforce_config.get("api_host", "") if workforce_config else "",
                new_agents=workforce_config.get("new_agents", []) if workforce_config else [],
                attaches=workforce_config.get("attaches", []) if workforce_config else [],
                mcp_servers=workforce_config.get("mcp_servers", []) if workforce_config else []
            )
            
            # Create and start the workforce
            logger.info(f"Creating workforce for {trigger_type} trigger: {event.trigger_id}")
            workforce, _ = await construct_workforce(chat_config)
            
            # Store the workforce for potential future reference
            active_workforces[project_id] = workforce
            
            # Create the main task
            camel_task = Task(content=task_content, id=chat_config.task_id)
            
            # Decompose the task and start execution
            logger.info(f"Starting task decomposition and execution for {trigger_type} trigger")
            subtasks = workforce.eigent_make_sub_tasks(camel_task)
            
            # Start the workforce execution in the background
            asyncio.create_task(self._execute_workforce_task(workforce, subtasks, project_id, event.trigger_id))
            
            logger.info(f"Successfully initiated workforce execution for {trigger_type} trigger: {event.trigger_id}")
            
        except Exception as e:
            logger.error(f"Error handling {trigger_type} trigger event: {str(e)}", exc_info=True)
    
    async def _execute_workforce_task(self, workforce: Workforce, subtasks: List[Task], project_id: str, trigger_id: str):
        """Execute the workforce task in the background."""
        try:
            logger.info(f"Starting workforce execution for project: {project_id}, trigger: {trigger_id}")
            await workforce.eigent_start(subtasks)
            logger.info(f"Workforce execution completed for project: {project_id}, trigger: {trigger_id}")
        except Exception as e:
            logger.error(f"Error during workforce execution for project {project_id}: {str(e)}", exc_info=True)
        finally:
            # Cleanup
            if project_id in active_workforces:
                try:
                    await active_workforces[project_id].cleanup()
                    del active_workforces[project_id]
                    logger.info(f"Cleaned up workforce for project: {project_id}")
                except Exception as cleanup_error:
                    logger.error(f"Error during workforce cleanup: {str(cleanup_error)}")
    
    async def remove_trigger(self, trigger_id: str) -> bool:
        """Remove and deactivate a trigger."""
        if trigger_id in self.active_triggers:
            try:
                if self.trigger_manager:
                    await self.trigger_manager.deactivate_trigger(trigger_id)
                del self.active_triggers[trigger_id]
                
                if trigger_id in registered_triggers:
                    registered_triggers[trigger_id]["status"] = "removed"
                    
                logger.info(f"Trigger {trigger_id} removed successfully")
                return True
            except Exception as e:
                logger.error(f"Error removing trigger {trigger_id}: {str(e)}")
                return False
        return False
    
    async def list_triggers(self) -> List[Dict]:
        """List all registered triggers."""
        return list(registered_triggers.values())
    
    async def get_trigger(self, trigger_id: str) -> Optional[Dict]:
        """Get details of a specific trigger."""
        return registered_triggers.get(trigger_id)
    
    async def shutdown(self):
        """Shutdown the trigger manager and cleanup resources."""
        if self.trigger_manager:
            await self.trigger_manager.deactivate_all_triggers()
            
        # Cleanup active workforces
        for project_id, workforce in active_workforces.items():
            try:
                await workforce.cleanup()
            except Exception as e:
                logger.error(f"Error cleaning up workforce {project_id}: {str(e)}")
        
        active_workforces.clear()
        self.active_triggers.clear()
        logger.info("Trigger service shutdown completed")

# Global instance
trigger_integration = TriggerWorkforceIntegration()

def get_trigger_integration() -> TriggerWorkforceIntegration:
    """Get the global trigger integration instance."""
    return trigger_integration

async def initialize_trigger_service():
    """Initialize the trigger service."""
    global global_trigger_manager
    try:
        global_trigger_manager = await trigger_integration.initialize_trigger_manager()
        logger.info("Trigger service initialized successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to initialize trigger service: {str(e)}")
        return False

async def create_example_webhook_trigger():
    """Create an example webhook trigger for demonstration."""
    workforce_config = {
        "model_platform": "openai",
        "model_type": "gpt-4",
        "new_agents": [],
        "attaches": [],
        "mcp_servers": []
    }
    
    webhook = await trigger_integration.create_webhook_trigger(
        trigger_id="example_webhook",
        name="Example Webhook Trigger",
        description="Processes incoming webhook requests and creates workforce tasks",
        port=8080,
        path="/webhook",
        host="localhost",
        workforce_config=workforce_config
    )
    
    logger.info("Example webhook trigger created at http://localhost:8080/webhook")    
    return webhook

async def create_example_schedule_trigger():
    """Create an example schedule trigger for demonstration."""
    workforce_config = {
        "model_platform": "openai", 
        "model_type": "gpt-4",
        "new_agents": [],
        "attaches": [],
        "mcp_servers": []
    }
    
    # Schedule to run every 5 minutes
    schedule = await trigger_integration.create_schedule_trigger(
        trigger_id="example_schedule",
        name="Example Schedule Trigger",
        description="Runs a scheduled task every 5 minutes",
        schedule_expression="*/5 * * * *",  # Cron expression for every 5 minutes
        workforce_config=workforce_config,
        task_content="Perform scheduled system health check and generate report"
    )
    
    logger.info("Example schedule trigger created to run every 5 minutes")
    
    return schedule

async def shutdown_trigger_service():
    """Shutdown the trigger service."""
    await trigger_integration.shutdown()
    logger.info("Trigger service shutdown completed")