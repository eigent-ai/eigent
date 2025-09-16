from typing import Literal
from dotenv import load_dotenv
from fastapi import APIRouter, Response
from loguru import logger
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


router = APIRouter(tags=["task"])


@router.post("/task/{id}/start", name="start task")
def start(id: str):
    task_lock = get_task_lock(id)
    logger.debug(f"start task {id}")
    asyncio.run(task_lock.put_queue(ActionStartData(action=Action.start)))
    logger.debug(f"start task {id} success")
    return Response(status_code=201)


@router.put("/task/{id}", name="update task")
def put(id: str, data: UpdateData):
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_queue(ActionUpdateTaskData(action=Action.update_task, data=data)))
    return Response(status_code=201)


class TakeControl(BaseModel):
    action: Literal[Action.pause, Action.resume]


@router.put("/task/{id}/take-control", name="take control pause or resume")
def take_control(id: str, data: TakeControl):
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_queue(ActionTakeControl(action=data.action)))
    return Response(status_code=204)


@router.post("/task/{id}/add-agent", name="add new agent")
def add_agent(id: str, data: NewAgent):
    # Set user-specific environment path for this thread
    set_user_env_path(data.env_path)
    load_dotenv(dotenv_path=data.env_path)
    asyncio.run(get_task_lock(id).put_queue(ActionNewAgent(**data.model_dump())))
    return Response(status_code=204)


@router.delete("/task/stop-all", name="stop all tasks")
def stop_all():
    for task_lock in task_locks.values():
        asyncio.run(task_lock.put_queue(ActionStopData()))
    return Response(status_code=204)
