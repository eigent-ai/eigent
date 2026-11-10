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

"""C6 deployment/API smoke: real owners, synthetic authority and model wire.

Run using scripts/smoke_parallel_sessions.py to establish isolation before
imports. This ASGI harness calls the production startup/close functions; it
intentionally does not import the full main.py or start Electron/cloud sync.
"""

import asyncio
import copy
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from app.controller.execution_controller import router
from app.run_context import get_current_run_context
from app.workspace_runtime import runtime
from app.workspace_runtime.entry_guard import owns_managed_execution
from tests.app.workspace_runtime.test_agent_adapter import response
from tests.app.workspace_runtime.test_registration import Deployment

EXAMPLE = (
    Path(__file__).resolve().parent
    / "fixtures/deployment.synthetic.example.json"
)


def configured_deployment(tmp_path, monkeypatch, **options):
    document = json.loads(EXAMPLE.read_text())
    document.update(options)
    # The rank bytes are synthetic, but use the real integrity-checked loader.
    document["tokenizer_asset_directory"] = str(tmp_path / "assets")
    deployment = Deployment(
        tmp_path, monkeypatch, manifest_options=document, initialize=False
    )
    monkeypatch.setenv(
        "EIGENT_MANAGED_EXECUTION_MANIFEST", str(deployment.manifest)
    )
    return deployment


@asynccontextmanager
async def application(deployment):
    """Use the production deployment lifecycle with explicit synthetic I/O."""
    d = deployment

    @asynccontextmanager
    async def lifespan(_app):
        runtime.initialize_execution_service(
            os.environ.get("EIGENT_MANAGED_EXECUTION_MANIFEST", ""),
            journal=d.journal,
            coordinator=d.coordinator,
            workspace_store=d.workspace_store,
            configuration_reader=lambda: d.context,
            transport=d.transport,
        )
        d.service = runtime.get_default_execution_service()
        d.registration = runtime.get_default_registration_service()
        try:
            await runtime.start_default_execution_service()
            yield
        finally:
            await runtime.close_default_execution_service()
            await d.coordinator.close()
            d.journal.close()

    app = FastAPI(lifespan=lifespan)
    app.include_router(router)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 1234)),
            base_url="http://synthetic-brain",
            headers={"X-Eigent-Local-Capability": "synthetic-local-control"},
        ) as client:
            yield client
    assert runtime.get_default_execution_service() is None


async def wait_for(check):
    async with asyncio.timeout(30):
        while not await check():
            await asyncio.sleep(0.02)


def record_observation(tmp_path, document):
    (tmp_path / "smoke-observations.json").write_text(
        json.dumps(document, indent=2) + "\n"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["no_manifest", "disabled", "c6_omitted"])
async def test_delivery_default_off(tmp_path, monkeypatch, mode):
    assert json.loads(EXAMPLE.read_text())["enabled"] is False
    assert (
        json.loads(EXAMPLE.read_text())["local_single_session_enabled"]
        is False
    )
    assert json.loads(EXAMPLE.read_text())["session_history_enabled"] is False
    d = configured_deployment(tmp_path, monkeypatch)
    if mode == "no_manifest":
        monkeypatch.delenv("EIGENT_MANAGED_EXECUTION_MANIFEST")
    elif mode == "c6_omitted":
        document = json.loads(d.manifest.read_text())
        document["enabled"] = True
        document.pop("local_single_session_enabled")
        document.pop("session_history_enabled")
        d.manifest.write_text(json.dumps(document))
    async with application(d) as client:
        unauthorized = await client.get(
            "/executions/capabilities",
            headers={"X-Eigent-Local-Capability": ""},
        )
        assert unauthorized.status_code == 401
        result = await client.get("/executions/capabilities")
        assert result.status_code == 200
        assert result.json().get("local_single_session", False) is False
        result = await client.post(
            "/projects/unclaimed/execution-configurations?claim_session=true",
            json={},
        )
        assert result.status_code == 503
        # An enabled service still authenticates the caller before refusing
        # the disabled C6 entry. No configuration/credential resolve occurs.
        assert d.calls == (
            ["/api/v1/sync/execution/identity"] if mode == "c6_omitted" else []
        )
        assert not owns_managed_execution(d.journal, project_id="unclaimed")
        if d.registration is not None:
            assert d.registration.session_history_enabled is False
        record_observation(tmp_path, {"mode": mode, "claim_status": 503})


@pytest.mark.asyncio
@pytest.mark.parametrize("git", [False, True])
@pytest.mark.parametrize("cross_space", [False, True])
async def test_delivery_manifest_to_parallel_files(
    tmp_path, monkeypatch, git, cross_space
):
    from camel.models import ModelFactory

    d = configured_deployment(
        tmp_path, monkeypatch, enabled=True, local_single_session_enabled=True
    )
    gates = {run: asyncio.Event() for run in ("start-a", "start-b", "next-a")}
    calls, wire, overlap = {}, [], {}
    original_create = ModelFactory.create

    async def model_io(request):
        context = get_current_run_context()
        assert context is not None
        run = context.run_id
        assert run in gates
        assert str(request.url) == (
            "https://model.example.test/authorized/v1/chat/completions"
        )
        body = json.loads(request.content)
        assert body["model"] == "gpt-5"
        wire.append({"run_id": run, "url": str(request.url)})
        calls[run] = calls.get(run, 0) + 1
        if calls[run] == 1:
            await gates[run].wait()
            result = response(
                tool="write_to_file",
                arguments={
                    "file_path": context.project_id + ".txt",
                    "content": run,
                },
            )
        else:
            result = response(content="Saved " + run)
        return httpx.Response(200, json=result.model_dump(mode="json"))

    def create_model(**kwargs):
        # Keep ModelFactory, SDK serialization, ListenChatAgent and tool loop.
        assert str(kwargs["async_client"].base_url) == (
            "https://model.example.test/authorized/v1/"
        )
        kwargs["async_client"]._client._transport = httpx.MockTransport(
            model_io
        )
        return original_create(**kwargs)

    monkeypatch.setattr(ModelFactory, "create", create_model)
    for project in ("a", "b", "unselected"):
        d.project(
            project,
            space="two" if cross_space and project == "b" else "one",
            git=git,
        )
        source = d.projects[project]
        source["space_source_type"] = "folder"
        source["provider"]["api_url"] = (
            "https://model.example.test/authorized/v1"
        )
        d.valid_refs[source["provider"]["provider_ref"]] = copy.deepcopy(
            source["provider"]
        )
    async with application(d) as client:
        try:
            result = await client.get("/executions/capabilities")
            assert result.json()["local_single_session"] is True
            assert d.registration.session_history_enabled is False
            envelopes = {}
            for project in ("a", "b", "unselected"):
                route = (
                    await client.get(f"/projects/{project}/execution-route")
                ).json()
                assert route["eligible"] is True
                assert route["route"] == "legacy"  # Inspection is not opt-in.
                if project == "unselected":
                    continue
                result = await client.post(
                    f"/projects/{project}/execution-configurations?claim_session=true",
                    json={},
                )
                assert result.status_code == 201, result.text
                envelopes[project] = result.json()["envelope"]
                result = await client.post(
                    f"/projects/{project}/executions",
                    json={
                        "request_id": "start-" + project,
                        "kind": "start",
                        "envelope": {
                            **envelopes[project],
                            "prompt": "write " + project,
                        },
                    },
                )
                assert result.status_code == 202, result.text

            async def both_at_model():
                return all(
                    calls.get(run) == 1 for run in ("start-a", "start-b")
                )

            await wait_for(both_at_model)
            for project in ("a", "b"):
                item = (
                    await client.get(f"/projects/{project}/executions")
                ).json()["items"][0]
                assert item["admitted_run_id"] == "start-" + project
                assert item["settlement"] != "settled"
                overlap[project] = item
            assert not owns_managed_execution(
                d.journal, project_id="unselected"
            )
            result = await client.post(
                "/projects/a/executions",
                json={
                    "request_id": "next-a",
                    "kind": "follow_up",
                    "envelope": envelopes["a"],
                    "source_follow_up_request_id": "next-a",
                    "follow_up_content": "write next a",
                },
            )
            assert result.status_code == 202, result.text
            assert (await client.get("/executions/next-a")).json()[
                "status"
            ] == "pending"
            assert "next-a" not in calls
            gates["start-a"].set()
            gates["start-b"].set()

            async def first_settled_and_next_started():
                a = (await client.get("/projects/a/executions")).json()[
                    "items"
                ]
                b = (await client.get("/projects/b/executions")).json()[
                    "items"
                ]
                return a[0]["settlement"] == b[0][
                    "settlement"
                ] == "settled" and bool(calls.get("next-a"))

            await wait_for(first_settled_and_next_started)
            gates["next-a"].set()

            async def last_settled_and_published():
                items = (await client.get("/projects/a/executions")).json()[
                    "items"
                ]
                path = Path(d.projects["a"]["space_root"]) / "a.txt"
                other = Path(d.projects["b"]["space_root"]) / "b.txt"
                return (
                    items[-1]["settlement"] == "settled"
                    and path.is_file()
                    and path.read_text() == "next-a"
                    and other.is_file()
                    and other.read_text() == "start-b"
                )

            await wait_for(last_settled_and_published)
            artifacts = {}
            for run, filename in (
                ("start-a", "a.txt"),
                ("start-b", "b.txt"),
                ("next-a", "a.txt"),
            ):
                result = await client.get(f"/executions/{run}/artifacts")
                assert result.status_code == 200, result.text
                artifact = next(
                    a
                    for a in result.json()["artifacts"]
                    if a["filename"] == filename
                )
                content = await client.get(
                    f"/executions/{run}/artifacts/{artifact['artifact_id']}/content"
                )
                assert content.status_code == 200
                assert content.text == run
                artifacts[run] = artifact
            assert (
                artifacts["start-a"]["content_digest"]
                != artifacts["next-a"]["content_digest"]
            )
            record_observation(
                tmp_path,
                {
                    "git": git,
                    "cross_space": cross_space,
                    "overlap": overlap,
                    "model_wire": wire,
                    "artifacts": artifacts,
                    "publication": {"a.txt": "next-a", "b.txt": "start-b"},
                    "unselected_claimed": False,
                    "history_enabled": False,
                },
            )
        finally:
            for gate in gates.values():
                gate.set()
