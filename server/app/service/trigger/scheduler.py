import asyncio
from datetime import datetime, timedelta
from typing import Optional
from contextlib import asynccontextmanager

from app.service.trigger.trigger_service import trigger_service
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("trigger_scheduler")


class TriggerScheduler:
    """Background scheduler for executing scheduled triggers."""
    
    def __init__(self, check_interval: int = 60):
        self.check_interval = check_interval  # seconds
        self.running = False
        self.task: Optional[asyncio.Task] = None
    
    async def start(self):
        """Start the scheduler."""
        if self.running:
            logger.warning("Scheduler is already running")
            return
        
        self.running = True
        self.task = asyncio.create_task(self._scheduler_loop())
        
        logger.info("Trigger scheduler started", extra={
            "check_interval": self.check_interval
        })
    
    async def stop(self):
        """Stop the scheduler."""
        if not self.running:
            return
        
        self.running = False
        
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        
        logger.info("Trigger scheduler stopped")
    
    async def _scheduler_loop(self):
        """Main scheduler loop."""
        logger.info("Scheduler loop started")
        
        while self.running:
            try:
                # Execute due scheduled triggers
                executed_count = await asyncio.get_event_loop().run_in_executor(
                    None, trigger_service.execute_scheduled_triggers
                )
                
                if executed_count > 0:
                    logger.info("Scheduled triggers executed", extra={
                        "count": executed_count
                    })
                
                # Process pending executions (if you have a task processor)
                # This is where you'd integrate with your task execution system
                
                # Sleep until next check
                await asyncio.sleep(self.check_interval)
                
            except asyncio.CancelledError:
                logger.info("Scheduler loop cancelled")
                break
            except Exception as e:
                logger.error("Error in scheduler loop", extra={
                    "error": str(e)
                }, exc_info=True)
                
                # Sleep before retrying
                await asyncio.sleep(min(self.check_interval, 30))
    
    async def run_cleanup(self, days_to_keep: int = 30):
        """Run cleanup of old execution records."""
        try:
            count = await asyncio.get_event_loop().run_in_executor(
                None, trigger_service.cleanup_old_executions, days_to_keep
            )
            
            logger.info("Cleanup completed", extra={
                "executions_removed": count,
                "days_to_keep": days_to_keep
            })
            
            return count
            
        except Exception as e:
            logger.error("Cleanup failed", extra={
                "error": str(e)
            }, exc_info=True)
            return 0


# Global scheduler instance
scheduler = TriggerScheduler()


@asynccontextmanager
async def lifespan_scheduler():
    """Context manager for scheduler lifecycle."""
    await scheduler.start()
    try:
        yield
    finally:
        await scheduler.stop()


async def start_scheduler():
    """Start the trigger scheduler."""
    await scheduler.start()


async def stop_scheduler():
    """Stop the trigger scheduler."""
    await scheduler.stop()


async def cleanup_old_executions(days_to_keep: int = 30):
    """Clean up old execution records."""
    return await scheduler.run_cleanup(days_to_keep)