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

"""Retire exact pre-admission resources without guessing crash ownership.

The service retires the admission claim before aborting. Unknown, changed or
partially prepared resources remain retained and require durable recovery;
the caller must not automatically retry them. This helper never launches a
writer, releases a Run lease, or garbage-collects CAS objects.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Callable

from .execution import publication_execution
from .provider import (
    DirectoryWorkspaceProvider,
    PreparationIdentity,
    SnapshotRef,
    WorkspaceHandle,
    WorkspaceOwnerError,
)
from .store import WorkspaceStateError, WorkspaceStateStore


class PreparationResources:
    def __init__(
        self,
        *,
        attempt_id: str,
        request_id: str,
        generation: int,
        state: WorkspaceStateStore,
        provider: DirectoryWorkspaceProvider,
    ) -> None:
        if (
            not attempt_id
            or not request_id
            or type(generation) is not int
            or generation < 1
        ):
            raise ValueError("preparation requires an exact owner")
        self.attempt_id = attempt_id
        self.request_id = request_id
        self.generation = generation
        self.state = state
        self.provider = provider
        self.workspace: WorkspaceHandle | None = None
        self._identity: PreparationIdentity | None = None
        self._started = False
        self._aborted = False
        self._handed_off = False
        self._lock = threading.RLock()
        # A recovered owner can already have a private copy even when this
        # new Python object has never called prepare. Do not reinterpret that
        # missing in-process proof as a capture-only failure.
        with state.journal._lock:
            if state.journal._connection.execute(
                "SELECT 1 FROM workspace_revision_references WHERE owner=?",
                (self.reference_owner,),
            ).fetchone():
                raise WorkspaceStateError(
                    "existing preparation requires explicit recovery"
                )

    @property
    def reference_owner(self) -> str:
        return "preparation:" + self.attempt_id

    def prepare(
        self,
        snapshot: SnapshotRef,
        *,
        assert_owner: Callable[[str, int], None],
    ) -> WorkspaceHandle:
        with self._lock:
            if self._started or self._aborted or self._handed_off:
                raise WorkspaceOwnerError("preparation cannot be reused")
            self._started = True
            self.workspace = self.provider.prepare(
                snapshot,
                owner=self.attempt_id,
                generation=self.generation,
                assert_owner=assert_owner,
            )
            self._identity = self.provider.preparation_identity(self.workspace)
            return self.workspace

    def _require_unadmitted(self, connection: sqlite3.Connection) -> None:
        request = connection.execute(
            "SELECT project_id FROM execution_requests WHERE request_id=?",
            (self.request_id,),
        ).fetchone()
        if request is None:
            raise WorkspaceStateError("unknown preparation request")
        claim = connection.execute(
            "SELECT request_id,generation,state FROM project_admission_claims WHERE project_id=?",
            (request[0],),
        ).fetchone()
        if (
            claim is None
            or claim[1] < self.generation
            or (
                claim[1] == self.generation
                and (claim[0] != self.request_id or claim[2] != "released")
            )
            or connection.execute(
                "SELECT 1 FROM run_attempts WHERE attempt_id=?",
                (self.attempt_id,),
            ).fetchone()
            or connection.execute(
                "SELECT 1 FROM run_workspace_bindings WHERE attempt_id=?",
                (self.attempt_id,),
            ).fetchone()
        ):
            raise WorkspaceStateError(
                "preparation is not retired and unadmitted"
            )
        if (
            self.workspace is not None
            and connection.execute(
                "SELECT 1 FROM run_workspace_bindings WHERE workspace_id=? OR root_path=?",
                (self.workspace.workspace_id, str(self.workspace.local_root)),
            ).fetchone()
        ):
            raise WorkspaceStateError(
                "preparation workspace has been handed off"
            )

    def _assert_unadmitted(self) -> None:
        with self.state.journal._lock:
            self._require_unadmitted(self.state.journal._connection)

    def _release_references(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            "DELETE FROM workspace_revision_references WHERE owner=?",
            (self.reference_owner,),
        )

    def abort(self) -> bool:
        """Return whether retry is safe after the old claim was retired.

        False is a persistent preparation_cleanup_required wait, not permission
        to try another full copy. Missing cleanup proof and partial failures
        intentionally retain all references. Idempotence is in-process only;
        a restarted process must not reconstruct cleanup authority.
        """
        with self._lock:
            if self._aborted:
                return True
            if self._handed_off:
                return False
            try:
                with publication_execution(
                    self.state.journal.path, self.reference_owner
                ):
                    self._assert_unadmitted()
                    if self._started:
                        if self.workspace is None or self._identity is None:
                            return False
                        if (
                            self.workspace.owner != self.attempt_id
                            or self.workspace.generation != self.generation
                        ):
                            return False
                        self.provider.discard_prepared_workspace(
                            self.workspace,
                            self._identity,
                            assert_unadmitted=self._assert_unadmitted,
                        )
                    with self.state.journal._write_transaction() as connection:
                        self._require_unadmitted(connection)
                        self._release_references(connection)
                    self._aborted = True
                    return True
            except Exception:
                # No raw filesystem/config/database exception crosses the
                # runtime boundary; the caller records one recovery reason.
                return False

    def handoff_completed(self) -> None:
        """Transfer retention only after an exact durable Run input exists."""
        with self._lock:
            workspace = self.workspace
            if self._aborted or workspace is None or self._identity is None:
                raise WorkspaceStateError(
                    "preparation has no handoff resource"
                )
            with publication_execution(
                self.state.journal.path, self.reference_owner
            ):
                with self.state.journal._write_transaction() as connection:
                    request = connection.execute(
                        "SELECT status,admitted_run_id,admitted_attempt_id FROM execution_requests WHERE request_id=?",
                        (self.request_id,),
                    ).fetchone()
                    binding = connection.execute(
                        "SELECT run_id,generation,workspace_id,provider,snapshot_revision,root_path FROM run_workspace_bindings WHERE attempt_id=?",
                        (self.attempt_id,),
                    ).fetchone()
                    if (
                        request is None
                        or request[0] != "admitted"
                        or request[2] != self.attempt_id
                        or binding is None
                        or tuple(binding)
                        != (
                            request[1],
                            self.generation,
                            workspace.workspace_id,
                            workspace.provider,
                            workspace.input_revision,
                            str(workspace.local_root),
                        )
                        or not connection.execute(
                            "SELECT 1 FROM workspace_revision_references WHERE revision=? AND owner=?",
                            (
                                workspace.input_revision,
                                f"run:{request[1]}:input",
                            ),
                        ).fetchone()
                    ):
                        raise WorkspaceStateError(
                            "Run input retention has not taken ownership"
                        )
                    self._release_references(connection)
                    self._handed_off = True
