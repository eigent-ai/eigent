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

"""Repeatable offline C6 API smoke, using already installed dependencies.

Usage: backend/.venv/bin/python backend/scripts/smoke_parallel_sessions.py \
    --output /absolute/new/synthetic-evidence-directory

Only stdlib is imported until the child has an empty, explicit environment and
an isolated HOME. The output must not already exist; synthetic databases and
failure logs are retained for inspection. No dependency bootstrap is performed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEST = "tests/app/workspace_runtime/test_delivery_smoke.py"
SUITES = {
    "preview": TEST,
    "default": "tests/app/controller/test_default_session_parallel.py",
    "native": "tests/app/workspace_runtime/test_native_runtime.py tests/app/workspace_runtime/test_native_tools.py tests/app/workspace_runtime/test_native_browser_lifecycle.py tests/app/workspace_runtime/test_ordinary_workspace.py tests/app/service/test_single_agent_service.py tests/app/run_runtime/test_coordinator.py",
    "protocol": "tests/app/workspace_runtime",
    "compatibility": "tests/app/run_journal/test_follow_up_queue.py tests/app/agent/toolkit/test_file_write_workspace.py tests/app/agent/toolkit/test_hybrid_browser_tab_limits.py tests/app/agent/factory/test_browser.py::test_electron_browser_pool_allocates_by_target_not_shared_port tests/app/agent/toolkit/test_electron_browser_target_guard.py",
    "guards": "tests/app/workspace_runtime/test_entry_guard.py",
    "browser": "tests/app/workspace_runtime/test_native_browser.py",
}


def worker(output: Path, test: str = TEST) -> int:
    if Path.home().resolve() != output / "home":
        raise RuntimeError("smoke requires its isolated HOME")

    def offline(event, args):
        if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto"}:
            if os.environ.get("EIGENT_NATIVE_BROWSER_FIXTURE") == "1":
                address = (
                    args[0] if event == "socket.getaddrinfo" else args[-1]
                )
                host = address[0] if isinstance(address, tuple) else address
                if host in {"localhost", "127.0.0.1", "::1"}:
                    return
            raise RuntimeError("C6 smoke forbids real network I/O")
        if event == "open" and isinstance(args[0], (str, bytes)):
            path = Path(os.fsdecode(args[0])).absolute()
            if path.name == ".env" or path.name.startswith(".env."):
                raise RuntimeError("C6 smoke forbids dotenv access")
            if ".eigent" in path.parts and not path.is_relative_to(output):
                raise RuntimeError("C6 smoke forbids real Eigent user data")

    sys.addaudithook(offline)
    import dotenv

    dotenv.load_dotenv = lambda *a, **k: False
    dotenv.dotenv_values = lambda *a, **k: {}
    import pytest

    from app.run_journal import runtime as journal_runtime

    class FailureFacts:
        @pytest.fixture
        def client(self):
            # Narrow route harness; never starts the application's background
            # services or loads the production user's settings.
            from fastapi import FastAPI
            from fastapi.testclient import TestClient

            from app.auth import require_local_control_principal
            from app.controller.chat_controller import router

            application = FastAPI()
            application.dependency_overrides[
                require_local_control_principal
            ] = lambda: {"kind": "test"}
            application.include_router(router)
            with TestClient(application) as client:
                yield client

        @pytest.hookimpl(hookwrapper=True)
        def pytest_runtest_makereport(self, item, call):
            outcome = yield
            report = outcome.get_result()
            if report.failed:
                # Keep the new run's facts and log; never diagnose by replaying
                # an unrelated historical timeout/crash sequence.
                with (output / "failures.jsonl").open("a") as handle:
                    handle.write(
                        json.dumps({"test": item.nodeid, "phase": report.when})
                        + "\n"
                    )

    try:
        return pytest.main(
            [
                "-p",
                "no:cacheprovider",
                "-p",
                "pytest_asyncio.plugin",
                "--import-mode=importlib",
                "--confcutdir=tests/app",
                "--basetemp",
                str(output / "state"),
                "--junitxml",
                str(output / "junit.xml"),
                "-q",
                "--tb=short",
                *test.split(),
            ],
            plugins=[FailureFacts()],
        )
    finally:
        journal_runtime.close_default_run_journal()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--suite", choices=SUITES, default="preview")
    parser.add_argument(
        "--worker", action="store_true", help=argparse.SUPPRESS
    )
    args = parser.parse_args()
    output = args.output
    if not output.is_absolute():
        parser.error("--output must be an absolute, new directory")
    output = output.resolve()
    if args.worker:
        return worker(output, SUITES[args.suite])
    output.mkdir(parents=True, exist_ok=False)
    for directory in ("home", "tmp", "config", "cache"):
        (output / directory).mkdir()
    environment = {
        "PATH": os.pathsep.join(
            (str(Path(sys.executable).parent), "/usr/bin", "/bin")
        ),
        "HOME": str(output / "home"),
        "USERPROFILE": str(output / "home"),
        "TMPDIR": str(output / "tmp"),
        "TMP": str(output / "tmp"),
        "TEMP": str(output / "tmp"),
        "XDG_CONFIG_HOME": str(output / "config"),
        "XDG_CACHE_HOME": str(output / "cache"),
        "PYTHONPATH": str(ROOT / "backend"),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_SYSTEM": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "EIGENT_RUN_JOURNAL_PATH": str(output / "default.sqlite"),
        "CAMEL_LOG_DIR": str(output / "home" / "camel-logs"),
    }
    if args.suite == "browser":
        node = shutil.which("node")
        if node is None:
            raise RuntimeError(
                "browser smoke requires existing Node dependencies"
            )
        environment["PATH"] += os.pathsep + str(Path(node).parent)
        environment["EIGENT_NATIVE_BROWSER_FIXTURE"] = "1"
    command = [
        sys.executable,
        "-u",
        "-B",
        str(Path(__file__).resolve()),
        "--output",
        str(output),
        "--worker",
        "--suite",
        args.suite,
    ]
    started = time.time()
    with (output / "smoke.log").open("x") as log:
        with subprocess.Popen(
            command,
            cwd=ROOT / "backend",
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        ) as process:
            for line in process.stdout:
                log.write(line)
                log.flush()
                print(line, end="", flush=True)
            result = process.wait()
    evidence = {}
    for path in sorted(output.rglob("smoke-observations.json")):
        evidence[str(path.relative_to(output))] = hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
    summary = {
        "scope": "synthetic parallel execution smoke; no Electron/full main startup",
        "exit_code": result,
        "started_at": started,
        "finished_at": time.time(),
        "python": sys.executable,
        "test": SUITES[args.suite],
        "observations": evidence,
        "environment": environment,
        "real_model_or_account_io": False,
    }
    (output / "result.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"C6 smoke exit={result}; evidence: {output}")
    return result


if __name__ == "__main__":
    raise SystemExit(main())
