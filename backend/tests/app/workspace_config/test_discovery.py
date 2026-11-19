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

import builtins
import hashlib
import io
import json
import os
from pathlib import Path
from unittest.mock import Mock

import pytest
import yaml

from app.run_journal import OptimisticConcurrencyError, SQLiteRunJournal
from app.workspace_bundle.runtime import EnvironmentSetupRequiredError
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


def _deny_fixture_opens(monkeypatch, forbidden: Path):
    """Observe the actual open boundary, not just the returned projection."""
    opened = []
    forbidden = forbidden.resolve()

    def guard(original):
        def checked(file, *args, **kwargs):
            if isinstance(file, (str, bytes, os.PathLike)):
                target = Path(os.fsdecode(file)).resolve()
                if target == forbidden or forbidden in target.parents:
                    opened.append(target)
                    raise AssertionError("forbidden fixture was opened")
            return original(file, *args, **kwargs)

        return checked

    monkeypatch.setattr(builtins, "open", guard(builtins.open))
    monkeypatch.setattr(io, "open", guard(io.open))
    return opened


@pytest.mark.parametrize("placement", ["in_repo", "sidecar"])
@pytest.mark.parametrize("redirect_owner", [False, True])
def test_configuration_root_or_owner_cannot_redirect_to_another_space(
    discovery, tmp_path, monkeypatch, placement, redirect_owner
):
    service, journal = discovery
    root, configuration = _install(tmp_path, journal, placement=placement)
    _, other_configuration = _install(
        tmp_path, journal, space_id="space-other", placement=placement
    )
    link = configuration.parent if redirect_owner else configuration
    target = (
        other_configuration.parent if redirect_owner else other_configuration
    )
    link.rename(link.with_name("original-configuration"))
    link.symlink_to(target, target_is_directory=True)
    opened = _deny_fixture_opens(monkeypatch, other_configuration)

    with pytest.raises(EnvironmentSetupRequiredError):
        service.discover(space_id="space-1", space_root=root)
    assert opened == []


@pytest.mark.parametrize(
    ("placement", "redirect"),
    [
        ("in_repo", "owner"),
        ("in_repo", "parent"),
        ("sidecar", "owner"),
        ("sidecar", "parent"),
        ("sidecar", "state"),
    ],
)
def test_owned_configuration_ancestors_cannot_reanchor_discovery(
    discovery, tmp_path, monkeypatch, placement, redirect
):
    _, journal = discovery
    owned = tmp_path / "owned"
    service = WorkspaceResourceDiscovery(journal, state_root=owned / "state")
    root, configuration = _install(owned, journal, placement=placement)
    owner = root if placement == "in_repo" else configuration.parent
    link = (
        owner
        if redirect == "owner"
        else owner.parent
        if redirect == "parent"
        else owned / "state"
    )
    outside = tmp_path / "synthetic-other-space"
    link.rename(outside)
    link.symlink_to(outside, target_is_directory=True)
    opened = _deny_fixture_opens(monkeypatch, outside)

    with pytest.raises(EnvironmentSetupRequiredError):
        service.discover(space_id="space-1", space_root=root)
    assert opened == []


@pytest.mark.parametrize("placement", ["in_repo", "sidecar"])
@pytest.mark.parametrize("contract", ["workspace.yaml", "workspace.lock"])
def test_contract_symlink_is_rejected_before_opening_external_content(
    discovery, tmp_path, monkeypatch, placement, contract
):
    service, journal = discovery
    root, configuration = _install(tmp_path, journal, placement=placement)
    outside = tmp_path / "synthetic-private-config.json"
    outside.write_text('{"token":"synthetic-boundary-marker"}')
    path = configuration / contract
    path.unlink()
    path.symlink_to(outside)
    opened = _deny_fixture_opens(monkeypatch, outside)

    with pytest.raises(EnvironmentSetupRequiredError) as caught:
        service.discover(space_id="space-1", space_root=root)
    assert opened == []
    assert str(outside) not in str(caught.value)
    assert "synthetic-boundary-marker" not in str(caught.value)


@pytest.mark.parametrize("placement", ["in_repo", "sidecar"])
@pytest.mark.parametrize("ref", [SKILL_REF, MCP_REF])
@pytest.mark.parametrize("redirect_parent", [False, True])
def test_asset_file_and_parent_links_never_open_external_targets(
    discovery, tmp_path, monkeypatch, placement, ref, redirect_parent
):
    service, journal = discovery
    root, configuration = _install(tmp_path, journal, placement=placement)
    path = configuration / ref.removeprefix("bundle://")
    link = path.parent if redirect_parent else path
    outside = tmp_path / "synthetic-external-asset"
    link.rename(outside)
    link.symlink_to(outside, target_is_directory=redirect_parent)
    opened = _deny_fixture_opens(monkeypatch, outside)

    result = service.discover(space_id="space-1", space_root=root)
    assert result["skills" if ref == SKILL_REF else "mcp_servers"] == []
    assert opened == []


@pytest.mark.parametrize("placement", ["in_repo", "sidecar"])
@pytest.mark.parametrize("redirect_parent", [False, True])
def test_mcp_executable_links_never_open_external_targets(
    discovery, tmp_path, monkeypatch, placement, redirect_parent
):
    service, journal = discovery
    executable_ref = "bundle://agent-plugins/research/bin/server"
    assets = _assets()
    assets[executable_ref] = b"#!/bin/sh\nexit 0\n"
    assets[MCP_REF] = json.dumps(
        {"mcpServers": {"research": {"command": "./bin/server", "args": []}}}
    ).encode()
    root, configuration = _install(
        tmp_path, journal, assets=assets, placement=placement
    )
    executable = configuration / executable_ref.removeprefix("bundle://")
    executable.chmod(0o755)
    lock_path = configuration / "workspace.lock"
    lock = yaml.safe_load(lock_path.read_text())
    for asset in lock["assets"]:
        if asset["ref"] == executable_ref:
            asset["executable"] = True
    lock_path.write_text(yaml.safe_dump(lock))
    candidate = service.discover(space_id="space-1", space_root=root)[
        "mcp_servers"
    ][0]
    assert candidate["availability"] == "available"

    link = executable.parent if redirect_parent else executable
    outside = tmp_path / "synthetic-external-executable"
    link.rename(outside)
    link.symlink_to(outside, target_is_directory=redirect_parent)
    opened = _deny_fixture_opens(monkeypatch, outside)

    result = service.discover(space_id="space-1", space_root=root)
    assert result["mcp_servers"] == []
    assert result["skills"][0]["ref"] == SKILL_REF
    assert opened == []


@pytest.mark.parametrize("placement", ["in_repo", "sidecar"])
def test_contained_root_contract_and_asset_aliases_remain_valid(
    discovery, tmp_path, placement
):
    service, journal = discovery
    root, configuration = _install(tmp_path, journal, placement=placement)
    # An alias may stay within the same Space owner; it cannot select a
    # different Space owner. Contract/asset aliases stay inside that Bundle.
    actual = configuration.with_name("contained-profile")
    configuration.rename(actual)
    configuration.symlink_to(actual.name, target_is_directory=True)
    for filename in ("workspace.yaml", "workspace.lock"):
        source = actual / filename
        target = source.with_name("original-" + filename)
        source.rename(target)
        source.symlink_to(target.name)
    source = actual / SKILL_REF.removeprefix("bundle://")
    target = source.with_name("original-skill.md")
    source.rename(target)
    source.symlink_to(target.name)

    result = service.discover(space_id="space-1", space_root=root)
    assert result["skills"][0]["ref"] == SKILL_REF
    assert result["mcp_servers"][0]["definition"] == MCP_REF
    assert all(
        item["availability"] == "available"
        for item in [*result["skills"], *result["mcp_servers"]]
    )
    assert str(actual) not in json.dumps(result)


def test_sidecar_trusted_storage_parent_alias_does_not_change_space_scope(
    discovery, tmp_path
):
    _, journal = discovery
    root, _ = _install(tmp_path, journal, placement="sidecar")
    storage_alias = tmp_path / "storage-alias"
    storage_alias.symlink_to(tmp_path, target_is_directory=True)
    service = WorkspaceResourceDiscovery(
        journal, state_root=storage_alias / "state"
    )
    # Sidecar does not require its files to be under the content workspace.
    result = service.discover(space_id="space-1", space_root=root)
    assert result["skills"][0]["ref"] == SKILL_REF


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
