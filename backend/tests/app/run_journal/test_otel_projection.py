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

from __future__ import annotations

import os
import re
from urllib.request import Request, urlopen

import pytest

from app.run_journal.otel_projection import (
    OTEL_GENAI_ATTRIBUTE_ALLOWLIST,
    OTEL_GENAI_PROJECTOR_VERSION,
    OTEL_GENAI_SCHEMA_URL,
    OTEL_GENAI_SEMCONV_SOURCE_REF,
    OTEL_GENAI_SEMCONV_VERSION,
    project_attempt_span,
    project_model_invocation_span,
)
from app.run_journal.store import SQLiteRunJournal
from app.run_runtime.step_coordinator import step_event_draft


def test_projection_contract_is_versioned_and_excludes_content(
    tmp_path,
) -> None:
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
        )
        journal.append_event(
            "run-1",
            step_event_draft(
                run_id="run-1",
                attempt_id=attempt.attempt_id,
                step_id="step-1",
                plan_item_id="plan-item-1",
                title="Call model",
                summary=None,
                ordinal=0,
                agent_id="agent-1",
                event="created",
                status="pending",
            ),
        )
        invocation = journal.start_model_invocation(
            invocation_id="invocation-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            step_id="step-1",
            agent_id="agent-1",
            logical_call_id="logical-1",
            provider="openai",
            model="gpt-test",
            transport="responses",
            thinking_effort="medium",
            request={
                "messages": [{"role": "user", "content": "secret"}],
                "model_config_dict": {"stream": False},
            },
            now=2,
        )
        invocation = journal.finish_model_invocation(
            invocation.invocation_id,
            status="completed",
            response={"id": "response-1", "model": "gpt-result"},
            prompt_tokens=4,
            completion_tokens=2,
            cache_read_tokens=1,
            cache_write_tokens=2,
            finish_reason="stop",
            now=3,
        )

        attempt_span = project_attempt_span(attempt)
        model_span = project_model_invocation_span(invocation)

        assert attempt_span.schema_url == OTEL_GENAI_SCHEMA_URL
        assert attempt_span.semconv_version == OTEL_GENAI_SEMCONV_VERSION
        assert attempt_span.semconv_source_ref == (
            OTEL_GENAI_SEMCONV_SOURCE_REF
        )
        assert OTEL_GENAI_SEMCONV_VERSION is None
        assert OTEL_GENAI_SCHEMA_URL is None
        assert attempt_span.projector_version == OTEL_GENAI_PROJECTOR_VERSION
        assert attempt_span.start_time_unix_seconds == attempt.started_at
        assert attempt_span.end_time_unix_seconds is None
        assert attempt_span.span_name == "run_attempt"
        assert attempt_span.attributes["eigent.workload.kind"] == "production"
        assert "gen_ai.operation.name" not in attempt_span.attributes
        assert attempt_span.attributes["eigent.operation.name"] == (
            "run_attempt"
        )
        assert model_span.span_kind == "CLIENT"
        assert model_span.span_name == "chat gpt-test"
        assert model_span.status_code == "UNSET"
        assert model_span.start_time_unix_seconds == invocation.started_at
        assert model_span.end_time_unix_seconds == invocation.completed_at
        assert model_span.attributes["gen_ai.provider.name"] == "openai"
        assert model_span.attributes["eigent.model.provider"] == "openai"
        assert model_span.attributes["eigent.step.id"] == "step-1"
        assert model_span.attributes["gen_ai.request.model"] == "gpt-test"
        assert model_span.attributes["gen_ai.response.model"] == "gpt-result"
        assert model_span.attributes["gen_ai.usage.input_tokens"] == 4
        assert "gen_ai.request.stream" not in model_span.attributes
        assert model_span.attributes["gen_ai.request.reasoning.level"] == (
            "medium"
        )
        assert (
            model_span.attributes["gen_ai.usage.cache_read.input_tokens"] == 1
        )
        assert (
            model_span.attributes["gen_ai.usage.cache_write.input_tokens"] == 2
        )
        assert "gen_ai.input.messages" not in model_span.attributes
        assert model_span.attributes["eigent.otel.content.mode"] == "excluded"
        assert "secret" not in str(model_span.attributes)
        assert {
            key for key in model_span.attributes if key.startswith("gen_ai.")
        } <= OTEL_GENAI_ATTRIBUTE_ALLOWLIST


def test_projection_records_stream_only_when_enabled(tmp_path) -> None:
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        invocation = journal.start_model_invocation(
            invocation_id="invocation-1",
            run_id="run-1",
            attempt_id=None,
            agent_id="agent-1",
            logical_call_id="logical-1",
            provider="openai",
            model="gpt-test",
            transport="responses",
            thinking_effort=None,
            request={"model_config_dict": {"stream": True}},
        )

        span = project_model_invocation_span(invocation)

        assert span.attributes["gen_ai.request.stream"] is True


def test_projection_v1_never_treats_canonical_rows_as_otel_messages(
    tmp_path,
) -> None:
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        invocation = journal.start_model_invocation(
            invocation_id="invocation-1",
            run_id="run-1",
            attempt_id=None,
            agent_id="agent-1",
            logical_call_id="logical-1",
            provider="openai",
            model="gpt-test",
            transport="chat_completions",
            thinking_effort=None,
            request={"messages": [{"role": "user", "content": "hello"}]},
        )
        span = project_model_invocation_span(invocation)

        assert "gen_ai.input.messages" not in span.attributes
        assert "gen_ai.output.messages" not in span.attributes
        assert "hello" not in str(span.attributes)


def test_provider_projection_preserves_raw_value_and_maps_known_namespace(
    tmp_path,
) -> None:
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        invocation = journal.start_model_invocation(
            invocation_id="invocation-1",
            run_id="run-1",
            attempt_id=None,
            agent_id="agent-1",
            logical_call_id="logical-1",
            provider="azure",
            model="gpt-test",
            transport="responses",
            thinking_effort=None,
            request={"messages": []},
        )

        span = project_model_invocation_span(invocation)

        assert span.attributes["gen_ai.provider.name"] == "azure.ai.openai"
        assert span.attributes["eigent.model.provider"] == "azure"


def test_gemini_provider_uses_the_direct_api_otel_namespace(tmp_path) -> None:
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        invocation = journal.start_model_invocation(
            invocation_id="invocation-1",
            run_id="run-1",
            attempt_id=None,
            agent_id="agent-1",
            logical_call_id="logical-1",
            provider="gemini",
            model="gemini-test",
            transport="generate_content",
            thinking_effort=None,
            request={"messages": []},
        )

        span = project_model_invocation_span(invocation)

        assert span.attributes["gen_ai.provider.name"] == "gcp.gemini"


@pytest.mark.skipif(
    os.environ.get("OTEL_CONFORMANCE_CHECK", "").lower()
    not in {"1", "true", "yes", "on"},
    reason="set OTEL_CONFORMANCE_CHECK=1 to query upstream GenAI semconv",
)
def test_otel_genai_allowlist_conforms_to_current_upstream_registry() -> None:
    """Opt-in network check for upstream registry and schema publication."""

    registry = _read_otel_upstream(
        "https://raw.githubusercontent.com/open-telemetry/"
        "semantic-conventions-genai/main/model/gen-ai/registry.yaml"
    )
    upstream_keys = set(
        re.findall(r"^\s*-\s+key:\s+([^\s#]+)", registry, re.MULTILINE)
    )
    assert OTEL_GENAI_ATTRIBUTE_ALLOWLIST <= upstream_keys

    readme = _read_otel_upstream(
        "https://raw.githubusercontent.com/open-telemetry/"
        "semantic-conventions-genai/main/README.md"
    )
    schema_section = re.search(
        r"^## Schema URL\s*\n+([^\n]+)", readme, re.MULTILINE
    )
    assert schema_section is not None
    assert schema_section.group(1).strip() == "TODO", (
        "upstream now publishes a GenAI schema URL; pin it and update this "
        "projection contract"
    )
    assert OTEL_GENAI_SCHEMA_URL is None


def _read_otel_upstream(url: str) -> str:
    request = Request(url, headers={"User-Agent": "Eigent-OTel-Conformance"})
    with urlopen(request, timeout=15) as response:  # nosec B310
        return response.read().decode("utf-8")
