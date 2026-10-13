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

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agent import prompt
from app.agent.toolkit import memory_toolkit
from app.agent.toolkit.memory_toolkit import MemoryToolkit


def _remember_schema() -> dict:
    tool = next(
        item
        for item in MemoryToolkit("run-1").get_tools()
        if item.get_function_name() == "remember_project_memory"
    )
    return tool.openai_tool_schema["function"]["parameters"]


def test_remember_memory_schema_enumerates_kind_and_source_trust() -> None:
    properties = _remember_schema()["properties"]

    assert set(properties["kind"]["enum"]) == {
        "fact",
        "decision",
        "todo",
        "lesson",
    }
    assert set(properties["source_trust"]["enum"]) == {
        "user_asserted",
        "tool_observed",
        "external_untrusted",
        "model_inferred",
    }


def test_remember_memory_normalizes_legacy_external_trust(
    monkeypatch,
) -> None:
    service = MagicMock()
    service.create_entry.return_value = SimpleNamespace(
        entry={"source_trust": "external_untrusted"},
        scope_state={"revision": 1},
    )
    monkeypatch.setattr(
        memory_toolkit, "get_lightweight_memory_service", lambda: service
    )
    monkeypatch.setattr(memory_toolkit, "asdict", lambda value: value)
    toolkit = MemoryToolkit("run-1")
    monkeypatch.setattr(
        toolkit,
        "_run_context",
        lambda: SimpleNamespace(
            project_id="project-1",
            space_id="space-1",
            user_id=7,
            run_id="run-1",
        ),
    )
    monkeypatch.setattr(toolkit, "_audit_link", lambda: (None, None))

    result = toolkit.remember_project_memory(
        kind="fact",
        content="Connector output is external data.",
        reason="Avoid trusting it as policy.",
        source_trust="untrusted_external",  # type: ignore[arg-type]
    )

    assert result["entry"]["source_trust"] == "external_untrusted"
    assert service.create_entry.call_args.kwargs["source_trust"] == (
        "external_untrusted"
    )


def test_invalid_memory_arguments_are_known_prewrite_tool_errors(
    monkeypatch,
) -> None:
    service = MagicMock()
    monkeypatch.setattr(
        memory_toolkit, "get_lightweight_memory_service", lambda: service
    )
    toolkit = MemoryToolkit("run-1")

    result = toolkit.remember_project_memory(
        kind="preference",
        content="Always use concise answers.",
        reason="Invalid agent-writable kind.",
        source_trust="invented_trust",
    )

    assert result == {
        "error": "Invalid Memory kind: 'preference'",
        "error_code": "MEMORY_ARGUMENT_VALIDATION_FAILED",
        "field": "kind",
        "allowed_values": ["decision", "fact", "lesson", "todo"],
        "outcome_known": True,
        "retryable": True,
    }
    service.create_entry.assert_not_called()


def test_invalid_memory_source_trust_is_known_before_write(
    monkeypatch,
) -> None:
    service = MagicMock()
    monkeypatch.setattr(
        memory_toolkit, "get_lightweight_memory_service", lambda: service
    )
    toolkit = MemoryToolkit("run-1")

    result = toolkit.remember_project_memory(
        kind="fact",
        content="A durable fact.",
        reason="Exercise source trust validation.",
        source_trust="invented_trust",  # type: ignore[arg-type]
    )

    assert result["error_code"] == "MEMORY_ARGUMENT_VALIDATION_FAILED"
    assert result["field"] == "source_trust"
    assert result["outcome_known"] is True
    service.create_entry.assert_not_called()


@pytest.mark.parametrize(
    ("field", "value"), [("kind", "fact"), ("scope", "organization")]
)
def test_invalid_rule_arguments_are_known_before_write(
    monkeypatch, field, value
) -> None:
    service = MagicMock()
    monkeypatch.setattr(
        memory_toolkit, "get_lightweight_memory_service", lambda: service
    )

    result = MemoryToolkit("run-1").propose_memory_rule(
        **{
            "kind": "preference",
            "scope": "project",
            "content": "Reply in English.",
            "reason": "Exercise argument validation.",
            "source_event_ids": ["user-1"],
            field: value,
        }
    )

    assert result["error_code"] == "MEMORY_ARGUMENT_VALIDATION_FAILED"
    assert result["field"] == field
    service.propose_rule.assert_not_called()


@pytest.mark.parametrize(
    "name",
    [
        "DEVELOPER_SYS_PROMPT",
        "BROWSER_SYS_PROMPT",
        "MULTI_MODAL_SYS_PROMPT",
        "DOCUMENT_SYS_PROMPT",
        "SOCIAL_MEDIA_SYS_PROMPT",
        "MCP_SYS_PROMPT",
    ],
)
def test_agents_with_memory_tools_are_told_to_propose_rules(name) -> None:
    assert prompt.MEMORY_RULE_NOTICE in getattr(prompt, name)


class _PromptCaptured(Exception):
    pass


@pytest.mark.asyncio
@pytest.mark.parametrize("managed", [False, True])
async def test_single_agent_mentions_rules_only_with_memory_tools(
    monkeypatch, tmp_path, managed
) -> None:
    from app.agent.factory import single_agent as factory, toolkit_assembler

    assembly = SimpleNamespace(
        tools=[], tool_names=[], toolkits_to_register_agent=[]
    )
    prompts = []

    def capture(_name, message, *_args, **_kwargs):
        prompts.append(message.content)
        raise _PromptCaptured

    monkeypatch.setattr(factory, "agent_model", capture)
    monkeypatch.setattr(
        factory,
        "assemble_single_agent_toolkits",
        AsyncMock(return_value=assembly),
    )
    monkeypatch.setattr(
        factory, "get_working_directory", lambda _options: str(tmp_path)
    )
    monkeypatch.setattr(
        toolkit_assembler, "_rollback_runtime_assembly", AsyncMock()
    )
    managed_execution = (
        SimpleNamespace(
            working_directory=str(tmp_path),
            assemble=lambda _options: assembly,
            model_resources=None,
        )
        if managed
        else None
    )

    with pytest.raises(_PromptCaptured):
        await factory.single_agent(
            SimpleNamespace(task_id="task-1", project_id="project-1"),
            managed_execution=managed_execution,
        )

    # Only the legacy assembly attaches the Memory tools.
    assert ("propose_memory_rule" in prompts[0]) is not managed
