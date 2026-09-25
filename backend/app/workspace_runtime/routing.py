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

"""Durable Session routing shares the admission/legacy writer boundary.

This is an ownership fact, not a second queue. Once explicitly claimed, a
Session never becomes legacy because a request was cancelled or capability
was disabled. execution_requests remains the only intent queue.
"""

from __future__ import annotations

import time

from .admission import AdmissionConflict
from .entry_guard import (
    ManagedExecutionRequired,
    owns_managed_execution_in_connection,
)
from .service import ExecutionForbidden

SINGLE_PROFILE = "single-agent-workspace-files-v1"


def queue_window(connection, project_id):
    latest = connection.execute(
        "SELECT COALESCE(MAX(queue_seq),0) FROM execution_requests WHERE project_id=?",
        (project_id,),
    ).fetchone()[0]
    active = connection.execute(
        """SELECT MIN(e.queue_seq) FROM execution_requests e
        LEFT JOIN run_workspace_finalizations f ON f.run_id=e.admitted_run_id
        WHERE e.project_id=? AND (e.status IN ('pending','preparing')
        OR (e.status='admitted' AND (f.state IS NULL OR f.state!='settled')))""",
        (project_id,),
    ).fetchone()[0]
    return {
        "has_requests": latest > 0,
        "request_cursor": max(0, active - 1 if active else latest - 50),
    }


def route_row(connection, project_id):
    return connection.execute(
        "SELECT * FROM project_execution_routes WHERE project_id=?",
        (project_id,),
    ).fetchone()


def registration_reason(connection, project_id, principal_ref):
    route = route_row(connection, project_id)
    if route is not None:
        if route["route"] == "legacy":
            return "new_session_required"
        if route["principal_ref"] != principal_ref:
            raise ExecutionForbidden("Session belongs to another principal")
        return None
    for query in (
        "SELECT 1 FROM runs WHERE project_id=? LIMIT 1",
        "SELECT 1 FROM execution_requests WHERE project_id=? LIMIT 1",
        """SELECT 1 FROM follow_up_requests WHERE project_id=?
        AND status IN ('pending','admitted') LIMIT 1""",
        "SELECT 1 FROM project_run_execution_leases WHERE project_id=? LIMIT 1",
    ):
        if connection.execute(query, (project_id,)).fetchone():
            return "new_session_required"
    return None


def claim_managed_in_transaction(connection, configuration):
    snapshot = configuration.snapshot
    if snapshot["profile"] != SINGLE_PROFILE:
        raise AdmissionConflict("single_agent_required")
    reason = registration_reason(
        connection, snapshot["project_id"], snapshot["principal_ref"]
    )
    if reason:
        raise AdmissionConflict(reason)
    row = route_row(connection, snapshot["project_id"])
    if row is not None and row["space_id"] != snapshot["space_id"]:
        raise AdmissionConflict("Session Space cannot change")
    connection.execute(
        """INSERT OR IGNORE INTO project_execution_routes
        (project_id,route,principal_ref,space_id,created_at)
        VALUES (?,'managed_single',?,?,?)""",
        (
            snapshot["project_id"],
            snapshot["principal_ref"],
            snapshot["space_id"],
            time.time(),
        ),
    )


def claim_legacy_session(journal, project_id):
    """Reserve before legacy runtime/credential/browser preparation begins."""
    with journal._write_transaction() as connection:
        if owns_managed_execution_in_connection(
            connection, project_id=project_id
        ):
            raise ManagedExecutionRequired(
                "This Session requires the managed execution API."
            )
        connection.execute(
            """INSERT OR IGNORE INTO project_execution_routes
            (project_id,route,created_at) VALUES (?,'legacy',?)""",
            (project_id, time.time()),
        )


def require_submission_in_transaction(
    connection, *, project_id, request_id, kind, envelope, origin
):
    row = route_row(connection, project_id)
    if row is None:
        return  # Existing trusted C1–C5 producers keep their contracts.
    if row["route"] == "legacy":
        raise AdmissionConflict("new_session_required")
    if row["principal_ref"] != origin.principal_ref:
        raise ExecutionForbidden("Session belongs to another principal")
    if (
        origin.source != "local"
        or kind not in {"start", "follow_up"}
        or envelope.get("session_mode") != "single-agent"
        or envelope.get("space_id") != row["space_id"]
        or envelope.get("attachment_ids")
        or envelope.get("review_handoff_ids")
    ):
        raise AdmissionConflict("session_content_unsupported")
    existing = connection.execute(
        "SELECT 1 FROM execution_requests WHERE request_id=?", (request_id,)
    ).fetchone()
    has_previous = connection.execute(
        "SELECT 1 FROM execution_requests WHERE project_id=? LIMIT 1",
        (project_id,),
    ).fetchone()
    if not existing and ((kind == "start") == bool(has_previous)):
        raise AdmissionConflict("session_request_kind_conflict")
