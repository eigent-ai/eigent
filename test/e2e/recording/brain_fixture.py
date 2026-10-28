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

"""Isolated Brain fixture for the real adapter; never reads a user's workspace."""

import asyncio
import os
from pathlib import Path

from fastapi import FastAPI
import uvicorn

from app.auth.local_control import capture_local_control_capability
from app.recording import runtime
from app.recording.models import RecordingScope
from app.recording.service import RecordingService
from app.recording.store import RecordingStore

capture_local_control_capability()
runtime.capture_recording_bootstrap()
from app.controller.recording_controller import router  # noqa: E402

root = Path(os.environ["RECORDING_FIXTURE_ROOT"])
space = root / "space"
space.mkdir(parents=True, exist_ok=True)
scope = RecordingScope(
    "desktop_renderer:local",
    "fixture",
    "space",
    "project",
    "task",
    "run",
    None,
    space,
    "fixture-binding",
)
service = RecordingService(
    RecordingStore(root / "recordings.sqlite3"),
    scope_resolver=lambda run, owner: scope,
    binding_check=lambda row: True,
    run_check=lambda run: (True, None),
)
runtime._service = service
api = FastAPI()
api.include_router(router)


@api.on_event("startup")
async def startup():
    async def watch():
        while True:
            service.tick()
            await asyncio.sleep(0.25)

    api.state.watch = asyncio.create_task(watch())


@api.on_event("shutdown")
async def shutdown():
    api.state.watch.cancel()
    await asyncio.gather(api.state.watch, return_exceptions=True)
    service.disconnect()


uvicorn.run(
    api,
    host="127.0.0.1",
    port=int(os.environ["RECORDING_FIXTURE_PORT"]),
    log_level="warning",
)
