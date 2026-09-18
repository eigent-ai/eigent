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

"""Read-only, Space-scoped discovery of portable Bundle resources.

Discovery never consults global Skills/MCP configuration, resolves secrets,
materializes files, or treats asset availability as execution authorization.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import Any

from app.run_journal import OptimisticConcurrencyError, SQLiteRunJournal
from app.workspace_bundle.mcp_destination import inspect_bundle_mcp_destination
from app.workspace_bundle.runtime import (
    EnvironmentSetupRequiredError,
    RuntimeEnvironmentAssembler,
)
from app.workspace_config.models import (
    WorkspaceBundleManifest,
    assert_bundle_asset_safe,
    assert_cloud_projection_safe,
    assert_manifest_secret_free,
)


class WorkspaceResourceDiscovery:
    MAX_ASSETS = 512
    MAX_ASSET_BYTES = RuntimeEnvironmentAssembler.MAX_TEXT_ASSET_BYTES

    def __init__(self, journal: SQLiteRunJournal, *, state_root: Path):
        self.journal = journal
        self.assembler = RuntimeEnvironmentAssembler(
            journal, state_root=state_root
        )

    @staticmethod
    def _safe_ref(ref: str) -> bool:
        if not ref.startswith("bundle://"):
            return False
        value = ref.removeprefix("bundle://")
        parts = value.split("/")
        return (
            bool(value)
            and all(part not in {"", ".", ".."} for part in parts)
            and not any(
                character in value
                for character in ("\\", "\x00", "%", "?", "#")
            )
        )

    def discover(self, *, space_id: str, space_root: Path) -> dict[str, Any]:
        draft = self.journal.get_workspace_config_draft(space_id)
        installed = self.journal.get_latest_workspace_config_materialization(
            space_id
        )
        skills: dict[str, dict[str, Any]] = {}
        mcp_servers: dict[tuple[str, str], dict[str, Any]] = {}
        if installed is not None:
            revision = self.journal.get_workspace_config_revision(
                installed.revision_id
            )
            if revision is not None:
                manifest = WorkspaceBundleManifest.model_validate(
                    revision.manifest
                )
                root = self.assembler._configuration_root(
                    space_id=space_id,
                    space_root=space_root,
                    placement=installed.config_placement,
                )
                lock = self.assembler._load_configuration_contract(
                    root, manifest
                )
                dependencies = (*lock.assets, *lock.skills, *lock.mcp_packages)
                digests = {item.ref: item.digest for item in dependencies}

                def read_installed(ref: str) -> tuple[Path | None, bytes]:
                    return self.assembler._read_bundle_asset(
                        root, ref, digests
                    )

                self._collect(
                    manifest=manifest,
                    refs=digests,
                    executable_assets={
                        item.ref: {
                            "content_digest": item.digest,
                            "executable": item.executable,
                        }
                        for item in dependencies
                    },
                    read=read_installed,
                    source="materialized_bundle",
                    skills=skills,
                    mcp_servers=mcp_servers,
                )
        if draft is not None:
            descriptors = (
                self.journal.list_workspace_config_draft_asset_descriptors(
                    space_id=space_id,
                    draft_version=draft.version,
                    document_digest=draft.document_digest,
                )
            )
            by_ref = {
                "bundle://" + item.logical_path.removeprefix("bundle://"): item
                for item in descriptors
            }

            def read_draft(ref: str) -> tuple[None, bytes]:
                descriptor = by_ref[ref]
                if descriptor.size_bytes > self.MAX_ASSET_BYTES:
                    raise ValueError("asset_too_large")
                asset = self.journal.get_workspace_config_draft_asset(
                    space_id=space_id,
                    draft_version=draft.version,
                    document_digest=draft.document_digest,
                    logical_path=descriptor.logical_path,
                    content_digest=descriptor.content_digest,
                )
                if (
                    asset is None
                    or len(asset.content) != descriptor.size_bytes
                    or hashlib.sha256(asset.content).hexdigest()
                    != descriptor.content_digest
                ):
                    raise ValueError("asset_changed")
                return None, asset.content

            self._collect(
                manifest=WorkspaceBundleManifest.model_validate(
                    draft.document
                ),
                refs=by_ref,
                executable_assets={
                    ref: {
                        "content_digest": item.content_digest,
                        "executable": item.executable,
                    }
                    for ref, item in by_ref.items()
                },
                read=read_draft,
                source="draft_bundle",
                skills=skills,
                mcp_servers=mcp_servers,
            )

        # A response is one captured configuration generation. Do not return
        # mixed options if a save/import/upgrade completed during discovery.
        if (
            self.journal.get_workspace_config_draft(space_id) != draft
            or self.journal.get_latest_workspace_config_materialization(
                space_id
            )
            != installed
        ):
            raise OptimisticConcurrencyError("workspace discovery changed")
        return {
            "space_id": space_id,
            "skills": sorted(skills.values(), key=lambda item: item["ref"]),
            "mcp_servers": sorted(
                mcp_servers.values(),
                key=lambda item: (item["label"], item["definition"]),
            ),
        }

    def _collect(
        self,
        *,
        manifest: WorkspaceBundleManifest,
        refs: dict,
        executable_assets: dict[str, dict[str, Any]],
        read: Callable[[str], tuple[Path | None, bytes]],
        source: str,
        skills: dict[str, dict[str, Any]],
        mcp_servers: dict[tuple[str, str], dict[str, Any]],
    ) -> None:
        if len(refs) > self.MAX_ASSETS:
            raise ValueError("bundle_discovery_asset_limit")
        mcp_refs = {item.definition for item in manifest.spec.mcp_servers}
        for ref in sorted(refs):
            if not self._safe_ref(ref):
                continue
            logical = PurePosixPath(ref.removeprefix("bundle://"))
            is_skill = logical.name == "SKILL.md"
            if (
                not is_skill
                and logical.name != "mcp.json"
                and ref not in mcp_refs
            ):
                continue
            try:
                path, content = read(ref)
                assert_bundle_asset_safe(ref, content)
                content.decode("utf-8")
                common = {
                    "source": source,
                    "availability": (
                        "available"
                        if source == "materialized_bundle"
                        else "requires_setup"
                    ),
                }
                if source == "draft_bundle":
                    common["reason"] = "publish_and_setup_required"
                if is_skill:
                    candidate = {
                        "ref": ref,
                        "label": logical.parent.name or "SKILL.md",
                        **common,
                    }
                    self._check_projection(candidate)
                    skills[ref] = candidate
                    continue
                definition = json.loads(content)
                servers = definition.get("mcpServers", {})
                if (
                    not isinstance(servers, dict)
                    or len(servers) > self.MAX_ASSETS
                ):
                    continue
                for server_id, server in servers.items():
                    if not isinstance(server_id, str) or not isinstance(
                        server, dict
                    ):
                        continue
                    slots = {
                        value.removeprefix("slot://")
                        for category in ("env", "headers")
                        for value in (server.get(category) or {}).values()
                        if isinstance(value, str)
                        and value.startswith("slot://")
                    }
                    candidate = {
                        "id": server_id,
                        "definition": ref,
                        "label": server_id,
                        "secret_slots": sorted(slots),
                        **common,
                    }
                    self._check_projection(candidate)
                    destination = inspect_bundle_mcp_destination(
                        revision_id=manifest.revision_id,
                        mcp_id=server_id,
                        definition_ref=ref,
                        definition_digest=hashlib.sha256(content).hexdigest(),
                        content=content,
                        secret_slots=tuple(sorted(slots)),
                        executable_assets_by_ref=executable_assets,
                    )
                    executable_ref = destination.get("executable_asset_ref")
                    if executable_ref is not None:
                        read(executable_ref)
                    issue = destination.get("availability_issue")
                    if server.get("command") and not destination.get(
                        "executable_digest"
                    ):
                        issue = issue or "mcp_executable_unavailable"
                    if issue:
                        candidate["availability"] = "requires_setup"
                        candidate["reason"] = issue
                    if path is not None:
                        # This is the same static resolver used by runtime. It
                        # checks referenced executable/cwd paths and slot maps;
                        # it neither starts MCP nor resolves credential values.
                        self.assembler._resolve_mcp_server(
                            server_id=server_id,
                            definition_path=path,
                            content=content,
                            secret_slots=tuple(sorted(slots)),
                        )
                    mcp_servers[(ref, server_id)] = candidate
            except (
                EnvironmentSetupRequiredError,
                ValueError,
                KeyError,
                TypeError,
                AttributeError,
                OSError,
            ):
                # Unverified bytes never produce a selectable runnable ref.
                # Existing manual values remain in the configuration editor.
                continue

    @staticmethod
    def _check_projection(candidate: dict[str, Any]) -> None:
        assert_manifest_secret_free(candidate)
        assert_cloud_projection_safe(candidate)
