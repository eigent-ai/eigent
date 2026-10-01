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

"""Reject legacy admission before it mutates a managed Session's runtime.

This read guard complements the Journal's transactional Attempt guard. It
does not reserve a lane or replace that guard; a concurrent handoff still has
to pass the authoritative database check. Historical workspace bindings keep
their Session on the managed path even after the current Run is settled.
"""

from __future__ import annotations

import asyncio
import sqlite3

from app.run_journal import InvalidRunTransitionError, SQLiteRunJournal


class ManagedExecutionRequired(InvalidRunTransitionError):
    """A legacy mutation must use the canonical execution service instead."""


def has_isolated_workspace_binding(
    journal: SQLiteRunJournal, run_id: str
) -> bool:
    """Legacy recovery must leave every isolated generation to its finalizer.

    A retained binding or finalization receipt is sufficient, including a
    settled one. Missing/corrupt schema is an error, never permission to read
    mutable files or release owners through the legacy path.
    """
    with journal._lock:
        return (
            journal._connection.execute(
                """SELECT 1 FROM run_workspace_bindings WHERE run_id=?
                UNION ALL
                SELECT 1 FROM run_workspace_finalizations WHERE run_id=?
                LIMIT 1""",
                (run_id, run_id),
            ).fetchone()
            is not None
        )


def owns_managed_execution(
    journal: object,
    *,
    project_id: str | None = None,
    run_id: str | None = None,
) -> bool:
    """Read ownership from the same Journal used by the legacy entry point."""
    if not isinstance(journal, SQLiteRunJournal):
        raise TypeError("Execution ownership requires the durable Journal")
    with journal._lock:
        return owns_managed_execution_in_connection(
            journal._connection, project_id=project_id, run_id=run_id
        )


def owns_managed_execution_in_connection(
    connection: sqlite3.Connection,
    *,
    project_id: str | None = None,
    run_id: str | None = None,
) -> bool:
    """Use the caller's database boundary, including its active write lock.

    A preflight read alone cannot authorize a later legacy queue mutation.
    Its writer must call this again inside the transaction that changes the
    compatibility row, so a managed admission cannot commit between them.
    """
    projects = {project_id} if project_id is not None else set()
    if run_id is not None:
        row = connection.execute(
            "SELECT project_id FROM runs WHERE run_id=?", (run_id,)
        ).fetchone()
        if row is not None:
            projects.add(row[0])
    for project in projects:
        for query in (
            """SELECT 1 FROM project_execution_routes WHERE project_id=?
            AND route='managed_single' LIMIT 1""",
            """SELECT 1 FROM execution_requests WHERE project_id=?
            AND status IN ('pending','preparing','admitted') LIMIT 1""",
            """SELECT 1 FROM project_admission_claims WHERE project_id=?
            AND state!='released' LIMIT 1""",
            """SELECT 1 FROM run_workspace_bindings binding
            JOIN runs owner ON owner.run_id=binding.run_id
            WHERE owner.project_id=? LIMIT 1""",
            """SELECT 1 FROM run_workspace_finalizations finalization
            JOIN runs owner ON owner.run_id=finalization.run_id
            WHERE owner.project_id=? LIMIT 1""",
        ):
            if connection.execute(query, (project,)).fetchone():
                return True
    return False


async def guard_legacy_execution_entry(
    journal: object,
    *,
    project_id: str | None = None,
    run_id: str | None = None,
) -> None:
    """HTTP compatibility boundary; never expose private workspace details."""
    from fastapi import HTTPException

    if not isinstance(journal, SQLiteRunJournal):
        raise HTTPException(
            status_code=503,
            detail={"code": "execution_ownership_unavailable"},
        )
    if await asyncio.to_thread(
        owns_managed_execution,
        journal,
        project_id=project_id,
        run_id=run_id,
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "managed_execution_required",
                "message": "This Session requires the managed execution API.",
            },
        )
