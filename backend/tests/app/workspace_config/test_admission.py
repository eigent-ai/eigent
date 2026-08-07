from __future__ import annotations

import json

from app.run_journal import SQLiteRunJournal
from app.workspace_config import ThinkingEffort
from app.workspace_config.admission import (
    EnvironmentAdmissionService,
    LegacyEnvironmentImporter,
)


def test_legacy_admission_persists_redacted_spec_before_attempt(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1",
            project_id="project-1",
            status="pending",
        )
        template = LegacyEnvironmentImporter().build_template(
            model_platform="openai",
            model_type="gpt-5.5-codex",
            auth_source="codex_subscription",
            requested_effort=ThinkingEffort.MAX,
            allow_local_system=True,
            mcp_server_names=("github", "github", "linear"),
        )
        service = EnvironmentAdmissionService(journal)

        first = service.persist_for_run(
            run_id="run-1",
            space_id="space-1",
            working_directory=tmp_path / "private-workspace",
            created_by="user-1",
            template=template,
        )
        replay = service.persist_for_run(
            run_id="run-1",
            space_id="space-1",
            working_directory=tmp_path / "private-workspace",
            created_by="user-1",
            template=template,
        )
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="request-1",
            reason="initial_execution",
            environment=first.binding,
        )

        assert replay.spec.spec_id == first.spec.spec_id
        assert attempt.environment_spec_id == first.spec.spec_id
        assert attempt.thinking_effort_requested == "max"
        assert attempt.thinking_effort_effective == "max"
        assert first.spec.provider_parameter_name == "reasoning_effort"
        assert first.spec.provider_value == "xhigh"
        assert tuple(
            item.id for item in template.manifest.spec.mcp_servers
        ) == ("github", "linear")

        events = journal.list_events("run-1")
        environment_events = [
            event
            for event in events
            if event.event_type == "run.environment_resolved"
        ]
        assert len(environment_events) == 1
        payload_json = json.dumps(environment_events[0].payload)
        assert str(tmp_path) not in payload_json
        assert "private-workspace" not in payload_json
        assert (
            environment_events[0].payload["provider_parameter_value"]
            == "xhigh"
        )
        assert first.persisted_spec.spec["local_materialization"][
            "context_sources"
        ][0]["absolute_path"].endswith("private-workspace")


def test_unknown_provider_remap_is_explicit_in_run_projection(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1",
            project_id="project-1",
            status="pending",
        )
        template = LegacyEnvironmentImporter().build_template(
            model_platform="anthropic",
            model_type="claude-next",
            auth_source=None,
            requested_effort=ThinkingEffort.MAX,
            allow_local_system=False,
        )

        result = EnvironmentAdmissionService(journal).persist_for_run(
            run_id="run-1",
            space_id="space-1",
            working_directory=tmp_path,
            created_by="local-user",
            template=template,
        )

        assert result.spec.thinking_effort_requested is ThinkingEffort.MAX
        assert result.spec.thinking_effort_effective is ThinkingEffort.MEDIUM
        assert result.spec.provider_parameter_name is None
        event = next(
            item
            for item in journal.list_events("run-1")
            if item.event_type == "run.environment_resolved"
        )
        assert event.payload["thinking_effort_requested"] == "max"
        assert event.payload["thinking_effort_effective"] == "medium"
