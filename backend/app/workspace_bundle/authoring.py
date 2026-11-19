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

"""Secret-free review projection for authoring a Workspace Bundle."""

from __future__ import annotations

import re
from typing import Any

from app.workspace_config import WorkspaceBundleManifest, canonical_digest
from app.workspace_config.admission import LegacyEnvironmentImporter
from app.workspace_config.global_resources import (
    GLOBAL_MCP_PREFIX,
    GLOBAL_SKILL_PREFIX,
    GlobalResourceUnavailable,
    resolve_global_mcp,
    resolve_global_skill,
)

_SENSITIVE_ENV_NAME = re.compile(
    r"(?:api[_-]?key|access[_-]?token|auth(?:orization)?|credential|"
    r"password|private[_-]?key|secret|token)$",
    re.IGNORECASE,
)


class WorkspaceBundleAuthoringService:
    """Build a bounded review without exposing any locally configured value."""

    @staticmethod
    def reference_findings(
        manifest: WorkspaceBundleManifest,
        *,
        user_id: str | int | None = None,
        email: str = "",
    ) -> list[dict[str, str]]:
        """Advisory device checks, separate from immutable author review digests.

        No registry lookup, script execution, credential export, or Cloud ACL
        claim. Models and explicitly selected assets are checked by Desktop.
        """
        findings = []
        references = [
            (f"spec.skills[{index}].ref", item.ref, "skill", ())
            for index, item in enumerate(manifest.spec.skills)
        ] + [
            (
                f"spec.mcpServers[{index}].definition",
                item.definition,
                "mcp",
                item.secret_slots,
            )
            for index, item in enumerate(manifest.spec.mcp_servers)
        ]
        for location, ref, kind, slots in references:
            code = None
            if ref.startswith("bundle://"):
                # Availability depends on the assets explicitly selected in
                # Save Review, not the contents of the user's Space folder.
                continue
            prefix = (
                GLOBAL_SKILL_PREFIX if kind == "skill" else GLOBAL_MCP_PREFIX
            )
            if not re.fullmatch(r"registry://[^\s?#%\\]+", ref):
                code = "malformed"
            elif not ref.startswith(prefix):
                code = "unsupported"
            elif not re.fullmatch(re.escape(prefix) + r"[0-9a-f]{64}", ref):
                code = "malformed"
            else:
                try:
                    if kind == "skill":
                        resolve_global_skill(ref, user_id=user_id, email=email)
                    else:
                        resolve_global_mcp(ref, secret_slots=slots)
                except GlobalResourceUnavailable as exc:
                    reason = str(exc)
                    if reason in {
                        "global_skill_unavailable",
                        "global_mcp_unavailable",
                        "global_resource_disabled",
                        "global_skill_invalid",
                        "global_mcp_invalid",
                    }:
                        code = "global_setup_required"
                    elif reason == "global_mcp_secret_slots_unsupported":
                        code = "unsupported"
                    else:
                        code = "verification_unavailable"
                except (OSError, ValueError, TimeoutError):
                    # Never project raw exceptions: they may contain paths,
                    # config contents or credentials. Failure is not absence.
                    code = "verification_unavailable"
            if code:
                findings.append(
                    {"location": location, "reference": ref, "code": code}
                )
        return findings

    @classmethod
    def review(
        cls,
        manifest: WorkspaceBundleManifest,
        *,
        mcp_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        spec = manifest.spec
        configured_servers = (mcp_config or {}).get("mcpServers", {})
        if not isinstance(configured_servers, dict):
            configured_servers = {}

        declared_environment = {
            item.name: item
            for item in (
                spec.environment.variables if spec.environment else ()
            )
        }
        discovered_environment: dict[str, dict[str, Any]] = {}
        declared_secret_slots = {
            slot
            for requirement in spec.mcp_servers
            for slot in requirement.secret_slots
        }
        discovered_secret_slots: set[str] = set()
        suggested_mcp_secret_slots: dict[str, set[str]] = {}
        excluded_value_count = 0
        for requirement in spec.mcp_servers:
            config = configured_servers.get(requirement.id)
            if not isinstance(config, dict):
                continue
            config_secret_slots = set(
                LegacyEnvironmentImporter._mcp_secret_slots(
                    requirement.id, config
                )
            )
            environment = config.get("env", {})
            environment_slot_prefix = (
                "mcp."
                + LegacyEnvironmentImporter._logical_name(requirement.id)
                + ".env."
            )
            environment_slots = (
                {
                    environment_slot_prefix
                    + LegacyEnvironmentImporter._logical_name(str(name))
                    for name in environment
                }
                if isinstance(environment, dict)
                else set()
            )
            non_environment_slots = config_secret_slots - environment_slots
            discovered_secret_slots.update(non_environment_slots)
            excluded_value_count += len(non_environment_slots)
            missing_slots = non_environment_slots - set(
                requirement.secret_slots
            )
            if missing_slots:
                suggested_mcp_secret_slots[requirement.id] = missing_slots
            if not isinstance(environment, dict):
                continue
            for raw_name, value in environment.items():
                name = str(raw_name)
                if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", name):
                    continue
                excluded_value_count += int(value is not None)
                discovered_environment[name] = {
                    "name": name,
                    "required": True,
                    "sensitive": bool(_SENSITIVE_ENV_NAME.search(name)),
                    "description": (
                        f"Required by the {requirement.id} MCP server"
                    ),
                }

        suggested_environment: list[dict[str, Any]] = []
        reviewed_environment: list[dict[str, Any]] = []
        for name in sorted(declared_environment):
            declared = declared_environment[name]
            inferred = discovered_environment.get(name)
            reviewed = declared.model_dump(
                by_alias=True, exclude_none=True, mode="json"
            )
            if inferred and inferred["sensitive"] and not declared.sensitive:
                reviewed["sensitive"] = True
                suggested_environment.append(reviewed)
            reviewed_environment.append(reviewed)
        suggested_environment.extend(
            discovered_environment[name]
            for name in sorted(discovered_environment)
            if name not in declared_environment
        )
        assets: set[str] = set(spec.instructions.values())
        assets.update(
            item.path
            for item in spec.context
            if item.kind == "bundle_asset" and item.path is not None
        )
        assets.update(
            item.ref
            for item in spec.skills
            if item.ref.startswith("bundle://")
        )
        assets.update(
            item.definition
            for item in spec.mcp_servers
            if item.definition.startswith("bundle://")
        )
        warnings: list[dict[str, str]] = []
        if spec.permissions.profile == "full_access":
            warnings.append(
                {
                    "code": "full_access_requested",
                    "message": "This Bundle requests Full Access.",
                }
            )
        if spec.git.remote_policy == "allow":
            warnings.append(
                {
                    "code": "git_remote_allowed",
                    "message": "Git remote operations may run without a prompt.",
                }
            )
        if suggested_environment:
            warnings.append(
                {
                    "code": "environment_requirements_discovered",
                    "message": (
                        "Local environment values were excluded; add or "
                        "harden their declarations before publishing."
                    ),
                }
            )

        payload = {
            "slug": manifest.metadata.id,
            "version": manifest.metadata.revision,
            "manifest_digest": manifest.digest,
            "name": manifest.metadata.name,
            "summary": {
                "instructions": len(spec.instructions),
                "context_sources": len(spec.context),
                "skills": len(spec.skills),
                "connectors": len(spec.connectors),
                "mcp_servers": len(spec.mcp_servers),
                "agents": len(spec.agents),
            },
            "requirements": {
                "environment_variables": reviewed_environment,
                "suggested_environment_variables": suggested_environment,
                "suggested_mcp_secret_slots": [
                    {
                        "mcp_id": mcp_id,
                        "secret_slots": sorted(slots),
                    }
                    for mcp_id, slots in sorted(
                        suggested_mcp_secret_slots.items()
                    )
                ],
                "secret_slots": sorted(
                    declared_secret_slots | discovered_secret_slots
                ),
                "connector_slots": [
                    {
                        "slot_id": item.connection_slot,
                        "connector_id": item.connector,
                        "required_grants": sorted(set(item.required_grants)),
                    }
                    for item in spec.connectors
                ],
                "local_path_slots": sorted(
                    {
                        item.slot
                        for item in spec.context
                        if item.kind == "local_path_slot"
                        and item.slot is not None
                    }
                ),
            },
            "assets": sorted(assets),
            "warnings": warnings,
            "local_values_excluded": excluded_value_count,
        }
        return {**payload, "review_digest": canonical_digest(payload)}
