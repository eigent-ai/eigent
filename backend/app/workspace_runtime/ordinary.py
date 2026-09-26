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

"""Workspace protocol adapter for ordinary Single Agent Runs.

The existing chat/follow-up queue still owns submission and FIFO. This adapter
only binds its pending Attempt, retains output, and feeds the existing durable
integration outbox. Historical direct-write Runs keep their original binding.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from pathlib import Path

from app.run_journal.models import RunEventDraft

from .content import ContentStore, canonical_json, content_digest
from .execution import publication_execution
from .finalizer import WorkspaceFinalizer
from .git_provider import GitWorkspaceProvider
from .integration import WorkspaceIntegrationCoordinator
from .native_runtime import NATIVE_POLICY_VERSION, NativeRunOwner
from .provider import (
    DirectoryWorkspaceProvider,
    PreparationIdentity,
    SourceChangedError,
    SourceFence,
    SourceWaitingForSettlementError,
    WorkspaceHandle,
)
from .session_input import compose_session_input
from .store import TargetFence, WorkspaceBusy, WorkspaceStateStore


def ordinary_provider(journal, source_root=None):
    state = WorkspaceStateStore(journal)
    root = journal.path.parent / "ordinary-executions"
    if source_root is not None and (Path(source_root) / ".git").exists():
        provider = GitWorkspaceProvider(
            ContentStore(root / "objects"),
            root / "workspaces",
            retention=state,
            repository_root=Path(source_root),
        )
    else:
        provider = DirectoryWorkspaceProvider(
            ContentStore(root / "objects"),
            root / "workspaces",
            retention=state,
        )
    if source_root is not None:
        from app.workspace_git.path_policy import (
            OPERATIONAL_DIRECTORIES,
            WorkspacePathPolicy,
        )

        source = Path(source_root)
        paths = WorkspacePathPolicy(source)

        def excluded(path, is_directory):
            operational = paths.is_operational(
                path + "/" if is_directory else path
            )
            if (
                Path(path).name in OPERATIONAL_DIRECTORIES
                and (source / path).is_symlink()
            ):
                operational = True
            if not operational:
                return False
            return not (
                isinstance(provider, GitWorkspaceProvider)
                and provider.git.is_tracked(source, source / path)
            )

        provider.exclude_path = excluded
    return provider


def source_fence(target):
    return SourceFence(
        target.target_id,
        target.physical_identity,
        target.write_epoch,
        target.settled_revision,
        target.receipt_cursor,
        target.state,
        target.owner_id,
        target.binding_version,
    )


@dataclass(frozen=True)
class OrdinaryWorkspace:
    owner: NativeRunOwner
    provider: DirectoryWorkspaceProvider
    target: TargetFence
    handle: WorkspaceHandle
    preparation_identity: PreparationIdentity

    def admit(self, journal, *, request_id, reason, environment=None):
        state = WorkspaceStateStore(journal)
        with (
            publication_execution(
                journal.path, "preparation:" + self.owner.attempt_id
            ),
            journal._write_transaction() as connection,
        ):
            attempt = journal._create_run_attempt_in_transaction(
                connection,
                self.owner.run_id,
                request_id=request_id,
                reason=reason,
                attempt_id=self.owner.attempt_id,
                activate=False,
                environment=environment,
            )
            if attempt.attempt_id != self.owner.attempt_id:
                raise RuntimeError(
                    "ordinary workspace cannot replace an existing Attempt"
                )
            self._bind(state, connection)
        self._release_preparation(state)
        return attempt

    def _bind(self, state, connection):
        state.bind_run_in_transaction(
            connection,
            run_id=self.owner.run_id,
            attempt_id=self.owner.attempt_id,
            generation=self.handle.generation,
            workspace_id=self.handle.workspace_id,
            provider=self.handle.provider,
            snapshot_revision=self.handle.input_revision,
            root_path=str(self.handle.local_root),
            target=self.target,
            policy_version=NATIVE_POLICY_VERSION,
        )

    def _release_preparation(self, state):
        # Composition can retain both the captured source and Session input.
        with state.journal._write_transaction() as connection:
            connection.execute(
                "DELETE FROM workspace_revision_references WHERE owner=?",
                ("preparation:" + self.owner.attempt_id,),
            )

    def discard_unadmitted(self, journal):
        def unadmitted():
            with journal._lock:
                row = journal._connection.execute(
                    """SELECT 1 FROM run_workspace_bindings
                    WHERE workspace_id=? OR root_path=? OR attempt_id=?
                    UNION ALL SELECT 1 FROM run_attempts WHERE attempt_id=?""",
                    (
                        self.handle.workspace_id,
                        str(self.handle.local_root),
                        self.owner.attempt_id,
                        self.owner.attempt_id,
                    ),
                ).fetchone()
            if row is not None:
                raise RuntimeError(
                    "admitted workspaces must retain their finalizer"
                )

        with publication_execution(
            journal.path, "preparation:" + self.owner.attempt_id
        ):
            self.provider.discard_prepared_workspace(
                self.handle,
                self.preparation_identity,
                assert_unadmitted=unadmitted,
            )
            self._release_preparation(WorkspaceStateStore(journal))

    def bind(self, journal):
        state = WorkspaceStateStore(journal)
        with journal._write_transaction() as connection:
            self._bind(state, connection)
        self._release_preparation(state)


def prepare_ordinary_workspace(journal, *, owner, source_root):
    state = WorkspaceStateStore(journal)
    with journal._lock:
        if journal._connection.execute(
            "SELECT 1 FROM workspace_revision_references WHERE owner=?",
            ("preparation:" + owner.attempt_id,),
        ).fetchone():
            raise RuntimeError(
                "existing preparation requires explicit recovery"
            )
    provider = ordinary_provider(journal, source_root)
    target = state.register_target(Path(source_root))
    fence = state.capture_fence(target.target_id)
    snapshot = provider.capture_source(
        Path(source_root),
        owner=owner.attempt_id,
        expected_fence=source_fence(fence),
        read_fence=lambda: source_fence(state.capture_fence(target.target_id)),
        commit_capture=lambda captured, _fence: state.accept_capture(
            fence, captured.revision_id, "preparation:" + owner.attempt_id
        ),
    )
    try:
        snapshot = compose_session_input(
            state, provider, owner.project_id, fence, snapshot
        )
    except BaseException:
        # No private materialization has started. Retire only the capture
        # reference created by this live preparation; saved Run output stays.
        with journal._write_transaction() as connection:
            connection.execute(
                "DELETE FROM workspace_revision_references WHERE owner=?",
                ("preparation:" + owner.attempt_id,),
            )
        raise
    handle = provider.prepare(snapshot, owner=owner.attempt_id, generation=1)
    return OrdinaryWorkspace(
        owner, provider, fence, handle, provider.preparation_identity(handle)
    )


async def drain_task(task):
    """Retain a concrete I/O operation through repeated waiter cancellation."""
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            continue
    return task.result()


async def prepare_ordinary_workspace_async(journal, *, owner, source_root):
    while True:
        run = await asyncio.to_thread(journal.get_run, owner.run_id)
        if run is not None and run.cancel_request_id:
            raise asyncio.CancelledError(
                "Run stopped before workspace admission"
            )
        if run is not None:
            await asyncio.to_thread(
                journal.append_event,
                owner.run_id,
                RunEventDraft(
                    event_id="ordinary-preparing:" + owner.run_id,
                    event_type="run.preparing",
                    payload={"phase": "workspace_preparation"},
                ),
            )
        try:
            return await _capture_ordinary_workspace_async(
                journal, owner=owner, source_root=source_root
            )
        except (
            WorkspaceBusy,
            SourceChangedError,
            SourceWaitingForSettlementError,
        ):
            # Only stable source capture waits here. Session content conflicts
            # and invalid/oversized sources require action, not another copy.
            if run is not None:
                await asyncio.to_thread(
                    journal.append_event,
                    owner.run_id,
                    RunEventDraft(
                        event_id="ordinary-source-wait:" + owner.attempt_id,
                        event_type="workspace.preparation.waiting",
                        payload={"reason": "source_waiting_for_settlement"},
                    ),
                )
            await asyncio.sleep(0.25)


async def _capture_ordinary_workspace_async(journal, *, owner, source_root):
    task = asyncio.create_task(
        asyncio.to_thread(
            prepare_ordinary_workspace,
            journal,
            owner=owner,
            source_root=source_root,
        )
    )
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError as cancelled:
        # A cancelled to_thread waiter does not stop capture/materialization.
        # Join it before discarding only this live, unadmitted preparation.
        try:
            workspace = await drain_task(task)
        except Exception:
            # Any uncertain partial resources keep their retention references.
            raise cancelled
        cleanup = asyncio.create_task(
            asyncio.to_thread(workspace.discard_unadmitted, journal)
        )
        await drain_task(cleanup)
        raise


async def finalize_ordinary_workspace(
    journal, workspace, runtime, result, outcome
):
    await WorkspaceFinalizer(journal).finalize(
        workspace.owner,
        runtime,
        workspace.provider,
        result,
        outcome,
    )
    await asyncio.to_thread(
        publish_ordinary_workspace, journal, workspace.owner.run_id
    )


async def finalize_task_lock_workspace(task_lock, *, result="", outcome):
    workspace = getattr(task_lock, "ordinary_workspace", None)
    runtime = getattr(task_lock, "ordinary_runtime", None)
    context = getattr(task_lock, "run_context", None)
    if (
        not isinstance(workspace, OrdinaryWorkspace)
        or context is None
        or workspace.owner.run_id != context.run_id
    ):
        return False
    if runtime is None or runtime.binding.run_id != context.run_id:
        raise RuntimeError("ordinary Run has no live writer settlement owner")
    from app.run_journal.runtime import get_default_run_journal

    lock = getattr(task_lock, "ordinary_finalizing", None)
    if lock is None:
        lock = task_lock.ordinary_finalizing = asyncio.Lock()
    async with lock:
        await finalize_ordinary_workspace(
            get_default_run_journal(),
            workspace,
            runtime,
            result,
            outcome,
        )
    return True


def publish_ordinary_workspace(journal, run_id):
    """Drive retained outbox work; output stays available on merge conflicts."""
    state = WorkspaceStateStore(journal)
    binding = ordinary_binding(journal, run_id)
    if binding is None:
        return []
    target = state.target(binding["target_id"])
    provider = ordinary_provider(journal, target.root_path)

    def authorized(request):
        with journal._lock:
            row = journal._connection.execute(
                """SELECT b.target_id,b.target_binding_version,b.policy_version,
                f.state,f.outcome,r.project_id FROM run_workspace_bindings b
                JOIN run_workspace_finalizations f ON f.run_id=b.run_id
                JOIN runs r ON r.run_id=b.run_id
                WHERE b.run_id=? AND b.attempt_id=f.owner_attempt_id
                AND b.generation=f.generation""",
                (request["run_id"],),
            ).fetchone()
        owned = row is not None and tuple(row) == (
            request["target_id"],
            request["target_binding_version"],
            NATIVE_POLICY_VERSION,
            "settled",
            "completed",
            request["project_id"],
        )
        return owned and ordinary_publication_authorized(journal, binding)

    with journal._lock:
        requests = journal._connection.execute(
            """SELECT request_id FROM workspace_integration_requests
            WHERE run_id=? AND status IN
            ('pending','waiting','waiting_target_stable','partially_integrated')
            AND worker_id IS NULL AND retry_after_at<=?""",
            (run_id, time.time()),
        ).fetchall()
    coordinator = WorkspaceIntegrationCoordinator(
        state, provider, authorize=authorized
    )
    results = []
    for row in requests:
        result = coordinator.process(row[0])
        payload = {
            "request_id": result.request_id,
            "status": result.status,
            "revision": result.revision,
            "wait_reason": result.wait_reason,
        }
        journal.append_event(
            run_id,
            RunEventDraft(
                event_id="ordinary-integration:"
                + content_digest(canonical_json(payload)),
                event_type="workspace.integration.updated",
                payload=payload,
            ),
        )
        results.append(result)
    return results


def ordinary_publication_authorized(journal, binding):
    """Respect a changed Space permission profile at every publication fence."""
    from app.permission_policy import PermissionPolicyService

    attempt = journal.get_run_attempt(binding["attempt_id"])
    if attempt is None or not attempt.environment_spec_id:
        return False
    spec = journal.get_effective_environment_spec(attempt.environment_spec_id)
    if spec is None or spec.owner_id != binding["run_id"]:
        return False
    space_id = spec.spec["semantic_spec"]["runtime_capability_manifest"][
        "workspace"
    ]["space_id"]
    current = PermissionPolicyService(journal).profile_for_space(space_id)
    # Bundle presets remain authority unless a Space policy overrides them.
    configured = journal.get_space_permission_profile(space_id)
    return (
        configured is None
        and not attempt.permission_profile_revision.startswith("space:")
    ) or current.revision == attempt.permission_profile_revision


def ordinary_binding(journal, run_id):
    with journal._lock:
        row = journal._connection.execute(
            "SELECT * FROM run_workspace_bindings WHERE run_id=? AND policy_version=?",
            (run_id, NATIVE_POLICY_VERSION),
        ).fetchone()
    return dict(row) if row is not None else None
