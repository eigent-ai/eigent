# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");

"""Best-effort startup migration for pre-Bundle local configuration.

The migration is deliberately local-only. It records a secret-free Personal
Default Bundle plus pointers to the existing local secret source; it never
copies credential values into the manifest or a Cloud projection.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.run_journal.store import SQLiteRunJournal
from app.workspace_config.admission import LegacyEnvironmentImporter
from app.workspace_config.models import canonical_digest

logger = logging.getLogger("legacy_workspace_bundle_migration")

_MIGRATION_VERSION = 1
_SECRET_KEY = re.compile(
    r"(?:api[_-]?key|access[_-]?token|auth(?:orization)?|credential|"
    r"password|private[_-]?key|secret|token)$",
    re.IGNORECASE,
)
_SECRET_ARG = re.compile(
    r"^--?(?:api[_-]?key|access[_-]?token|auth|authorization|password|"
    r"private[_-]?key|secret|token)(?:=(.*))?$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class LegacyMigrationResult:
    status: str
    old_user: bool
    checksum: str | None = None
    output_path: Path | None = None
    error: str | None = None


class LegacyWorkspaceBundleMigration:
    """Create an idempotent local Personal Default Bundle migration record."""

    def __init__(
        self,
        *,
        eigent_root: Path,
        journal: SQLiteRunJournal,
    ) -> None:
        self.root = eigent_root
        self.journal = journal
        self.mcp_path = self.root / "mcp.json"
        self.output_path = (
            self.root
            / "migrations"
            / "personal-default-workspace-bundle-v1.json"
        )

    def run(self) -> LegacyMigrationResult:
        """Migrate silently; malformed legacy data degrades without startup failure."""

        try:
            skill_configs = self._skill_configs()
            old_user = (
                self.mcp_path.exists()
                or bool(skill_configs)
                or self._has_space_or_project_data()
            )
            if not old_user:
                return LegacyMigrationResult(
                    status="not_applicable", old_user=False
                )

            mcp = self._read_json(self.mcp_path, default={"mcpServers": {}})
            raw_servers = mcp.get("mcpServers", {})
            if not isinstance(raw_servers, dict):
                raise ValueError("mcp.json mcpServers must be an object")
            servers = {
                str(name): value
                for name, value in raw_servers.items()
                if isinstance(value, dict)
            }
            skills: dict[str, dict[str, Any]] = {}
            for config in skill_configs:
                for name, value in config.get("skills", {}).items():
                    if isinstance(value, dict):
                        skills[str(name)] = value

            template = LegacyEnvironmentImporter().build_template(
                model_platform="legacy",
                model_type="default",
                auth_source=None,
                requested_effort=None,
                allow_local_system=False,
                mcp_server_configs=servers,
                skill_config={"version": 1, "skills": skills},
            )
            bindings = self._secret_bindings(servers)
            safe_payload = {
                "migration_version": _MIGRATION_VERSION,
                "kind": "PersonalDefaultWorkspaceBundleMigration",
                "bundle_manifest": template.manifest.canonical_payload(),
                "runtime_capability_manifest": (
                    template.runtime_capability_manifest
                ),
                "local_secret_slot_bindings": bindings,
            }
            checksum = canonical_digest(safe_payload)
            document = {**safe_payload, "source_checksum": checksum}

            if self.output_path.exists():
                current = self._read_json(self.output_path)
                if current.get("source_checksum") == checksum:
                    return LegacyMigrationResult(
                        status="unchanged",
                        old_user=True,
                        checksum=checksum,
                        output_path=self.output_path,
                    )
            self._atomic_write(document)
            return LegacyMigrationResult(
                status="migrated",
                old_user=True,
                checksum=checksum,
                output_path=self.output_path,
            )
        except (
            Exception
        ) as exc:  # startup migration is intentionally fail-open
            logger.warning(
                "Legacy Workspace Bundle migration degraded: %s", exc
            )
            return LegacyMigrationResult(
                status="degraded",
                old_user=True,
                error=str(exc),
            )

    def _skill_configs(self) -> list[dict[str, Any]]:
        configs: list[dict[str, Any]] = []
        candidates = list(self.root.glob("skills-config.json"))
        candidates.extend(self.root.glob("*/skills-config.json"))
        for path in sorted(set(candidates)):
            parsed = self._read_json(path, default={})
            skills = parsed.get("skills")
            if isinstance(skills, dict) and skills:
                configs.append(parsed)
        return configs

    def _has_space_or_project_data(self) -> bool:
        if self.journal.list_all_runs():
            return True
        memory = self.root / "memory"
        if not memory.exists():
            return False
        return any(memory.rglob("space.json")) or any(
            memory.rglob("project.json")
        )

    @staticmethod
    def _read_json(path: Path, *, default: dict | None = None) -> dict:
        if not path.exists() and default is not None:
            return default
        parsed = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError(f"{path.name} must contain a JSON object")
        return parsed

    def _secret_bindings(
        self, servers: dict[str, dict[str, Any]]
    ) -> list[dict[str, Any]]:
        bindings: dict[str, dict[str, Any]] = {}

        def add(server: str, path: tuple[str, ...], label: str) -> None:
            logical = LegacyEnvironmentImporter._logical_name
            slot = (
                "mcp."
                + logical(server)
                + "."
                + ".".join(logical(item) for item in path)
            )
            bindings[slot] = {
                "slot_id": slot,
                "source": {
                    "kind": "legacy_mcp_json_pointer",
                    "file": "mcp.json",
                    "server_id": server,
                    "json_pointer": "/mcpServers/"
                    + "/".join(self._pointer_part(item) for item in path),
                    "label": label,
                },
            }

        def visit(server: str, value: Any, path: tuple[str, ...]) -> None:
            if isinstance(value, dict):
                for key, child in value.items():
                    key_text = str(key)
                    child_path = (*path, key_text)
                    if _SECRET_KEY.search(key_text):
                        add(server, child_path, key_text)
                    else:
                        visit(server, child, child_path)
            elif isinstance(value, list):
                index = 0
                while index < len(value):
                    item = value[index]
                    if isinstance(item, str):
                        match = _SECRET_ARG.match(item)
                        if match:
                            if match.group(1) is not None:
                                add(
                                    server,
                                    (*path, str(index)),
                                    item.split("=", 1)[0],
                                )
                            elif index + 1 < len(value):
                                add(
                                    server,
                                    (*path, str(index + 1)),
                                    item,
                                )
                                index += 2
                                continue
                    visit(server, item, (*path, str(index)))
                    index += 1

        for server, config in sorted(servers.items()):
            visit(server, config, ())
        return [bindings[key] for key in sorted(bindings)]

    @staticmethod
    def _pointer_part(value: str) -> str:
        return value.replace("~", "~0").replace("/", "~1")

    def _atomic_write(self, document: dict[str, Any]) -> None:
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.output_path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(temporary, self.output_path)


def migrate_legacy_workspace_bundle_on_startup(
    journal: SQLiteRunJournal,
    *,
    eigent_root: Path | None = None,
) -> LegacyMigrationResult:
    root = eigent_root or Path.home() / ".eigent"
    return LegacyWorkspaceBundleMigration(
        eigent_root=root,
        journal=journal,
    ).run()
