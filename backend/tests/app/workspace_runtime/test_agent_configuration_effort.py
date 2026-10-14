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

"""Managed (parallel execution) Agent configuration and model effort."""

from types import SimpleNamespace

import pytest

from app.permission_policy import PRESET_PROFILES, PermissionProfileName
from app.run_journal import SQLiteRunJournal
from app.workspace_config import (
    ModelCapabilityRegistry,
    parse_workspace_manifest,
)
from app.workspace_runtime.agent_configuration import (
    AgentConfigurationUnavailable,
    FrozenAgentConfiguration,
    ResolvedCredential,
)


def _configuration(model_type, effort, **changes):
    manifest = parse_workspace_manifest(f"""
apiVersion: eigent.ai/v1alpha1
kind: WorkspaceBundle
metadata: {{id: bundle_managed_effort, name: Managed effort, revision: 1}}
spec:
  permissions: {{profile: full_access}}
  models:
    default: {{modelRef: 'provider://managed', thinkingEffort: {effort}}}
""")
    values = dict(
        manifest=manifest,
        provider_capability=ModelCapabilityRegistry().resolve(
            model_platform="openai",
            model_type=model_type,
            has_function_tools=True,
        ),
        space_id="space-1",
        project_id="project-1",
        principal_ref="principal:fixture",
        permission_profile_revision=PRESET_PROFILES[
            PermissionProfileName.FULL_ACCESS
        ].revision,
        credential_ref="credential:fixture",
        model_platform="openai",
        model_type=model_type,
        api_url="https://api.example.invalid/v1",
        thinking_effort=effort,
        tokenizer_ref="tokenizer:fixture",
        credential_resolver=lambda ref, principal: ResolvedCredential(
            ref, principal, "synthetic-key"
        ),
    )
    values.update(changes)
    return FrozenAgentConfiguration(**values)


def _persist(config, tmp_path):
    request = SimpleNamespace(
        request_id="request-1",
        project_id="project-1",
        envelope={
            **config.configuration,
            "project_id": "project-1",
            "prompt": "fixture",
        },
    )
    workspace = SimpleNamespace(
        workspace_id="workspace-1", local_root=tmp_path
    )
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        binding = config.persist_environment(journal, request, workspace)
        record = journal.get_effective_environment_spec(
            binding.environment_spec_id
        )
    return binding, record.spec


@pytest.mark.parametrize("effort", ["low", "medium", "high", "xhigh", "max"])
def test_unknown_model_bundle_effort_runs_at_provider_default(
    tmp_path, effort
):
    config = _configuration("deepseek-chat", effort)
    assert config.snapshot["thinking_effort"] == effort
    assert config.snapshot["provider_capability"]["status"] == "unknown_model"
    binding, spec = _persist(config, tmp_path)
    assert binding.thinking_effort_requested == effort
    assert binding.thinking_effort_effective == "medium"
    assert spec["provider_value"] == "provider_default"
    assert spec.get("provider_parameter_name") is None


def test_unknown_model_keeps_the_users_own_effort_parameter(tmp_path):
    config = _configuration(
        "deepseek-chat",
        "high",
        model_config_dict={"reasoning_effort": "max"},
    )
    assert config.snapshot["model_config_dict"]["reasoning_effort"] == "max"
    _, spec = _persist(config, tmp_path)
    assert spec["provider_value"] == "provider_default"


def test_cloud_unknown_model_rejects_its_own_effort_parameter():
    with pytest.raises(
        AgentConfigurationUnavailable, match="model_effort_unsupported"
    ):
        _configuration(
            "deepseek-chat",
            "high",
            api_url="https://proxy.eigent.ai/v1",
            model_config_dict={"reasoning_effort": "max"},
        )


@pytest.mark.parametrize("effort", ["xhigh", "max"])
def test_name_recognised_model_runs_a_higher_effort_at_high(tmp_path, effort):
    config = _configuration("gpt-5", effort)
    binding, spec = _persist(config, tmp_path)
    assert binding.thinking_effort_requested == effort
    assert binding.thinking_effort_effective == "high"
    assert spec["provider_value"] == "high"


def test_registered_model_keeps_strict_effort_checks():
    config = _configuration("gpt-5", "high")
    assert config.provider_capability.supported_efforts
    with pytest.raises(
        AgentConfigurationUnavailable, match="model_effort_conflict"
    ):
        _configuration(
            "gpt-5", "high", model_config_dict={"reasoning_effort": "low"}
        )
