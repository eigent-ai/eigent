"""Durable user edits inside a private Run integration worktree."""

from __future__ import annotations

import hashlib
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from app.run_journal import (
    GitCheckpointRecord,
    SQLiteRunJournal,
    configured_run_journal_path,
    get_default_run_journal,
)
from app.workspace_config import canonical_digest
from app.workspace_git.content import (
    ContentRepositoryError,
    ContentRepositoryService,
    RepositoryStateChangedError,
)
from app.workspace_git.coordinator import WorkspaceGitCoordinator


@dataclass(frozen=True)
class RunWorkspaceEditResult:
    run_id: str
    relative_path: str
    content_digest: str
    checkpoint: GitCheckpointRecord


class RunWorkspaceEditService:
    """Serialize UI edits with Agent merges and checkpoint before success."""

    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        state_root: Path,
        coordinator: WorkspaceGitCoordinator | None = None,
        max_content_bytes: int = 4 * 1024 * 1024,
    ) -> None:
        if max_content_bytes < 1:
            raise ValueError("Run workspace edit limit must be positive")
        self.journal = journal
        self.state_root = state_root.expanduser().resolve()
        self.coordinator = coordinator or WorkspaceGitCoordinator(
            journal,
            state_root=self.state_root,
        )
        self.git = self.coordinator.git
        self.content: ContentRepositoryService = self.coordinator.content
        self.max_content_bytes = max_content_bytes

    def save_text(
        self,
        *,
        run_id: str,
        relative_path: str,
        content: str,
        operation_request_id: str,
        editor_session_id: str,
        actor_id: str,
        expected_content_digest: str | None = None,
        now: float | None = None,
    ) -> RunWorkspaceEditResult:
        timestamp = now if now is not None else time.time()
        if not editor_session_id.strip():
            raise ValueError("Editor session id is required")
        encoded = content.encode("utf-8")
        if len(encoded) > self.max_content_bytes:
            raise ValueError(
                "Run workspace text edit exceeds the bounded save limit"
            )
        normalized = self._relative_path(relative_path)
        desired_digest = hashlib.sha256(encoded).hexdigest()
        run = self.journal.get_run_git_materialization(run_id)
        if (
            run is None
            or run.materialization_state != "materialized"
            or not run.worktree_path
        ):
            raise ContentRepositoryError(
                "Run workspace must be materialized before editing"
            )
        repository = self.journal.get_git_repository(run.repository_id)
        if repository is None:
            raise ContentRepositoryError("Run repository is unavailable")
        root = Path(run.worktree_path).expanduser().resolve()
        target = root / normalized
        self._assert_safe_target(root, target)
        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": run.repository_id,
                    "request_id": operation_request_id,
                }
            )[:32]
        )
        payload = {
            "run_id": run_id,
            "relative_path": normalized,
            "content_digest": desired_digest,
            "expected_content_digest": expected_content_digest,
            "editor_session_id": editor_session_id,
            "actor_id": actor_id,
        }
        lock_path = self.content.repository_lock_path(repository.space_id)
        with self.content.repository_lock(lock_path):
            before = self.git.repo_state_token(root)
            existing_operation = self.journal.get_git_operation(operation_id)
            persisted_expected_digest = (
                existing_operation.expected_repo_state_digest
                if existing_operation is not None
                else before.digest
            )
            operation = self.journal.begin_git_operation(
                operation_id=operation_id,
                repository_id=run.repository_id,
                request_id=operation_request_id,
                operation_type="run.workspace_edit",
                payload_digest=canonical_digest(payload),
                expected_repo_state_digest=persisted_expected_digest,
            )
            if operation.status == "completed":
                return self._completed_result(
                    operation.result,
                    run_id=run_id,
                    relative_path=normalized,
                    content_digest=desired_digest,
                )
            current_digest = self._digest_file(target)
            if operation.status == "prepared":
                if current_digest != expected_content_digest:
                    self.journal.fail_git_operation(
                        operation_id,
                        error_code="workspace_content_changed",
                        error_message=(
                            "Run workspace content changed before save"
                        ),
                    )
                    raise RepositoryStateChangedError(
                        "Run workspace file changed; refresh before saving"
                    )
                self.journal.mark_git_operation_dispatched(
                    operation_id,
                    observed_repo_state_digest=before.digest,
                    now=timestamp,
                )
            elif operation.status != "dispatched":
                raise ContentRepositoryError(
                    f"Run workspace edit is {operation.status!r}"
                )
            if current_digest != desired_digest:
                self._atomic_replace(target, encoded)
            checkpoint_request_id = f"{operation_request_id}:checkpoint"
            try:
                checkpoint = self.content.checkpoint(
                    run.repository_id,
                    operation_request_id=checkpoint_request_id,
                    expected_repo_state_digest=self.git.repo_state_token(
                        root
                    ).digest,
                    paths=(target,),
                    path_sources={normalized: "user_selected"},
                    target_role="run",
                    target_id=run_id,
                    actor_id=actor_id,
                    trigger="run_workspace.user_edit",
                    message=f"Save Run workspace edit {normalized}",
                    worktree_root=root,
                    repository_lock_held=True,
                )
            except Exception:
                # The edit operation stays dispatched. Retrying the same
                # request resumes from the intended content and the
                # checkpoint operation is independently idempotent.
                raise
            result = {
                "run_id": run_id,
                "relative_path": normalized,
                "content_digest": desired_digest,
                "checkpoint_id": checkpoint.checkpoint_id,
                "commit_oid": checkpoint.commit_oid,
            }
            self.journal.complete_git_operation(
                operation_id,
                result=result,
                observed_repo_state_digest=self.git.repo_state_token(
                    root
                ).digest,
                now=timestamp,
            )
        return RunWorkspaceEditResult(
            run_id=run_id,
            relative_path=normalized,
            content_digest=desired_digest,
            checkpoint=checkpoint,
        )

    def _completed_result(
        self,
        result: dict | None,
        *,
        run_id: str,
        relative_path: str,
        content_digest: str,
    ) -> RunWorkspaceEditResult:
        checkpoint_id = str((result or {}).get("checkpoint_id") or "")
        checkpoint = self.journal.get_git_checkpoint(checkpoint_id)
        if checkpoint is None:
            raise ContentRepositoryError(
                "Completed Run workspace edit has no checkpoint"
            )
        return RunWorkspaceEditResult(
            run_id=run_id,
            relative_path=relative_path,
            content_digest=content_digest,
            checkpoint=checkpoint,
        )

    @staticmethod
    def _relative_path(value: str) -> str:
        path = PurePosixPath(value)
        if (
            not value
            or path.is_absolute()
            or ".." in path.parts
            or value.startswith(("~/", "\\\\"))
            or (len(value) > 1 and value[1] == ":")
        ):
            raise ValueError("Run workspace edit path must be relative")
        return path.as_posix()

    @staticmethod
    def _assert_safe_target(root: Path, target: Path) -> None:
        resolved = target.resolve(strict=False)
        try:
            resolved.relative_to(root)
        except ValueError as exc:
            raise ContentRepositoryError(
                "Run workspace edit target escapes its worktree"
            ) from exc

    @staticmethod
    def _digest_file(path: Path) -> str | None:
        if not path.is_file():
            return None
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _atomic_replace(target: Path, content: bytes) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)


def get_default_run_workspace_edit_service() -> RunWorkspaceEditService:
    return RunWorkspaceEditService(
        get_default_run_journal(),
        state_root=configured_run_journal_path().parent / "workspace-git",
    )
