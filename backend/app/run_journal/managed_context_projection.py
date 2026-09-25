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

"""Strict managed mode of the Journal ContextProjector; no history store.

Capture follows durable admission, in one bounded read snapshot. Legacy
Project-only history is deliberately not an authenticated source. The legacy
projector's defaults and compatibility behavior remain unchanged.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from app.permission_policy.models import redact_action_arguments
from app.workspace_config.models import (
    canonical_digest,
    redact_device_home_paths,
)

from .context_projection import _TERMINAL_TOOL_EVENT_TYPES, _latest_tool_events

MAX_RUNS = 8
MAX_EVENTS = 512
MAX_RUN_BYTES = 128 * 1024
MAX_SOURCE_BYTES = 1024 * 1024
MAX_BINDING_BYTES = 256 * 1024


class ContextSourceUnavailable(RuntimeError):
    """A fixed reason only; never interpolate source contents into errors."""


@dataclass(frozen=True)
class ContextRun:
    text: str
    source_event_ids: tuple[str, ...]


@dataclass(frozen=True)
class ManagedContextSource:
    project_id: str
    run_id: str
    attempt_id: str
    question: str
    project_state_version: int
    runs: tuple[ContextRun, ...]
    omitted_runs: int
    destination: str


def _fail():
    raise ContextSourceUnavailable("context_source_binding_invalid")


def _json(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _decode(value):
    if not isinstance(value, str) or len(value.encode()) > MAX_BINDING_BYTES:
        _fail()
    result = json.loads(value)
    if not isinstance(result, dict):
        _fail()
    return result


def _message(payload):
    for key in ("content", "message", "result", "error"):
        if isinstance(payload.get(key), str):
            return payload[key]
    raise ContextSourceUnavailable("context_message_schema_unsupported")


def _redact(payload):
    def paths(value):
        if isinstance(value, str):
            return redact_device_home_paths(value)
        if isinstance(value, list):
            return [paths(item) for item in value]
        if isinstance(value, dict):
            return {
                key: "[REDACTED]"
                if any(
                    word in key.lower()
                    for word in ("credential", "secret", "private_key")
                )
                else paths(item)
                for key, item in value.items()
            }
        return value

    return paths(redact_action_arguments(payload))


def render_managed_run(events, *, run_id, attempt_id, outcome):
    """Keep complete semantic records, including paired tool request/outcome."""
    latest = _latest_tool_events(events)
    typed_user = any(e.event_type == "user.message" for e in events)
    typed_final = any(e.event_type == "assistant.final" for e in events)
    if not any(e.event_type == f"run.{outcome}" for e in events):
        raise ContextSourceUnavailable("context_terminal_evidence_missing")
    records, source_ids = [], []
    for event in events:
        if event.run_id != run_id:
            _fail()
        kind = event.event_type
        payload = _redact(event.payload)
        record = None
        if kind == "user.message":
            record = {"kind": kind, "content": _message(payload)}
        elif (
            not typed_user
            and kind == "legacy.confirmed"
            and isinstance(payload.get("question"), str)
        ):
            record = {"kind": "user.message", "content": payload["question"]}
        elif kind == "assistant.final" or (
            not typed_final
            and kind == "legacy.end"
            and event.legacy_step == "end"
        ):
            record = {
                "kind": "assistant.final"
                if outcome == "completed"
                else "assistant.observation",
                "content": _message(payload),
                "run_outcome": outcome,
            }
        elif kind.startswith("tool."):
            call_id = payload.get("tool_call_id")
            if not isinstance(call_id, str) or not call_id:
                raise ContextSourceUnavailable("context_tool_identity_missing")
            if latest.get(call_id) is not event:
                continue
            if payload.get("attempt_id") != attempt_id:
                raise ContextSourceUnavailable("context_tool_owner_mismatch")
            status = kind.removeprefix("tool.")
            if status not in {
                "prepared",
                "dispatched",
                "completed",
                "failed",
                "timed_out",
                "outcome_unknown",
            }:
                raise ContextSourceUnavailable(
                    "context_tool_outcome_unsupported"
                )
            request_event = next(
                (
                    e
                    for e in reversed(events)
                    if e.sequence <= event.sequence
                    and e.event_type.startswith("tool.")
                    and e.payload.get("tool_call_id") == call_id
                    and isinstance(e.payload.get("request"), dict)
                ),
                None,
            )
            request = {}
            if request_event is not None:
                if request_event.payload.get("attempt_id") != attempt_id:
                    raise ContextSourceUnavailable(
                        "context_tool_owner_mismatch"
                    )
                request = _redact(request_event.payload["request"])
                source_ids.append(request_event.event_id)
            record = {
                "kind": "tool.fact",
                "tool_call_id": call_id,
                "tool_name": payload.get("tool_name", "unknown"),
                "request": request,
                "status": status,
                "result": payload.get("result"),
                "outcome": payload.get("outcome"),
                "timeout_reason": payload.get("timeout_reason"),
                "external_effect_may_have_occurred": status
                in {"dispatched", "outcome_unknown"},
                "durable_outcome_observed": kind in _TERMINAL_TOOL_EVENT_TYPES,
                **{
                    key: payload[key]
                    for key in ("agent_id", "step_id")
                    if key in payload
                },
            }
        elif kind in {"interaction.resolved", "approval.decided"}:
            if payload.get("attempt_id") not in {None, attempt_id}:
                raise ContextSourceUnavailable(
                    "context_interaction_owner_mismatch"
                )
            record = {
                "kind": kind,
                "historical_only": True,
                **{
                    key: payload[key]
                    for key in ("decision", "status", "reason")
                    if key in payload
                },
            }
        elif kind in {
            "run.completed",
            "run.failed",
            "run.cancelled",
            "run.interrupted",
            "run.deadline_reached",
        }:
            record = {
                "kind": kind,
                **{
                    key: payload[key]
                    for key in (
                        "reason",
                        "error",
                        "message",
                        "outcome",
                        "timeout_reason",
                    )
                    if key in payload
                },
            }
        if record is not None:
            records.append(record)
            source_ids.append(event.event_id)
    return ContextRun(
        _json({"run_id": run_id, "outcome": outcome, "records": records}),
        tuple(dict.fromkeys(source_ids)),
    )


def _owner(connection, row, *, request, binding, snapshot, current=False):
    from app.workspace_runtime.admission import _digest

    envelope = _decode(row["envelope_json"])
    if _digest(envelope) != row["envelope_digest"] or (
        row["project_id"],
        envelope.get("principal_ref"),
        envelope.get("space_id"),
    ) != (request.project_id, snapshot["principal_ref"], snapshot["space_id"]):
        _fail()
    config = connection.execute(
        """SELECT configuration_revision,project_id,principal_ref,
           CASE WHEN length(CAST(document_json AS BLOB))<=? THEN document_json END AS document_json
           FROM managed_execution_configurations WHERE configuration_revision=?""",
        (MAX_BINDING_BYTES, envelope.get("configuration_revision")),
    ).fetchone()
    if config is None:
        if current:
            _fail()
        return None
    document = _decode(config["document_json"])
    saved, registered = document["configuration"], document["binding"]
    source = registered["source"]
    principal = f"account:{canonical_digest(registered['authority'])}:{source['account_owner_id']}:{source['desktop_instance_id']}"
    if (
        config["configuration_revision"]
        != "agentcfg:" + canonical_digest(saved)
        or saved.get("registration_binding")
        != "binding:" + canonical_digest(registered)
        or (config["project_id"], config["principal_ref"], principal)
        != (
            request.project_id,
            snapshot["principal_ref"],
            snapshot["principal_ref"],
        )
        or any(
            saved.get(key) != snapshot[key]
            for key in ("project_id", "space_id", "principal_ref")
        )
        or (source.get("project_id"), source.get("space_id"))
        != (request.project_id, snapshot["space_id"])
        or (current and saved != snapshot)
    ):
        _fail()
    run = connection.execute(
        """SELECT r.project_id,r.status,r.active_attempt_id,a.run_id,a.attempt_id,
                  a.environment_spec_id,a.environment_spec_digest,
                  s.owner_type,s.owner_id,
                  CASE WHEN length(CAST(s.spec_json AS BLOB))<=? THEN s.spec_json END AS spec_json,
                  s.environment_spec_digest AS spec_digest,
                  b.generation,b.workspace_id,b.policy_version,f.state,
                  f.owner_attempt_id,(f.writer_settlement_json IS NOT NULL) AS writer_settled,f.outcome
           FROM runs r JOIN run_attempts a ON a.run_id=r.run_id AND a.attempt_id=?
           JOIN effective_environment_specs s ON s.environment_spec_id=a.environment_spec_id
           JOIN run_workspace_finalizations f ON f.run_id=r.run_id
           JOIN run_workspace_bindings b ON b.run_id=r.run_id AND b.generation=f.generation AND b.attempt_id=a.attempt_id
           WHERE r.run_id=?""",
        (
            MAX_BINDING_BYTES,
            row["admitted_attempt_id"],
            row["admitted_run_id"],
        ),
    ).fetchone()
    if run is None or (
        run["project_id"] != request.project_id
        or run["owner_attempt_id"] != row["admitted_attempt_id"]
        or run["environment_spec_digest"] != run["spec_digest"]
        or (run["owner_type"], run["owner_id"])
        != ("run", row["admitted_run_id"])
        or run["policy_version"] != "isolated-v1"
    ):
        _fail()
    spec = _decode(run["spec_json"])
    manifest = spec["semantic_spec"].get("runtime_capability_manifest", {})
    if (
        canonical_digest(spec) != run["spec_digest"]
        or spec.get("spec_id") != run["environment_spec_id"]
        or manifest.get("managed_agent") != saved
        or manifest.get("configuration_revision")
        != config["configuration_revision"]
    ):
        _fail()
    if current:
        if (
            (
                run["run_id"],
                run["attempt_id"],
                run["active_attempt_id"],
                run["generation"],
                run["workspace_id"],
                run["environment_spec_id"],
            )
            != (
                binding.run_id,
                binding.attempt_id,
                binding.attempt_id,
                binding.generation,
                binding.workspace.workspace_id,
                binding.environment_spec_id,
            )
            or run["status"] != "running"
            or run["state"] != "pending"
        ):
            _fail()
    elif (
        run["state"] != "settled"
        or not run["writer_settled"]
        or run["status"]
        not in {"completed", "failed", "cancelled", "interrupted"}
        or run["outcome"] != run["status"]
    ):
        _fail()
    return run


def _question(connection, row):
    from app.workspace_runtime.admission import AdmissionStore

    question = _decode(row["envelope_json"]).get("prompt")
    if row["kind"] == "follow_up":
        message = connection.execute(
            """SELECT project_id,source,source_command_id,
                CASE WHEN length(CAST(content AS BLOB))<=? THEN content END AS content,
                CASE WHEN length(CAST(attachment_paths_json AS BLOB))<=? THEN attachment_paths_json END AS attachment_paths_json,
                CASE WHEN length(CAST(review_handoff_ids_json AS BLOB))<=? THEN review_handoff_ids_json END AS review_handoff_ids_json
                FROM follow_up_requests WHERE request_id=? AND project_id=? AND status='admitted' AND admitted_run_id=?""",
            (
                MAX_BINDING_BYTES,
                MAX_BINDING_BYTES,
                MAX_BINDING_BYTES,
                row["source_follow_up_request_id"],
                row["project_id"],
                row["admitted_run_id"],
            ),
        ).fetchone()
        if (
            message is None
            or AdmissionStore._message_digest(message)
            != row["source_message_digest"]
        ):
            _fail()
        question = message["content"]
    event = connection.execute(
        "SELECT CASE WHEN length(CAST(payload_json AS BLOB))<=? THEN payload_json END FROM run_events WHERE event_id=? AND run_id=? AND event_type='user.message'",
        (
            MAX_BINDING_BYTES,
            "execution-input:" + row["request_id"],
            row["admitted_run_id"],
        ),
    ).fetchone()
    if (
        not isinstance(question, str)
        or event is None
        or _decode(event[0])
        != {"content": question, "request_id": row["request_id"]}
    ):
        _fail()
    return question


def _capture(connection, journal, request, binding, snapshot, destination):
    if destination != snapshot["api_url"]:
        raise ContextSourceUnavailable("context_destination_not_authorized")

    current = connection.execute(
        """SELECT request_id,project_id,kind,queue_seq,envelope_digest,
                  source_follow_up_request_id,source_message_digest,admitted_run_id,admitted_attempt_id,
                  CASE WHEN length(CAST(envelope_json AS BLOB))<=? THEN envelope_json END AS envelope_json
           FROM execution_requests WHERE request_id=? AND project_id=? AND status='admitted'""",
        (MAX_BINDING_BYTES, request.request_id, request.project_id),
    ).fetchone()
    if (
        current is None
        or current["kind"] not in {"start", "follow_up"}
        or (
            current["admitted_run_id"],
            current["admitted_attempt_id"],
            current["envelope_digest"],
            current["kind"],
        )
        != (
            binding.run_id,
            binding.attempt_id,
            request.envelope_digest,
            request.kind,
        )
    ):
        _fail()
    _owner(
        connection,
        current,
        request=request,
        binding=binding,
        snapshot=snapshot,
        current=True,
    )
    question = _question(connection, current)
    # The existing (project_id,updated_at DESC) index bounds the candidate
    # window, including unverifiable legacy Runs. Queue sequence is intent
    # insertion order: Send now can execute newer intents before older ones.
    # Authenticate candidates, then order by the actual admission generation.
    candidates = connection.execute(
        """SELECT run_id FROM runs WHERE project_id=? AND run_id!=?
           ORDER BY updated_at DESC LIMIT ?""",
        (request.project_id, binding.run_id, MAX_RUNS + 1),
    ).fetchall()
    runs, omitted, used = [], int(len(candidates) > MAX_RUNS), 0
    for candidate in candidates[:MAX_RUNS]:
        row = connection.execute(
            """SELECT request_id,project_id,kind,queue_seq,envelope_digest,
                      source_follow_up_request_id,source_message_digest,admitted_run_id,admitted_attempt_id,
                      CASE WHEN length(CAST(envelope_json AS BLOB))<=? THEN envelope_json END AS envelope_json
               FROM execution_requests WHERE request_id=? AND project_id=? AND status='admitted'""",
            (MAX_BINDING_BYTES, candidate["run_id"], request.project_id),
        ).fetchone()
        if row is None:
            omitted += 1
            continue
        if (
            row["admitted_run_id"] != candidate["run_id"]
            or row["kind"] == "resume"
        ):
            _fail()
        prior = _owner(
            connection,
            row,
            request=request,
            binding=binding,
            snapshot=snapshot,
        )
        if prior is None:
            omitted += 1
            continue
        if prior["generation"] >= binding.generation:
            _fail()
        _question(connection, row)
        headers = connection.execute(
            "SELECT sequence,length(CAST(payload_json AS BLOB)) AS bytes FROM run_events WHERE run_id=? ORDER BY sequence LIMIT ?",
            (row["admitted_run_id"], MAX_EVENTS + 1),
        ).fetchall()
        size = sum(item["bytes"] for item in headers)
        if (
            len(headers) > MAX_EVENTS
            or size > MAX_RUN_BYTES
            or used + size > MAX_SOURCE_BYTES
        ):
            omitted += 1
            continue
        events = journal.list_events(row["admitted_run_id"], limit=MAX_EVENTS)
        runs.append(
            (
                prior["generation"],
                render_managed_run(
                    events,
                    run_id=row["admitted_run_id"],
                    attempt_id=row["admitted_attempt_id"],
                    outcome=prior["status"],
                ),
            )
        )
        used += size
    state = connection.execute(
        "SELECT state_version FROM project_execution_states WHERE project_id=?",
        (request.project_id,),
    ).fetchone()
    return ManagedContextSource(
        request.project_id,
        binding.run_id,
        binding.attempt_id,
        _redact({"content": question})["content"],
        state[0] if state else 0,
        tuple(run for _, run in sorted(runs, key=lambda item: item[0])),
        omitted,
        destination,
    )


def capture_managed_execution_context(
    journal, *, request, binding, configuration, destination
):
    """Called through run_owned_thread, before this Run's first model call."""
    with journal._lock:
        connection = journal._connection
        if connection.in_transaction:
            raise ContextSourceUnavailable("context_requires_read_snapshot")
        connection.execute("BEGIN")
        try:
            return _capture(
                connection,
                journal,
                request,
                binding,
                configuration.snapshot,
                destination,
            )
        except (
            ValueError,
            KeyError,
            TypeError,
            AttributeError,
            RecursionError,
        ):
            raise ContextSourceUnavailable("context_source_invalid") from None
        finally:
            connection.execute("ROLLBACK")
