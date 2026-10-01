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

"""Accepted Session recovery uses canonical admission, not transport delivery."""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.controller import chat_controller
from app.model.session_model import SessionModelSelection
from app.run_journal import SQLiteRunJournal
from app.workspace_config.admission import (
    EnvironmentAdmissionService,
    LegacyEnvironmentImporter,
)
from app.workspace_config.model_selection import accepted_session_model


@pytest.fixture
def admitted(tmp_path):
    with SQLiteRunJournal(tmp_path / "recovery.sqlite3") as journal:
        journal.ensure_run(
            run_id="original-run", project_id="session-1", status="pending"
        )
        template = LegacyEnvironmentImporter().build_template(
            model_platform="azure",
            model_type="gpt-5.5",
            auth_source=None,
            requested_effort="medium",
            allow_local_system=False,
            session_mode="single-agent",
        )
        environment = EnvironmentAdmissionService(journal).persist_for_run(
            run_id="original-run",
            space_id="space-1",
            working_directory=tmp_path,
            created_by="fixture",
            template=template,
        )
        selection = {
            "modelType": "cloud",
            "cloud_model_type": "original-catalog",
            "model_platform": "azure",
            "model_type": "gpt-5.5",
            "model_ref": "provider://cloud/original-catalog",
            "thinking_effort": "medium",
        }
        yield journal, environment, selection


def test_pending_run_and_even_prepared_environment_are_not_acceptance(
    admitted,
):
    journal, _, _ = admitted
    assert (
        accepted_session_model(
            journal, space_id="space-1", project_id="session-1"
        )
        is None
    )


@pytest.mark.asyncio
async def test_canonical_input_and_bound_attempt_recover_original_selection_without_sse(
    admitted,
):
    journal, environment, selection = admitted
    journal.create_run_attempt(
        "original-run",
        request_id="original-request",
        reason="initial_execution",
        activate=False,
        environment=environment.binding,
    )
    assert (
        accepted_session_model(
            journal, space_id="space-1", project_id="session-1"
        )
        is None
    )
    # This is the real admission recorder, before the client can receive onopen.
    await chat_controller._record_canonical_user_message(
        journal,
        run_context=SimpleNamespace(
            project_id="session-1", run_id="original-run"
        ),
        request_id="original-request",
        content="Synthetic question",
        source="chat",
        attaches=[],
        session_model_selection={
            "space_id": "space-1",
            "selection": selection,
        },
    )
    # A later merely pending request cannot replace the accepted origin.
    journal.ensure_run(
        run_id="later-pending", project_id="session-1", status="pending"
    )
    before = journal._connection.total_changes
    assert accepted_session_model(
        journal, space_id="space-1", project_id="session-1"
    ) == {"run_id": "original-run", "selection": selection}
    assert journal._connection.total_changes == before
    assert (
        accepted_session_model(
            journal, space_id="space-1", project_id="another-session"
        )
        is None
    )
    with pytest.raises(ValueError, match="ownership"):
        accepted_session_model(
            journal, space_id="another-space", project_id="session-1"
        )


@pytest.mark.asyncio
async def test_recovery_rejects_a_pin_that_disagrees_with_the_actual_attempt(
    admitted,
):
    journal, environment, selection = admitted
    journal.create_run_attempt(
        "original-run",
        request_id="original-request",
        reason="initial_execution",
        activate=False,
        environment=environment.binding,
    )
    await chat_controller._record_canonical_user_message(
        journal,
        run_context=SimpleNamespace(
            project_id="session-1", run_id="original-run"
        ),
        request_id="original-request",
        content="Synthetic question",
        source="chat",
        attaches=[],
        session_model_selection={
            "space_id": "space-1",
            "selection": {**selection, "model_type": "changed-model"},
        },
    )
    with pytest.raises(ValueError, match="admitted environment"):
        accepted_session_model(
            journal, space_id="space-1", project_id="session-1"
        )


def test_private_recovery_pin_schema_excludes_credentials(admitted):
    _, _, selection = admitted
    assert (
        SessionModelSelection.model_validate(selection).model_dump(
            by_alias=True, exclude_none=True
        )
        == selection
    )
    with pytest.raises(ValidationError):
        SessionModelSelection.model_validate(
            {**selection, "api_key": "synthetic-secret"}
        )
