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

"""Opt-in durable execution for registered, controlled worker adapters.

HTTP callers supply intent references only. Trusted deployment code registers
the exact Project policy and resolves immutable environment specs; legacy CAMEL
factories are deliberately not inferred from request bodies or active UI state.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import TYPE_CHECKING, Any

from .admission import (
    AdmissionConflict,
    AdmissionError,
    AdmissionFenceLost,
    AdmissionStore,
    ExecutionRequest,
    InvalidExecutionEnvelope,
    validate_envelope,
)
from .authorization_check import run_authorization_check
from .bound_runtime import BoundRuntime, RuntimeBinding
from .preparation import PreparationResources
from .provider import DirectoryWorkspaceProvider, SourceFence, WorkspaceHandle
from .store import WorkspaceStateStore

if TYPE_CHECKING:
    from app.run_journal import SQLiteRunJournal
    from app.run_journal.models import AttemptEnvironmentBinding
    from app.run_runtime import RunCoordinator, RuntimeHandle

logger = logging.getLogger(__name__)


class ExecutionUnavailable(AdmissionError):
    pass


class ExecutionForbidden(AdmissionError):
    pass


@dataclass(frozen=True)
class ExecutionOrigin:
    principal_ref: str
    source: str = "local"
    source_command_id: str | None = None
    hands_capability_ref: str | None = None


@dataclass(frozen=True)
class RuntimeConfiguration:
    environment: AttemptEnvironmentBinding
    env: Mapping[str, str]
    handler: Callable[[BoundRuntime], Awaitable[str]]
    configuration_revision: str | None = None

    def __post_init__(self):
        object.__setattr__(self, "env", MappingProxyType(dict(self.env)))


@dataclass(frozen=True)
class ExecutionPolicy:
    """Trusted, explicit registration; never deserialized from an API body.

    configuration contains the exact accepted envelope configuration (without
    prompt/project_id). resolve_runtime must persist a Run-owned EnvironmentSpec
    for these revisions and explicit workspace; it cannot use a latest/UI lookup.
    The adapter may dispatch only BoundRuntime's sealed worker operations.
    """

    principal_ref: str
    configuration: Mapping[str, Any]
    source_root: Path
    provider: DirectoryWorkspaceProvider
    resolve_runtime: Callable[
        [ExecutionRequest, WorkspaceHandle], RuntimeConfiguration
    ]
    sources: frozenset[str] = frozenset({"local"})
    # A concrete source-and-target permission check, rerun before each dispatch.
    authorize: Callable[[ExecutionOrigin], bool] = lambda _origin: False
    refresh_authorization: Callable[[], Awaitable[bool]] | None = None
    authorize_control: Callable[[ExecutionOrigin], bool] | None = None
    # Trusted registrations opt in only for their thread-safe local checks.
    # Generic policies retain their original event-loop callback contract.
    threaded_authorization: bool = False
    # State captured before one complete worker check. Validation must reject
    # an invalid live binding and must not run blocking Git commands on the loop.
    authorization_state: Callable[[], object] | None = None
    validate_authorization_state: Callable[[object], bool] | None = None
    configuration_json: str = field(init=False, repr=False)

    def __post_init__(self):
        configuration = json.dumps(
            dict(self.configuration), sort_keys=True, allow_nan=False
        )
        if any(k in self.configuration for k in ("prompt", "project_id")):
            raise ValueError("policy configuration excludes message identity")
        object.__setattr__(self, "configuration_json", configuration)
        object.__setattr__(
            self, "configuration", MappingProxyType(json.loads(configuration))
        )
        object.__setattr__(self, "sources", frozenset(self.sources))
        object.__setattr__(self, "source_root", Path(self.source_root))

    def read_authorization_state(self):
        if not self.threaded_authorization:
            return None
        try:
            if self.authorization_state is not None:
                return self.authorization_state()
        except Exception:
            pass
        raise ExecutionForbidden("execution authorization state unavailable")

    async def check_authorization(self, check):
        def checked():
            # Capture BEFORE the complete check, so a change after it succeeds
            # cannot become the stamp that blesses that earlier result.
            state = self.read_authorization_state()
            return check(), state

        current, state = (
            await run_authorization_check(checked)
            if self.threaded_authorization
            else checked()
        )
        if current is not self:
            raise ExecutionUnavailable("configuration_revision_unavailable")
        receipt = PolicyAuthorization(self, state)
        receipt.require_current()
        return receipt


@dataclass(frozen=True)
class PolicyAuthorization:
    """Ephemeral state of one complete check; never a persisted/cached grant."""

    policy: ExecutionPolicy
    state: object = field(repr=False)

    def require_current(self):
        try:
            validate = self.policy.validate_authorization_state
            if self.policy.threaded_authorization and validate is not None:
                if validate(self.state) is True:
                    return
            elif self.policy.read_authorization_state() == self.state:
                return
        except Exception:
            pass
        raise ExecutionForbidden("execution authorization state changed")


class ExecutionPolicyRegistry:
    """Explicit capability registration; no permissive production default."""

    def __init__(self):
        self._policies: dict[str, ExecutionPolicy] = {}
        self._revisions: dict[tuple[str, str], ExecutionPolicy] = {}

    def register(self, project_id: str, policy: ExecutionPolicy) -> None:
        if project_id in self._policies:
            raise ValueError("revoke a Project policy before replacing it")
        self._policies[project_id] = policy
        self._revisions[
            (
                project_id,
                policy.configuration.get("configuration_revision", ""),
            )
        ] = policy

    def register_revision(
        self, project_id: str, policy: ExecutionPolicy
    ) -> None:
        """Retain exact accepted configurations for already queued requests."""
        key = (project_id, policy.configuration["configuration_revision"])
        if key in self._revisions and self._revisions[key] is not policy:
            raise ValueError("configuration revision is already registered")
        self._revisions[key] = policy
        self._policies[project_id] = policy

    def revoke(self, project_id: str) -> None:
        self._policies.pop(project_id, None)
        for key in tuple(self._revisions):
            if key[0] == project_id:
                del self._revisions[key]

    def select(
        self,
        project_id: str,
        origin: ExecutionOrigin,
        configuration_revision: str | None = None,
    ) -> ExecutionPolicy:
        policy = (
            self._revisions.get((project_id, configuration_revision))
            if configuration_revision
            else self._policies.get(project_id)
        )
        if (
            policy is None
            or policy.principal_ref != origin.principal_ref
            or origin.source not in policy.sources
            or (
                origin.source == "remote_control"
                and (
                    not origin.source_command_id
                    or not origin.hands_capability_ref
                )
            )
        ):
            raise ExecutionForbidden("execution origin is not authorized")
        return policy

    def require(self, project_id, origin, configuration_revision=None):
        policy = self.select(project_id, origin, configuration_revision)
        try:
            allowed = policy.authorize(origin) is True
        except Exception:
            allowed = False
        if not allowed:
            raise ExecutionForbidden("execution permission is unavailable")
        return policy

    async def require_async(
        self, project_id, origin, configuration_revision=None
    ):
        return (
            await self.require_authorization_async(
                project_id, origin, configuration_revision
            )
        ).policy

    async def require_authorization_async(
        self, project_id, origin, configuration_revision=None
    ):
        policy = self.select(project_id, origin, configuration_revision)
        if policy.refresh_authorization is not None:
            try:
                refreshed = await policy.refresh_authorization()
            except Exception:
                refreshed = False
            if refreshed is not True:
                raise ExecutionUnavailable("authorization_required")
        receipt = await policy.check_authorization(
            lambda: self.require(project_id, origin, configuration_revision)
        )
        if (
            self.select(project_id, origin, configuration_revision)
            is not policy
        ):
            raise ExecutionUnavailable("configuration_revision_unavailable")
        return receipt

    async def require_control(
        self, project_id, origin, configuration_revision=None
    ):
        policy = self.select(project_id, origin, configuration_revision)
        if policy.authorize_control is None:
            return await self.require_async(
                project_id, origin, configuration_revision
            )
        try:
            allowed = policy.authorize_control(origin) is True
        except Exception:
            allowed = False
        if not allowed:
            raise ExecutionForbidden("execution control is not authorized")
        return policy


@dataclass
class _Execution:
    request: ExecutionRequest
    runtime: BoundRuntime
    configuration: RuntimeConfiguration
    policy: ExecutionPolicy
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    finalizing: asyncio.Lock = field(default_factory=asyncio.Lock)
    handle: RuntimeHandle | None = None
    finalized: bool = False


class ExecutionService:
    def __init__(
        self,
        journal: SQLiteRunJournal,
        coordinator: RunCoordinator,
        policies: ExecutionPolicyRegistry,
        *,
        capacity: int = 4,
        scan_interval: float = 0.25,
        stop_timeout: float = 5.0,
    ):
        if type(capacity) is not int or capacity < 2 or scan_interval <= 0:
            raise ValueError("parallel capacity and scan interval are invalid")
        self.journal = journal
        self.coordinator = coordinator
        coordinator.bind_journal(journal)
        self.policies = policies
        self.admission = AdmissionStore(journal)
        self.state = WorkspaceStateStore(journal)
        self.capacity = capacity
        self.scan_interval = scan_interval
        self.stop_timeout = stop_timeout
        self.owner_id = "execution-" + uuid.uuid4().hex
        self._wake = asyncio.Event()
        self._closing = False
        self._loop_task: asyncio.Task | None = None
        self._close_task: asyncio.Task | None = None
        self._tasks: dict[str, asyncio.Task] = {}
        self._executions: dict[str, _Execution] = {}
        self._publications: dict[str, asyncio.Task] = {}
        self._cancellations: dict[str, asyncio.Task] = {}
        self._authorization_checks: dict[str, asyncio.Task] = {}
        self._local_authorization_checks: dict[str, asyncio.Task] = {}
        self._cursor: str | None = None
        self.recovery_facts: dict[str, tuple[str, ...]] = {}

    def capabilities(self) -> dict[str, Any]:
        result = {
            "execution_admission": True,
            "controlled_worker": True,
            "parallel_sessions": True,
            "supports_legacy_chat": False,
            "supports_single_agent": False,
            "supports_workforce": False,
            "resume_transfer": False,
            "capacity": self.capacity,
        }
        registration = getattr(self, "registration", None)
        if registration is not None:
            result.update(
                trusted_configuration_registration=True,
                restricted_profiles=registration.profiles(),
                local_single_session=registration.local_single_session_enabled,
            )
        return result

    @staticmethod
    def _origin(request: ExecutionRequest) -> ExecutionOrigin:
        return ExecutionOrigin(
            principal_ref=request.envelope["principal_ref"],
            source=request.source,
            source_command_id=request.source_command_id,
            hands_capability_ref=request.envelope.get("hands_capability_ref"),
        )

    def _policy(self, request: ExecutionRequest) -> ExecutionPolicy:
        policy = self.policies.require(
            request.project_id,
            self._origin(request),
            request.envelope.get("configuration_revision"),
        )
        expected = json.loads(policy.configuration_json)
        actual = {
            key: value
            for key, value in request.envelope.items()
            if key not in {"prompt", "project_id"}
        }
        if actual != expected:
            raise ExecutionUnavailable("configuration_revision_unavailable")
        if request.envelope.get("attachment_ids") or request.envelope.get(
            "review_handoff_ids"
        ):
            raise ExecutionUnavailable("attachment_resolver_unavailable")
        return policy

    async def _policy_async(self, request):
        await self.policies.require_async(
            request.project_id,
            self._origin(request),
            request.envelope.get("configuration_revision"),
        )
        return await self._policy_local_async(request)

    async def _policy_local_async(self, request):
        policy = self.policies.select(
            request.project_id,
            self._origin(request),
            request.envelope.get("configuration_revision"),
        )
        if policy.threaded_authorization:
            # Re-run the original complete check, including registry selection,
            # credential, physical binding and envelope checks. No cached grant.
            receipt = await policy.check_authorization(
                lambda: self._policy(request)
            )
            if (
                self.policies.select(
                    request.project_id,
                    self._origin(request),
                    request.envelope.get("configuration_revision"),
                )
                is not policy
            ):
                raise ExecutionUnavailable(
                    "configuration_revision_unavailable"
                )
            return receipt.policy
        return self._policy(request)

    async def submit(
        self,
        *,
        request_id: str,
        project_id: str,
        kind: str,
        envelope: Mapping[str, Any],
        origin: ExecutionOrigin,
        target_run_id: str | None = None,
        source_follow_up_request_id: str | None = None,
        delivery_mode: str = "wait",
        follow_up_content: str | None = None,
    ) -> ExecutionRequest:
        from app.run_journal import IdempotencyConflictError

        if self._closing:
            raise ExecutionUnavailable("execution service is closing")
        payload = validate_envelope(envelope, project_id=project_id, kind=kind)
        authorization = await self.policies.require_authorization_async(
            project_id, origin, payload.get("configuration_revision")
        )
        policy = authorization.policy
        if payload.get("principal_ref") not in (None, origin.principal_ref):
            raise ExecutionForbidden("execution principal differs")
        if payload.get("hands_capability_ref") != origin.hands_capability_ref:
            raise ExecutionForbidden("execution capability differs")
        payload["principal_ref"] = origin.principal_ref
        expected = json.loads(policy.configuration_json)
        if any(
            value != expected.get(key)
            for key, value in payload.items()
            if key not in {"prompt", "project_id"}
        ):
            # Unknown credential/config references never enter the durable
            # journal; missing configuration may still wait without guessing.
            raise ExecutionForbidden(
                "execution configuration is not registered"
            )
        if kind != "follow_up" and follow_up_content is not None:
            raise InvalidExecutionEnvelope(
                "only follow-up has message content"
            )
        # The immutable compatibility message and admission intent have a single
        # commit boundary, including Send now demotion and source idempotency.
        with self.journal._write_transaction() as connection:
            from .routing import require_submission_in_transaction, route_row

            # No await/Git here. Re-read live account, permission and binding
            # state under the same journal transaction that will admit intent.
            authorization.require_current()
            if (
                self.policies.select(
                    project_id, origin, payload.get("configuration_revision")
                )
                is not policy
            ):
                raise ExecutionUnavailable(
                    "configuration_revision_unavailable"
                )
            route = route_row(connection, project_id)
            if route is not None and route["route"] == "managed_single":
                registration = getattr(self, "registration", None)
                if (
                    registration is None
                    or not registration.local_single_session_enabled
                ):
                    raise ExecutionUnavailable("session_entry_disabled")
            require_submission_in_transaction(
                connection,
                project_id=project_id,
                request_id=request_id,
                kind=kind,
                envelope=payload,
                origin=origin,
            )
            if kind == "follow_up" and follow_up_content is not None:
                if payload.get("attachment_ids"):
                    raise ExecutionUnavailable(
                        "attachment_resolver_unavailable"
                    )
                try:
                    self.journal._put_follow_up_request_in_transaction(
                        connection,
                        request_id=request_id,
                        project_id=project_id,
                        content=follow_up_content,
                        review_handoff_ids=payload.get(
                            "review_handoff_ids", ()
                        ),
                        delivery_mode=delivery_mode,
                        source=origin.source,
                        source_command_id=origin.source_command_id,
                    )
                except IdempotencyConflictError as exc:
                    raise AdmissionConflict(
                        "follow-up identity was reused"
                    ) from exc
            request = self.admission.submit_in_transaction(
                connection,
                request_id=request_id,
                project_id=project_id,
                kind=kind,
                envelope=payload,
                source=origin.source,
                source_command_id=origin.source_command_id,
                source_follow_up_request_id=source_follow_up_request_id,
                target_run_id=target_run_id,
                delivery_mode=delivery_mode,
            )
        self._wake.set()
        if request.kind == "resume" and request.status == "pending":
            self._wait_reason(request.request_id, "resume_recovery_required")
            return self.admission.get(request.request_id)
        return request

    async def get(
        self, request_id: str, *, origin: ExecutionOrigin
    ) -> ExecutionRequest | None:
        request = self.admission.get(request_id)
        if request is not None:
            await self.policies.require_control(
                request.project_id,
                origin,
                request.envelope.get("configuration_revision"),
            )
            if request.envelope["principal_ref"] != origin.principal_ref:
                raise ExecutionForbidden("execution principal differs")
        return request

    async def set_delivery(
        self,
        request_id: str,
        *,
        origin: ExecutionOrigin,
        delivery_mode: str,
        operation_id: str | None = None,
    ) -> ExecutionRequest:
        if await self.get(request_id, origin=origin) is None:
            raise AdmissionError("unknown execution request")
        request = self.admission.set_delivery_mode(
            request_id, delivery_mode, operation_id=operation_id
        )
        self._wake.set()
        return request

    async def list_requests(self, project_id, *, origin, after=0, limit=50):
        if (
            type(after) is not int
            or after < 0
            or type(limit) is not int
            or not 1 <= limit <= 50
        ):
            raise ValueError("invalid execution page")
        registration = getattr(self, "registration", None)
        if registration is None:
            await self.policies.require_control(project_id, origin)
        else:
            await registration.authorize_project_control(project_id, origin)
        with self.journal._lock:
            rows = self.journal._connection.execute(
                """SELECT e.*,r.status AS run_status,r.cancel_request_id,
                f.state AS settlement,m.content AS follow_up_content
                FROM execution_requests e
                LEFT JOIN runs r ON r.run_id=e.admitted_run_id
                LEFT JOIN run_workspace_finalizations f ON f.run_id=e.admitted_run_id
                LEFT JOIN follow_up_requests m ON m.request_id=e.source_follow_up_request_id
                WHERE e.project_id=? AND e.queue_seq>?
                ORDER BY e.queue_seq LIMIT ?""",
                (project_id, after, limit + 1),
            ).fetchall()
            result = []
            for row in rows[:limit]:
                envelope = json.loads(row["envelope_json"])
                if envelope.get("principal_ref") != origin.principal_ref:
                    raise ExecutionForbidden("execution principal differs")
                content = (
                    row["follow_up_content"]
                    if row["kind"] == "follow_up"
                    else envelope.get("prompt", "")
                )
                content = content or ""
                record = {
                    key: row[key]
                    for key in (
                        "request_id",
                        "project_id",
                        "kind",
                        "source",
                        "queue_seq",
                        "source_follow_up_request_id",
                        "delivery_mode",
                        "status",
                        "wait_reason",
                        "admitted_run_id",
                        "admitted_attempt_id",
                        "created_at",
                        "updated_at",
                        "run_status",
                        "settlement",
                    )
                }
                record.update(
                    content=content[:4000],
                    content_truncated=len(content) > 4000,
                    configuration_revision=envelope.get(
                        "configuration_revision"
                    ),
                    cancel_requested=row["cancel_request_id"] is not None,
                )
                result.append(record)
        return {
            "project_id": project_id,
            "items": result,
            "next_cursor": result[-1]["queue_seq"]
            if len(rows) > limit
            else None,
        }

    async def artifacts(
        self, request_id: str, *, origin: ExecutionOrigin
    ) -> dict:
        request = await self.get(request_id, origin=origin)
        if request is None:
            raise FileNotFoundError(request_id)
        policy = await self.policies.require_control(
            request.project_id,
            origin,
            request.envelope.get("configuration_revision"),
        )
        with self.journal._lock:
            final = self.journal._connection.execute(
                "SELECT * FROM run_workspace_finalizations WHERE run_id=?",
                (request.admitted_run_id,),
            ).fetchone()
        if final is None or final["state"] != "settled":
            raise AdmissionError("execution artifacts are not finalized")
        payload = json.loads(
            await asyncio.to_thread(
                policy.provider.store.read_blob, final["manifest_digest"]
            )
        )
        if (
            payload.get("schema") != "isolated_artifacts.v1"
            or payload.get("run_id") != request.admitted_run_id
            or payload.get("attempt_id") != final["owner_attempt_id"]
            or payload.get("generation") != final["generation"]
            or payload.get("checkpoint_revision")
            != final["checkpoint_revision"]
        ):
            raise AdmissionError("execution artifact ownership differs")
        return {
            "run_id": payload["run_id"],
            "project_id": request.project_id,
            "checkpoint_revision": payload["checkpoint_revision"],
            "artifacts": [
                {
                    key: item[key]
                    for key in (
                        "artifact_id",
                        "filename",
                        "relativePath",
                        "size",
                        "content_digest",
                        "checkpoint_revision",
                    )
                }
                for item in payload["artifacts"]
            ],
        }

    async def read_artifact(
        self,
        request_id: str,
        artifact_id: str,
        *,
        origin: ExecutionOrigin,
        offset: int = 0,
        length: int | None = None,
    ) -> bytes:
        from .finalizer import WorkspaceFinalizer

        request = await self.get(request_id, origin=origin)
        if request is None:
            raise FileNotFoundError(request_id)
        policy = await self.policies.require_control(
            request.project_id,
            origin,
            request.envelope.get("configuration_revision"),
        )
        return await asyncio.to_thread(
            WorkspaceFinalizer(self.journal).read_artifact,
            run_id=request.admitted_run_id,
            artifact_id=artifact_id,
            provider=policy.provider,
            offset=offset,
            length=length,
        )

    async def cancel(
        self, request_id: str, *, origin: ExecutionOrigin
    ) -> ExecutionRequest:
        request = await self.get(request_id, origin=origin)
        if request is None:
            raise AdmissionError("unknown execution request")
        request = self.admission.cancel(request_id)
        if request.status == "admitted":
            await self._cancel_admitted(request)
        self._wake.set()
        return request

    async def _cancel_admitted(self, request: ExecutionRequest) -> None:
        from app.run_journal import InvalidRunTransitionError

        run = self.journal.get_run(request.admitted_run_id)
        terminal = {"completed", "failed", "cancelled"}
        if run.status not in terminal and run.cancel_request_id is None:
            try:
                self.journal.request_cancel(
                    request.admitted_run_id,
                    request_id="execution-cancel:" + request.request_id,
                    reason="execution_cancelled",
                )
            except InvalidRunTransitionError:
                # A deadline may terminalize the Run between this read and
                # cancel intent. That fact still does not prove writers stopped.
                current = self.journal.get_run(request.admitted_run_id)
                if (
                    current.status not in terminal
                    and current.cancel_request_id is None
                ):
                    raise
        execution = self._executions.get(request.request_id)
        if execution is None:
            # Another/restarted process has no stop proof. Intent is durable;
            # the existing owner/barrier stays authoritative.
            return
        await execution.ready.wait()
        if execution.handle is not None:
            handle = await self.coordinator.cancel_dormant(
                **self._owner(execution)
            )
            if not handle.runner_started:
                await self._finalize(execution, "", "cancelled")

    @staticmethod
    def _owner(execution: _Execution) -> dict[str, Any]:
        binding = execution.runtime.binding
        return {
            "run_id": binding.run_id,
            "attempt_id": binding.attempt_id,
            "generation": binding.generation,
        }

    async def start(self) -> None:
        if self._closing:
            raise ExecutionUnavailable("execution service is closed")
        if self._loop_task is not None:
            return
        self.recovery_facts = self.reconcile_facts()
        self._loop_task = asyncio.create_task(
            self._dispatch(), name=self.owner_id
        )
        self._wake.set()

    def reconcile_facts(self) -> dict[str, tuple[str, ...]]:
        """Observe lost process ownership without scanning or stealing writers."""
        # A second process starting is not proof that the first process died.
        # Even changing pending -> needs_attention would invalidate its exact
        # activation fence. Recovery requires explicit verified transfer later.
        with self.journal._lock:
            connection = self.journal._connection
            return {
                "unverified_runs": tuple(
                    row[0]
                    for row in connection.execute(
                        "SELECT run_id FROM run_workspace_finalizations WHERE state!='settled' ORDER BY run_id"
                    )
                ),
                "unverified_claims": tuple(
                    row[0]
                    for row in connection.execute(
                        """SELECT request_id FROM project_admission_claims
                    WHERE state='claimed' AND owner_id!=? ORDER BY request_id""",
                        (self.owner_id,),
                    )
                ),
            }

    async def _dispatch(self) -> None:
        while not self._closing:
            self._wake.clear()
            try:
                self._dispatch_cancellations()
                self._dispatch_publications()
                room = self.capacity - len(self._tasks)
                if room > 0:
                    for request in self.admission.list_dispatch_candidates(
                        after_project_id=self._cursor, limit=room
                    ):
                        self._cursor = request.project_id
                        if request.request_id in self._tasks:
                            continue
                        if (
                            request.wait_reason
                            == "preparation_cleanup_required"
                        ):
                            continue
                        if (
                            request.wait_reason
                            and time.time() - request.updated_at < 1
                        ):
                            continue
                        # Resume is persisted as the SAME Run, but no ownership
                        # transfer is inferred from restart, generation or TTL.
                        if request.kind == "resume":
                            self._wait_reason(
                                request.request_id, "resume_recovery_required"
                            )
                            continue
                        claim = self.admission.claim(
                            request.request_id, owner_id=self.owner_id
                        )
                        if claim is None:
                            continue
                        task = asyncio.create_task(
                            self._execute(request, claim)
                        )
                        self._tasks[request.request_id] = task
                        task.add_done_callback(
                            lambda done, key=request.request_id: (
                                self._task_done(key, done)
                            )
                        )
            except Exception:
                logger.warning("Execution dispatcher scan failed")
            try:
                await asyncio.wait_for(self._wake.wait(), self.scan_interval)
            except TimeoutError:
                pass

    def _wait_reason(self, request_id: str, reason: str) -> None:
        with self.journal._write_transaction() as connection:
            connection.execute(
                """UPDATE execution_requests SET wait_reason=?,updated_at=?
                WHERE request_id=? AND status='pending'""",
                (reason, time.time(), request_id),
            )

    def _task_done(self, request_id: str, task: asyncio.Task) -> None:
        self._tasks.pop(request_id, None)
        if not task.cancelled() and task.exception() is not None:
            logger.warning("Execution owner task failed")
        self._wake.set()

    def _dispatch_cancellations(self):
        for key, execution in tuple(self._executions.items()):
            if key in self._cancellations or execution.finalized:
                continue
            run = self.journal.get_run(execution.runtime.binding.run_id)
            if run.cancel_request_id is not None or run.status in {
                "completed",
                "failed",
                "cancelled",
            }:
                self._schedule_cancellation(execution)
            elif key not in self._local_authorization_checks:
                # A slow Session's fresh filesystem/Git check must not hold
                # the dispatcher or another Session's admission/cancellation.
                task = asyncio.create_task(
                    self._check_active_policy(execution)
                )
                self._local_authorization_checks[key] = task
                task.add_done_callback(
                    lambda done, key=key: self._local_authorization_done(
                        key, done
                    )
                )

    async def _check_active_policy(self, execution):
        key = execution.request.request_id
        try:
            revoked = (
                await self._policy_local_async(execution.request)
                is not execution.policy
            )
        except AdmissionError:
            revoked = True
        if (
            self._closing
            or execution.finalized
            or self._executions.get(key) is not execution
            or key in self._cancellations
        ):
            return
        if revoked:
            self._schedule_cancellation(execution)
        elif (
            execution.policy.refresh_authorization is not None
            and key not in self._authorization_checks
        ):
            # Keep remote refresh separate: a withheld HTTP response must not
            # prevent subsequent local revocation checks for this Session.
            task = asyncio.create_task(self._refresh_active(execution))
            self._authorization_checks[key] = task
            task.add_done_callback(
                lambda done: self._authorization_done(key, done)
            )

    def _schedule_cancellation(self, execution):
        key = execution.request.request_id
        if key in self._cancellations:
            return
        task = asyncio.create_task(self._cancel_admitted(execution.request))
        self._cancellations[key] = task
        task.add_done_callback(lambda done: self._cancellation_done(key, done))

    def _local_authorization_done(self, key, task):
        self._local_authorization_checks.pop(key, None)
        if not task.cancelled() and task.exception() is not None:
            logger.warning("Execution local authorization check failed")

    async def _refresh_active(self, execution):
        try:
            await self._policy_async(execution.request)
        except AdmissionError:
            pass  # The next local scan observes the revoked proof.

    def _authorization_done(self, key, task):
        self._authorization_checks.pop(key, None)
        if not task.cancelled() and task.exception() is not None:
            logger.warning("Execution authorization refresh failed")

    def _cancellation_done(self, key, task):
        self._cancellations.pop(key, None)
        if not task.cancelled() and task.exception() is not None:
            logger.warning("Execution cancellation requires owner attention")

    def _authorize_worker(self, request, policy, binding):
        if self._policy(request) is not policy:
            return False
        with self.journal._lock:
            row = self.journal._connection.execute(
                """SELECT r.cancel_request_id,r.active_attempt_id,r.status,
                f.owner_attempt_id,f.generation,f.state
                FROM runs r JOIN run_workspace_finalizations f USING(run_id)
                WHERE r.run_id=?""",
                (binding.run_id,),
            ).fetchone()
        return row is not None and tuple(row) == (
            None,
            binding.attempt_id,
            "running",
            binding.attempt_id,
            binding.generation,
            "pending",
        )

    def _dispatch_publications(self) -> None:
        room = self.capacity - len(self._publications)
        if room <= 0:
            return
        with self.journal._lock:
            rows = self.journal._connection.execute(
                """SELECT i.request_id,e.request_id AS execution_id
                FROM workspace_integration_requests i
                JOIN execution_requests e ON e.admitted_run_id=i.run_id
                WHERE (i.status IN ('pending','waiting','waiting_target_stable')
                    OR (i.status='partially_integrated' AND EXISTS (
                        SELECT 1 FROM workspace_integration_paths p
                        WHERE p.request_id=i.request_id
                        AND p.status IN ('pending','waiting'))))
                AND i.worker_id IS NULL AND i.retry_after_at<=?
                ORDER BY i.created_at,i.request_id LIMIT ?""",
                (time.time(), room),
            ).fetchall()
        for row in rows:
            key = row["request_id"]
            if key in self._publications:
                continue
            task = asyncio.create_task(self._publish(key, row["execution_id"]))
            self._publications[key] = task
            task.add_done_callback(
                lambda done, key=key: self._publication_done(key, done)
            )

    def _publication_done(self, key, task):
        self._publications.pop(key, None)
        if not task.cancelled() and task.exception() is not None:
            logger.warning("Execution publication requires attention")
        self._wake.set()

    async def _publish(self, integration_id, execution_id):
        from .integration import WorkspaceIntegrationCoordinator

        request = self.admission.get(execution_id)
        try:
            policy = await self._policy_async(request)
        except AdmissionError:
            # Revocation leaves durable output/outbox intact, with bounded retry.
            with self.journal._write_transaction() as connection:
                connection.execute(
                    """UPDATE workspace_integration_requests
                    SET wait_reason='authorization_required',retry_after_at=?
                    WHERE request_id=? AND worker_id IS NULL""",
                    (time.time() + 5, integration_id),
                )
            return
        loop = asyncio.get_running_loop()
        checks: set[asyncio.Task] = set()

        async def refresh():
            task = asyncio.current_task()
            checks.add(task)
            try:
                return await self._policy_async(request)
            finally:
                checks.discard(task)

        def authorize(publication):
            if policy.refresh_authorization is not None:
                # Integration runs in its owned thread. Revalidate at each
                # existing publication fence, without blocking the event loop.
                future = asyncio.run_coroutine_threadsafe(refresh(), loop)
                try:
                    future.result(timeout=6)
                except Exception:
                    future.cancel()
                    return False
            return self._authorize_publication(request, policy, publication)

        coordinator = WorkspaceIntegrationCoordinator(
            self.state,
            policy.provider,
            authorize=authorize,
        )
        try:
            await asyncio.to_thread(coordinator.process, integration_id)
        finally:
            # Cancelling the cross-thread future completes that future before
            # its coroutine/reader has stopped. Retain the actual checks until
            # drained, so service shutdown cannot close their journal early.
            await asyncio.gather(*tuple(checks), return_exceptions=True)

    def _authorize_publication(self, request, policy, publication) -> bool:
        if self._policy(request) is not policy:
            return False
        target = self.state.target(publication["target_id"])
        root, identity = self.state.physical_identity(policy.source_root)
        if (
            target.root_path != root
            or target.physical_identity != identity
            or target.binding_version != publication["target_binding_version"]
            or publication["run_id"] != request.admitted_run_id
            or publication["project_id"] != request.project_id
        ):
            return False
        with self.journal._lock:
            binding = self.journal._connection.execute(
                """SELECT target_id,target_binding_version FROM run_workspace_bindings
                WHERE run_id=? AND attempt_id=?""",
                (request.admitted_run_id, request.admitted_attempt_id),
            ).fetchone()
        return binding is not None and tuple(binding) == (
            target.target_id,
            target.binding_version,
        )

    def _require_claim(self, claim) -> None:
        with self.journal._lock:
            self.admission.require_claim_in_transaction(
                self.journal._connection, claim
            )

    @staticmethod
    def _source_fence(target) -> SourceFence:
        return SourceFence(
            physical_target_id=target.target_id,
            physical_identity=target.physical_identity,
            write_epoch=target.write_epoch,
            settled_revision=target.settled_revision,
            integration_receipt_cursor=target.receipt_cursor,
            state=target.state,
            owner=target.owner_id,
            binding_version=target.binding_version,
        )

    def _prepare(self, request, claim, policy, attempt_id, resources):
        from .session_input import compose_session_input

        self._require_claim(claim)
        target = self.state.register_target(policy.source_root)
        fence = self.state.capture_fence(target.target_id)
        snapshot = policy.provider.capture_source(
            policy.source_root,
            owner=attempt_id,
            expected_fence=self._source_fence(fence),
            read_fence=lambda: self._source_fence(
                self.state.capture_fence(target.target_id)
            ),
            commit_capture=lambda captured, _fence: self.state.accept_capture(
                fence, captured.revision_id, "preparation:" + attempt_id
            ),
        )
        if (
            request.envelope.get("source_revision", snapshot.revision_id)
            != snapshot.revision_id
        ):
            raise ExecutionUnavailable("source_revision_changed")
        snapshot = compose_session_input(
            self.state, policy.provider, request.project_id, fence, snapshot
        )
        workspace = resources.prepare(
            snapshot,
            assert_owner=lambda _owner, _generation: self._require_claim(
                claim
            ),
        )
        configuration = policy.resolve_runtime(request, workspace)
        if (
            (
                configuration.configuration_revision
                or configuration.environment.bundle_revision_id
            )
            != request.envelope["configuration_revision"]
            or configuration.environment.permission_profile_revision
            != request.envelope["permission_profile_revision"]
        ):
            raise ExecutionForbidden(
                "resolved environment differs from intent"
            )
        return workspace, target, configuration

    async def _execute(self, request, claim) -> None:
        execution = None
        runtime = None
        resources = None
        try:
            policy = await self._policy_async(request)
            attempt_id = str(uuid.uuid4())
            resources = PreparationResources(
                attempt_id=attempt_id,
                request_id=request.request_id,
                generation=claim.generation,
                state=self.state,
                provider=policy.provider,
            )
            workspace, target, configuration = await asyncio.to_thread(
                self._prepare, request, claim, policy, attempt_id, resources
            )
            if (
                self._closing
                or await self._policy_async(request) is not policy
            ):
                raise ExecutionUnavailable("execution_policy_changed")
            runtime = BoundRuntime(
                RuntimeBinding(
                    run_id=request.request_id,
                    attempt_id=attempt_id,
                    generation=claim.generation,
                    workspace=workspace,
                    environment_spec_id=configuration.environment.environment_spec_id,
                    env=configuration.env,
                ),
                stop_timeout=self.stop_timeout,
                authorize=lambda binding, _operations: self._authorize_worker(
                    request, policy, binding
                ),
                refresh_authorization=policy.refresh_authorization,
            )

            def handoff(connection, current, owner):
                from app.run_journal import RunEventDraft

                self.journal._ensure_run_in_transaction(
                    connection,
                    run_id=current.request_id,
                    project_id=current.project_id,
                    status="pending",
                )
                attempt = self.journal._create_run_attempt_in_transaction(
                    connection,
                    current.request_id,
                    request_id=current.request_id,
                    attempt_id=attempt_id,
                    reason="isolated_execution",
                    activate=False,
                    environment=configuration.environment,
                    admission_claim=(owner.request_id, owner.generation),
                )
                self.state.bind_run_in_transaction(
                    connection,
                    run_id=current.request_id,
                    attempt_id=attempt_id,
                    generation=owner.generation,
                    workspace_id=workspace.workspace_id,
                    provider=workspace.provider,
                    snapshot_revision=workspace.input_revision,
                    root_path=str(workspace.local_root),
                    target=target,
                    policy_version=current.envelope[
                        "workspace_policy_version"
                    ],
                )
                content = current.envelope.get("prompt")
                if current.kind == "follow_up":
                    content = connection.execute(
                        "SELECT content FROM follow_up_requests WHERE request_id=?",
                        (current.request_id,),
                    ).fetchone()[0]
                self.journal._append_event_in_transaction(
                    connection,
                    current.request_id,
                    RunEventDraft(
                        event_id="execution-input:" + current.request_id,
                        event_type="user.message",
                        payload={
                            "content": content,
                            "request_id": current.request_id,
                        },
                    ),
                    expected_project_id=current.project_id,
                )
                return attempt

            admitted = self.admission.handoff(claim, prepare_attempt=handoff)
            execution = _Execution(admitted, runtime, configuration, policy)
            self._executions[request.request_id] = execution
            try:
                resources.handoff_completed()
                execution.handle = await self.coordinator.register_dormant(
                    **self._owner(execution),
                    runner=lambda _handle: self._run(execution),
                )
                if self._closing or self._policy(request) is not policy:
                    raise ExecutionUnavailable("execution_policy_changed")
                await self.coordinator.activate_dormant(
                    **self._owner(execution)
                )
            finally:
                execution.ready.set()
            await execution.handle.wait()
        except Exception as exc:
            # Only the current process's actual runtime can establish stoppage.
            if execution is not None:
                if execution.handle is not None:
                    await self.coordinator.cancel_dormant(
                        **self._owner(execution)
                    )
                run = self.journal.get_run(request.request_id)
                outcome = "cancelled" if run.cancel_request_id else "failed"
                await self._finalize(execution, "", outcome)
            else:
                if runtime is not None:
                    await runtime.stop()
                reason = getattr(exc, "code", "preparation_unavailable")
                if reason not in {
                    "agent_configuration_unavailable",
                    "session_input_conflict",
                    "source_changed",
                    "source_waiting_for_settlement",
                }:
                    reason = "preparation_unavailable"
                try:
                    self.admission.release(
                        claim,
                        wait_reason="preparation_cleanup_required"
                        if resources is not None
                        else reason,
                    )
                except AdmissionFenceLost:
                    # A committed cancellation owns the released claim.
                    logger.info(
                        "Execution preparation no longer owns admission"
                    )
                if resources is not None:
                    if await asyncio.to_thread(resources.abort):
                        self._wait_reason(request.request_id, reason)
                    else:
                        logger.warning(
                            "Execution preparation requires cleanup"
                        )
        finally:
            if execution is not None:
                execution.ready.set()
                self._executions.pop(request.request_id, None)

    async def _run(self, execution: _Execution) -> None:
        outcome, result = "completed", ""
        try:
            result = await execution.runtime.run(
                execution.configuration.handler
            )
            if not isinstance(result, str):
                raise TypeError("controlled runtime result must be text")
        except asyncio.CancelledError:
            outcome = "cancelled"
        except Exception:
            outcome = "failed"
            logger.warning("Controlled execution failed")
        finalization = asyncio.create_task(
            self._finalize(execution, result, outcome)
        )
        try:
            await asyncio.shield(finalization)
        except asyncio.CancelledError:
            # Cancel intent may arrive after the handler returned. The final
            # transaction arbitrates it; cancellation must not orphan capture.
            await asyncio.shield(finalization)

    async def _finalize(self, execution, result, outcome):
        from .finalizer import WorkspaceFinalizer

        async with execution.finalizing:
            if execution.finalized:
                return
            try:
                await WorkspaceFinalizer(self.journal).finalize(
                    execution.request,
                    execution.runtime,
                    execution.policy.provider,
                    result,
                    outcome,
                )
                execution.finalized = True
            except Exception:
                logger.warning("Isolated execution requires owner recovery")
            self._wake.set()

    async def close(self) -> None:
        if self._close_task is None:
            self._close_task = asyncio.create_task(self._drain())
        await asyncio.shield(self._close_task)

    async def _drain(self) -> None:
        self._closing = True
        self._wake.set()
        if self._loop_task is not None:
            await self._loop_task
        await asyncio.gather(
            *(
                self._cancel_admitted(item.request)
                for item in tuple(self._executions.values())
            )
        )
        # Never cancel a to_thread preparation and pretend it stopped writing.
        # Bounded provider operations must finish before journal shutdown.
        if self._tasks:
            await asyncio.gather(*tuple(self._tasks.values()))
        if self._publications:
            await asyncio.gather(*tuple(self._publications.values()))
        if self._cancellations:
            await asyncio.gather(*tuple(self._cancellations.values()))
        checks = (
            *self._authorization_checks.values(),
            *self._local_authorization_checks.values(),
        )
        for task in checks:
            task.cancel()
        await asyncio.gather(*checks, return_exceptions=True)
