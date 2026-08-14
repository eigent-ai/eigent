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

"""Agent Plugins v1.0.0 importer for reviewable Workspace Bundle drafts."""

from __future__ import annotations

import hashlib
import ipaddress
import json
import mimetypes
import re
import stat
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass
from functools import lru_cache
from itertools import islice
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlsplit

import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError

from app.run_journal.models import WorkspaceConfigDraftRecord
from app.run_journal.store import SQLiteRunJournal
from app.workspace_bundle.authoring import WorkspaceBundleAuthoringService
from app.workspace_config import (
    SecretValueInManifestError,
    WorkspaceBundleManifest,
    assert_bundle_asset_safe,
    assert_manifest_secret_free,
    canonical_digest,
)

PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"

_PLUGIN_FIELDS = {
    "$schema",
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "extensions",
}
_AUTHOR_FIELDS = {"name", "email", "url"}
_SKILL_FIELDS = {
    "name",
    "description",
    "license",
    "compatibility",
    "metadata",
    "allowed-tools",
}
_NAME = re.compile(r"^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$")
_SKILL_NAME = re.compile(r"^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")
_PLACEHOLDER = re.compile(r"\$\{([^{}]+)\}")
_HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
_SLOT_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,199}$")
_CONVERTER_VERSION = "eigent-agent-plugins-importer/1"
_MAX_JSON_BYTES = 1024 * 1024
_MAX_SKILL_BYTES = 1024 * 1024
_MAX_ASSET_BYTES = 16 * 1024 * 1024
_MAX_PACKAGE_BYTES = 64 * 1024 * 1024
_MAX_PACKAGE_FILES = 512
_MAX_PACKAGE_ENTRIES = 4_000
_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
_MAX_ARCHIVE_DEPTH = 32
_MAX_COMPRESSION_RATIO = 100
_MAX_REVIEW_VALUE_CHARS = 512
_MAX_ARCHIVE_DIRECTORY_BYTES = 8 * 1024 * 1024
_SCHEMA_ROOT = Path(__file__).with_name("schemas") / "agent_plugins" / "1.0.0"


class AgentPluginImportError(ValueError):
    """Raised when the portable plugin package cannot be imported safely."""


@lru_cache(maxsize=2)
def _schema_validator(filename: str) -> Draft202012Validator:
    try:
        schema = json.loads(
            (_SCHEMA_ROOT / filename).read_text(encoding="utf-8")
        )
        Draft202012Validator.check_schema(schema)
    except (
        OSError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        SchemaError,
    ) as exc:
        raise RuntimeError("Bundled Agent Plugins schema is invalid") from exc
    return Draft202012Validator(schema)


def _validate_standard_schema(value: Any, filename: str, label: str) -> None:
    try:
        _schema_validator(filename).validate(value)
    except ValidationError as exc:
        raise AgentPluginImportError(
            f"{label} does not conform to Agent Plugins 1.0.0"
        ) from exc


def _review_public_value(name: str, value: str) -> dict[str, Any]:
    return {
        "name": name,
        "value": value[:_MAX_REVIEW_VALUE_CHARS],
        "value_digest": hashlib.sha256(value.encode("utf-8")).hexdigest(),
        "truncated": len(value) > _MAX_REVIEW_VALUE_CHARS,
    }


@dataclass(frozen=True)
class AgentPluginImportWarning:
    code: str
    message: str
    path: str | None = None

    def as_dict(self) -> dict[str, str]:
        result = {"code": self.code, "message": self.message}
        if self.path is not None:
            result["path"] = self.path
        return result


@dataclass(frozen=True)
class AgentPluginAsset:
    logical_path: str
    source_relative_path: str
    content_digest: str
    media_type: str
    size_bytes: int
    content: bytes
    executable: bool = False
    provenance: str = "agent_plugin_import"

    def descriptor(self) -> dict[str, Any]:
        return {
            "id": "asset_" + self.content_digest[:32],
            "logical_path": self.logical_path,
            "content_digest": self.content_digest,
            "media_type": self.media_type,
            "size_bytes": self.size_bytes,
            "provenance": self.provenance,
            "source_relative_path": self.source_relative_path,
            "executable": self.executable,
        }

    def persistence_payload(self) -> dict[str, Any]:
        return {
            **self.descriptor(),
            "content": self.content,
        }


@dataclass(frozen=True)
class AgentPluginImportResult:
    manifest: WorkspaceBundleManifest
    assets: tuple[AgentPluginAsset, ...]
    source_metadata: dict[str, Any]
    warnings: tuple[AgentPluginImportWarning, ...]
    review: dict[str, Any]
    status: str = "draft"
    source_format: str = "agent-plugins/1.0.0"

    @property
    def draft_document(self) -> dict[str, Any]:
        return self.manifest.canonical_payload()

    @property
    def asset_descriptors(self) -> tuple[dict[str, Any], ...]:
        return tuple(asset.descriptor() for asset in self.assets)

    @property
    def workspace_lock_assets(self) -> tuple[dict[str, Any], ...]:
        version = self.source_metadata.get("version")
        return tuple(
            {
                "ref": asset.logical_path,
                "digest": asset.content_digest,
                "version": version if isinstance(version, str) else None,
            }
            for asset in self.assets
        )


@dataclass(frozen=True)
class AgentPluginDraftConversion:
    import_result: AgentPluginImportResult
    draft: WorkspaceConfigDraftRecord


class AgentPluginImporter:
    """Validate a portable Agent Plugin and create a secret-free draft."""

    def import_plugin(
        self,
        plugin_root: Path,
        *,
        bundle_id: str | None = None,
        revision: int = 1,
    ) -> AgentPluginImportResult:
        try:
            source = plugin_root.resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise AgentPluginImportError(
                "Agent Plugin source is no longer available"
            ) from exc
        if source.is_dir():
            return self._import_directory(
                source,
                source_kind="directory",
                display_name=source.name,
                bundle_id=bundle_id,
                revision=revision,
            )
        if source.is_file() and source.suffix.lower() == ".zip":
            with tempfile.TemporaryDirectory(
                prefix="eigent-agent-plugin-"
            ) as temp:
                extracted = self._extract_archive(source, Path(temp))
                return self._import_directory(
                    extracted,
                    source_kind="archive",
                    display_name=source.name,
                    bundle_id=bundle_id,
                    revision=revision,
                )
        raise AgentPluginImportError(
            "Agent Plugin source must be a directory or .zip archive"
        )

    def _import_directory(
        self,
        plugin_root: Path,
        *,
        source_kind: str,
        display_name: str,
        bundle_id: str | None,
        revision: int,
    ) -> AgentPluginImportResult:
        root = self._plugin_root(plugin_root)
        source_tree_digest = self._source_tree_digest(root)
        warnings: list[AgentPluginImportWarning] = []
        source_manifest = self._load_plugin_manifest(root, warnings)
        plugin_name = source_manifest["name"]
        asset_prefix = f"agent-plugins/{plugin_name}"
        explicit_secrets = self._explicit_secret_requirements(source_manifest)

        skill_refs, skill_review = self._discover_skills(
            root, asset_prefix, warnings
        )
        mcp_config, mcp_requirements, mcp_review = self._load_mcp(
            root,
            asset_prefix,
            warnings,
            explicit_secrets,
        )
        if explicit_secrets:
            raise AgentPluginImportError(
                "ai.eigent MCP secret requirement does not match a valid "
                "MCP server declaration"
            )
        semantic_executable_paths = {
            review["executable_asset_ref"].removeprefix(
                f"bundle://{asset_prefix}/"
            )
            for review in mcp_review
            if review.get("executable_asset_ref")
        }
        overrides: dict[str, bytes] = {
            "plugin.json": self._json_bytes(source_manifest),
        }
        excluded: set[str] = set()
        if mcp_config is None:
            if self._path_exists(root / "mcp.json"):
                excluded.add("mcp.json")
        else:
            overrides["mcp.json"] = self._json_bytes(mcp_config)

        assets = self._collect_assets(
            root,
            asset_prefix=asset_prefix,
            overrides=overrides,
            excluded=excluded,
            semantic_executable_paths=semantic_executable_paths,
        )
        manifest = WorkspaceBundleManifest.model_validate(
            {
                "apiVersion": "eigent.ai/v1alpha1",
                "kind": "WorkspaceBundle",
                "metadata": {
                    "id": bundle_id or self._bundle_id(plugin_name),
                    "name": plugin_name,
                    "revision": revision,
                },
                "spec": {
                    "skills": [
                        {"ref": value, "assignTo": []} for value in skill_refs
                    ],
                    "mcpServers": mcp_requirements,
                    "models": {
                        "default": {
                            "modelRef": "provider://default",
                            "thinkingEffort": "medium",
                        }
                    },
                    "permissions": {
                        "profile": "request_approval",
                        "rules": [],
                    },
                },
            }
        )
        diagnostics = tuple(
            {
                **item.as_dict(),
                "severity": "warning",
                **({"logical_path": item.path} if item.path else {}),
            }
            for item in warnings
        )
        converted_tree_digest = canonical_digest(
            [
                {
                    "logical_path": asset.logical_path,
                    "content_digest": asset.content_digest,
                    "executable": asset.executable,
                }
                for asset in assets
            ]
        )
        skipped_skills = [
            {
                "logical_path": item.get("logical_path"),
                "reason_code": item["code"],
                "reason": item["message"],
            }
            for item in diagnostics
            if item["code"]
            in {"invalid_skills_component", "invalid_skill_skipped"}
        ]
        skipped_mcp = [
            {
                "logical_path": item.get("logical_path"),
                "reason_code": item["code"],
                "reason": item["message"],
            }
            for item in diagnostics
            if item["code"]
            in {"invalid_mcp_component", "invalid_mcp_server_skipped"}
        ]
        credential_requirements = [
            {
                "requirement_key": slot,
                "label": slot,
                "description": "Configure locally after conversion.",
                "requirement_kind": "mcp_secret",
                "required": True,
                "sensitive": True,
            }
            for requirement in mcp_requirements
            for slot in requirement["secretSlots"]
        ]
        inspection_payload = {
            "standard": "agent-plugins",
            "schema_version": "1.0.0",
            "source_tree_digest": source_tree_digest,
            "converted_tree_digest": converted_tree_digest,
            "metadata": {
                key: source_manifest.get(key)
                for key in ("name", "version", "description", "author")
                if source_manifest.get(key) is not None
            },
            "source": {
                "display_name": display_name,
                "source_kind": source_kind,
            },
            "skills": skill_review,
            "skipped_skills": skipped_skills,
            "mcp_servers": mcp_review,
            "skipped_mcp_servers": skipped_mcp,
            "files": [asset.descriptor() for asset in assets],
            "credential_requirements": credential_requirements,
            "warnings": [
                {
                    "code": item["code"],
                    "severity": item["severity"],
                    "message": item["message"],
                }
                for item in diagnostics
            ],
            "diagnostics": list(diagnostics),
            "convertible": True,
        }
        digest_payload = {
            **inspection_payload,
            "converter_version": _CONVERTER_VERSION,
            "conversion_plan": WorkspaceBundleAuthoringService.review(
                manifest, mcp_config=mcp_config
            ),
            "workspace_lock_assets": [
                {
                    "ref": asset.logical_path,
                    "digest": asset.content_digest,
                    "version": source_manifest.get("version"),
                }
                for asset in assets
            ],
        }
        review = {
            **inspection_payload,
            "review_digest": canonical_digest(digest_payload),
        }
        return AgentPluginImportResult(
            manifest=manifest,
            assets=assets,
            source_metadata=dict(source_manifest),
            warnings=tuple(warnings),
            review=review,
        )

    def convert_to_draft(
        self,
        plugin_root: Path,
        *,
        journal: SQLiteRunJournal,
        space_id: str,
        expected_target_draft_version: int,
        expected_review_digest: str,
        client_request_id: str,
        updated_by: str,
        bundle_id: str | None = None,
        revision: int = 1,
    ) -> AgentPluginDraftConversion:
        result = self.import_plugin(
            plugin_root,
            bundle_id=bundle_id,
            revision=revision,
        )
        if result.review["review_digest"] != expected_review_digest:
            raise AgentPluginImportError(
                "Agent Plugin changed after review; inspect it again"
            )
        draft = journal.put_workspace_config_draft_from_import(
            space_id=space_id,
            expected_target_draft_version=expected_target_draft_version,
            client_request_id=client_request_id,
            document=result.draft_document,
            review_digest=result.review["review_digest"],
            assets=tuple(
                asset.persistence_payload() for asset in result.assets
            ),
            updated_by=updated_by,
        )
        return AgentPluginDraftConversion(import_result=result, draft=draft)

    @staticmethod
    def _plugin_root(value: Path) -> Path:
        try:
            root = value.resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise AgentPluginImportError(
                "Agent Plugin root does not exist"
            ) from exc
        if not root.is_dir():
            raise AgentPluginImportError(
                "Agent Plugin root must be a directory"
            )
        return root

    @staticmethod
    def _extract_archive(archive: Path, destination: Path) -> Path:
        try:
            archive_size = archive.stat().st_size
        except OSError as exc:
            raise AgentPluginImportError(
                "Agent Plugin archive is no longer available"
            ) from exc
        if archive_size > _MAX_ARCHIVE_BYTES:
            raise AgentPluginImportError("Agent Plugin archive is too large")
        AgentPluginImporter._preflight_archive_directory(
            archive,
            archive_size=archive_size,
        )
        try:
            handle = zipfile.ZipFile(archive)
        except (OSError, zipfile.BadZipFile) as exc:
            raise AgentPluginImportError(
                "Agent Plugin archive is invalid"
            ) from exc
        total = 0
        files = 0
        normalized_names: set[str] = set()
        with handle:
            entries = handle.infolist()
            if len(entries) > _MAX_PACKAGE_ENTRIES:
                raise AgentPluginImportError(
                    "Agent Plugin archive contains too many entries"
                )
            for info in entries:
                raw_name = info.filename
                relative = PurePosixPath(info.filename)
                if (
                    not raw_name
                    or "\x00" in raw_name
                    or "\\" in raw_name
                    or relative.is_absolute()
                    or not relative.parts
                    or any(part in {"", ".", ".."} for part in relative.parts)
                    or len(relative.parts) > _MAX_ARCHIVE_DEPTH
                ):
                    raise AgentPluginImportError(
                        "Agent Plugin archive contains an unsafe path"
                    )
                collision_key = unicodedata.normalize(
                    "NFC", relative.as_posix()
                ).casefold()
                if collision_key in normalized_names:
                    raise AgentPluginImportError(
                        "Agent Plugin archive contains colliding paths"
                    )
                normalized_names.add(collision_key)
                mode = (info.external_attr >> 16) & 0o177777
                file_type = stat.S_IFMT(mode)
                if file_type not in {0, stat.S_IFREG, stat.S_IFDIR}:
                    raise AgentPluginImportError(
                        "Agent Plugin archive contains a special file"
                    )
                if info.flag_bits & 0x1:
                    raise AgentPluginImportError(
                        "Encrypted Agent Plugin archives are unsupported"
                    )
                target = destination.joinpath(*relative.parts)
                try:
                    target.resolve(strict=False).relative_to(
                        destination.resolve()
                    )
                except ValueError as exc:
                    raise AgentPluginImportError(
                        "Agent Plugin archive contains an unsafe path"
                    ) from exc
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                files += 1
                total += info.file_size
                if (
                    files > _MAX_PACKAGE_FILES
                    or info.file_size > _MAX_ASSET_BYTES
                    or total > _MAX_PACKAGE_BYTES
                    or (info.file_size > 0 and info.compress_size == 0)
                    or (
                        info.compress_size > 0
                        and info.file_size
                        > info.compress_size * _MAX_COMPRESSION_RATIO
                    )
                ):
                    raise AgentPluginImportError(
                        "Agent Plugin archive exceeds safe extraction limits"
                    )
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    with (
                        handle.open(info) as source,
                        target.open("xb") as output,
                    ):
                        remaining = info.file_size
                        while remaining:
                            chunk = source.read(min(64 * 1024, remaining))
                            if not chunk:
                                raise AgentPluginImportError(
                                    "Agent Plugin archive entry is truncated"
                                )
                            output.write(chunk)
                            remaining -= len(chunk)
                        if source.read(1):
                            raise AgentPluginImportError(
                                "Agent Plugin archive entry exceeds its descriptor"
                            )
                except (
                    OSError,
                    RuntimeError,
                    zipfile.BadZipFile,
                    NotImplementedError,
                ) as exc:
                    raise AgentPluginImportError(
                        "Agent Plugin archive cannot be extracted"
                    ) from exc
                if mode & 0o111:
                    target.chmod(0o700)

        candidates = [destination]
        candidates.extend(
            item
            for item in destination.iterdir()
            if item.is_dir() and item.name != "__MACOSX"
        )
        roots = [
            item for item in candidates if (item / "plugin.json").is_file()
        ]
        if len(roots) != 1:
            raise AgentPluginImportError(
                "Agent Plugin archive must contain one plugin.json root"
            )
        return roots[0]

    @staticmethod
    def _preflight_archive_directory(
        archive: Path,
        *,
        archive_size: int,
    ) -> None:
        """Reject oversized ZIP indexes before ZipFile allocates their entries."""

        tail_size = min(archive_size, 22 + 65_535)
        try:
            with archive.open("rb") as handle:
                handle.seek(archive_size - tail_size)
                tail = handle.read(tail_size)
        except OSError as exc:
            raise AgentPluginImportError(
                "Agent Plugin archive cannot be read"
            ) from exc
        signature = b"PK\x05\x06"
        offset = tail.rfind(signature)
        if offset < 0 or len(tail) - offset < 22:
            raise AgentPluginImportError("Agent Plugin archive is invalid")
        record = tail[offset : offset + 22]
        disk_number = int.from_bytes(record[4:6], "little")
        directory_disk = int.from_bytes(record[6:8], "little")
        disk_entries = int.from_bytes(record[8:10], "little")
        total_entries = int.from_bytes(record[10:12], "little")
        directory_size = int.from_bytes(record[12:16], "little")
        comment_size = int.from_bytes(record[20:22], "little")
        if offset + 22 + comment_size != len(tail):
            raise AgentPluginImportError("Agent Plugin archive is invalid")
        if disk_number or directory_disk or disk_entries != total_entries:
            raise AgentPluginImportError(
                "Multi-disk Agent Plugin archives are unsupported"
            )
        if total_entries == 0xFFFF:
            raise AgentPluginImportError(
                "ZIP64 Agent Plugin archives are unsupported"
            )
        if total_entries > _MAX_PACKAGE_ENTRIES:
            raise AgentPluginImportError(
                "Agent Plugin archive contains too many entries"
            )
        if directory_size > _MAX_ARCHIVE_DIRECTORY_BYTES:
            raise AgentPluginImportError(
                "Agent Plugin archive directory is too large"
            )

    def _load_plugin_manifest(
        self,
        root: Path,
        warnings: list[AgentPluginImportWarning],
    ) -> dict[str, Any]:
        value = self._load_json(root, Path("plugin.json"), required=True)
        if not isinstance(value, dict):
            raise AgentPluginImportError("plugin.json must contain an object")
        unknown = sorted(set(value) - _PLUGIN_FIELDS)
        for field in unknown:
            warnings.append(
                AgentPluginImportWarning(
                    code="unknown_manifest_field_ignored",
                    message=f"Unknown plugin.json field {field!r} was ignored.",
                    path=f"plugin.json#/{field}",
                )
            )
        manifest = {key: value[key] for key in _PLUGIN_FIELDS if key in value}
        if manifest.get("$schema") != PLUGIN_SCHEMA:
            raise AgentPluginImportError(
                "plugin.json must declare the Agent Plugins 1.0.0 schema"
            )
        name = manifest.get("name")
        if (
            not isinstance(name, str)
            or not 1 <= len(name) <= 64
            or _NAME.fullmatch(name) is None
        ):
            raise AgentPluginImportError("plugin.json name is invalid")
        for field in (
            "version",
            "description",
            "homepage",
            "repository",
            "license",
        ):
            if field in manifest and not isinstance(manifest[field], str):
                raise AgentPluginImportError(
                    f"plugin.json {field} must be a string"
                )
        if "keywords" in manifest and (
            not isinstance(manifest["keywords"], list)
            or any(not isinstance(item, str) for item in manifest["keywords"])
        ):
            raise AgentPluginImportError(
                "plugin.json keywords must be an array of strings"
            )
        if "author" in manifest:
            author = manifest["author"]
            if (
                not isinstance(author, dict)
                or set(author) - _AUTHOR_FIELDS
                or any(not isinstance(item, str) for item in author.values())
            ):
                raise AgentPluginImportError("plugin.json author is invalid")
        extensions = manifest.get("extensions")
        if extensions is not None and not isinstance(extensions, dict):
            warnings.append(
                AgentPluginImportWarning(
                    code="invalid_extensions_ignored",
                    message="Invalid plugin.json extensions were ignored.",
                    path="plugin.json#/extensions",
                )
            )
            manifest.pop("extensions", None)
        elif isinstance(extensions, dict):
            valid_extensions: dict[str, Any] = {}
            for name, extension in extensions.items():
                if isinstance(extension, dict):
                    valid_extensions[name] = extension
                    continue
                warnings.append(
                    AgentPluginImportWarning(
                        code="invalid_extension_ignored",
                        message=f"Invalid extension {name!r} was ignored.",
                        path=f"plugin.json#/extensions/{name}",
                    )
                )
            manifest["extensions"] = valid_extensions
        _validate_standard_schema(
            manifest, "plugin.schema.json", "plugin.json"
        )
        return manifest

    @staticmethod
    def _explicit_secret_requirements(
        manifest: dict[str, Any],
    ) -> dict[tuple[str, str, str], str]:
        extensions = manifest.get("extensions", {})
        eigent = (
            extensions.get("ai.eigent")
            if isinstance(extensions, dict)
            else None
        )
        if eigent is None:
            return {}
        if not isinstance(eigent, dict):
            raise AgentPluginImportError(
                "ai.eigent extension must be an object"
            )
        unknown = set(eigent) - {"mcpSecretRequirements"}
        if unknown:
            raise AgentPluginImportError(
                "ai.eigent extension contains unsupported fields"
            )
        raw = eigent.get("mcpSecretRequirements", [])
        if not isinstance(raw, list):
            raise AgentPluginImportError(
                "ai.eigent mcpSecretRequirements must be an array"
            )
        result: dict[tuple[str, str, str], str] = {}
        used_slots: set[str] = set()
        expected_fields = {"serverId", "location", "name", "slotId"}
        for item in raw:
            if not isinstance(item, dict) or set(item) != expected_fields:
                raise AgentPluginImportError(
                    "ai.eigent MCP secret requirement is invalid"
                )
            server_id = item["serverId"]
            location = item["location"]
            name = item["name"]
            slot_id = item["slotId"]
            if (
                not all(
                    isinstance(value, str) and value for value in item.values()
                )
                or location not in {"env", "headers"}
                or _SLOT_ID.fullmatch(slot_id) is None
            ):
                raise AgentPluginImportError(
                    "ai.eigent MCP secret requirement is invalid"
                )
            key = (
                server_id,
                location,
                name.lower() if location == "headers" else name,
            )
            if key in result or slot_id in used_slots:
                raise AgentPluginImportError(
                    "ai.eigent MCP secret requirements must be unique"
                )
            result[key] = slot_id
            used_slots.add(slot_id)
        return result

    def _discover_skills(
        self,
        root: Path,
        asset_prefix: str,
        warnings: list[AgentPluginImportWarning],
    ) -> tuple[tuple[str, ...], list[dict[str, Any]]]:
        skills_path = root / "skills"
        if not self._path_exists(skills_path):
            return (), []
        try:
            self._assert_contained(root, skills_path)
        except AgentPluginImportError as exc:
            warnings.append(
                AgentPluginImportWarning(
                    code="invalid_skills_component",
                    message=str(exc),
                    path="skills",
                )
            )
            return (), []
        if not skills_path.is_dir():
            warnings.append(
                AgentPluginImportWarning(
                    code="invalid_skills_component",
                    message="skills exists but is not a directory.",
                    path="skills",
                )
            )
            return (), []
        result: list[str] = []
        reviews: list[dict[str, Any]] = []
        for child in sorted(skills_path.iterdir(), key=lambda item: item.name):
            try:
                self._assert_contained(root, child)
                if not child.is_dir():
                    continue
                skill_file = child / "SKILL.md"
                if not self._path_exists(skill_file):
                    continue
                frontmatter = self._validate_skill(root, child, skill_file)
            except AgentPluginImportError as exc:
                warnings.append(
                    AgentPluginImportWarning(
                        code="invalid_skill_skipped",
                        message=str(exc),
                        path=f"skills/{child.name}/SKILL.md",
                    )
                )
                continue
            skill_ref = f"bundle://{asset_prefix}/skills/{child.name}/SKILL.md"
            result.append(skill_ref)
            reviews.append(
                {
                    "id": child.name,
                    "name": frontmatter["name"],
                    "description": frontmatter["description"],
                    "logical_path": skill_ref,
                }
            )
        return tuple(result), reviews

    def _validate_skill(
        self,
        root: Path,
        directory: Path,
        skill_file: Path,
    ) -> dict[str, Any]:
        content = self._read_file(
            root,
            skill_file,
            maximum=_MAX_SKILL_BYTES,
        )
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise AgentPluginImportError("SKILL.md must be UTF-8") from exc
        match = re.match(
            r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)",
            text,
            re.DOTALL,
        )
        if match is None:
            raise AgentPluginImportError("SKILL.md requires YAML frontmatter")
        try:
            frontmatter = yaml.safe_load(match.group(1))
        except yaml.YAMLError as exc:
            raise AgentPluginImportError(
                "SKILL.md frontmatter is invalid"
            ) from exc
        if (
            not isinstance(frontmatter, dict)
            or set(frontmatter) - _SKILL_FIELDS
        ):
            raise AgentPluginImportError(
                "SKILL.md frontmatter fields are invalid"
            )
        name = frontmatter.get("name")
        description = frontmatter.get("description")
        if (
            not isinstance(name, str)
            or not 1 <= len(name) <= 64
            or _SKILL_NAME.fullmatch(name) is None
            or name != directory.name
        ):
            raise AgentPluginImportError(
                "SKILL.md name must match its immediate parent directory"
            )
        if (
            not isinstance(description, str)
            or not 1 <= len(description) <= 1024
        ):
            raise AgentPluginImportError("SKILL.md description is invalid")
        for field in ("license", "allowed-tools"):
            if field in frontmatter and not isinstance(
                frontmatter[field], str
            ):
                raise AgentPluginImportError(
                    f"SKILL.md {field} must be a string"
                )
        compatibility = frontmatter.get("compatibility")
        if compatibility is not None and (
            not isinstance(compatibility, str)
            or not 1 <= len(compatibility) <= 500
        ):
            raise AgentPluginImportError("SKILL.md compatibility is invalid")
        metadata = frontmatter.get("metadata")
        if metadata is not None and (
            not isinstance(metadata, dict)
            or any(
                not isinstance(key, str) or not isinstance(value, str)
                for key, value in metadata.items()
            )
        ):
            raise AgentPluginImportError("SKILL.md metadata is invalid")
        return frontmatter

    def _load_mcp(
        self,
        root: Path,
        asset_prefix: str,
        warnings: list[AgentPluginImportWarning],
        explicit_secrets: dict[tuple[str, str, str], str],
    ) -> tuple[
        dict[str, Any] | None, list[dict[str, Any]], list[dict[str, Any]]
    ]:
        path = root / "mcp.json"
        if not self._path_exists(path):
            return {"$schema": MCP_SCHEMA, "mcpServers": {}}, [], []
        try:
            value = self._load_json(root, Path("mcp.json"), required=True)
            if (
                not isinstance(value, dict)
                or set(value) != {"$schema", "mcpServers"}
                or value.get("$schema") != MCP_SCHEMA
                or not isinstance(value.get("mcpServers"), dict)
            ):
                raise AgentPluginImportError(
                    "mcp.json top-level schema is invalid"
                )
        except AgentPluginImportError as exc:
            warnings.append(
                AgentPluginImportWarning(
                    code="invalid_mcp_component",
                    message=str(exc),
                    path="mcp.json",
                )
            )
            return None, [], []

        sanitized: dict[str, Any] = {"$schema": MCP_SCHEMA, "mcpServers": {}}
        requirements: list[dict[str, Any]] = []
        reviews: list[dict[str, Any]] = []
        for server_id in sorted(value["mcpServers"]):
            server = value["mcpServers"][server_id]
            try:
                if not isinstance(server_id, str) or not server_id:
                    raise AgentPluginImportError("MCP server id is invalid")
                normalized, slots, review = self._validate_mcp_server(
                    root,
                    server_id,
                    server,
                    explicit_secrets,
                    asset_prefix,
                )
            except AgentPluginImportError as exc:
                warnings.append(
                    AgentPluginImportWarning(
                        code="invalid_mcp_server_skipped",
                        message=str(exc),
                        path=f"mcp.json#/mcpServers/{server_id}",
                    )
                )
                continue
            sanitized["mcpServers"][server_id] = normalized
            reviews.append(review)
            requirements.append(
                {
                    "id": server_id,
                    "definition": f"bundle://{asset_prefix}/mcp.json",
                    "secretSlots": slots,
                    "assignTo": [],
                }
            )
        return sanitized, requirements, reviews

    def _validate_mcp_server(
        self,
        root: Path,
        server_id: str,
        value: Any,
        explicit_secrets: dict[tuple[str, str, str], str],
        asset_prefix: str,
    ) -> tuple[dict[str, Any], list[str], dict[str, Any]]:
        _validate_standard_schema(
            {
                "$schema": MCP_SCHEMA,
                "mcpServers": {server_id: value},
            },
            "mcp.schema.json",
            f"MCP server {server_id!r}",
        )
        if not isinstance(value, dict):
            raise AgentPluginImportError("MCP server must be an object")
        transport = value.get("type")
        slots: list[str] = []
        if transport == "stdio":
            allowed = {"type", "command", "args", "env", "cwd"}
            if set(value) - allowed:
                raise AgentPluginImportError(
                    "stdio MCP server has unknown fields"
                )
            command = value.get("command")
            if not isinstance(command, str) or not command:
                raise AgentPluginImportError("stdio MCP command is required")
            if self._known_placeholders(command):
                raise AgentPluginImportError(
                    "MCP command cannot contain plugin placeholders"
                )
            if command.startswith("./"):
                executable = self._resolve_plugin_relative(root, command)
                if (
                    not self._path_exists(executable)
                    or not executable.is_file()
                ):
                    raise AgentPluginImportError(
                        "plugin-relative MCP command does not exist"
                    )
            elif (
                "/" in command
                or "\\" in command
                or any(character.isspace() for character in command)
            ):
                raise AgentPluginImportError(
                    "MCP command must be one bare or ./ executable token"
                )
            args = value.get("args", [])
            if not isinstance(args, list) or any(
                not isinstance(item, str) for item in args
            ):
                raise AgentPluginImportError("stdio MCP args must be strings")
            environment = value.get("env", {})
            if not isinstance(environment, dict) or any(
                not isinstance(key, str) or not isinstance(item, str)
                for key, item in environment.items()
            ):
                raise AgentPluginImportError(
                    "stdio MCP env must contain strings"
                )
            if {key.upper() for key in environment} & {
                "PLUGIN_ROOT",
                "PLUGIN_DATA",
            }:
                raise AgentPluginImportError(
                    "stdio MCP env cannot override reserved plugin variables"
                )
            cwd = value.get("cwd")
            if cwd is not None:
                if not isinstance(cwd, str):
                    raise AgentPluginImportError(
                        "stdio MCP cwd must be a string"
                    )
                self._validate_cwd(root, cwd)
            normalized = {"type": "stdio", "command": command}
            self._assert_public_package_value(command)
            if args:
                for item in args:
                    self._assert_public_package_value(item)
                normalized["args"] = args
            if environment:
                normalized["env"], slots = (
                    self._apply_explicit_secret_requirements(
                        server_id,
                        "env",
                        environment,
                        explicit_secrets,
                    )
                )
            if cwd is not None:
                self._assert_public_package_value(cwd)
                normalized["cwd"] = cwd
            review = {
                "id": server_id,
                "name": server_id,
                "transport": "stdio",
                "command": command,
                "args": list(args),
                "command_summary": " ".join([command, *args]),
                "env_names": sorted(environment),
                "public_environment": [
                    _review_public_value(name, public_value)
                    for name, public_value in sorted(
                        normalized.get("env", {}).items()
                    )
                    if not public_value.startswith("slot://")
                ],
                "header_names": [],
                "public_headers": [],
                "cwd": cwd,
                "credential_requirement_keys": sorted(slots),
                "executable_asset_ref": (
                    f"bundle://{asset_prefix}/{command[2:]}"
                    if command.startswith("./")
                    else None
                ),
            }
            return normalized, slots, review

        if transport not in {"streamable-http", "sse"}:
            raise AgentPluginImportError("MCP transport is unsupported")
        allowed = {"type", "url", "headers"}
        if set(value) - allowed:
            raise AgentPluginImportError(
                "remote MCP server has unknown fields"
            )
        url = value.get("url")
        if not isinstance(url, str) or not url:
            raise AgentPluginImportError("remote MCP URL is required")
        if self._known_placeholders(url):
            raise AgentPluginImportError(
                "remote MCP URL cannot contain plugin placeholders"
            )
        self._validate_remote_url(url)
        self._assert_public_package_value(url)
        headers = value.get("headers", {})
        if not isinstance(headers, dict) or any(
            not isinstance(key, str) or not isinstance(item, str)
            for key, item in headers.items()
        ):
            raise AgentPluginImportError(
                "remote MCP headers must contain strings"
            )
        lowered: set[str] = set()
        for name, header_value in headers.items():
            lower = name.lower()
            if (
                _HEADER_NAME.fullmatch(name) is None
                or lower in lowered
                or any(
                    ord(character) < 32 or ord(character) == 127
                    for character in header_value
                )
                or self._known_placeholders(header_value)
            ):
                raise AgentPluginImportError("remote MCP header is invalid")
            lowered.add(lower)
        normalized = {"type": transport, "url": url}
        if headers:
            normalized["headers"], slots = (
                self._apply_explicit_secret_requirements(
                    server_id,
                    "headers",
                    headers,
                    explicit_secrets,
                )
            )
        return (
            normalized,
            slots,
            {
                "id": server_id,
                "name": server_id,
                "transport": transport,
                "url": url,
                "env_names": [],
                "public_environment": [],
                "header_names": sorted(headers, key=str.lower),
                "public_headers": [
                    _review_public_value(name, public_value)
                    for name, public_value in sorted(
                        normalized.get("headers", {}).items(),
                        key=lambda item: item[0].lower(),
                    )
                    if not public_value.startswith("slot://")
                ],
                "credential_requirement_keys": sorted(slots),
            },
        )

    def _apply_explicit_secret_requirements(
        self,
        server_id: str,
        category: str,
        values: dict[str, str],
        explicit_secrets: dict[tuple[str, str, str], str],
    ) -> tuple[dict[str, str], list[str]]:
        result: dict[str, str] = {}
        slots: list[str] = []
        for name, value in values.items():
            lookup_name = name.lower() if category == "headers" else name
            slot = explicit_secrets.pop(
                (server_id, category, lookup_name),
                None,
            )
            if slot is None:
                try:
                    assert_manifest_secret_free({name: value})
                    self._assert_public_package_value(value)
                except SecretValueInManifestError as exc:
                    raise AgentPluginImportError(
                        "Agent Plugin contains a secret-like MCP field; "
                        "declare an explicit ai.eigent secret requirement "
                        "instead"
                    ) from exc
                result[name] = value
                continue
            result[name] = f"slot://{slot}"
            slots.append(slot)
        return result, slots

    @staticmethod
    def _assert_public_package_value(value: str) -> None:
        try:
            # Standard env/header literals are package-visible declarations.
            # Scan their values, but do not infer credentials merely from a key.
            assert_bundle_asset_safe(
                "bundle://agent-plugins/public-value.txt",
                value.encode("utf-8"),
            )
        except SecretValueInManifestError as exc:
            raise AgentPluginImportError(
                "Agent Plugin contains secret-like public MCP data; declare "
                "an explicit ai.eigent secret requirement instead"
            ) from exc

    @staticmethod
    def _validate_remote_url(value: str) -> None:
        try:
            parsed = urlsplit(value)
            port = parsed.port
        except ValueError as exc:
            raise AgentPluginImportError("remote MCP URL is invalid") from exc
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
            or port is not None
            and not 1 <= port <= 65535
        ):
            raise AgentPluginImportError("remote MCP URL is invalid")
        loopback = parsed.hostname == "localhost"
        if not loopback:
            try:
                loopback = ipaddress.ip_address(parsed.hostname).is_loopback
            except ValueError:
                loopback = False
        if not loopback and parsed.scheme != "https":
            raise AgentPluginImportError(
                "non-loopback remote MCP URLs must use HTTPS"
            )

    def _validate_cwd(self, root: Path, value: str) -> None:
        if value.startswith("./"):
            self._resolve_plugin_relative(root, value)
            return
        for placeholder in ("${PLUGIN_ROOT}", "${PLUGIN_DATA}"):
            if value == placeholder:
                return
            prefix = placeholder + "/"
            if value.startswith(prefix):
                relative = PurePosixPath(value.removeprefix(prefix))
                if not relative.parts or any(
                    part in {"", ".", ".."} for part in relative.parts
                ):
                    raise AgentPluginImportError(
                        "stdio MCP cwd escapes its root"
                    )
                if placeholder == "${PLUGIN_ROOT}":
                    self._resolve_plugin_relative(
                        root, "./" + relative.as_posix()
                    )
                return
        raise AgentPluginImportError("stdio MCP cwd has an invalid root")

    def _resolve_plugin_relative(self, root: Path, value: str) -> Path:
        if not value.startswith("./"):
            raise AgentPluginImportError(
                "plugin-relative paths must begin with ./"
            )
        relative = PurePosixPath(value[2:])
        if not relative.parts or any(
            part in {"", ".", ".."} for part in relative.parts
        ):
            raise AgentPluginImportError(
                "plugin-relative path escapes plugin root"
            )
        candidate = root.joinpath(*relative.parts)
        self._assert_contained(root, candidate, strict=False)
        return candidate

    def _collect_assets(
        self,
        root: Path,
        *,
        asset_prefix: str,
        overrides: dict[str, bytes],
        excluded: set[str],
        semantic_executable_paths: set[str],
    ) -> tuple[AgentPluginAsset, ...]:
        files = self._walk_package(root)
        assets: list[AgentPluginAsset] = []
        total = 0
        for relative, path in files:
            relative_text = relative.as_posix()
            if relative_text in excluded:
                continue
            content = overrides.get(relative_text)
            if content is None:
                content = self._read_file(root, path, maximum=_MAX_ASSET_BYTES)
            if len(content) > _MAX_ASSET_BYTES:
                raise AgentPluginImportError(
                    f"Agent Plugin asset {relative_text!r} is too large"
                )
            total += len(content)
            if total > _MAX_PACKAGE_BYTES:
                raise AgentPluginImportError(
                    "Agent Plugin package is too large"
                )
            logical_path = f"bundle://{asset_prefix}/{relative_text}"
            # mcp.json has already been field-validated and every package-visible
            # value scanned above. Generic structured scanning would incorrectly
            # infer a credential from a standard public key such as API_TOKEN.
            if relative_text != "mcp.json":
                assert_bundle_asset_safe(logical_path, content)
            media_type = mimetypes.guess_type(relative_text)[0]
            try:
                executable = bool(path.stat().st_mode & 0o111) or (
                    relative_text in semantic_executable_paths
                )
            except OSError as exc:
                raise AgentPluginImportError(
                    "Agent Plugin asset metadata cannot be read"
                ) from exc
            assets.append(
                AgentPluginAsset(
                    logical_path=logical_path,
                    source_relative_path=relative_text,
                    content_digest=hashlib.sha256(content).hexdigest(),
                    media_type=media_type or "application/octet-stream",
                    size_bytes=len(content),
                    content=content,
                    executable=executable,
                )
            )
        return tuple(assets)

    def _source_tree_digest(self, root: Path) -> str:
        entries: list[dict[str, Any]] = []
        total = 0
        for relative, path in self._walk_package(root):
            content = self._read_file(root, path, maximum=_MAX_ASSET_BYTES)
            total += len(content)
            if total > _MAX_PACKAGE_BYTES:
                raise AgentPluginImportError(
                    "Agent Plugin package is too large"
                )
            try:
                executable = bool(path.stat().st_mode & 0o111)
            except OSError as exc:
                raise AgentPluginImportError(
                    "Agent Plugin asset metadata cannot be read"
                ) from exc
            entries.append(
                {
                    "source_relative_path": relative.as_posix(),
                    "content_digest": hashlib.sha256(content).hexdigest(),
                    "executable": executable,
                }
            )
        return canonical_digest(entries)

    def _walk_package(self, root: Path) -> list[tuple[PurePosixPath, Path]]:
        result: list[tuple[PurePosixPath, Path]] = []
        entry_count = 0
        normalized_paths: set[str] = set()

        def walk(
            directory: Path, relative: PurePosixPath, active: set[Path]
        ) -> None:
            nonlocal entry_count
            resolved_directory = self._assert_contained(root, directory)
            if resolved_directory in active:
                raise AgentPluginImportError(
                    "Agent Plugin contains a symlink cycle"
                )
            active = {*active, resolved_directory}
            try:
                remaining = _MAX_PACKAGE_ENTRIES - entry_count
                children = list(islice(directory.iterdir(), remaining + 1))
            except OSError as exc:
                raise AgentPluginImportError(
                    "Agent Plugin package cannot be enumerated"
                ) from exc
            if len(children) > remaining:
                raise AgentPluginImportError(
                    "Agent Plugin contains too many filesystem entries"
                )
            children.sort(key=lambda item: item.name)
            for child in children:
                entry_count += 1
                if entry_count > _MAX_PACKAGE_ENTRIES:
                    raise AgentPluginImportError(
                        "Agent Plugin contains too many filesystem entries"
                    )
                child_relative = relative / child.name
                # Git administration directories are never portable plugin
                # assets, including repositories nested below vendor trees.
                if child.name == ".git":
                    continue
                collision_key = unicodedata.normalize(
                    "NFC", child_relative.as_posix()
                ).casefold()
                if collision_key in normalized_paths:
                    raise AgentPluginImportError(
                        "Agent Plugin contains colliding filesystem paths"
                    )
                normalized_paths.add(collision_key)
                try:
                    resolved_child = self._assert_contained(root, child)
                except AgentPluginImportError:
                    if child_relative.parts[
                        0
                    ] == "skills" or child_relative == PurePosixPath(
                        "mcp.json"
                    ):
                        continue
                    raise
                resolved_relative = resolved_child.relative_to(root)
                if (
                    resolved_relative.parts
                    and resolved_relative.parts[0] == ".git"
                ):
                    continue
                if child.is_dir():
                    if len(child_relative.parts) > _MAX_ARCHIVE_DEPTH:
                        raise AgentPluginImportError(
                            "Agent Plugin directory nesting is too deep"
                        )
                    walk(child, child_relative, active)
                elif child.is_file():
                    result.append((child_relative, child))
                    if len(result) > _MAX_PACKAGE_FILES:
                        raise AgentPluginImportError(
                            "Agent Plugin contains too many files"
                        )
                else:
                    raise AgentPluginImportError(
                        f"Agent Plugin path {child_relative.as_posix()!r} "
                        "is not a regular file or directory"
                    )

        walk(root, PurePosixPath("."), set())
        return result

    def _load_json(self, root: Path, relative: Path, *, required: bool) -> Any:
        path = root / relative
        if not self._path_exists(path):
            if required:
                raise AgentPluginImportError(
                    f"{relative.as_posix()} is required"
                )
            return None
        content = self._read_file(root, path, maximum=_MAX_JSON_BYTES)
        try:
            return json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise AgentPluginImportError(
                f"{relative.as_posix()} is not valid UTF-8 JSON"
            ) from exc

    def _read_file(self, root: Path, path: Path, *, maximum: int) -> bytes:
        self._assert_contained(root, path)
        if not path.is_file():
            raise AgentPluginImportError(
                f"Agent Plugin path {path.name!r} is not a regular file"
            )
        try:
            with path.open("rb") as handle:
                content = handle.read(maximum + 1)
        except OSError as exc:
            raise AgentPluginImportError(
                "Agent Plugin file cannot be read"
            ) from exc
        if len(content) > maximum:
            raise AgentPluginImportError(
                f"Agent Plugin file {path.name!r} is too large"
            )
        return content

    @staticmethod
    def _path_exists(path: Path) -> bool:
        return path.exists() or path.is_symlink()

    @staticmethod
    def _assert_contained(
        root: Path,
        path: Path,
        *,
        strict: bool = True,
    ) -> Path:
        try:
            resolved = path.resolve(strict=strict)
            resolved.relative_to(root)
        except (OSError, RuntimeError, ValueError) as exc:
            raise AgentPluginImportError(
                "Agent Plugin path escapes the plugin root"
            ) from exc
        return resolved

    @staticmethod
    def _known_placeholders(value: str) -> set[str]:
        return {
            item
            for item in _PLACEHOLDER.findall(value)
            if item in {"PLUGIN_ROOT", "PLUGIN_DATA"}
        }

    @staticmethod
    def _bundle_id(plugin_name: str) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "_", plugin_name).strip("_")
        return "agent_plugin_" + normalized

    @staticmethod
    def _json_bytes(value: Any) -> bytes:
        return (
            json.dumps(
                value,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n"
        ).encode("utf-8")
