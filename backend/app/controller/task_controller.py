from typing import Literal
from dotenv import load_dotenv
from fastapi import APIRouter, Response
from pydantic import BaseModel
from app.model.chat import NewAgent, UpdateData
from app.service.task import (
    Action,
    ActionNewAgent,
    ActionStopData,
    ActionTakeControl,
    ActionStartData,
    ActionUpdateTaskData,
    get_task_lock,
    task_locks,
)
import asyncio
from app.component.environment import set_user_env_path
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("task_controller")


router = APIRouter()


@router.post("/task/{id}/start", name="start task")
@traceroot.trace()
def start(id: str):
    task_lock = get_task_lock(id)
    logger.info("Starting task", extra={"task_id": id})
    asyncio.run(task_lock.put_queue(ActionStartData(action=Action.start)))
    logger.info("Task started successfully", extra={"task_id": id})
    return Response(status_code=201)


@router.put("/task/{id}", name="update task")
@traceroot.trace()
def put(id: str, data: UpdateData):
    logger.info("Updating task", extra={"task_id": id, "task_items_count": len(data.task)})
    logger.debug("Update task data", extra={"task_id": id, "data": data.model_dump_json()})
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_queue(ActionUpdateTaskData(action=Action.update_task, data=data)))
    logger.info("Task updated successfully", extra={"task_id": id})
    return Response(status_code=201)


class TakeControl(BaseModel):
    action: Literal[Action.pause, Action.resume]


@router.put("/task/{id}/take-control", name="take control pause or resume")
@traceroot.trace()
def take_control(id: str, data: TakeControl):
    logger.info("Task control action", extra={"task_id": id, "action": data.action})
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_queue(ActionTakeControl(action=data.action)))
    logger.info("Task control action completed", extra={"task_id": id, "action": data.action})
    return Response(status_code=204)


@router.post("/task/{id}/add-agent", name="add new agent")
@traceroot.trace()
def add_agent(id: str, data: NewAgent):
    logger.info("Adding new agent to task", extra={"task_id": id, "agent_name": data.name})
    logger.debug("New agent data", extra={"task_id": id, "agent_data": data.model_dump_json()})
    # Set user-specific environment path for this thread
    set_user_env_path(data.env_path)
    load_dotenv(dotenv_path=data.env_path)
    asyncio.run(get_task_lock(id).put_queue(ActionNewAgent(**data.model_dump())))
    logger.info("Agent added to task", extra={"task_id": id, "agent_name": data.name})
    return Response(status_code=204)


@router.delete("/task/stop-all", name="stop all tasks")
@traceroot.trace()
def stop_all():
    logger.warning("Stopping all tasks", extra={"task_count": len(task_locks)})
    for task_lock in task_locks.values():
        asyncio.run(task_lock.put_queue(ActionStopData()))
    logger.info("All tasks stopped", extra={"task_count": len(task_locks)})
    return Response(status_code=204)
