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

"""Read the installed model policy without loading any provider credentials."""

from app.model.session_model import SessionModelSelection
from app.run_journal import OptimisticConcurrencyError, SQLiteRunJournal
from app.workspace_bundle.runtime import EnvironmentSetupRequiredError
from app.workspace_config.models import (
    WorkspaceBundleManifest,
    WorkspaceModelSelection,
)


def installed_model_selection(
    journal: SQLiteRunJournal, space_id: str
) -> WorkspaceModelSelection | None:
    installed = journal.get_latest_workspace_config_materialization(space_id)
    if installed is None:
        return None
    if installed.state != "materialized":
        raise EnvironmentSetupRequiredError(
            ["workspace_bundle_not_materialized"]
        )
    revision = journal.get_workspace_config_revision(installed.revision_id)
    if revision is None:
        raise EnvironmentSetupRequiredError(
            ["workspace_bundle_revision_missing"]
        )
    manifest = WorkspaceBundleManifest.model_validate(revision.manifest)
    if len(manifest.spec.agents) > 1:
        raise EnvironmentSetupRequiredError(
            ["multi_agent_runtime_adapter_unavailable"]
        )
    proposal = journal.get_active_workspace_bundle_proposal(
        space_id=space_id, revision_id=installed.revision_id
    )
    if proposal is not None and proposal.state != "materialized":
        raise EnvironmentSetupRequiredError(
            ["workspace_bundle_not_materialized"]
        )
    profile_name = (
        manifest.spec.agents[0].model_profile
        if manifest.spec.agents
        else "default"
    )
    profile = manifest.spec.models[profile_name]
    if (
        journal.get_latest_workspace_config_materialization(space_id)
        != installed
    ):
        raise OptimisticConcurrencyError("workspace model selection changed")
    return WorkspaceModelSelection(
        materialization_id=installed.materialization_id,
        revision_id=installed.revision_id,
        model_profile=profile_name,
        model_ref=profile.model_ref,
        thinking_effort=profile.thinking_effort,
    )


def accepted_session_model(
    journal: SQLiteRunJournal, *, space_id: str, project_id: str
) -> dict | None:
    """Recover only an admitted initial binding, never a merely pending Run row."""
    runs = journal.list_runs(project_id=project_id, limit=501)
    if len(runs) > 500:
        raise ValueError(
            "Session model recovery exceeds the bounded Run window"
        )
    for run in sorted(runs, key=lambda item: (item.created_at, item.run_id)):
        for attempt in journal.list_run_attempts(run.run_id):
            if (
                attempt.resume_reason != "initial_execution"
                or not attempt.environment_spec_id
            ):
                continue
            events = journal.get_events_by_id(
                [f"user-message:{attempt.resume_request_id}"]
            )
            if not events:
                continue
            event = events[0]
            if (
                event.run_id != run.run_id
                or event.event_type != "user.message"
            ):
                raise ValueError("Invalid admitted Session input")
            origin = event.payload.get("session_model_selection") or {}
            if origin.get("space_id") != space_id:
                raise ValueError("Session model ownership is unavailable")
            selection = SessionModelSelection.model_validate(
                origin.get("selection")
            )
            environment = journal.get_effective_environment_spec(
                attempt.environment_spec_id
            )
            model = (
                environment.spec.get("semantic_spec", {})
                .get("runtime_capability_manifest", {})
                .get("model", {})
                if environment
                else {}
            )
            if (
                not environment
                or environment.environment_spec_digest
                != attempt.environment_spec_digest
                or model.get("platform") != selection.model_platform
                or model.get("type") != selection.model_type
            ):
                raise ValueError(
                    "Session model does not match its admitted environment"
                )
            return {
                "run_id": run.run_id,
                "selection": selection.model_dump(
                    mode="json", by_alias=True, exclude_none=True
                ),
            }
    return None
