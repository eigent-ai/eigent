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

"""JSON-lines IPC into real ASGI/SQLite/dispatcher/runtime/finalizer, no sockets.

Only account-service responses, trusted release assets, and model I/O are
synthetic. The SDK serializes real requests to a MockTransport. A fresh temp
home and network audit guard protect the developer's environment.
"""

import asyncio
import base64
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit


async def main():
    with tempfile.TemporaryDirectory(prefix="eigent-c6-ipc-") as temporary:
        root = Path(temporary)
        synthetic_home = root / "home"
        synthetic_home.mkdir()
        Path.home = classmethod(lambda cls: synthetic_home)
        original_expanduser = os.path.expanduser
        os.path.expanduser = (
            lambda path: str(synthetic_home) + path[1:]
            if isinstance(path, str) and path.startswith("~/")
            else original_expanduser(path)
        )

        def offline(event, args):
            if event in {"socket.connect", "socket.getaddrinfo"}:
                raise AssertionError("C6 IPC tests forbid real network")
            if event == "open" and isinstance(args[0], (str, bytes)):
                name = os.fsdecode(args[0])
                if name.startswith("/Users/4pmtong/.eigent/") or Path(name).name in {
                    ".env",
                    ".env.local",
                    ".env.development",
                    ".env.test",
                }:
                    raise AssertionError("C6 IPC tests forbid real configuration")

        sys.addaudithook(offline)
        import dotenv

        dotenv.load_dotenv = lambda *a, **k: False
        dotenv.dotenv_values = lambda *a, **k: {}
        import httpx
        import pytest
        from fastapi import FastAPI
        from app.controller import run_controller
        from app.controller.execution_controller import router
        from app.run_context import get_current_run_context
        from app.workspace_runtime import runtime
        from tests.app.workspace_runtime.test_registration import Deployment
        from tests.app.workspace_runtime.test_agent_adapter import response

        monkeypatch = pytest.MonkeyPatch()
        deployment = Deployment(root, monkeypatch)
        deployment.registration.local_single_session_enabled = True
        monkeypatch.setattr(
            run_controller, "get_default_run_journal", lambda: deployment.journal
        )
        monkeypatch.setattr(
            run_controller,
            "get_default_run_coordinator",
            lambda: deployment.coordinator,
        )
        app = FastAPI()
        app.include_router(router)
        app.include_router(run_controller.router)
        gates, counts, wire, metadata, spaces = {}, {}, [], {}, {}
        from camel.models import ModelFactory

        original_model = ModelFactory.create

        async def model_io(request):
            context = get_current_run_context()
            run_id = context.run_id
            counts[run_id] = counts.get(run_id, 0) + 1
            body = json.loads(request.content)
            wire.append(
                {"run": run_id, "url": str(request.url), "body": copy.deepcopy(body)}
            )
            if counts[run_id] == 1:
                await gates.setdefault(run_id, asyncio.Event()).wait()
                result = response(
                    tool="write_to_file",
                    arguments={
                        "file_path": context.project_id + ".txt",
                        "content": run_id,
                    },
                )
            else:
                result = response(content="Saved " + run_id)
            return httpx.Response(200, json=result.model_dump(mode="json"))

        def create_model(**kwargs):
            assert str(kwargs["async_client"].base_url).startswith(
                "https://model.example.test/authorized/v1"
            )
            kwargs["async_client"]._client._transport = httpx.MockTransport(model_io)
            return original_model(**kwargs)

        monkeypatch.setattr(ModelFactory, "create", create_model)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 1234)),
            base_url="http://synthetic-brain",
        ) as client:
            deployment.client = client

            async def handle(value):
                kind = value["kind"]
                if kind == "space":
                    spaces[value["space"]] = bool(value.get("git"))
                    return True
                if kind == "start":
                    await deployment.service.start()
                    return True
                if kind == "release":
                    gates.setdefault(value["run"], asyncio.Event()).set()
                    return True
                if kind == "flag":
                    deployment.registration.local_single_session_enabled = value[
                        "enabled"
                    ]
                    return True
                if kind == "history":
                    deployment.registration.session_history_enabled = value["enabled"]
                    return True
                if kind == "stats":
                    return {
                        "wire": wire,
                        "counts": counts,
                        "requests": [
                            dict(row)
                            for row in deployment.journal._connection.execute(
                                "SELECT request_id,project_id,status FROM execution_requests"
                            )
                        ],
                        "finals": [
                            dict(row)
                            for row in deployment.journal._connection.execute(
                                "SELECT run_id,state FROM run_workspace_finalizations"
                            )
                        ],
                    }
                if kind != "http":
                    raise ValueError(kind)
                path = value["path"]
                parts = urlsplit(path).path.strip("/").split("/")
                body = json.loads(value.get("body") or "null")
                # Simulated authenticated external account service, not a
                # replacement for Brain's configuration or execution APIs.
                if parts[:3] == ["api", "v1", "spaces"]:
                    space = parts[3]
                    if len(parts) == 5 and value["method"] == "POST":
                        project = body["id"]
                        if project not in metadata:
                            deployment.project(
                                project,
                                space=space,
                                mode=body["mode"],
                                git=spaces.get(space, False),
                            )
                            source = deployment.projects[project]
                            source["space_source_type"] = "folder"
                            source["provider"]["api_url"] = (
                                "https://model.example.test/authorized/v1"
                            )
                            deployment.valid_refs[
                                source["provider"]["provider_ref"]
                            ] = copy.deepcopy(source["provider"])
                            metadata[project] = {**body, "space_id": space}
                        result = metadata[project]
                    elif len(parts) == 6 and value["method"] == "PATCH":
                        project = parts[5]
                        metadata[project].update(
                            {
                                key: value
                                for key, value in body.items()
                                if key != "metadata"
                            }
                        )
                        metadata[project]["metadata"].update(body.get("metadata", {}))
                        source = deployment.projects[project]
                        source["session_mode"] = metadata[project]["mode"]
                        source["thinking_effort"] = metadata[project]["metadata"].get(
                            "thinkingEffort"
                        )
                        result = metadata[project]
                    else:
                        raise ValueError("Unexpected account request")
                    return {
                        "status": 200,
                        "headers": {"content-type": "application/json"},
                        "body": base64.b64encode(json.dumps(result).encode()).decode(),
                    }
                result = await client.request(
                    value["method"],
                    path,
                    content=value.get("body"),
                    headers=value.get("headers", {}),
                )
                return {
                    "status": result.status_code,
                    "headers": dict(result.headers),
                    "body": base64.b64encode(result.content).decode(),
                }

            try:
                while line := await asyncio.to_thread(sys.stdin.readline):
                    value = json.loads(line)
                    if value["kind"] == "close":
                        break
                    try:
                        result = await handle(value)
                        message = {"id": value["id"], "result": result}
                    except Exception as error:
                        import traceback

                        traceback.print_exc(file=sys.stderr)
                        message = {"id": value["id"], "error": str(error)}
                    sys.__stdout__.write("@IPC " + json.dumps(message) + "\n")
                    sys.__stdout__.flush()
            finally:
                for gate in gates.values():
                    gate.set()
                await runtime.close_default_execution_service()
                await deployment.coordinator.close()
                deployment.journal.close()
                monkeypatch.undo()


if __name__ == "__main__":
    sys.stdout = sys.stderr
    asyncio.run(main())
