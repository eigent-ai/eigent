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

from __future__ import annotations

import asyncio

import pytest

from app.run_context import (
    RunContext,
    get_current_run_context,
    stream_with_run_context,
)


def _context(tmp_path, run_id: str) -> RunContext:
    return RunContext(
        space_id="space-1",
        project_id="project-1",
        run_id=run_id,
        task_id=run_id,
        email="user@example.com",
        user_id="42",
        working_directory=tmp_path,
        task_output_root=tmp_path / run_id,
        camel_log_dir=tmp_path / f"{run_id}-logs",
        binding_source="test",
        workdir_mode=None,
        browser_port=9222,
    )


@pytest.mark.asyncio
async def test_stream_context_pins_turn_and_observes_rebind_on_next_turn(
    tmp_path,
):
    entered = asyncio.Event()
    release = asyncio.Event()
    observed: list[str | None] = []
    current = {"value": _context(tmp_path, "run-old")}

    async def source():
        entered.set()
        await release.wait()
        context = get_current_run_context()
        observed.append(context.run_id if context else None)
        child_observed = await asyncio.create_task(
            _read_current_run_id_after_yield()
        )
        observed.append(child_observed)
        yield "old-event"
        context = get_current_run_context()
        observed.append(context.run_id if context else None)
        yield "new-event"

    async def _read_current_run_id_after_yield() -> str | None:
        await asyncio.sleep(0)
        context = get_current_run_context()
        return context.run_id if context else None

    stream = stream_with_run_context(source(), lambda: current["value"])
    pending = asyncio.create_task(stream.__anext__())
    await entered.wait()
    current["value"] = _context(tmp_path, "run-new")
    release.set()

    assert await pending == "old-event"
    assert observed == ["run-old", "run-old"]
    assert await stream.__anext__() == "new-event"
    assert observed == ["run-old", "run-old", "run-new"]
    assert get_current_run_context() is None
    await stream.aclose()
