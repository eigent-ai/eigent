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

"""Resolve immutable execution identity and the persistent Space binding."""

from pathlib import Path

from .models import RecordingError, RecordingScope


def resolve_scope(run_id: str, principal: str) -> RecordingScope:
    from app.run_journal import get_default_run_journal
    from app.utils.workspace_resolver import get_workspace_resolver

    journal = get_default_run_journal()
    run = journal.get_run(run_id)
    if run is None:
        raise RecordingError("recording_scope_not_found", 404)
    if run.status not in {"running", "waiting_for_user", "pending"}:
        raise RecordingError("task_not_active")
    resolver = get_workspace_resolver()
    found = resolver.store.find_snapshot(run_id)
    if not found:
        return _managed_scope(journal, resolver, run, principal)
    owner, snapshot = found
    if snapshot.project_id != run.project_id:
        raise RecordingError("recording_scope_mismatch", 403)
    if (
        principal.startswith("brain_user:")
        and str(snapshot.user_id) != principal.split(":", 1)[1]
    ):
        raise RecordingError("recording_forbidden", 403)
    binding = resolver.store.get_binding(
        owner, snapshot.space_id, snapshot.user_id
    )
    if not binding:
        raise RecordingError("workspace_unbound", 412)
    root = Path(binding.workspace_root).expanduser()
    if root.is_symlink() or not root.is_dir():
        raise RecordingError("workspace_rebound")
    return RecordingScope(
        principal=principal,
        account=owner,
        space_id=snapshot.space_id,
        project_id=run.project_id,
        task_id=snapshot.task_id,
        run_id=run_id,
        attempt_id=run.active_attempt_id,
        root=root.resolve(),
        binding_version=binding.updated_at,
        user_id=str(snapshot.user_id)
        if snapshot.user_id is not None
        else None,
    )


def binding_matches(record: dict) -> bool:
    from app.utils.workspace_resolver import get_workspace_resolver

    binding = get_workspace_resolver().store.get_binding(
        record["account"], record["space_id"], record.get("user_id")
    )
    return bool(
        binding
        and str(Path(binding.workspace_root).expanduser().resolve())
        == record["root"]
        and binding.updated_at == record["binding_version"]
    )


def active_attempt(run_id: str) -> tuple[bool, str | None]:
    from app.run_journal import get_default_run_journal

    run = get_default_run_journal().get_run(run_id)
    return (
        bool(run and run.status in {"running", "waiting_for_user", "pending"}),
        run.active_attempt_id if run else None,
    )


def _managed_scope(journal, resolver, run, principal) -> RecordingScope:
    """Use the admitted immutable registration, never the agent checkout root."""
    import json

    from app.utils.workspace_paths import runtime_owner_key

    with journal._lock:
        request = journal._connection.execute(
            "SELECT envelope_json FROM execution_requests WHERE admitted_run_id=? AND admitted_attempt_id=? AND status='admitted' ORDER BY queue_seq DESC LIMIT 1",
            (run.run_id, run.active_attempt_id),
        ).fetchone()
        if request is None:
            raise RecordingError("recording_scope_unavailable", 412)
        envelope = json.loads(request[0])
        registered = journal._connection.execute(
            "SELECT document_json,principal_ref FROM managed_execution_configurations WHERE configuration_revision=? AND project_id=?",
            (envelope.get("configuration_revision"), run.project_id),
        ).fetchone()
    if registered is None or registered[1] != envelope.get("principal_ref"):
        raise RecordingError("recording_scope_unavailable", 412)
    document = json.loads(registered[0])
    source = document["binding"]["source"]
    config = document["configuration"]
    user_id = str(source["account_owner_id"])
    if (
        principal.startswith("brain_user:")
        and user_id != principal.split(":", 1)[1]
    ):
        raise RecordingError("recording_forbidden", 403)
    if (
        config["project_id"] != run.project_id
        or config["space_id"] != source["space_id"]
        or config["principal_ref"] != registered[1]
    ):
        raise RecordingError("recording_scope_mismatch", 403)
    binding = resolver.store.get_canonical_binding(user_id, source["space_id"])
    frozen = document["binding"]["workspace_binding"]
    if (
        not binding
        or binding.updated_at != frozen["updated_at"]
        or str(Path(binding.workspace_root).resolve())
        != document["binding"]["source_root"]
    ):
        raise RecordingError("workspace_rebound")
    return RecordingScope(
        principal=principal,
        account=runtime_owner_key("", user_id),
        space_id=source["space_id"],
        project_id=run.project_id,
        task_id=run.run_id,
        run_id=run.run_id,
        attempt_id=run.active_attempt_id,
        root=Path(binding.workspace_root).resolve(),
        binding_version=binding.updated_at,
        user_id=user_id,
    )
