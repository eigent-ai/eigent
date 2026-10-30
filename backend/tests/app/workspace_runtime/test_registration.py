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

"""Trusted bootstrap -> authenticated API -> real adapters/finalizer, offline.

Only server/model I/O and release asset bytes are synthetic. No hand-written
ExecutionPolicy or FrozenAgentConfiguration replaces the registration path.
"""

import asyncio
import base64
import copy
import hashlib
import json
import os
import subprocess
import threading
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from app.auth import local_control
from app.controller.execution_controller import router
from app.permission_policy import PRESET_PROFILES, PermissionProfileName
from app.run_journal import SQLiteRunJournal
from app.run_runtime import RunCoordinator
from app.run_sync.cloud_sync import CloudSyncConfiguration
from app.utils import workspace_resolver
from app.workspace_config import parse_workspace_manifest
from app.workspace_runtime import runtime, tokenizer_assets
from tests.app.workspace_runtime.test_agent_adapter import response
from tests.app.workspace_runtime.test_service import eventually
from tests.app.workspace_runtime.test_workforce_adapter import ModelScript


def release_assets(root, monkeypatch):
    directory = root / "assets"
    directory.mkdir()
    raw = b"".join(
        base64.b64encode(bytes([i])) + b" " + str(i).encode() + b"\n"
        for i in range(256)
    )
    (directory / "synthetic.tiktoken").write_bytes(raw)
    manifest = root / "release.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "assets": [
                    {
                        "filename": "synthetic.tiktoken",
                        "sha256": hashlib.sha256(raw).hexdigest(),
                        "provenance": "synthetic test release",
                        "encoding_name": "synthetic-bytes",
                        "rank_count": 256,
                        "pat_str": r"(?s).",
                        "special_tokens": {},
                        "models": {
                            "gpt-5": {
                                "tokens_per_message": 3,
                                "tokens_per_name": 1,
                            }
                        },
                    }
                ],
            }
        )
    )
    monkeypatch.setattr(tokenizer_assets, "MANIFEST", manifest)
    return directory


class Deployment:
    def __init__(
        self, root, monkeypatch, *, manifest_options=None, initialize=True
    ):
        self.root = root
        self.assets = release_assets(root, monkeypatch)
        self.manifest = root / "deployment.json"
        self.manifest.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "enabled": True,
                    "server_url": "https://authority.example.test",
                    "tokenizer_asset_directory": str(self.assets),
                    "capacity": 4,
                    **(manifest_options or {}),
                }
            )
        )
        self.context = CloudSyncConfiguration(
            "https://authority.example.test/api/v1/sync/events:ingest",
            "Bearer synthetic-account-secret",
            "device",
        )
        self.identity = {
            "account_owner_id": "1",
            "desktop_instance_id": "device",
            "device_credential_version": 1,
        }
        self.projects = {}
        self.valid_refs = {}
        self.calls = []
        self.before_response = None
        monkeypatch.setattr(
            workspace_resolver,
            "workspace_state_root",
            lambda _email, user_id=None: root
            / "bindings"
            / str(user_id or "legacy"),
        )
        monkeypatch.setattr(
            local_control,
            "_process_local_control_capability",
            "synthetic-local-control",
        )
        self.workspace_store = workspace_resolver.WorkspaceStore()
        self.journal = SQLiteRunJournal(root / "journal.sqlite")
        self.coordinator = RunCoordinator(self.journal)
        self.transport = httpx.MockTransport(self.server_io)
        if initialize:
            self.initialize()

    def initialize(self):
        runtime.initialize_execution_service(
            self.manifest,
            journal=self.journal,
            coordinator=self.coordinator,
            workspace_store=self.workspace_store,
            configuration_reader=lambda: self.context,
            transport=self.transport,
        )
        self.service = runtime.get_default_execution_service()
        assert self.service is not None, (
            runtime.execution_initialization_state()
        )
        self.service.scan_interval = 0.02
        self.service.stop_timeout = 2
        self.registration = runtime.get_default_registration_service()

    async def server_io(self, request):
        self.calls.append(request.url.path)
        assert request.headers["X-Desktop-Instance-ID"] == "device"
        if (
            self.context is None
            or request.headers["Authorization"] != self.context.authorization
        ):
            return httpx.Response(401)
        if request.url.path.endswith("/identity"):
            return httpx.Response(200, json=self.identity)
        project_id = request.url.path.split("/")[-2]
        source = copy.deepcopy(self.projects[project_id])
        source.update(self.identity)
        if request.method == "POST":
            body = json.loads(request.content)
            if body["provider_ref"] not in self.valid_refs:
                return httpx.Response(409)
            if (body["space_id"], body["session_mode"]) != (
                source["space_id"],
                source["session_mode"],
            ):
                return httpx.Response(409)
            source["provider"] = copy.deepcopy(
                self.valid_refs[body["provider_ref"]]
            )
            source["api_key"] = "synthetic-model-secret"
        if self.before_response:
            await self.before_response(request)
        return httpx.Response(200, json=source)

    def project(self, project, *, space="one", mode="single-agent", git=False):
        root = self.root / space
        if not root.exists():
            root.mkdir()
            if git:
                subprocess.run(
                    [
                        "git",
                        "-c",
                        "init.defaultBranch=main",
                        "init",
                        str(root),
                    ],
                    check=True,
                    capture_output=True,
                    env={
                        "PATH": "/usr/bin:/bin",
                        "HOME": str(self.root),
                        "GIT_CONFIG_NOSYSTEM": "1",
                    },
                )
            self.workspace_store.save_binding(
                "", space, str(root), user_id="1"
            )
            bundle = parse_workspace_manifest("""
apiVersion: eigent.ai/v1alpha1
kind: WorkspaceBundle
metadata: {id: bundle_registration, name: Synthetic, revision: 1}
spec:
  permissions: {profile: full_access}
  models:
    default: {modelRef: 'provider://managed', thinkingEffort: medium}
""")
            self.journal.put_workspace_config_revision(
                revision_id=bundle.revision_id,
                bundle_id=bundle.metadata.id,
                revision_number=1,
                manifest=bundle.canonical_payload(),
                created_by="synthetic-owner",
            )
            self.journal.put_workspace_config_materialization(
                materialization_id="materialized-" + space,
                space_id=space,
                revision_id=bundle.revision_id,
                config_placement="sidecar",
            )
            proposal = self.journal.put_workspace_bundle_install_proposal(
                proposal_id="proposal-" + space,
                request_id="install-" + space,
                space_id=space,
                bundle_id=bundle.metadata.id,
                revision_id=bundle.revision_id,
                config_placement="sidecar",
                manifest=bundle.canonical_payload(),
                assets=[],
                install_plan={},
            )
            for state in ("approved", "materializing", "materialized"):
                proposal = (
                    self.journal.transition_workspace_bundle_install_proposal(
                        proposal.proposal_id,
                        expected_version=proposal.version,
                        state=state,
                        decided_by="synthetic-owner",
                    )
                )
            self.permission(space, PermissionProfileName.FULL_ACCESS)
        provider = {
            "provider_ref": "provider:1:" + "a" * 32,
            "model_platform": "openai",
            "model_type": "gpt-5",
            "api_url": "https://api.openai.com/v1",
            "model_config_dict": {"max_completion_tokens": 1024},
            "extra_params": {
                "api_mode": "chat_completions",
                "timeout": 10,
                "max_retries": 0,
            },
        }
        self.valid_refs[provider["provider_ref"]] = copy.deepcopy(provider)
        self.projects[project] = {
            **self.identity,
            "project_id": project,
            "space_id": space,
            "space_root": str(root),
            "session_mode": mode,
            "thinking_effort": "medium",
            "provider": provider,
        }

    def permission(self, space, profile):
        value = PRESET_PROFILES[profile]
        self.journal.put_space_permission_profile(
            space_id=space,
            profile_name=value.name,
            sandbox_mode=value.sandbox_mode,
            approval_mode=value.approval_mode,
            reviewer_mode=value.reviewer_mode,
            updated_by="synthetic-owner",
        )

    async def register(self, project):
        result = await self.client.post(
            f"/projects/{project}/execution-configurations", json={}
        )
        assert result.status_code == 201, result.text
        return result.json()["envelope"]

    async def submit(self, project, request, envelope):
        result = await self.client.post(
            f"/projects/{project}/executions",
            json={
                "request_id": request,
                "kind": "start",
                "envelope": {**envelope, "prompt": request},
            },
        )
        assert result.status_code == 202, result.text
        return result.json()

    def completed(self, request):
        run = self.journal.get_run(request)
        return run is not None and run.status == "completed"


@pytest_asyncio.fixture
async def deployment(tmp_path, monkeypatch):
    assert runtime.get_default_execution_service() is None
    deployment = Deployment(tmp_path, monkeypatch)
    app = FastAPI()
    app.include_router(router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 1234)),
        base_url="http://test",
        headers={"X-Eigent-Local-Capability": "synthetic-local-control"},
    ) as client:
        deployment.client = client
        try:
            yield deployment
        finally:
            await runtime.close_default_execution_service()
            await deployment.coordinator.close()
            deployment.journal.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("git", [False, True])
@pytest.mark.parametrize("cross_space", [False, True])
@pytest.mark.parametrize(
    "modes",
    [
        ("single-agent", "single-agent"),
        ("single-agent", "workforce"),
        ("workforce", "workforce"),
    ],
)
async def test_real_registration_parallel_sessions_and_finalizer(
    deployment, monkeypatch, git, cross_space, modes
):
    d = deployment
    arrived = set()
    release = asyncio.Event()
    cwd, environment = Path.cwd(), dict(os.environ)

    async def worker(context, role, call, _messages):
        if call == 1:
            arrived.add(context.project_id)
            if len(arrived) == 2:
                release.set()
            await release.wait()
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": f"{context.run_id}-{role}.txt",
                    "content": context.run_id,
                },
            )
        return response(
            content=json.dumps(
                {
                    "content": "Successfully wrote the requested file.",
                    "failed": False,
                }
            )
        )

    script = ModelScript(monkeypatch, worker_reply=worker)
    for project, mode in zip(("a", "b"), modes):
        d.project(
            project,
            space="two" if project == "b" and cross_space else "one",
            mode=mode,
            git=git,
        )
        envelope = await d.register(project)
        await d.submit(project, "run-" + project, envelope)
    await d.service.start()
    await eventually(
        lambda: d.completed("run-a") and d.completed("run-b"), timeout=25
    )
    assert arrived == {"a", "b"}
    for project in ("a", "b"):
        result = await d.client.get(
            "/executions/run-" + project + "/artifacts"
        )
        assert result.status_code == 200, result.text
        assert result.json()["artifact_count"] >= 1
        source = Path(d.projects[project]["space_root"])
        await eventually(
            lambda: bool(list(source.glob("run-" + project + "-*.txt")))
        )
    assert Path.cwd() == cwd and dict(os.environ) == environment
    assert all(
        capture["async_client"]._client._trust_env is False
        for capture in script.captures
    )
    dump = "\n".join(d.journal._connection.iterdump())
    for secret in (
        "synthetic-model-secret",
        "Bearer synthetic-account-secret",
    ):
        assert (
            secret not in dump
            and hashlib.sha256(secret.encode()).hexdigest() not in dump
        )
    assert (
        d.journal._connection.execute(
            "SELECT COUNT(*) FROM run_workspace_finalizations WHERE state='settled'"
        ).fetchone()[0]
        == 2
    )


@pytest.mark.asyncio
async def test_restart_exact_queue_waits_for_auth_and_pins_model_intent(
    deployment, monkeypatch
):
    d = deployment
    d.project("a")
    original = await d.register("a")
    await d.submit("a", "first", original)
    await d.submit("a", "second", original)
    d.projects["a"]["thinking_effort"] = "high"
    changed = await d.register("a")
    assert (
        changed["configuration_revision"] != original["configuration_revision"]
    )
    await runtime.close_default_execution_service()
    authenticated = d.context
    d.context = None
    d.initialize()
    script = ModelScript(monkeypatch)
    await d.service.start()
    await eventually(
        lambda: d.service.admission.get("first").wait_reason is not None
    )
    assert d.journal.get_run("first") is None
    assert not script.calls
    d.context = authenticated
    await eventually(
        lambda: d.completed("first") and d.completed("second"), timeout=25
    )
    assert (
        len(d.journal.list_run_attempts("first"))
        == len(d.journal.list_run_attempts("second"))
        == 1
    )
    assert all(
        capture["model_config_dict"]["reasoning_effort"] == "medium"
        for capture in script.captures
    )
    order = [
        run
        for run, role, call in script.calls
        if role == "single" and call == 1
    ]
    assert order == ["first", "second"]


@pytest.mark.asyncio
async def test_revoked_provider_waits_without_attempt_but_owned_cancel_works(
    deployment, monkeypatch
):
    d = deployment
    d.project("a")
    envelope = await d.register("a")
    await d.submit("a", "waiting", envelope)
    d.valid_refs.clear()
    ModelScript(monkeypatch)
    await d.service.start()
    await eventually(
        lambda: d.service.admission.get("waiting").wait_reason is not None
    )
    assert d.journal.get_run("waiting") is None
    result = await d.client.delete("/executions/waiting")
    assert result.status_code == 200 and result.json()["status"] == "cancelled"
    d.project("b", space="two", mode="workforce")
    await d.submit("b", "independent", await d.register("b"))
    await eventually(lambda: d.completed("independent"), timeout=20)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    [
        "account",
        "device_version",
        "authority",
        "root",
        "permission",
        "binding",
    ],
)
async def test_lifecycle_authority_changes_cannot_redirect_pending_work(
    deployment, change
):
    d = deployment
    d.project("a")
    await d.submit("a", "waiting", await d.register("a"))
    if change == "account":
        d.identity["account_owner_id"] = "2"
    elif change == "device_version":
        d.identity["device_credential_version"] = 2
    elif change == "authority":
        d.context = CloudSyncConfiguration(
            "https://other.test/api/v1/sync/events:ingest",
            d.context.authorization,
            "device",
        )
    elif change == "root":
        d.projects["a"]["space_root"] = str(d.root / "other")
    elif change == "permission":
        d.permission("one", PermissionProfileName.READ_ONLY)
    else:
        d.workspace_store.save_binding(
            "", "one", str(d.root / "other"), user_id="1"
        )
    await d.service.start()
    await eventually(
        lambda: d.service.admission.get("waiting").wait_reason is not None
    )
    assert d.journal.get_run("waiting") is None
    assert d.service.admission.get("waiting").envelope["project_id"] == "a"


@pytest.mark.asyncio
async def test_capability_is_pure_and_api_accepts_no_config_secrets(
    deployment, monkeypatch
):
    d = deployment
    count = len(d.calls)

    def forbidden(*_args, **_kwargs):
        raise AssertionError(
            "capability must not read configuration, assets or authority"
        )

    monkeypatch.setattr(d.registration.source, "configuration", forbidden)
    monkeypatch.setattr(tokenizer_assets, "load_tokenizer_assets", forbidden)
    result = await d.client.get("/executions/capabilities")
    assert result.json()["parallel_sessions"] is True
    assert result.json()["supports_workforce"] is False
    assert len(d.calls) == count
    invalid = await d.client.post(
        "/projects/a/execution-configurations",
        json={"api_key": "input-secret"},
    )
    assert invalid.status_code == 422 and "input-secret" not in invalid.text
    invalid = await d.client.post(
        "/projects/a/executions", json={"api_key": "input-secret"}
    )
    assert invalid.status_code == 422 and "input-secret" not in invalid.text
    denied = await d.client.get(
        "/executions/capabilities",
        headers={"X-Eigent-Local-Capability": "wrong"},
    )
    assert denied.status_code == 401


def test_explicit_asset_loader_integrity_and_counter_compatibility(
    tmp_path, monkeypatch
):
    from camel.types import UnifiedModelType
    from camel.utils import token_counting

    from app.workspace_runtime.agent_model_resources import (
        LoadedOpenAITokenizer,
    )

    assets = release_assets(tmp_path, monkeypatch)
    loaded = tokenizer_assets.load_tokenizer_assets(assets)["gpt-5"]
    # The public counter constructor with the same release encoding must have
    # exactly the same counter/content identity as the no-registry constructor.
    monkeypatch.setattr(
        token_counting,
        "get_model_encoding",
        lambda _model: loaded.for_model("gpt-5").encoding,
    )
    assert (
        LoadedOpenAITokenizer(
            token_counting.OpenAITokenCounter(UnifiedModelType("gpt-5"))
        ).reference
        == loaded.reference
    )
    (assets / "synthetic.tiktoken").write_bytes(b"corrupt")
    assert tokenizer_assets.load_tokenizer_assets(assets) == {}
    assert tokenizer_assets.load_tokenizer_assets(tmp_path / "missing") == {}


@pytest.mark.asyncio
async def test_missing_assets_disable_before_journal_or_credentials(
    tmp_path, monkeypatch
):
    def forbidden(*_args, **_kwargs):
        raise AssertionError(
            "missing assets must not initialize journal or credentials"
        )

    from app.run_journal import runtime as journal_runtime

    monkeypatch.setattr(journal_runtime, "get_default_run_journal", forbidden)
    manifest = tmp_path / "disabled.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "enabled": True,
                "server_url": "https://authority.test",
                "tokenizer_asset_directory": str(tmp_path / "missing"),
                "capacity": 4,
            }
        )
    )
    runtime.initialize_execution_service(
        manifest, configuration_reader=forbidden
    )
    assert runtime.get_default_execution_service() is None
    assert (
        runtime.execution_initialization_state() == "tokenizer_assets_required"
    )
    await runtime.close_default_execution_service()


@pytest.mark.asyncio
async def test_revocation_during_preparation_creates_no_attempt(
    deployment, monkeypatch
):
    d = deployment
    d.project("a")
    await d.submit("a", "waiting", await d.register("a"))
    prepared, release = threading.Event(), threading.Event()
    original = d.service._prepare

    def gate(*args):
        result = original(*args)
        prepared.set()
        assert release.wait(10)
        return result

    monkeypatch.setattr(d.service, "_prepare", gate)
    await d.service.start()
    try:
        await eventually(prepared.is_set)
        d.valid_refs.clear()
    finally:
        release.set()
    await eventually(
        lambda: d.service.admission.get("waiting").wait_reason is not None
    )
    assert d.journal.get_run("waiting") is None


@pytest.mark.asyncio
async def test_active_revocation_stops_one_owner_preserves_partial_and_other_session(
    deployment, monkeypatch
):
    d = deployment
    blocked = asyncio.Event()

    async def worker(context, role, call, _messages):
        if call == 1:
            return response(
                tool="write_to_file",
                arguments={
                    "file_path": context.run_id + ".txt",
                    "content": context.run_id,
                },
            )
        if context.run_id == "revoked":
            blocked.set()
            await asyncio.Event().wait()
        return response(content="done")

    ModelScript(monkeypatch, worker_reply=worker)
    d.project("a")
    d.project("b", space="two")
    provider = d.projects["b"]["provider"]
    provider["provider_ref"] = "provider:2:" + "b" * 32
    d.valid_refs[provider["provider_ref"]] = copy.deepcopy(provider)
    await d.submit("a", "revoked", await d.register("a"))
    await d.submit("b", "independent", await d.register("b"))
    await d.service.start()
    await eventually(blocked.is_set)
    del d.valid_refs[d.projects["a"]["provider"]["provider_ref"]]
    await eventually(
        lambda: d.service.admission.get_claim("a").state == "released",
        timeout=12,
    )
    await eventually(lambda: d.completed("independent"))
    assert d.journal.get_run("revoked").status == "cancelled"
    artifact = await d.client.get("/executions/revoked/artifacts")
    assert (
        artifact.status_code == 200 and artifact.json()["artifact_count"] == 1
    )
    assert not (d.root / "one/revoked.txt").exists()
    assert not d.journal._connection.execute(
        "SELECT 1 FROM workspace_integration_requests WHERE run_id='revoked'"
    ).fetchone()


@pytest.mark.asyncio
async def test_finalized_output_does_not_publish_after_authority_revocation(
    deployment, monkeypatch
):
    d = deployment
    ModelScript(monkeypatch)
    d.project("a")
    original = d.service._dispatch_publications
    monkeypatch.setattr(d.service, "_dispatch_publications", lambda: None)
    await d.submit("a", "finished", await d.register("a"))
    await d.service.start()
    await eventually(lambda: d.completed("finished"), timeout=15)
    assert not (d.root / "one/finished-single.txt").exists()
    d.valid_refs.clear()
    monkeypatch.setattr(d.service, "_dispatch_publications", original)
    await eventually(
        lambda: d.journal._connection.execute(
            "SELECT 1 FROM workspace_integration_requests WHERE run_id='finished' AND wait_reason='authorization_required'"
        ).fetchone()
    )
    assert not (d.root / "one/finished-single.txt").exists()
    result = await d.client.get("/executions/finished/artifacts")
    assert result.status_code == 200 and result.json()["artifact_count"] == 1


@pytest.mark.asyncio
async def test_capability_middleware_has_no_sync_side_effect(
    deployment, monkeypatch
):
    from app.run_sync import middleware

    def forbidden(*_args, **_kwargs):
        raise AssertionError(
            "capability cannot create a background sync worker"
        )

    monkeypatch.setattr(
        middleware, "configure_default_cloud_sync_worker", forbidden
    )
    app = FastAPI()
    app.middleware("http")(middleware.cloud_sync_configuration_middleware)
    app.include_router(router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 12)),
        base_url="http://test",
    ) as client:
        result = await client.get(
            "/executions/capabilities",
            headers={
                "Authorization": "Bearer synthetic",
                "X-Eigent-Local-Capability": "synthetic-local-control",
            },
        )
        assert result.status_code == 200 and not deployment.calls


@pytest.mark.asyncio
async def test_revocation_after_integration_planning_prevents_apply(
    deployment, monkeypatch
):
    from app.workspace_runtime.integration import (
        WorkspaceIntegrationCoordinator,
    )

    d = deployment
    d.project("a")
    ModelScript(monkeypatch)
    reached = threading.Event()
    original = WorkspaceIntegrationCoordinator._apply

    def revoke_before_apply(coordinator, operation):
        d.valid_refs.clear()
        reached.set()
        return original(coordinator, operation)

    monkeypatch.setattr(
        WorkspaceIntegrationCoordinator, "_apply", revoke_before_apply
    )
    await d.submit("a", "finished", await d.register("a"))
    await d.service.start()
    await eventually(reached.is_set, timeout=15)
    await eventually(lambda: not d.service._publications)
    assert not (d.root / "one/finished-single.txt").exists()
    assert d.completed("finished")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "corruption",
    ["materialization", "tokenizer", "configuration", "physical_root"],
)
async def test_restart_keeps_unavailable_exact_configuration_pending(
    deployment, corruption
):
    d = deployment
    d.project("a")
    envelope = await d.register("a")
    await d.submit("a", "waiting", envelope)
    await runtime.close_default_execution_service()
    if corruption == "materialization":
        with d.journal._write_transaction() as connection:
            connection.execute(
                "UPDATE workspace_config_materializations SET state='degraded'"
            )
    elif corruption == "tokenizer":
        # A different, valid release asset cannot restore the pinned counter.
        manifest_path = tokenizer_assets.MANIFEST
        document = json.loads(manifest_path.read_text())
        document["assets"][0]["encoding_name"] = "other-synthetic-release"
        manifest_path.write_text(json.dumps(document))
    elif corruption == "configuration":
        with d.journal._write_transaction() as connection:
            connection.execute(
                "UPDATE managed_execution_configurations SET document_json='{}'"
            )
    else:
        (d.root / "one").rename(d.root / "original-one")
        (d.root / "one").mkdir()
    d.initialize()
    await d.service.start()
    await eventually(
        lambda: d.service.admission.get("waiting").wait_reason is not None
    )
    assert d.journal.get_run("waiting") is None
    assert (
        d.service.admission.get("waiting").envelope["configuration_revision"]
        == envelope["configuration_revision"]
    )
