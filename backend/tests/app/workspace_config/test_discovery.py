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

import hashlib
import json
from unittest.mock import Mock

import pytest
import yaml

from app.run_journal import OptimisticConcurrencyError, SQLiteRunJournal
from app.workspace_config import WorkspaceBundleManifest
from app.workspace_config.discovery import WorkspaceResourceDiscovery

SKILL_REF = "bundle://agent-plugins/research/skills/research/SKILL.md"
MCP_REF = "bundle://agent-plugins/research/mcp.json"


def _manifest():
    return WorkspaceBundleManifest.model_validate(
        {
            "apiVersion": "eigent.ai/v1alpha1",
            "kind": "WorkspaceBundle",
            "metadata": {"id": "research", "name": "Research", "revision": 1},
            "spec": {
                "skills": [{"ref": SKILL_REF, "assignTo": []}],
                "mcpServers": [{"id": "research", "definition": MCP_REF}],
                "models": {"default": {"modelRef": "provider://default"}},
            },
        }
    )


def _assets():
    return {
        SKILL_REF: b"---\nname: research\ndescription: Research\n---\nRead carefully.",
        MCP_REF: json.dumps(
            {
                "mcpServers": {
                    "research": {
                        "type": "streamable-http",
                        "url": "https://example.test/mcp",
                    }
                }
            }
        ).encode(),
    }


@pytest.fixture
def discovery(tmp_path):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    service = WorkspaceResourceDiscovery(
        journal, state_root=tmp_path / "state"
    )
    yield service, journal
    journal.close()


def _install(
    tmp_path, journal, *, space_id="space-1", assets=None, placement="in_repo"
):
    manifest = _manifest()
    journal.put_workspace_config_revision(
        revision_id=manifest.revision_id,
        bundle_id=manifest.metadata.id,
        revision_number=1,
        manifest=manifest.canonical_payload(),
        created_by="fixture",
    )
    journal.put_workspace_config_materialization(
        materialization_id="materialization-" + space_id,
        space_id=space_id,
        revision_id=manifest.revision_id,
        config_placement=placement,
    )
    root = tmp_path / space_id
    configuration = (
        root / ".eigent"
        if placement == "in_repo"
        else tmp_path / "state" / "spaces" / space_id / "configuration"
    )
    configuration.mkdir(parents=True)
    contents = _assets() if assets is None else assets
    for ref, content in contents.items():
        target = configuration / ref.removeprefix("bundle://")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    (configuration / "workspace.yaml").write_text(
        yaml.safe_dump(manifest.canonical_payload())
    )
    (configuration / "workspace.lock").write_text(
        yaml.safe_dump(
            {
                "apiVersion": "eigent.ai/lock/v1alpha1",
                "bundleRevision": manifest.revision_id,
                "manifestDigest": manifest.digest,
                "assets": [
                    {"ref": ref, "digest": hashlib.sha256(content).hexdigest()}
                    for ref, content in contents.items()
                ],
            }
        )
    )
    return root, configuration


def _import(journal, *, space_id="space-1", assets=None):
    contents = _assets() if assets is None else assets
    return journal.put_workspace_config_draft_from_import(
        space_id=space_id,
        expected_target_draft_version=0,
        client_request_id="import-" + space_id,
        document=_manifest().canonical_payload(),
        review_digest="a" * 64,
        assets=tuple(
            {
                "logical_path": ref,
                "content_digest": hashlib.sha256(content).hexdigest(),
                "media_type": "text/plain",
                "size_bytes": len(content),
                "executable": False,
                "provenance": "agent_plugin_import",
                "content": content,
            }
            for ref, content in contents.items()
        ),
        updated_by="fixture",
    )


@pytest.mark.parametrize("placement", ["in_repo", "sidecar"])
def test_materialized_candidates_use_runtime_verified_refs_without_mutations(
    discovery, tmp_path, monkeypatch, placement
):
    service, journal = discovery
    root, configuration = _install(tmp_path, journal, placement=placement)
    before = {
        path: path.read_bytes()
        for path in configuration.rglob("*")
        if path.is_file()
    }
    rows_before = journal._connection.total_changes
    broker = Mock(side_effect=AssertionError("must not read credentials"))
    service.assembler.secret_broker_factory = broker
    result = service.discover(space_id="space-1", space_root=root)
    assert result["skills"] == [
        {
            "ref": SKILL_REF,
            "label": "research",
            "source": "materialized_bundle",
            "availability": "available",
        }
    ]
    assert result["mcp_servers"] == [
        {
            "id": "research",
            "definition": MCP_REF,
            "label": "research",
            "secret_slots": [],
            "source": "materialized_bundle",
            "availability": "available",
        }
    ]
    assert not broker.called
    assert journal._connection.total_changes == rows_before
    assert {path: path.read_bytes() for path in before} == before
    projection = json.dumps(result)
    assert str(root) not in projection
    assert "Authorization" not in projection
    assert "example.test" not in projection
    assert "assignTo" not in projection


def test_imported_assets_are_draft_choices_requiring_existing_setup(
    discovery, tmp_path
):
    service, journal = discovery
    draft = _import(journal)
    result = service.discover(
        space_id="space-1", space_root=tmp_path / "unused"
    )
    assert result["skills"][0]["ref"] == SKILL_REF
    assert result["mcp_servers"][0]["definition"] == MCP_REF
    for candidate in [*result["skills"], *result["mcp_servers"]]:
        assert candidate["availability"] == "requires_setup"
        assert candidate["reason"] == "publish_and_setup_required"
        assert candidate["source"] == "draft_bundle"
    assert journal.get_workspace_config_draft("space-1") == draft
    assert not (tmp_path / "unused").exists()


def test_no_other_space_or_legacy_registry_discovery(discovery, tmp_path):
    service, journal = discovery
    _import(journal, space_id="space-other")
    root, _ = _install(tmp_path, journal, space_id="space-other")
    draft = _manifest().canonical_payload()
    draft["spec"]["skills"] = [{"ref": "registry://skills/legacy"}]
    draft["spec"]["mcpServers"] = [
        {"id": "legacy", "definition": "registry://mcp/legacy"}
    ]
    journal.put_workspace_config_draft(
        space_id="space-1",
        expected_version=0,
        document=draft,
        updated_by="fixture",
    )
    assert service.discover(space_id="space-1", space_root=root) == {
        "space_id": "space-1",
        "skills": [],
        "mcp_servers": [],
    }


def test_changed_or_missing_asset_never_produces_available_candidate(
    discovery, tmp_path
):
    service, journal = discovery
    root, configuration = _install(tmp_path, journal)
    (configuration / SKILL_REF.removeprefix("bundle://")).write_text(
        "Changed content"
    )
    (configuration / MCP_REF.removeprefix("bundle://")).unlink()
    assert (
        service.discover(space_id="space-1", space_root=root)["skills"] == []
    )
    assert (
        service.discover(space_id="space-1", space_root=root)["mcp_servers"]
        == []
    )


def test_symlink_escape_does_not_read_outside_bundle(discovery, tmp_path):
    service, journal = discovery
    root, configuration = _install(tmp_path, journal)
    outside = tmp_path / "outside-SKILL.md"
    outside.write_bytes(_assets()[SKILL_REF])
    skill = configuration / SKILL_REF.removeprefix("bundle://")
    skill.unlink()
    skill.symlink_to(outside)
    result = service.discover(space_id="space-1", space_root=root)
    assert result["skills"] == []
    assert len(result["mcp_servers"]) == 1


def test_draft_generation_change_discards_response(
    discovery, tmp_path, monkeypatch
):
    service, journal = discovery
    draft = _import(journal)
    original = journal.get_workspace_config_draft_asset
    saved = False

    def concurrent_save(**kwargs):
        nonlocal saved
        asset = original(**kwargs)
        if not saved:
            saved = True
            journal.put_workspace_config_draft(
                space_id="space-1",
                expected_version=draft.version,
                document=draft.document,
                updated_by="another-editor",
            )
        return asset

    monkeypatch.setattr(
        journal, "get_workspace_config_draft_asset", concurrent_save
    )
    with pytest.raises(OptimisticConcurrencyError):
        service.discover(space_id="space-1", space_root=tmp_path)


@pytest.mark.parametrize(
    "ref",
    [
        "bundle:///tmp/SKILL.md",
        "bundle://skills/../SKILL.md",
        "bundle://skills/%2e%2e/SKILL.md",
        "bundle://skills/a\\b/SKILL.md",
        "registry://skills/research",
        "bundle://skills//SKILL.md",
    ],
)
def test_invalid_logical_refs_are_not_discovered(discovery, tmp_path, ref):
    service, journal = discovery
    if ref.startswith("bundle://"):
        _import(journal, assets={ref: _assets()[SKILL_REF]})
        assert (
            service.discover(space_id="space-1", space_root=tmp_path)["skills"]
            == []
        )
    else:
        assert not service._safe_ref(ref)


def test_duplicate_lock_references_are_deduplicated(discovery, tmp_path):
    service, journal = discovery
    root, configuration = _install(tmp_path, journal)
    lock_path = configuration / "workspace.lock"
    lock = yaml.safe_load(lock_path.read_text())
    lock["skills"] = [lock["assets"][0]]
    lock_path.write_text(yaml.safe_dump(lock))
    result = service.discover(space_id="space-1", space_root=root)
    assert len(result["skills"]) == len(result["mcp_servers"]) == 1


def test_unsupported_http_secret_destination_requires_setup(
    discovery, tmp_path
):
    service, journal = discovery
    assets = _assets()
    definition = json.loads(assets[MCP_REF])
    definition["mcpServers"]["research"]["headers"] = {
        "Authorization": "slot://api_token"
    }
    assets[MCP_REF] = json.dumps(definition).encode()
    root, _ = _install(tmp_path, journal, assets=assets)
    result = service.discover(space_id="space-1", space_root=root)
    candidate = result["mcp_servers"][0]
    assert candidate["availability"] == "requires_setup"
    assert candidate["reason"] == "mcp_secret_http_transport_unavailable"
    assert candidate["secret_slots"] == ["api_token"]


def test_mcp_definition_preserves_distinct_server_candidates(
    discovery, tmp_path
):
    service, journal = discovery
    assets = _assets()
    definition = json.loads(assets[MCP_REF])
    definition["mcpServers"]["second"] = {"url": "https://example.test/second"}
    assets[MCP_REF] = json.dumps(definition).encode()
    _import(journal, assets=assets)
    result = service.discover(space_id="space-1", space_root=tmp_path)
    assert [item["id"] for item in result["mcp_servers"]] == [
        "research",
        "second",
    ]
