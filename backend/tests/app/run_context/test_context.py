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
async def test_stream_context_getter_observes_rebind_while_waiting(tmp_path):
    entered = asyncio.Event()
    release = asyncio.Event()
    observed: list[str | None] = []
    current = {"value": _context(tmp_path, "run-old")}

    async def source():
        entered.set()
        await release.wait()
        context = get_current_run_context()
        observed.append(context.run_id if context else None)
        yield "event"

    stream = stream_with_run_context(source(), lambda: current["value"])
    pending = asyncio.create_task(stream.__anext__())
    await entered.wait()
    current["value"] = _context(tmp_path, "run-new")
    release.set()

    assert await pending == "event"
    assert observed == ["run-new"]
    assert get_current_run_context() is None
    await stream.aclose()
