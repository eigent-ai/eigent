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

"""Isolated smoke fixture: real TerminalToolkit, process registry and HTTP routes.

Only model dispatch and workspace admission are replaced. Commands and state live
under a TemporaryDirectory. No credentials, model calls or user projects are used.
"""

import atexit
import contextvars
import os
from pathlib import Path
import shlex
import sys
import tempfile
import uuid
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))
state = tempfile.TemporaryDirectory(prefix="eigent-terminal-smoke-")
state_path = Path(state.name)
os.environ["EIGENT_RUN_JOURNAL_PATH"] = str(state_path / "journal.sqlite3")
os.environ["EIGENT_LOCAL_CONTROL_CAPABILITY"] = "terminal-smoke-fixture"
os.environ["EIGENT_RUNTIME"] = "electron"

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.controller.run_controller import router
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
import app.agent.toolkit.terminal_toolkit as module
from app.run_context import RunContext
import uvicorn

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:18740"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
TerminalToolkit._setup_cloned_environment = lambda self: None
TerminalToolkit._get_venv_path = lambda self: None
TerminalToolkit._prepare_terminal_workspace = lambda self, **kw: None
current = contextvars.ContextVar("smoke_context", default=None)
module.run_context_for_task = lambda _: current.get()
checkpoint = contextvars.ContextVar("smoke_checkpoint", default=None)
module.get_current_tool_checkpoint = lambda: checkpoint.get()
toolkits = []


@app.post("/smoke/start/{kind}")
def start(kind: str):
    scripts = {
        "server": "import http.server; print('http://127.0.0.1:18742/', flush=True); http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=18742, bind='127.0.0.1')",
        "stream": "import time; [(print('tick-%d 世界' % i, flush=True), time.sleep(1)) for i in range(5)]",
        "silent": "import time; time.sleep(120)",
        "failure": "import sys; print('expected failure', flush=True); sys.exit(7)",
    }
    if kind not in scripts:
        return {"error": "unknown fixture"}
    (state_path / "index.html").write_text("<h1>Managed preview server</h1>")
    toolkit = TerminalToolkit(
        "terminal-smoke",
        agent_name="Smoke " + kind,
        working_directory=str(state_path),
        session_logs_dir=str(state_path / uuid.uuid4().hex),
        safe_mode=False,
    )
    toolkits.append(toolkit)
    token = current.set(
        RunContext(
            space_id="smoke-space",
            project_id="terminal-smoke",
            run_id="smoke-run",
            task_id="smoke-run",
            email="fixture@example.invalid",
            user_id="fixture",
            working_directory=state_path,
            task_output_root=state_path,
            camel_log_dir=state_path / "logs",
            binding_source="fixture",
            workdir_mode="direct-write",
            browser_port=0,
        )
    )
    cp_token = checkpoint.set(SimpleNamespace(tool_call_id="smoke-" + kind))
    try:
        command = f"{shlex.quote(sys.executable)} -u -c {shlex.quote(scripts[kind])}"
        return {
            "result": toolkit._shell_exec_with_workspace_checkpoint(
                command, id=kind, block=kind == "stream"
            )
        }
    finally:
        current.reset(token)
        checkpoint.reset(cp_token)


@atexit.register
def cleanup():
    for toolkit in toolkits:
        toolkit.cleanup(remove_venv=False)
    state.cleanup()


uvicorn.run(app, host="127.0.0.1", port=18741)
