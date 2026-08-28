from __future__ import annotations

import hashlib
import stat
import subprocess
from pathlib import Path

import pytest
import yaml

from app.run_journal import IdempotencyConflictError, SQLiteRunJournal
from app.workspace_config import (
    ConfigPlacement,
    SecretValueInManifestError,
    parse_workspace_manifest,
)
from app.workspace_git import (
    ConfigurationRepositoryError,
    ConfigurationRepositoryService,
    GitBackend,
    GitBackendError,
    NestedRepositoryError,
)

MANIFEST = """
apiVersion: eigent.ai/v1alpha1
kind: WorkspaceBundle
metadata:
  id: bundle_local
  name: Local Workspace
  revision: 1
spec:
  instructions:
    coordinator: bundle://instructions/coordinator.md
  models:
    default:
      modelRef: provider://default
      thinkingEffort: medium
"""


@pytest.fixture
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as value:
        yield value


def _service(tmp_path: Path, journal: SQLiteRunJournal):
    empty_hooks = tmp_path / "empty-hooks"
    empty_hooks.mkdir()
    backend = GitBackend(hooks_path=empty_hooks)
    return (
        ConfigurationRepositoryService(
            journal,
            state_root=tmp_path / "state",
            git_backend=backend,
        ),
        backend,
    )


def _git(repository: Path, *args: str) -> str:
    completed = subprocess.run(
        ("git", "-C", str(repository), *args),
        check=True,
        capture_output=True,
        text=True,
        env={
            "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_TERMINAL_PROMPT": "0",
        },
    )
    return completed.stdout.strip()


def test_sidecar_bootstrap_never_mutates_user_space(
    tmp_path,
    journal,
):
    space = tmp_path / "user-space"
    space.mkdir()
    original = space / "private-notes.txt"
    original.write_text("never import me", encoding="utf-8")
    service, backend = _service(tmp_path, journal)
    manifest = parse_workspace_manifest(MANIFEST)

    first = service.bootstrap(
        space_id="space-1",
        space_root=space,
        manifest=manifest,
        placement=ConfigPlacement.SIDECAR,
        created_by="user-1",
    )
    replay = service.bootstrap(
        space_id="space-1",
        space_root=space,
        manifest=manifest,
        placement=ConfigPlacement.SIDECAR,
        created_by="user-1",
    )

    assert not (space / ".git").exists()
    assert not (space / ".eigent").exists()
    assert original.read_text(encoding="utf-8") == "never import me"
    assert first.content_repository_root is None
    assert first.commit_oid == replay.commit_oid
    assert first.configuration_repository_initialized is True
    assert replay.configuration_repository_initialized is False
    assert backend.probe(first.configuration_repository_root).is_repository
    assert set(
        backend.show_commit_paths(first.configuration_repository_root)
    ) == {"workspace.lock", "workspace.yaml"}
    assert (
        yaml.safe_load(first.manifest_path.read_text())["metadata"]["id"]
        == "bundle_local"
    )
    assert (
        journal.get_workspace_config_revision(manifest.revision_id)
        == first.revision
    )
    assert first.materialization.space_id == "space-1"
    assert first.materialization.config_placement == "sidecar"


def test_sidecar_bootstrap_commits_verified_bundle_assets(tmp_path, journal):
    space = tmp_path / "user-space"
    space.mkdir()
    service, backend = _service(tmp_path, journal)

    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        manifest=parse_workspace_manifest(MANIFEST),
        placement=ConfigPlacement.SIDECAR,
        created_by="user-1",
        assets={
            "instructions/coordinator.md": b"Coordinate safely.\n",
            "images/icon.bin": b"\x00\x01\x02",
        },
        lock_payload={
            "apiVersion": "eigent.ai/lock/v1alpha1",
            "bundleRevision": "bundle_local@1",
            "manifestDigest": parse_workspace_manifest(MANIFEST).digest,
            "assets": [
                {
                    "ref": "bundle://instructions/coordinator.md",
                    "digest": hashlib.sha256(
                        b"Coordinate safely.\n"
                    ).hexdigest(),
                },
                {
                    "ref": "bundle://images/icon.bin",
                    "digest": hashlib.sha256(b"\x00\x01\x02").hexdigest(),
                },
            ],
            "skills": [],
            "mcpPackages": [],
        },
    )

    assert (
        result.configuration_repository_root / "images/icon.bin"
    ).read_bytes() == b"\x00\x01\x02"
    assert set(
        backend.show_commit_paths(result.configuration_repository_root)
    ) == {
        "images/icon.bin",
        "instructions/coordinator.md",
        "workspace.lock",
        "workspace.yaml",
    }


def test_same_bundle_revision_materializes_into_multiple_spaces(
    tmp_path,
    journal,
):
    first_space = tmp_path / "space-one"
    second_space = tmp_path / "space-two"
    first_space.mkdir()
    second_space.mkdir()
    service, _ = _service(tmp_path, journal)
    manifest = parse_workspace_manifest(MANIFEST)

    first = service.bootstrap(
        space_id="space-1",
        space_root=first_space,
        manifest=manifest,
        placement=ConfigPlacement.SIDECAR,
        created_by="user-1",
    )
    second = service.bootstrap(
        space_id="space-2",
        space_root=second_space,
        manifest=manifest,
        placement=ConfigPlacement.SIDECAR,
        created_by="user-2",
    )

    assert first.revision == second.revision
    assert (
        first.materialization.materialization_id
        != second.materialization.materialization_id
    )
    assert second.materialization.space_id == "space-2"
    assert (
        first.configuration_repository_root
        != second.configuration_repository_root
    )


def test_existing_space_materialization_rejects_placement_change_before_git(
    tmp_path,
    journal,
):
    space = tmp_path / "space"
    space.mkdir()
    service, _ = _service(tmp_path, journal)
    manifest = parse_workspace_manifest(MANIFEST)
    service.bootstrap(
        space_id="space-1",
        space_root=space,
        manifest=manifest,
        placement=ConfigPlacement.SIDECAR,
        created_by="user-1",
    )

    with pytest.raises(IdempotencyConflictError, match="different placement"):
        service.bootstrap(
            space_id="space-1",
            space_root=space,
            manifest=manifest,
            placement=ConfigPlacement.IN_REPO,
            created_by="user-1",
            allow_content_repository_init=True,
        )

    assert not (space / ".git").exists()
    assert not (space / ".eigent").exists()


def test_in_repo_commit_excludes_and_preserves_user_staged_changes(
    tmp_path,
    journal,
):
    space = tmp_path / "owned-space"
    space.mkdir()
    service, backend = _service(tmp_path, journal)
    backend.init_repository(space)
    notes = space / "notes.txt"
    notes.write_text("baseline", encoding="utf-8")
    backend.commit_paths(space, (notes,), message="initial")
    notes.write_text("user staged edit", encoding="utf-8")
    _git(space, "add", "--", "notes.txt")

    hook = space / ".git" / "hooks" / "pre-commit"
    hook.write_text("#!/bin/sh\nexit 99\n", encoding="utf-8")
    hook.chmod(0o755)
    config_before = (space / ".git" / "config").read_text(encoding="utf-8")

    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        manifest=parse_workspace_manifest(MANIFEST),
        placement=ConfigPlacement.IN_REPO,
        created_by="user-1",
    )

    assert result.content_repository_initialized is False
    assert result.configuration_repository_root == space / ".eigent"
    assert set(backend.show_commit_paths(space)) == {
        ".eigent/workspace.lock",
        ".eigent/workspace.yaml",
    }
    assert _git(space, "diff", "--cached", "--name-only") == "notes.txt"
    assert (space / ".git" / "config").read_text(
        encoding="utf-8"
    ) == config_before


def test_in_repo_requires_explicit_content_init(tmp_path, journal):
    space = tmp_path / "plain-folder"
    space.mkdir()
    service, _ = _service(tmp_path, journal)
    manifest = parse_workspace_manifest(MANIFEST)

    with pytest.raises(
        ConfigurationRepositoryError,
        match="requires an owned/adopted",
    ):
        service.bootstrap(
            space_id="space-1",
            space_root=space,
            manifest=manifest,
            placement=ConfigPlacement.IN_REPO,
            created_by="user-1",
        )

    assert not (space / ".git").exists()
    assert not (space / ".eigent").exists()

    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        manifest=manifest,
        placement=ConfigPlacement.IN_REPO,
        created_by="user-1",
        allow_content_repository_init=True,
    )
    assert result.content_repository_initialized is True
    assert (space / ".git").is_dir()


def test_nested_repository_is_rejected_without_writing_child(
    tmp_path,
    journal,
):
    parent = tmp_path / "parent"
    parent.mkdir()
    child = parent / "child-space"
    child.mkdir()
    service, backend = _service(tmp_path, journal)
    backend.init_repository(parent)

    with pytest.raises(NestedRepositoryError):
        service.bootstrap(
            space_id="space-1",
            space_root=child,
            manifest=parse_workspace_manifest(MANIFEST),
            placement=ConfigPlacement.IN_REPO,
            created_by="user-1",
            allow_content_repository_init=True,
        )

    assert not (child / ".git").exists()
    assert not (child / ".eigent").exists()


def test_secret_or_device_capability_in_lock_is_rejected_before_init(
    tmp_path,
    journal,
):
    space = tmp_path / "space"
    space.mkdir()
    service, _ = _service(tmp_path, journal)
    manifest = parse_workspace_manifest(MANIFEST)

    with pytest.raises(SecretValueInManifestError):
        service.bootstrap(
            space_id="space-1",
            space_root=space,
            manifest=manifest,
            placement=ConfigPlacement.SIDECAR,
            created_by="user-1",
            lock_payload={"api_key": "do-not-write"},
        )
    with pytest.raises(
        ConfigurationRepositoryError,
        match="portable lock schema",
    ):
        service.bootstrap(
            space_id="space-1",
            space_root=space,
            manifest=manifest,
            placement=ConfigPlacement.SIDECAR,
            created_by="user-1",
            lock_payload={"providerCapabilityRevision": "device-v2"},
        )

    assert not (tmp_path / "state" / "spaces").exists()


def test_lock_must_match_bundle_revision_before_git_init(tmp_path, journal):
    space = tmp_path / "space"
    space.mkdir()
    service, _ = _service(tmp_path, journal)
    manifest = parse_workspace_manifest(MANIFEST)

    with pytest.raises(
        ConfigurationRepositoryError,
        match="selected Bundle revision",
    ):
        service.bootstrap(
            space_id="space-1",
            space_root=space,
            manifest=manifest,
            placement=ConfigPlacement.SIDECAR,
            created_by="user-1",
            lock_payload={
                "apiVersion": "eigent.ai/lock/v1alpha1",
                "bundleRevision": "bundle_other@1",
                "manifestDigest": "0" * 64,
                "assets": [],
                "skills": [],
                "mcpPackages": [],
            },
        )

    assert not (tmp_path / "state" / "spaces").exists()


def test_replay_does_not_overwrite_manual_manifest_edit(
    tmp_path,
    journal,
):
    space = tmp_path / "space"
    space.mkdir()
    service, _ = _service(tmp_path, journal)
    manifest = parse_workspace_manifest(MANIFEST)
    first = service.bootstrap(
        space_id="space-1",
        space_root=space,
        manifest=manifest,
        placement=ConfigPlacement.SIDECAR,
        created_by="user-1",
    )
    edited = (
        first.manifest_path.read_text(encoding="utf-8") + "\n# user edit\n"
    )
    first.manifest_path.write_text(edited, encoding="utf-8")

    with pytest.raises(ConfigurationRepositoryError, match="uncommitted"):
        service.bootstrap(
            space_id="space-1",
            space_root=space,
            manifest=manifest,
            placement=ConfigPlacement.SIDECAR,
            created_by="user-1",
        )

    assert first.manifest_path.read_text(encoding="utf-8") == edited
    assert (
        service.git.current_head(first.configuration_repository_root)
        == first.commit_oid
    )


def test_bootstrap_recovers_exact_untracked_files_after_crash(
    tmp_path,
    journal,
):
    space = tmp_path / "space"
    space.mkdir()
    service, backend = _service(tmp_path, journal)
    manifest = parse_workspace_manifest(MANIFEST)
    repository = tmp_path / "state" / "spaces" / "space-1" / "configuration"
    backend.init_repository(repository)
    manifest_path = repository / "workspace.yaml"
    lock_path = repository / "workspace.lock"
    manifest_path.write_text(
        yaml.safe_dump(
            manifest.canonical_payload(),
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    lock_path.write_text(
        yaml.safe_dump(
            {
                "apiVersion": "eigent.ai/lock/v1alpha1",
                "bundleRevision": manifest.revision_id,
                "manifestDigest": manifest.digest,
                "assets": [],
                "skills": [],
                "mcpPackages": [],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        manifest=manifest,
        placement=ConfigPlacement.SIDECAR,
        created_by="user-1",
    )

    assert result.configuration_repository_initialized is False
    assert set(backend.show_commit_paths(repository)) == {
        "workspace.lock",
        "workspace.yaml",
    }
    assert (
        backend.changed_paths(
            repository,
            (manifest_path, lock_path),
        )
        == ()
    )


def test_bootstrap_clears_owner_execute_for_non_executable_asset_recovery(
    tmp_path,
    journal,
):
    space = tmp_path / "space"
    space.mkdir()
    service, backend = _service(tmp_path, journal)
    manifest = parse_workspace_manifest(MANIFEST)
    repository = tmp_path / "state" / "spaces" / "space-1" / "configuration"
    backend.init_repository(repository)
    content = b"public package data\n"
    lock_payload = {
        "apiVersion": "eigent.ai/lock/v1alpha1",
        "bundleRevision": manifest.revision_id,
        "manifestDigest": manifest.digest,
        "assets": [
            {
                "ref": "bundle://assets/data.txt",
                "digest": hashlib.sha256(content).hexdigest(),
                "executable": False,
            }
        ],
        "skills": [],
        "mcpPackages": [],
    }
    (repository / "workspace.yaml").write_text(
        yaml.safe_dump(
            manifest.canonical_payload(),
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (repository / "workspace.lock").write_text(
        yaml.safe_dump(lock_payload, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    asset_path = repository / "assets" / "data.txt"
    asset_path.parent.mkdir(parents=True)
    asset_path.write_bytes(content)
    asset_path.chmod(0o755)

    service.bootstrap(
        space_id="space-1",
        space_root=space,
        manifest=manifest,
        placement=ConfigPlacement.SIDECAR,
        created_by="user-1",
        assets={"assets/data.txt": content},
        lock_payload=lock_payload,
        executable_assets=set(),
    )

    assert stat.S_IMODE(asset_path.stat().st_mode) == 0o644


def test_bundle_upgrade_preserves_user_edits_and_removes_only_clean_old_assets(
    tmp_path,
    journal,
):
    space = tmp_path / "space"
    space.mkdir()
    service, backend = _service(tmp_path, journal)
    first_manifest = parse_workspace_manifest(MANIFEST)
    first_assets = {
        "instructions/coordinator.md": b"version one\n",
        "assets/obsolete.txt": b"remove on upgrade\n",
    }
    first = service.bootstrap(
        space_id="space-1",
        space_root=space,
        manifest=first_manifest,
        placement=ConfigPlacement.SIDECAR,
        created_by="user-1",
        assets=first_assets,
        lock_payload={
            "apiVersion": "eigent.ai/lock/v1alpha1",
            "bundleRevision": first_manifest.revision_id,
            "manifestDigest": first_manifest.digest,
            "assets": [
                {
                    "ref": f"bundle://{path}",
                    "digest": hashlib.sha256(content).hexdigest(),
                }
                for path, content in first_assets.items()
            ],
            "skills": [],
            "mcpPackages": [],
        },
    )
    edited_path = (
        first.configuration_repository_root / "instructions/coordinator.md"
    )
    edited_path.write_text("user edit\n", encoding="utf-8")
    second_manifest = parse_workspace_manifest(
        MANIFEST.replace("revision: 1", "revision: 2")
    )
    second_assets = {"instructions/coordinator.md": b"version two\n"}
    second_lock = {
        "apiVersion": "eigent.ai/lock/v1alpha1",
        "bundleRevision": second_manifest.revision_id,
        "manifestDigest": second_manifest.digest,
        "assets": [
            {
                "ref": "bundle://instructions/coordinator.md",
                "digest": hashlib.sha256(
                    second_assets["instructions/coordinator.md"]
                ).hexdigest(),
            }
        ],
        "skills": [],
        "mcpPackages": [],
    }

    with pytest.raises(ConfigurationRepositoryError, match="uncommitted"):
        service.bootstrap(
            space_id="space-1",
            space_root=space,
            manifest=second_manifest,
            placement=ConfigPlacement.SIDECAR,
            created_by="user-1",
            assets=second_assets,
            lock_payload=second_lock,
            expected_previous_revision_id=first_manifest.revision_id,
        )
    assert edited_path.read_text(encoding="utf-8") == "user edit\n"

    edited_path.write_bytes(first_assets["instructions/coordinator.md"])
    upgraded = service.bootstrap(
        space_id="space-1",
        space_root=space,
        manifest=second_manifest,
        placement=ConfigPlacement.SIDECAR,
        created_by="user-1",
        assets=second_assets,
        lock_payload=second_lock,
        expected_previous_revision_id=first_manifest.revision_id,
    )

    assert edited_path.read_bytes() == b"version two\n"
    assert not (
        upgraded.configuration_repository_root / "assets/obsolete.txt"
    ).exists()
    assert (
        backend.changed_paths(
            upgraded.configuration_repository_root,
            (
                upgraded.manifest_path,
                upgraded.lock_path,
                edited_path,
            ),
        )
        == ()
    )
    assert (
        int(
            _git(
                upgraded.configuration_repository_root,
                "rev-list",
                "--count",
                "HEAD",
            )
        )
        == 2
    )


def test_revision_conflict_is_detected_before_git_mutation(
    tmp_path,
    journal,
):
    space = tmp_path / "space"
    space.mkdir()
    service, _ = _service(tmp_path, journal)
    original = parse_workspace_manifest(MANIFEST)
    first = service.bootstrap(
        space_id="space-1",
        space_root=space,
        manifest=original,
        placement=ConfigPlacement.SIDECAR,
        created_by="user-1",
    )
    conflicting = parse_workspace_manifest(
        MANIFEST.replace("name: Local Workspace", "name: Changed Name")
    )

    with pytest.raises(IdempotencyConflictError):
        service.bootstrap(
            space_id="space-1",
            space_root=space,
            manifest=conflicting,
            placement=ConfigPlacement.SIDECAR,
            created_by="user-1",
        )

    assert (
        service.git.current_head(first.configuration_repository_root)
        == first.commit_oid
    )
    assert (
        yaml.safe_load(first.manifest_path.read_text())["metadata"]["name"]
        == "Local Workspace"
    )


def test_git_backend_rejects_paths_outside_repository(tmp_path):
    repository = tmp_path / "repo"
    repository.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("no", encoding="utf-8")
    backend = GitBackend(hooks_path=tmp_path / "hooks")
    backend.init_repository(repository)

    with pytest.raises(GitBackendError, match="escapes repository"):
        backend.commit_paths(
            repository,
            (outside,),
            message="must not commit",
        )


def test_git_backend_ignores_inherited_repository_control_environment(
    tmp_path,
    monkeypatch,
):
    repository = tmp_path / "repo"
    repository.mkdir()
    external_index = tmp_path / "attacker-controlled-index"
    backend = GitBackend(hooks_path=tmp_path / "hooks")
    backend.init_repository(repository)
    tracked = repository / "safe.txt"
    tracked.write_text("safe", encoding="utf-8")
    monkeypatch.setenv("GIT_INDEX_FILE", str(external_index))
    monkeypatch.setenv("GIT_AUTHOR_NAME", "Unexpected User")

    commit_oid = backend.commit_paths(
        repository,
        (tracked,),
        message="safe commit",
        author_name="Eigent Test",
        author_email="test@eigent.ai",
    )

    assert not external_index.exists()
    assert backend.show_commit_paths(repository, commit_oid) == ("safe.txt",)
    assert _git(
        repository, "show", "-s", "--format=%an <%ae>", commit_oid
    ) == ("Eigent Test <test@eigent.ai>")
