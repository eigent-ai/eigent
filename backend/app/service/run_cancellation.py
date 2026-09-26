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

"""Durable terminal transition for compatibility-generator Stop actions."""

from __future__ import annotations

import asyncio
from typing import Any

from app.run_context import RunContext
from app.run_runtime import get_default_run_coordinator


async def cancel_current_turn_durable(task_lock: Any) -> bool:
    context = getattr(task_lock, "run_context", None)
    if not isinstance(context, RunContext):
        return False
    from app.workspace_runtime.ordinary import OrdinaryWorkspace

    if isinstance(
        getattr(task_lock, "ordinary_workspace", None), OrdinaryWorkspace
    ):
        from app.run_journal.runtime import get_default_run_journal
        from app.workspace_runtime.ordinary import finalize_task_lock_workspace

        journal = get_default_run_journal()
        await asyncio.to_thread(
            journal.request_cancel,
            context.run_id,
            request_id=f"user-stop:{context.run_id}",
            reason="user_stopped_turn",
        )
        if await finalize_task_lock_workspace(task_lock, outcome="cancelled"):
            return True
    await get_default_run_coordinator().complete_cancelled_turn(
        context.run_id,
        request_id=f"user-stop:{context.run_id}",
        reason="user_stopped_turn",
    )
    return True
