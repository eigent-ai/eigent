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

"""Actual admission -> dispatcher -> private worker -> finalizer service chain."""

from __future__ import annotations

import asyncio
import os
import subprocess
import threading
import time
from dataclasses import replace

import pytest
import pytest_asyncio

from app.run_journal import AttemptEnvironmentBinding, SQLiteRunJournal
from app.run_policy import RunTimeoutPolicy, TimeoutOutcome, TimeoutScope
from app.run_runtime import RunCoordinator
from app.workspace_config import (
    EnvironmentConfigResolver,
    LocalMaterialization,
    ProviderModelCapability,
    ThinkingEffort,
    parse_workspace_manifest,
)
from app.workspace_runtime.bound_runtime import WorkerOperation as Op
from app.workspace_runtime.content import ContentStore
from app.workspace_runtime.git_provider import GitWorkspaceProvider
from app.workspace_runtime.provider import DirectoryWorkspaceProvider
from app.workspace_runtime.service import (
    ExecutionForbidden,
    ExecutionOrigin,
    ExecutionPolicy,
    ExecutionPolicyRegistry,
    ExecutionService,
    ExecutionUnavailable,
    RuntimeConfiguration,
)
from app.workspace_runtime.store import WorkspaceStateStore


async def eventually(predicate, *, timeout=8):
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.01)


class World:
    def __init__(self, root):
        self.root = root
        self.journal = SQLiteRunJournal(root / "journal.sqlite")
        self.state = WorkspaceStateStore(self.journal)
        self.content = ContentStore(root / "objects")
        self.registry = ExecutionPolicyRegistry()
        self.coordinator = RunCoordinator(self.journal)
        self.service = ExecutionService(
            self.journal,
            self.coordinator,
            self.registry,
            scan_interval=0.02,
            stop_timeout=0.15,
        )
        self.origin = ExecutionOrigin("local:test")
        self.policies = {}
        self.manifest = parse_workspace_manifest("""
apiVersion: eigent.ai/v1alpha1
kind: WorkspaceBundle
metadata:
  id: bundle_controlled_tests
  name: Controlled worker tests
  revision: 1
spec:
  agents:
    - id: coordinator
      role: coordinator
      modelProfile: default
  models:
    default:
      modelRef: provider://controlled-fixture
      thinkingEffort: medium
""")
        self.journal.put_workspace_config_revision(
            revision_id=self.manifest.revision_id,
            bundle_id=self.manifest.metadata.id,
            revision_number=1,
            manifest=self.manifest.canonical_payload(),
            created_by="test",
        )

    def register(
        self, project, handler, *, space="space", git=False, source=None
    ):
        source = source or self.root / space
        source.mkdir(exist_ok=True)
        if git and not (source / ".git").exists():
            subprocess.run(
                ["git", "-c", "init.defaultBranch=main", "init", str(source)],
                check=True,
                capture_output=True,
                env={
                    "PATH": "/usr/bin:/bin",
                    "GIT_CONFIG_NOSYSTEM": "1",
                    "HOME": str(self.root),
                },
            )
        provider_type = (
            GitWorkspaceProvider if git else DirectoryWorkspaceProvider
        )
        kwargs = {"repository_root": source} if git else {}
        provider = provider_type(
            self.content,
            self.root / ("private-" + project),
            retention=self.state,
            **kwargs,
        )
        configuration = {
            "space_id": space,
            "model_platform": "controlled",
            "model_type": "fixture",
            "session_mode": "single-agent",
            "workspace_policy_version": "isolated-v1",
            "configuration_revision": self.manifest.revision_id,
            "credential_ref": "credential:fixture",
            "permission_profile_revision": "permission:fixture",
            "principal_ref": self.origin.principal_ref,
        }

        def resolve(request, workspace):
            spec = EnvironmentConfigResolver().resolve(
                manifest=self.manifest,
                owner_type="run",
                owner_id=request.request_id,
                local_materialization=LocalMaterialization(),
                provider_capability=ProviderModelCapability(
                    supported_efforts=(ThinkingEffort.MEDIUM,),
                    default_effort=ThinkingEffort.MEDIUM,
                    provider_mapping={ThinkingEffort.MEDIUM: "medium"},
                    capability_revision="fixture:v1",
                ),
                permission_profile_revision_override="permission:fixture",
            )
            self.journal.put_effective_environment_spec(spec)
            return RuntimeConfiguration(
                environment=AttemptEnvironmentBinding(
                    spec.spec_id,
                    spec.digest,
                    spec.bundle_revision_id,
                    spec.permission_profile_revision,
                    "medium",
                    "medium",
                    spec.provider_capability_revision,
                ),
                env={"ISOLATED_VALUE": project},
                handler=lambda runtime: handler(runtime, request),
            )

        policy = ExecutionPolicy(
            principal_ref=self.origin.principal_ref,
            configuration=configuration,
            source_root=source,
            provider=provider,
            resolve_runtime=resolve,
            authorize=lambda origin: (
                origin.principal_ref == self.origin.principal_ref
            ),
        )
        self.registry.register(project, policy)
        self.policies[project] = policy
        return policy

    async def submit(self, project, request, *, followup=False):
        envelope = dict(self.policies[project].configuration)
        kwargs = {}
        if followup:
            kwargs = {
                "source_follow_up_request_id": request,
                "follow_up_content": request,
            }
        else:
            envelope["prompt"] = request
        return await self.service.submit(
            request_id=request,
            project_id=project,
            kind="follow_up" if followup else "start",
            envelope=envelope,
            origin=self.origin,
            **kwargs,
        )

    def completed(self, request):
        run = self.journal.get_run(request)
        return run is not None and run.status == "completed"


@pytest_asyncio.fixture
async def world(tmp_path):
    world = World(tmp_path)
    try:
        yield world
    finally:
        await world.service.close()
        await world.coordinator.close()
        world.journal.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("git", [False, True])
@pytest.mark.parametrize(
    "topology", ["same-space", "cross-space", "shared-target"]
)
async def test_real_service_workers_overlap_and_automatically_publish(
    world, git, topology
):
    arrived, ready = {}, asyncio.Event()
    runtimes = []

    async def handler(runtime, request):
        runtimes.append(runtime)
        arrived[request.project_id] = runtime.binding.workspace.local_root
        if len(arrived) == 2:
            ready.set()
        await ready.wait()
        await runtime.execute_worker(
            [
                Op("write", "started-" + request.project_id, b"ready"),
                Op("sleep", seconds=0.4),
                Op(
                    "write",
                    "result-" + request.project_id,
                    environment_key="ISOLATED_VALUE",
                ),
            ],
            mutation_id="program",
        )
        return "completed " + request.project_id

    first = world.register("p1", handler, git=git)
    second = world.register(
        "p2",
        handler,
        git=git,
        space="space" if topology == "same-space" else "other-space",
        source=first.source_root if topology == "shared-target" else None,
    )
    original_environment, original_cwd = dict(os.environ), os.getcwd()
    await world.submit("p1", "r1")
    await world.submit("p2", "r2")
    await world.service.start()
    await asyncio.wait_for(ready.wait(), 8)
    await eventually(
        lambda: all(
            (path / ("started-" + project)).exists()
            for project, path in arrived.items()
        )
    )
    assert all(
        runtime._processes[0].process.returncode is None
        for runtime in runtimes
    )
    assert arrived["p1"] != arrived["p2"]
    assert all(
        path not in {first.source_root, second.source_root}
        for path in arrived.values()
    )
    await eventually(lambda: world.completed("r1") and world.completed("r2"))
    await eventually(
        lambda: (
            (first.source_root / "result-p1").exists()
            and (second.source_root / "result-p2").exists()
        )
    )
    assert (first.source_root / "result-p1").read_bytes() == b"p1"
    assert (second.source_root / "result-p2").read_bytes() == b"p2"
    with world.journal._lock:
        assert not world.journal._connection.execute(
            "SELECT 1 FROM workspace_revision_references WHERE owner LIKE 'preparation:%'"
        ).fetchone()
    assert (
        dict(os.environ) == original_environment
        and os.getcwd() == original_cwd
    )
    metadata = await world.service.artifacts("r1", origin=world.origin)
    artifact = next(
        a for a in metadata["artifacts"] if a["relativePath"] == "result-p1"
    )
    (arrived["p1"] / "result-p1").write_bytes(b"later private edits")
    (first.source_root / "result-p1").write_bytes(b"later target edits")
    assert (
        await world.service.read_artifact(
            "r1", artifact["artifact_id"], origin=world.origin
        )
        == b"p1"
    )
    with pytest.raises(ExecutionForbidden):
        await world.service.artifacts(
            "r1", origin=ExecutionOrigin("local:other")
        )


@pytest.mark.asyncio
async def test_session_fifo_followup_atomic_message_and_next_input(world):
    entered, release = asyncio.Event(), asyncio.Event()
    order = []

    async def handler(runtime, request):
        order.append(request.request_id)
        if request.request_id == "first":
            entered.set()
            await release.wait()
            await runtime.execute_worker(
                [Op("write", "first.txt", b"one")], mutation_id="first"
            )
        else:
            assert (
                runtime.binding.workspace.local_root / "first.txt"
            ).read_bytes() == b"one"
            await runtime.execute_worker(
                [Op("write", "second.txt", b"two")], mutation_id="second"
            )
        return request.request_id

    policy = world.register("p", handler)
    await world.submit("p", "first")
    await world.submit("p", "second", followup=True)
    await world.service.start()
    await asyncio.wait_for(entered.wait(), 5)
    assert world.service.admission.get("second").status == "pending"
    assert world.journal.get_run("second") is None
    assert order == ["first"]
    release.set()
    await eventually(lambda: world.completed("second"))
    assert order == ["first", "second"]
    with world.journal._lock:
        message = world.journal._connection.execute(
            "SELECT status,admitted_run_id FROM follow_up_requests WHERE request_id='second'"
        ).fetchone()
    assert tuple(message) == ("admitted", "second")
    await eventually(lambda: (policy.source_root / "second.txt").exists())
    with world.journal._lock:
        events = world.journal._connection.execute(
            "SELECT COUNT(*) FROM run_events WHERE run_id='second' AND event_type='user.message'"
        ).fetchone()[0]
    assert events == 1


@pytest.mark.asyncio
async def test_cancel_during_preparation_never_creates_run_or_dispatches(
    world, monkeypatch
):
    entered, release = threading.Event(), threading.Event()
    calls = []

    async def handler(_runtime, request):
        calls.append(request.request_id)
        return "unexpected"

    policy = world.register("p", handler)
    original = policy.provider.prepare

    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original(*args, **kwargs)

    monkeypatch.setattr(policy.provider, "prepare", blocked)
    await world.submit("p", "r")
    await world.service.start()
    await eventually(entered.is_set)
    try:
        result = await world.service.cancel("r", origin=world.origin)
        assert result.status == "cancelled"
    finally:
        release.set()
    await eventually(lambda: not world.service._tasks)
    assert calls == [] and world.journal.get_run("r") is None


@pytest.mark.asyncio
async def test_cancel_one_running_owner_keeps_other_session_running(world):
    entered = set()
    release = asyncio.Event()

    async def handler(runtime, request):
        entered.add(request.request_id)
        if request.request_id == "r1":
            await runtime.execute_worker(
                [Op("write", "partial", b"partial"), Op("sleep", seconds=10)],
                mutation_id="slow",
            )
        else:
            await release.wait()
        return "finished"

    world.register("p1", handler)
    world.register("p2", handler)
    await world.submit("p1", "r1")
    await world.submit("p2", "r2")
    await world.service.start()
    await eventually(lambda: entered == {"r1", "r2"})
    await world.service.cancel("r1", origin=world.origin)
    assert world.journal.get_run("r1").status == "cancelled"
    assert world.journal.get_run("r2").status == "running"
    release.set()
    await eventually(lambda: world.completed("r2"))
    with world.journal._lock:
        assert not world.journal._connection.execute(
            "SELECT 1 FROM workspace_integration_requests WHERE run_id='r1'"
        ).fetchone()


@pytest.mark.asyncio
async def test_revocation_during_prepare_does_not_activate(world, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    calls = []

    async def handler(_runtime, request):
        calls.append(request.request_id)
        return "unexpected"

    policy = world.register("p", handler)
    original = policy.resolve_runtime

    def blocked(*args):
        entered.set()
        assert release.wait(5)
        return original(*args)

    world.registry.revoke("p")
    replacement = replace(policy, resolve_runtime=blocked)
    world.registry.register("p", replacement)
    await world.submit("p", "r")
    await world.service.start()
    await eventually(entered.is_set)
    world.registry.revoke("p")
    release.set()
    await eventually(lambda: not world.service._tasks)
    assert world.journal.get_run("r") is None and calls == []


@pytest.mark.asyncio
async def test_resume_retains_existing_run_and_waits_for_recovery(world):
    async def handler(_runtime, _request):
        raise AssertionError("Resume must not invent a fresh Run")

    policy = world.register("p", handler)
    world.journal.ensure_run(
        run_id="existing", project_id="p", status="interrupted"
    )
    request = await world.service.submit(
        request_id="resume-request",
        project_id="p",
        kind="resume",
        target_run_id="existing",
        envelope=dict(policy.configuration),
        origin=world.origin,
    )
    await world.service.start()
    assert request.target_run_id == "existing"
    assert world.journal.get_run("resume-request") is None
    assert (
        world.service.admission.claim("resume-request", owner_id="other")
        is None
    )


@pytest.mark.asyncio
async def test_startup_keeps_foreign_claim_and_reports_recovery(world):
    async def handler(_runtime, _request):
        return "never"

    world.register("p", handler)
    await world.submit("p", "r")
    original = world.service.admission.claim("r", owner_id="crashed-owner")
    await world.service.start()
    assert world.service.admission.get_claim("p") == original
    assert world.service.recovery_facts["unverified_claims"] == ("r",)
    assert world.journal.get_run("r") is None


@pytest.mark.asyncio
async def test_cancel_before_activation_never_enters_handler(
    world, monkeypatch
):
    registered, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def handler(_runtime, _request):
        calls.append("entered")
        return "unexpected"

    world.register("p", handler)
    original = world.coordinator.register_dormant

    async def blocked(**kwargs):
        handle = await original(**kwargs)
        registered.set()
        await release.wait()
        return handle

    monkeypatch.setattr(world.coordinator, "register_dormant", blocked)
    await world.submit("p", "r")
    await world.service.start()
    await asyncio.wait_for(registered.wait(), 5)
    cancellation = asyncio.create_task(
        world.service.cancel("r", origin=world.origin)
    )
    await eventually(
        lambda: world.journal.get_run("r").cancel_request_id is not None
    )
    release.set()
    await asyncio.wait_for(cancellation, 5)
    assert calls == []
    assert world.journal.get_run("r").status == "cancelled"
    assert world.service.admission.get_claim("p").state == "released"


@pytest.mark.asyncio
async def test_cancel_during_finalization_does_not_orphan_capture(
    world, monkeypatch
):
    from app.workspace_runtime.finalizer import WorkspaceFinalizer

    entered, release = threading.Event(), threading.Event()
    original = WorkspaceFinalizer._checkpoint

    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original(*args, **kwargs)

    monkeypatch.setattr(WorkspaceFinalizer, "_checkpoint", blocked)

    async def handler(runtime, _request):
        await runtime.execute_worker(
            [Op("write", "result", b"partial")], mutation_id="write"
        )
        return "done"

    world.register("p", handler)
    await world.submit("p", "r")
    await world.service.start()
    await eventually(entered.is_set)
    cancellation = asyncio.create_task(
        world.service.cancel("r", origin=world.origin)
    )
    await eventually(
        lambda: world.journal.get_run("r").cancel_request_id is not None
    )
    release.set()
    await asyncio.wait_for(cancellation, 5)
    assert world.journal.get_run("r").status == "cancelled"
    with world.journal._lock:
        assert (
            world.journal._connection.execute(
                "SELECT state FROM run_workspace_finalizations WHERE run_id='r'"
            ).fetchone()[0]
            == "settled"
        )
        assert not world.journal._connection.execute(
            "SELECT 1 FROM workspace_integration_requests WHERE run_id='r'"
        ).fetchone()


@pytest.mark.asyncio
async def test_unknown_writer_retains_barrier_across_service_restart(world):
    async def unsafe(runtime, _request):
        runtime.flag_unmanaged_writer()
        return "not verified"

    async def safe(_runtime, _request):
        return "done"

    world.register("p", unsafe)
    world.register("other", safe)
    await world.submit("p", "r")
    await world.submit("p", "later")
    await world.submit("other", "independent")
    await world.service.start()
    await eventually(
        lambda: world.completed("independent") and not world.service._tasks
    )
    assert world.journal.get_run("later") is None
    with world.journal._lock:
        final = world.journal._connection.execute(
            "SELECT state,writer_settlement_json,manifest_digest FROM run_workspace_finalizations WHERE run_id='r'"
        ).fetchone()
    assert tuple(final) == ("needs_attention", None, None)
    await world.service.close()
    replacement = ExecutionService(
        world.journal, world.coordinator, world.registry, scan_interval=0.02
    )
    try:
        await replacement.start()
        assert replacement.admission.claim("later", owner_id="retry") is None
        assert world.journal.get_run("later") is None
        assert replacement.admission.get_claim("p").state == "handed_off"
    finally:
        await replacement.close()


@pytest.mark.asyncio
async def test_unregistered_credential_reference_is_never_persisted(world):
    async def handler(_runtime, _request):
        return "unused"

    policy = world.register("p", handler)
    with pytest.raises(ExecutionForbidden):
        await world.service.submit(
            request_id="r",
            project_id="p",
            kind="start",
            envelope={
                **policy.configuration,
                "credential_ref": "untrusted-secret-value",
                "prompt": "test",
            },
            origin=world.origin,
        )
    assert world.service.admission.get("r") is None


@pytest.mark.asyncio
async def test_http_routes_use_real_registered_service_and_immutable_artifacts(
    world, monkeypatch
):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.auth import LocalControlPrincipal, require_local_control_principal
    from app.controller import execution_controller

    async def handler(runtime, _request):
        await runtime.execute_worker(
            [Op("write", "report.txt", b"immutable")], mutation_id="write"
        )
        return "done"

    policy = world.register("p", handler)
    app = FastAPI()
    app.include_router(execution_controller.router)
    app.dependency_overrides[require_local_control_principal] = lambda: (
        LocalControlPrincipal(kind="local", user_id="test")
    )
    monkeypatch.setattr(
        execution_controller,
        "get_default_execution_service",
        lambda: world.service,
    )
    await world.service.start()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        body = {
            "request_id": "r",
            "kind": "start",
            "envelope": {**policy.configuration, "prompt": "create report"},
        }
        first = await client.post("/projects/p/executions", json=body)
        assert first.status_code == 202
        assert "credential_ref" not in first.text
        duplicate = await client.post("/projects/p/executions", json=body)
        assert duplicate.status_code == 202
        await eventually(lambda: world.completed("r"))
        metadata = await client.get("/executions/r/artifacts")
        assert metadata.status_code == 200
        artifact = metadata.json()["artifacts"][0]
        response = await client.get(
            "/executions/r/artifacts/" + artifact["artifact_id"] + "/content"
        )
        assert response.status_code == 200 and response.content == b"immutable"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert (
            await client.get("/executions/r/artifacts/../content")
        ).status_code == 404


@pytest.mark.asyncio
async def test_changed_target_policy_cannot_publish_older_outbox(
    world, monkeypatch
):
    async def handler(runtime, _request):
        await runtime.execute_worker(
            [Op("write", "report", b"old source output")], mutation_id="write"
        )
        return "done"

    policy = world.register("p", handler)
    monkeypatch.setattr(world.service, "_dispatch_publications", lambda: None)
    await world.submit("p", "r")
    await world.service.start()
    await eventually(lambda: world.completed("r"))
    with world.journal._lock:
        integration_id = world.journal._connection.execute(
            "SELECT request_id FROM workspace_integration_requests WHERE run_id='r'"
        ).fetchone()[0]
    new_root = world.root / "new-permitted-root"
    new_root.mkdir()
    world.registry.revoke("p")
    world.registry.register("p", replace(policy, source_root=new_root))
    await world.service._publish(integration_id, "r")
    assert not (policy.source_root / "report").exists()
    assert not (new_root / "report").exists()
    with world.journal._lock:
        request = world.journal._connection.execute(
            "SELECT status,wait_reason FROM workspace_integration_requests WHERE request_id=?",
            (integration_id,),
        ).fetchone()
    assert tuple(request) == ("waiting", "authorization_required")


@pytest.mark.asyncio
async def test_cancelled_close_waiter_cannot_orphan_preparation_thread(
    world, monkeypatch
):
    entered, release = threading.Event(), threading.Event()

    async def handler(_runtime, _request):
        raise AssertionError("shutdown must not launch the prepared runtime")

    policy = world.register("p", handler)
    original = policy.provider.prepare

    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original(*args, **kwargs)

    monkeypatch.setattr(policy.provider, "prepare", blocked)
    await world.submit("p", "r")
    await world.service.start()
    await eventually(entered.is_set)
    close = asyncio.create_task(world.service.close())
    await eventually(lambda: world.service._closing)
    close.cancel()
    with pytest.raises(asyncio.CancelledError):
        await close
    assert "r" in world.service._tasks
    assert not world.service._tasks["r"].done()
    release.set()
    await asyncio.wait_for(world.service.close(), 5)
    assert not world.service._tasks
    assert world.service.admission.get_claim("p").state == "released"
    assert world.journal.get_run("r") is None


@pytest.mark.asyncio
async def test_second_process_startup_cannot_invalidate_live_activation(
    world, monkeypatch
):
    registered, release = asyncio.Event(), asyncio.Event()

    async def handler(_runtime, _request):
        return "done"

    world.register("p", handler)
    original = world.coordinator.register_dormant

    async def blocked(**kwargs):
        result = await original(**kwargs)
        registered.set()
        await release.wait()
        return result

    monkeypatch.setattr(world.coordinator, "register_dormant", blocked)
    await world.submit("p", "r")
    await world.service.start()
    await asyncio.wait_for(registered.wait(), 5)
    with SQLiteRunJournal(world.journal.path) as observer:
        coordinator = RunCoordinator(observer)
        service = ExecutionService(
            observer, coordinator, world.registry, scan_interval=0.02
        )
        try:
            await service.start()
            assert service.recovery_facts["unverified_runs"] == ("r",)
            with observer._lock:
                assert (
                    observer._connection.execute(
                        "SELECT state FROM run_workspace_finalizations WHERE run_id='r'"
                    ).fetchone()[0]
                    == "pending"
                )
            release.set()
            await eventually(lambda: world.completed("r"))
        finally:
            release.set()
            await service.close()
            await coordinator.close()


@pytest.mark.asyncio
async def test_followup_message_and_request_rollback_together(world):
    async def handler(_runtime, _request):
        return "unused"

    policy = world.register("p", handler)
    with pytest.raises(ValueError):
        await world.service.submit(
            request_id="r",
            project_id="p",
            kind="follow_up",
            envelope=dict(policy.configuration),
            origin=world.origin,
            source_follow_up_request_id="mismatched",
            follow_up_content="message",
        )
    assert world.service.admission.get("r") is None
    with world.journal._lock:
        assert not world.journal._connection.execute(
            "SELECT 1 FROM follow_up_requests WHERE request_id='r'"
        ).fetchone()


@pytest.mark.asyncio
async def test_foreign_cancel_is_consumed_and_forbids_late_worker(world):
    entered, release = asyncio.Event(), asyncio.Event()
    roots = []

    async def handler(runtime, _request):
        roots.append(runtime.binding.workspace.local_root)
        entered.set()
        await release.wait()
        await runtime.execute_worker(
            [Op("write", "after-cancel", b"must not write")],
            mutation_id="late",
        )
        return "unexpected"

    world.register("p", handler)
    await world.submit("p", "r")
    await world.service.start()
    await asyncio.wait_for(entered.wait(), 5)
    with SQLiteRunJournal(world.journal.path) as observer:
        coordinator = RunCoordinator(observer)
        other = ExecutionService(observer, coordinator, world.registry)
        try:
            await other.cancel("r", origin=world.origin)
            assert observer.get_run("r").cancel_request_id is not None
            release.set()
            await eventually(
                lambda: world.journal.get_run("r").status == "cancelled"
            )
            assert not (roots[0] / "after-cancel").exists()
        finally:
            release.set()
            await other.close()
            await coordinator.close()


@pytest.mark.asyncio
async def test_revoked_live_owner_stops_without_request_authorization(world):
    entered = asyncio.Event()

    async def handler(runtime, _request):
        entered.set()
        await runtime.cancelled.wait()
        return "stopped after revocation"

    world.register("p", handler)
    await world.submit("p", "r")
    await world.service.start()
    await asyncio.wait_for(entered.wait(), 5)
    world.registry.revoke("p")
    await eventually(lambda: world.journal.get_run("r").status == "cancelled")
    assert world.service.admission.get_claim("p").state == "released"


@pytest.mark.asyncio
@pytest.mark.parametrize("git", [False, True])
async def test_partial_successor_publication_retries_after_predecessor(
    world, monkeypatch, git
):
    dispatch = world.service._dispatch_publications
    monkeypatch.setattr(world.service, "_dispatch_publications", lambda: None)

    async def handler(runtime, request):
        await runtime.execute_worker(
            [Op("write", "x.txt", request.request_id.encode())],
            mutation_id=request.request_id + "-x",
        )
        if request.request_id == "r2":
            await runtime.execute_worker(
                [Op("write", "y.txt", b"independent-r2")],
                mutation_id="r2-y",
            )
        return request.request_id

    policy = world.register("p", handler, git=git)
    await world.submit("p", "r1")
    await world.submit("p", "r2", followup=True)
    await world.service.start()
    await eventually(lambda: world.completed("r2"))
    with world.journal._lock:
        requests = {
            row["run_id"]: row["request_id"]
            for row in world.journal._connection.execute(
                "SELECT request_id,run_id FROM workspace_integration_requests"
            )
        }

    def publication_status(run_id):
        with world.journal._lock:
            return world.journal._connection.execute(
                "SELECT status FROM workspace_integration_requests WHERE run_id=?",
                (run_id,),
            ).fetchone()[0]

    # Publication workers may acquire the target in either completion order.
    await world.service._publish(requests["r2"], "r2")
    assert publication_status("r2") == "partially_integrated"
    assert (policy.source_root / "y.txt").read_bytes() == b"independent-r2"
    assert not (policy.source_root / "x.txt").exists()
    await world.service._publish(requests["r1"], "r1")
    assert (policy.source_root / "x.txt").read_bytes() == b"r1"

    monkeypatch.setattr(world.service, "_dispatch_publications", dispatch)
    world.service._wake.set()
    await eventually(lambda: publication_status("r2") == "integrated")
    assert (policy.source_root / "x.txt").read_bytes() == b"r2"
    assert (policy.source_root / "y.txt").read_bytes() == b"independent-r2"


@pytest.mark.asyncio
async def test_partial_publication_with_only_conflicts_waits_for_resolution(
    world, monkeypatch
):
    dispatch = world.service._dispatch_publications
    monkeypatch.setattr(world.service, "_dispatch_publications", lambda: None)

    async def handler(runtime, _request):
        for path in ("x.txt", "y.txt"):
            await runtime.execute_worker(
                [Op("write", path, b"agent")], mutation_id=path
            )
        return "done"

    policy = world.register("p", handler)
    await world.submit("p", "r")
    await world.service.start()
    await eventually(lambda: world.completed("r"))
    (policy.source_root / "x.txt").write_bytes(b"user")
    with world.journal._lock:
        request = world.journal._connection.execute(
            "SELECT request_id FROM workspace_integration_requests WHERE run_id='r'"
        ).fetchone()[0]
    await world.service._publish(request, "r")
    with world.journal._write_transaction() as connection:
        assert (
            connection.execute(
                "SELECT status FROM workspace_integration_requests WHERE request_id=?",
                (request,),
            ).fetchone()[0]
            == "partially_integrated"
        )
        assert {
            row[0]
            for row in connection.execute(
                "SELECT status FROM workspace_integration_paths WHERE request_id=?",
                (request,),
            )
        } == {"conflict", "integrated"}
        connection.execute(
            "UPDATE workspace_integration_requests SET retry_after_at=0 WHERE request_id=?",
            (request,),
        )
    dispatch()
    assert not world.service._publications
    assert (policy.source_root / "x.txt").read_bytes() == b"user"
    assert (policy.source_root / "y.txt").read_bytes() == b"agent"


@pytest.mark.asyncio
@pytest.mark.parametrize("stop", ["cancel", "close", "dispatcher"])
async def test_terminal_fact_does_not_skip_stopping_live_writer(
    world, monkeypatch, stop
):
    runtimes = []
    if stop != "dispatcher":
        monkeypatch.setattr(
            world.service, "_dispatch_cancellations", lambda: None
        )

    async def handler(runtime, _request):
        runtimes.append(runtime)
        await runtime.execute_worker(
            [
                Op("write", "started", b"ready"),
                Op("sleep", seconds=2),
                Op("write", "after-cancel", b"late"),
            ],
            mutation_id="live-writer",
        )
        return "finished"

    world.register("p", handler)
    await world.submit("p", "r")
    await world.service.start()
    await eventually(
        lambda: (
            runtimes
            and (runtimes[0].binding.workspace.local_root / "started").exists()
        )
    )
    runtime = runtimes[0]
    now = time.time()
    world.journal.set_timeout_policy(
        "r", RunTimeoutPolicy(run_deadline_at=now - 1)
    )
    world.journal.record_timeout_outcome(
        TimeoutOutcome(
            scope=TimeoutScope.RUN_DEADLINE,
            policy_version="v1",
            reason="run_deadline_reached",
            started_at=now - 2,
            ended_at=now,
            run_id="r",
            attempt_id=runtime.binding.attempt_id,
        )
    )
    assert world.journal.get_run("r").status == "failed"
    if stop == "cancel":
        await world.service.cancel("r", origin=world.origin)
    elif stop == "close":
        await world.service.close()
    await eventually(
        lambda: world.service.admission.get_claim("p").state == "released"
    )
    assert world.journal.get_run("r").status == "failed"
    assert runtime.sealed
    assert all(
        item.process.returncode is not None for item in runtime._processes
    )
    assert not (runtime.binding.workspace.local_root / "after-cancel").exists()
    with world.journal._lock:
        assert (
            world.journal._connection.execute(
                "SELECT state FROM run_workspace_finalizations WHERE run_id='r'"
            ).fetchone()[0]
            == "settled"
        )
        assert not world.journal._connection.execute(
            "SELECT 1 FROM workspace_integration_requests WHERE run_id='r'"
        ).fetchone()


@pytest.mark.asyncio
@pytest.mark.parametrize("git", [False, True])
async def test_resolver_failure_cleans_preparation_before_retry_and_cancel(
    world, git
):
    async def handler(_runtime, _request):
        raise AssertionError("unavailable resolver must not dispatch")

    policy = world.register("p", handler, git=git)
    (policy.source_root / "source.txt").write_bytes(b"x" * 4096)
    if git:
        environment = {
            "PATH": "/usr/bin:/bin",
            "HOME": str(world.root),
            "GIT_CONFIG_NOSYSTEM": "1",
        }
        for arguments in (
            ["add", "source.txt"],
            [
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "-m",
                "fixture source",
            ],
        ):
            subprocess.run(
                ["git", "-C", str(policy.source_root), *arguments],
                check=True,
                capture_output=True,
                env=environment,
            )
    attempts = []

    def unavailable(_request, workspace):
        attempts.append(workspace.local_root)
        assert all(not previous.exists() for previous in attempts[:-1])
        raise ExecutionUnavailable("credential_temporarily_unavailable")

    world.registry.revoke("p")
    world.registry.register("p", replace(policy, resolve_runtime=unavailable))
    await world.submit("p", "r")
    await world.service.start()
    await eventually(lambda: len(attempts) >= 3)
    await world.service.cancel("r", origin=world.origin)
    await world.service.close()
    assert all(not path.exists() for path in attempts)
    assert not tuple(policy.provider.workspace_root.iterdir())
    assert world.journal.get_run("r") is None
    with world.journal._lock:
        assert not world.journal._connection.execute(
            "SELECT 1 FROM workspace_revision_references WHERE owner LIKE 'preparation:%'"
        ).fetchone()
    assert (policy.source_root / "source.txt").read_bytes() == b"x" * 4096


@pytest.mark.asyncio
async def test_unsafe_preparation_cleanup_waits_without_recopying(world):
    async def handler(_runtime, _request):
        raise AssertionError("unavailable resolver must not dispatch")

    policy = world.register("p", handler, git=True)
    # This legitimate untracked overlay prevents ordinary Git worktree removal.
    (policy.source_root / "source.txt").write_bytes(b"user overlay")
    attempts = []

    def unavailable(_request, workspace):
        attempts.append(workspace.local_root)
        raise ExecutionUnavailable("credential_temporarily_unavailable")

    world.registry.revoke("p")
    world.registry.register("p", replace(policy, resolve_runtime=unavailable))
    await world.submit("p", "r")
    await world.service.start()
    await eventually(
        lambda: (
            world.service.admission.get("r").wait_reason
            == "preparation_cleanup_required"
            and not world.service._tasks
        )
    )
    await asyncio.sleep(1.2)
    assert len(attempts) == 1

    async def other_session(_runtime, _request):
        return "other Session remains available"

    world.register("p2", other_session, git=True)
    await world.submit("p2", "r2")
    await eventually(lambda: world.completed("r2"))
    await world.service.close()
    # Restart observes the same durable wait and cannot allocate a new copy.
    service = ExecutionService(
        world.journal, world.coordinator, world.registry, scan_interval=0.02
    )
    try:
        await service.start()
        await asyncio.sleep(1.2)
        assert len(attempts) == 1
        await service.cancel("r", origin=world.origin)
    finally:
        await service.close()
    assert world.journal.get_run("r") is None
    assert (attempts[0] / "source.txt").read_bytes() == b"user overlay"
    assert (policy.source_root / "source.txt").read_bytes() == b"user overlay"
    with world.journal._lock:
        assert world.journal._connection.execute(
            "SELECT 1 FROM workspace_revision_references WHERE owner LIKE 'preparation:%'"
        ).fetchone()
