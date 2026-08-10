from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from app.workspace_config import (
    EnvironmentConfigResolver,
    LocalMaterialization,
    ModelCapabilityRegistry,
    ProviderModelCapability,
    ResolvedConnectorBinding,
    ResolvedContextSource,
    SecretValueInManifestError,
    ThinkingEffort,
    UnsafeCloudProjectionError,
    UnsupportedThinkingEffortError,
    WorktreeMaterialization,
    assert_bundle_asset_safe,
    assert_manifest_secret_free,
    canonical_digest,
    parse_workforce_manifest,
)

MANIFEST_YAML = """
apiVersion: eigent.ai/v1alpha1
kind: WorkforceBundle
metadata:
  id: bundle_product_research
  name: Product Research Workforce
  revision: 7
spec:
  instructions:
    coordinator: bundle://instructions/coordinator.md
  context:
    - id: product_docs
      kind: local_path_slot
      slot: product_docs_folder
      sharing: reference_only
    - id: research_policy
      kind: bundle_asset
      path: bundle://context/README.md
      sharing: bundled
  skills:
    - ref: registry://skills/web-research@2.1.0
      assignTo: [coordinator]
  connectors:
    - id: source_repository
      connector: github
      connectionSlot: github_readonly
      requiredGrants: [repository.read]
  mcpServers:
    - id: issue_tracker
      definition: registry://mcp/linear@1.4.0
      secretSlots: [LINEAR_API_TOKEN]
      assignTo: [coordinator]
  agents:
    - id: coordinator
      role: coordinator
      modelProfile: default
  models:
    default:
      modelRef: provider://default
      thinkingEffort: medium
  permissions:
    profile: request_approval
    rules:
      - action: connector.read
        effect: allow
  git:
    enabled: true
    checkpointPolicy: user_and_run_terminal
    agentIsolation: worktree
    remotePolicy: prompt
"""


def _capability() -> ProviderModelCapability:
    return ProviderModelCapability(
        supported_efforts=(
            ThinkingEffort.LOW,
            ThinkingEffort.MEDIUM,
            ThinkingEffort.HIGH,
        ),
        default_effort=ThinkingEffort.MEDIUM,
        provider_mapping={
            ThinkingEffort.LOW: "low",
            ThinkingEffort.MEDIUM: "medium",
            ThinkingEffort.HIGH: "high",
        },
        capability_revision="provider-capability-v3",
    )


def test_manifest_is_strict_canonical_and_digest_stable():
    first = parse_workforce_manifest(MANIFEST_YAML)
    reordered = parse_workforce_manifest(
        MANIFEST_YAML.replace(
            "  name: Product Research Workforce\n  revision: 7",
            "  revision: 7\n  name: Product Research Workforce",
        )
    )

    assert first == reordered
    assert first.digest == reordered.digest
    assert first.revision_id == "bundle_product_research@7"
    assert (
        first.spec.models["default"].thinking_effort is ThinkingEffort.MEDIUM
    )


def test_manifest_rejects_secret_value_even_inside_freeform_instructions():
    with pytest.raises(SecretValueInManifestError, match="api_key"):
        parse_workforce_manifest(
            MANIFEST_YAML.replace(
                "coordinator: bundle://instructions/coordinator.md",
                "api_key: sk-must-not-enter-a-bundle",
            )
        )


def test_secret_scan_covers_plural_fields_values_and_script_assets():
    with pytest.raises(SecretValueInManifestError, match="api_keys"):
        assert_manifest_secret_free({"api_keys": ["not-a-slot"]})
    with pytest.raises(SecretValueInManifestError, match="secret-like"):
        assert_manifest_secret_free(
            {"note": "use sk-live-abcdefghijklmnop for the demo"}
        )
    with pytest.raises(SecretValueInManifestError, match="asset"):
        assert_bundle_asset_safe(
            "skills/importer.py",
            b"TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz123456'",
        )


def test_manifest_rejects_inline_absolute_path_and_missing_default_model():
    with pytest.raises(ValidationError, match="absolute path"):
        parse_workforce_manifest(
            MANIFEST_YAML.replace(
                "  context:\n",
                "  context:\n"
                "    - id: local_hint\n"
                "      kind: inline\n"
                "      content: 'Read /Users/alice/private/report.md'\n",
            )
        )
    with pytest.raises(ValidationError, match="default profile"):
        parse_workforce_manifest(
            MANIFEST_YAML.replace("    default:\n", "    custom:\n")
        )


def test_manifest_rejects_physical_path_for_local_slot():
    with pytest.raises(ValidationError, match="physical path"):
        parse_workforce_manifest(
            MANIFEST_YAML.replace(
                "      sharing: reference_only",
                "      path: /Users/alice/private\n"
                "      sharing: reference_only",
                1,
            )
        )


def test_thinking_effort_aliases_are_normalized_and_unsupported_is_explicit():
    manifest = parse_workforce_manifest(
        MANIFEST_YAML.replace(
            "thinkingEffort: medium", "thinkingEffort: light"
        )
    )
    assert (
        manifest.spec.models["default"].thinking_effort is ThinkingEffort.LOW
    )

    with pytest.raises(UnsupportedThinkingEffortError, match="xhigh"):
        _capability().resolve(ThinkingEffort.XHIGH)


def test_dynamic_provider_remap_is_opt_in_and_reported():
    capability = ProviderModelCapability(
        supported_efforts=(ThinkingEffort.LOW, ThinkingEffort.HIGH),
        default_effort=ThinkingEffort.LOW,
        provider_mapping={
            ThinkingEffort.LOW: "minimal",
            ThinkingEffort.HIGH: "deep",
        },
        capability_revision="dynamic-v1",
        dynamic_model=True,
    )

    with pytest.raises(UnsupportedThinkingEffortError):
        capability.resolve(ThinkingEffort.MEDIUM)
    resolved = capability.resolve(
        ThinkingEffort.MEDIUM,
        allow_dynamic_remap=True,
    )

    assert resolved.requested is ThinkingEffort.MEDIUM
    assert resolved.effective is ThinkingEffort.LOW
    assert resolved.provider_value == "minimal"
    assert resolved.remapped is True


def test_capability_registry_maps_product_max_without_blind_forwarding():
    registry = ModelCapabilityRegistry()

    codex = registry.resolve(
        model_platform="openai",
        model_type="gpt-5.5-codex",
        auth_source="codex_subscription",
    ).resolve(ThinkingEffort.MAX, allow_dynamic_remap=True)
    openai = registry.resolve(
        model_platform="openai",
        model_type="gpt-5.5",
    ).resolve(ThinkingEffort.XHIGH, allow_dynamic_remap=True)
    unknown = registry.resolve(
        model_platform="anthropic",
        model_type="claude-next",
    ).resolve(ThinkingEffort.MAX, allow_dynamic_remap=True)

    assert (codex.requested, codex.effective) == (
        ThinkingEffort.MAX,
        ThinkingEffort.MAX,
    )
    assert codex.provider_parameter_name == "reasoning_effort"
    assert codex.provider_value == "xhigh"
    assert openai.effective is ThinkingEffort.HIGH
    assert openai.provider_value == "high"
    assert unknown.effective is ThinkingEffort.MEDIUM
    assert unknown.provider_parameter_name is None
    assert unknown.provider_value == "provider_default"


def test_cloud_projection_redacts_local_paths_and_binding_ids():
    manifest = parse_workforce_manifest(MANIFEST_YAML)
    local = LocalMaterialization(
        context_sources=(
            ResolvedContextSource(
                id="product_docs",
                kind="local_path_slot",
                slot_id="product_docs_folder",
                absolute_path="/Users/alice/company/private",
                root_fingerprint_digest="root-digest",
            ),
        ),
        connector_bindings=(
            ResolvedConnectorBinding(
                connector_id="github",
                slot_id="github_readonly",
                local_binding_id="connection-secret-device-id",
                required_grants=("repository.read",),
            ),
        ),
        worktree=WorktreeMaterialization(
            repository_id="repo-1",
            logical_worktree_role="run_integration",
            absolute_path="/Users/alice/.eigent/worktrees/run-1",
            base_commit="abc123",
        ),
    )
    spec = EnvironmentConfigResolver().resolve(
        manifest=manifest,
        owner_type="run",
        owner_id="run-1",
        local_materialization=local,
        provider_capability=_capability(),
    )

    local_json = json.dumps(spec.local_payload())
    cloud = spec.cloud_projection()
    cloud_json = json.dumps(cloud)
    assert "/Users/alice/company/private" in local_json
    assert "connection-secret-device-id" in local_json
    assert "/Users/alice/company/private" not in cloud_json
    assert "connection-secret-device-id" not in cloud_json
    assert "/Users/alice/.eigent/worktrees/run-1" not in cloud_json
    assert cloud["local_projection"]["context_sources"] == [
        {
            "id": "product_docs",
            "kind": "local_path_slot",
            "slot_id": "product_docs_folder",
            "root_fingerprint_digest": "root-digest",
        }
    ]
    projection_body = {
        key: value
        for key, value in cloud.items()
        if key != "projection_digest"
    }
    assert cloud["projection_digest"] == canonical_digest(projection_body)


def test_cloud_projection_rejects_local_fields_in_semantic_capabilities():
    manifest = parse_workforce_manifest(MANIFEST_YAML)
    spec = EnvironmentConfigResolver().resolve(
        manifest=manifest,
        owner_type="run",
        owner_id="run-1",
        local_materialization=LocalMaterialization(),
        provider_capability=_capability(),
        runtime_capability_manifest={
            "browser": {
                "socket_path": "/Users/alice/.eigent/browser.sock",
            }
        },
    )

    with pytest.raises(UnsafeCloudProjectionError, match="absolute path"):
        spec.cloud_projection()
