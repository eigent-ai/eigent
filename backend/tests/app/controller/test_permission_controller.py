from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.controller.permission_controller import (
    PermissionProfileBody,
    get_permission_profile,
    put_permission_profile,
)
from app.permission_policy import PermissionProfileName
from app.run_journal import SQLiteRunJournal


@pytest.mark.asyncio
async def test_permission_profile_defaults_and_optimistic_update(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        with patch(
            "app.controller.permission_controller.get_default_run_journal",
            return_value=journal,
        ):
            default = await get_permission_profile("space-1")
            updated = await put_permission_profile(
                "space-1",
                PermissionProfileBody(
                    profile_name=PermissionProfileName.AUTO_REVIEWER,
                    request_id="request-1",
                    updated_by="user-1",
                    expected_revision=0,
                ),
            )
            replay = await put_permission_profile(
                "space-1",
                PermissionProfileBody(
                    profile_name=PermissionProfileName.AUTO_REVIEWER,
                    request_id="request-1",
                    updated_by="user-1",
                    expected_revision=0,
                ),
            )

        assert default["profile_name"] == "request_approval"
        assert default["revision"] == 0
        assert updated["profile_name"] == "auto_reviewer"
        assert updated["revision"] == 1
        assert replay == updated
        revision = journal.get_space_permission_profile_revision(
            "space:space-1:1"
        )
        assert revision is not None
        assert revision.profile_name == "auto_reviewer"
        with journal._lock:
            audits = journal._connection.execute(
                "SELECT * FROM security_audit_events"
            ).fetchall()
        assert len(audits) == 1
        assert audits[0]["event_type"] == "permission.profile.modified"


@pytest.mark.asyncio
async def test_permission_profile_rejects_stale_revision(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.put_space_permission_profile(
            space_id="space-1",
            profile_name="request_approval",
            sandbox_mode="workspace-write",
            approval_mode="on-request",
            reviewer_mode="user",
            updated_by="user-1",
            now=1,
        )
        with patch(
            "app.controller.permission_controller.get_default_run_journal",
            return_value=journal,
        ):
            with pytest.raises(HTTPException) as error:
                await put_permission_profile(
                    "space-1",
                    PermissionProfileBody(
                        profile_name=PermissionProfileName.FULL_ACCESS,
                        request_id="request-2",
                        updated_by="user-1",
                        expected_revision=0,
                    ),
                )
        assert error.value.status_code == 409
