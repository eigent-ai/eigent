"""Shared in-process activation gate for durable improve commands."""

from __future__ import annotations

import asyncio
import logging

from app.run_journal import get_default_run_journal
from app.service.task import ActionImproveData, TaskLock


async def activate_improve_admission(
    task_lock: TaskLock,
    item: ActionImproveData,
    *,
    project_id: str,
    logger: logging.Logger,
) -> bool:
    """Activate a pending Attempt once and discard duplicate queue envelopes."""

    if not item.request_id:
        return True
    if item.request_id in task_lock.processed_improve_request_ids:
        logger.info(
            "Skipping duplicate improve admission",
            extra={"project_id": project_id, "request_id": item.request_id},
        )
        return False
    if item.attempt_id and item.run_id:
        await asyncio.to_thread(
            get_default_run_journal().activate_run_attempt,
            item.attempt_id,
            expected_run_id=item.run_id,
        )
    task_lock.processed_improve_request_ids.add(item.request_id)
    return True
