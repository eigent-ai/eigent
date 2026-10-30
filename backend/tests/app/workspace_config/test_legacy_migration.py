from __future__ import annotations

import json

from app.run_journal import SQLiteRunJournal
from app.workspace_config.legacy_migration import (
    LegacyWorkspaceBundleMigration,
)


def test_new_user_does_not_receive_a_legacy_bundle(tmp_path):
    eigent_root = tmp_path / ".eigent"
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        result = LegacyWorkspaceBundleMigration(
            eigent_root=eigent_root,
            journal=journal,
        ).run()

    assert result.status == "not_applicable"
    assert result.old_user is False
    assert not (eigent_root / "migrations").exists()


def test_old_user_migration_is_secret_free_local_and_idempotent(tmp_path):
    eigent_root = tmp_path / ".eigent"
    eigent_root.mkdir()
    secret = "token-that-must-never-enter-the-bundle"
    (eigent_root / "mcp.json").write_text(
        json.dumps(
            {
                "mcpServers": {
                    "github": {
                        "command": "connector",
                        "args": ["--token", secret],
                        "env": {"GITHUB_TOKEN": secret, "LOG_LEVEL": "info"},
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    skill_root = eigent_root / "user_42"
    skill_root.mkdir()
    (skill_root / "skills-config.json").write_text(
        json.dumps({"version": 1, "skills": {"pdf": {"enabled": True}}}),
        encoding="utf-8",
    )

    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        migration = LegacyWorkspaceBundleMigration(
            eigent_root=eigent_root,
            journal=journal,
        )
        first = migration.run()
        first_bytes = first.output_path.read_bytes()  # type: ignore[union-attr]
        second = migration.run()

    assert first.status == "migrated"
    assert second.status == "unchanged"
    assert first.checksum == second.checksum
    assert second.output_path.read_bytes() == first_bytes  # type: ignore[union-attr]
    serialized = first_bytes.decode("utf-8")
    assert secret not in serialized
    document = json.loads(serialized)
    assert document["bundle_manifest"]["metadata"]["name"] == (
        "Personal Default Bundle"
    )
    slots = {
        item["slot_id"]: item["source"]
        for item in document["local_secret_slot_bindings"]
    }
    assert "mcp.github.env.github_token" in slots
    assert "mcp.github.args.1" in slots
    assert slots["mcp.github.env.github_token"]["kind"] == (
        "legacy_mcp_json_pointer"
    )
    assert slots["mcp.github.env.github_token"]["file"] == "mcp.json"


def test_existing_project_data_triggers_migration_without_legacy_files(
    tmp_path,
):
    eigent_root = tmp_path / ".eigent"
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-existing",
            project_id="project-existing",
            status="completed",
        )
        result = LegacyWorkspaceBundleMigration(
            eigent_root=eigent_root,
            journal=journal,
        ).run()

    assert result.status == "migrated"
    assert result.output_path is not None
    assert result.output_path.exists()


def test_malformed_legacy_asset_degrades_without_blocking_startup(tmp_path):
    eigent_root = tmp_path / ".eigent"
    eigent_root.mkdir()
    (eigent_root / "mcp.json").write_text("{broken", encoding="utf-8")
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        result = LegacyWorkspaceBundleMigration(
            eigent_root=eigent_root,
            journal=journal,
        ).run()

    assert result.status == "degraded"
    assert result.old_user is True
    assert result.error
