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

"""Versioned RunJournal -> OpenTelemetry GenAI projection contract.

This module is intentionally pure. RunJournal stays canonical and exporters
consume these projections asynchronously; exporter failure must never alter a
Run fact or block Production dispatch.

Intentionally unwired in v1: this is a frozen projection contract; exporter
wiring lands separately after the contract and privacy boundary are reviewed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from app.run_journal.models import ModelInvocationRecord, RunAttemptRecord

OTEL_GENAI_PROJECTOR_VERSION = 1
# The dedicated GenAI repository has not published a semantic-convention
# version or schema URL yet. Keep both unset so a future exporter omits
# schema_url rather than advertising an unresolvable schema. The projection
# contract is instead pinned to a reviewed upstream source snapshot.
OTEL_GENAI_SEMCONV_VERSION: str | None = None
OTEL_GENAI_SCHEMA_URL: str | None = None
OTEL_GENAI_SEMCONV_SOURCE_REF = (
    "open-telemetry/semantic-conventions-genai@"
    "56d6b11a02129319bf371083fa134b7ce989c976"
)
# Verified on 2026-08-25 against model/gen-ai/registry.yaml at the source ref
# above. The opt-in network conformance test also checks current upstream main
# so registry drift becomes visible before exporter wiring lands.
OTEL_GENAI_ATTRIBUTE_ALLOWLIST = frozenset(
    {
        "gen_ai.operation.name",
        "gen_ai.provider.name",
        "gen_ai.request.model",
        "gen_ai.request.reasoning.level",
        "gen_ai.request.stream",
        "gen_ai.response.finish_reasons",
        "gen_ai.response.id",
        "gen_ai.response.model",
        "gen_ai.usage.cache_read.input_tokens",
        "gen_ai.usage.cache_write.input_tokens",
        "gen_ai.usage.input_tokens",
        "gen_ai.usage.output_tokens",
    }
)
_PROVIDER_NAMES = {
    "azure": "azure.ai.openai",
    "aws-bedrock": "aws.bedrock",
    "aws-bedrock-converse": "aws.bedrock",
    "bedrock": "aws.bedrock",
    "gemini": "gcp.gemini",
    "mistral": "mistral_ai",
    "vertex-ai": "gcp.vertex_ai",
    "vertexai": "gcp.vertex_ai",
}


@dataclass(frozen=True)
class OtelSpanProjection:
    projector_version: int
    semconv_version: str | None
    semconv_source_ref: str
    schema_url: str | None
    span_name: str
    span_kind: Literal["INTERNAL", "CLIENT"]
    status_code: Literal["UNSET", "ERROR"]
    start_time_unix_seconds: float
    end_time_unix_seconds: float | None
    attributes: dict[str, Any]


def project_attempt_span(attempt: RunAttemptRecord) -> OtelSpanProjection:
    profile = attempt.workload_profile
    attributes: dict[str, Any] = {
        # A local Eigent Attempt is the trace root, not a remote agent-client
        # call. Model invocations beneath it use the standard GenAI fields.
        "eigent.operation.name": "run_attempt",
        "eigent.run.id": attempt.run_id,
        "eigent.attempt.id": attempt.attempt_id,
        "eigent.attempt.number": attempt.attempt_number,
        "eigent.otel.projector.version": OTEL_GENAI_PROJECTOR_VERSION,
    }
    _set_optional(
        attributes,
        "eigent.workload.profile.digest",
        attempt.workload_profile_digest,
    )
    if profile is not None:
        attributes.update(
            {
                "eigent.workload.kind": profile.workload_kind,
                "eigent.workload.profile.version": profile.profile_version,
                "eigent.workload.isolation_policy.ref": (
                    profile.isolation_policy_ref
                ),
                "eigent.workload.capture_policy.ref": (
                    profile.capture_policy_ref
                ),
                "eigent.workload.verifier_policy.ref": (
                    profile.verifier_policy_ref
                ),
                "eigent.workload.budget_policy.ref": (
                    profile.budget_policy_ref
                ),
                "eigent.workload.network_policy.ref": (
                    profile.network_policy_ref
                ),
                "eigent.workload.retention_policy.ref": (
                    profile.retention_policy_ref
                ),
            }
        )
        _set_optional(
            attributes, "eigent.workload.pairing_key", profile.pairing_key
        )
        _set_optional(
            attributes, "eigent.workload.experiment.id", profile.experiment_id
        )
        _set_optional(
            attributes,
            "eigent.workload.rollout_batch.id",
            profile.rollout_batch_id,
        )
    if attempt.environment_spec_digest:
        attributes["eigent.environment.spec.digest"] = (
            attempt.environment_spec_digest
        )
    return OtelSpanProjection(
        projector_version=OTEL_GENAI_PROJECTOR_VERSION,
        semconv_version=OTEL_GENAI_SEMCONV_VERSION,
        semconv_source_ref=OTEL_GENAI_SEMCONV_SOURCE_REF,
        schema_url=OTEL_GENAI_SCHEMA_URL,
        span_name="run_attempt",
        span_kind="INTERNAL",
        status_code=_attempt_status(attempt.status),
        start_time_unix_seconds=attempt.started_at,
        end_time_unix_seconds=attempt.ended_at,
        attributes=attributes,
    )


def project_model_invocation_span(
    record: ModelInvocationRecord,
) -> OtelSpanProjection:
    attributes: dict[str, Any] = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": _otel_provider_name(record.provider),
        "gen_ai.request.model": record.model,
        "eigent.run.id": record.run_id,
        "eigent.model.invocation.id": record.invocation_id,
        "eigent.model.logical_call.id": record.logical_call_id,
        "eigent.model.retry.index": record.retry_index,
        "eigent.agent.id": record.agent_id,
        "eigent.model.transport": record.transport,
        "eigent.model.provider": record.provider,
        "eigent.model.request.digest": record.request_digest,
        "eigent.otel.projector.version": OTEL_GENAI_PROJECTOR_VERSION,
        # V1 intentionally exports correlation and usage only. Canonical
        # request/response JSON does not implement the OTel message schemas.
        "eigent.otel.content.mode": "excluded",
    }
    if record.attempt_id:
        attributes["eigent.attempt.id"] = record.attempt_id
    if record.step_id:
        attributes["eigent.step.id"] = record.step_id
    if record.thinking_effort:
        attributes["eigent.model.thinking_effort"] = record.thinking_effort
        attributes["gen_ai.request.reasoning.level"] = record.thinking_effort
    if record.response_digest:
        attributes["eigent.model.response.digest"] = record.response_digest
    request_config = record.request.get("model_config_dict")
    if (
        isinstance(request_config, dict)
        and request_config.get("stream") is True
    ):
        # The convention says absence means non-streaming; emit this only for
        # an actual streaming request.
        attributes["gen_ai.request.stream"] = True
    _set_optional(
        attributes, "gen_ai.usage.input_tokens", record.prompt_tokens
    )
    _set_optional(
        attributes,
        "gen_ai.usage.output_tokens",
        record.completion_tokens,
    )
    _set_optional(
        attributes,
        "gen_ai.usage.cache_read.input_tokens",
        record.cache_read_tokens,
    )
    _set_optional(
        attributes,
        "gen_ai.usage.cache_write.input_tokens",
        record.cache_write_tokens,
    )
    if record.finish_reason:
        attributes["gen_ai.response.finish_reasons"] = [record.finish_reason]

    response = record.response or {}
    response_model = response.get("model")
    response_id = response.get("id")
    _set_optional(attributes, "gen_ai.response.model", response_model)
    _set_optional(attributes, "gen_ai.response.id", response_id)

    if record.error_code:
        attributes["error.type"] = record.error_code
    _validate_gen_ai_attributes(attributes)
    return OtelSpanProjection(
        projector_version=OTEL_GENAI_PROJECTOR_VERSION,
        semconv_version=OTEL_GENAI_SEMCONV_VERSION,
        semconv_source_ref=OTEL_GENAI_SEMCONV_SOURCE_REF,
        schema_url=OTEL_GENAI_SCHEMA_URL,
        span_name=f"chat {record.model}",
        span_kind="CLIENT",
        status_code=(
            "ERROR"
            if record.status in {"failed", "outcome_unknown"}
            else "UNSET"
        ),
        start_time_unix_seconds=record.started_at,
        end_time_unix_seconds=record.completed_at,
        attributes=attributes,
    )


def _attempt_status(status: str) -> Literal["UNSET", "ERROR"]:
    if status in {
        "failed",
        "cancelled",
        "interrupted",
        "timed_out",
    }:
        return "ERROR"
    return "UNSET"


def _set_optional(attributes: dict[str, Any], key: str, value: Any) -> None:
    if value is not None and value != "":
        attributes[key] = value


def _otel_provider_name(provider: str) -> str:
    normalized = provider.strip().lower()
    return _PROVIDER_NAMES.get(normalized, normalized)


def _validate_gen_ai_attributes(attributes: dict[str, Any]) -> None:
    unknown = {
        key
        for key in attributes
        if key.startswith("gen_ai.")
        and key not in OTEL_GENAI_ATTRIBUTE_ALLOWLIST
    }
    if unknown:
        raise ValueError(
            "unreviewed OpenTelemetry GenAI attribute(s): "
            + ", ".join(sorted(unknown))
        )


__all__ = [
    "OTEL_GENAI_PROJECTOR_VERSION",
    "OTEL_GENAI_SCHEMA_URL",
    "OTEL_GENAI_SEMCONV_SOURCE_REF",
    "OTEL_GENAI_SEMCONV_VERSION",
    "OTEL_GENAI_ATTRIBUTE_ALLOWLIST",
    "OtelSpanProjection",
    "project_attempt_span",
    "project_model_invocation_span",
]
