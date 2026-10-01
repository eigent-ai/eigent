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

"""Manifest-backed Git worktrees using the existing GitBackend object store.

Only Eigent runtime refs and private worktree indexes are written. Full input
and output manifests stay in the local CAS, including read-only user overlays.
Git trees contain the managed baseline plus provenance-authorized mutations,
not the complete CAS view. No checkout, filter or merge driver processes content.
Admitted and partial-preparation refs remain retained. Exact unchanged private
preparations may be retired by discard_prepared_workspace; journal recovery/GC
must reconcile all other worktrees and refs.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import tempfile
import uuid
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path

from app.workspace_git.backend import GitBackend, GitBackendError

from .content import (
    ContentIntegrityError,
    ContentStore,
    ManifestEntry,
    WorkspaceContentError,
    canonical_json,
    content_digest,
    relative_path,
    sync_directory,
)
from .provider import (
    CaptureLimits,
    DirectoryWorkspaceProvider,
    PreparationIdentity,
    RetentionBackend,
    SnapshotRef,
    SourceChangedError,
    SourceFence,
    WorkspaceHandle,
    WorkspaceOwnerError,
    WorkspaceRevision,
    _stat_token,
)


@dataclass(frozen=True, kw_only=True)
class GitSnapshotRef(SnapshotRef):
    source_commit: str | None = None
    repository_identity: str
    provider: str = "git"


@dataclass(frozen=True, kw_only=True)
class GitWorkspaceHandle(WorkspaceHandle):
    """input_revision is full CAS I; input_commit is only its managed layer."""

    git_ref: str
    input_commit: str
    input_tree: str
    repository_identity: str
    provider: str = "git"


@dataclass(frozen=True, kw_only=True)
class GitWorkspaceRevision(WorkspaceRevision):
    """revision_id is full CAS O; Git fields cover managed paths only."""

    git_ref: str
    git_commit: str
    git_tree: str
    overlay_preimage_commit: str | None = None
    path_provenance: tuple[tuple[str, str], ...] = ()
    provider: str = "git"


class GitMutationProvenanceError(WorkspaceContentError):
    """A changed path lacks a receipt authorizing its managed checkpoint."""

    code = "mutation_provenance_unverified"


@dataclass(frozen=True)
class GitAuthorizationState:
    """Dependencies of one worker check, never a reusable authorization."""

    locator: tuple = field(repr=False)
    configurations: tuple = field(repr=False)
    branch: bytes | None = field(repr=False)
    branch_dependent: bool


def _configuration_state(path: Path) -> tuple:
    # Metadata only: config values (possibly credentials) never enter receipts.
    resolved = path.resolve()
    try:
        observed = resolved.stat()
    except FileNotFoundError:
        return str(resolved), None
    if not stat.S_ISREG(observed.st_mode) or not os.access(resolved, os.R_OK):
        raise SourceChangedError("Git configuration is not readable")
    return str(resolved), _stat_token(observed)


def _authorization_head(directory: Path) -> bytes | None:
    """Validate discovery's HEAD prerequisite, allowing normal HEAD updates."""
    head = directory / "HEAD"
    if head.is_symlink():
        target = os.fsencode(os.readlink(head))
        # Git also accepts legacy symbolic HEAD, including an unborn branch.
        if target.startswith(b"refs/"):
            return target
        raise SourceChangedError("Git HEAD symbolic link is invalid")
    descriptor = os.open(head, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise SourceChangedError("Git HEAD is not a regular reference")
        value = os.read(descriptor, 4097)
    finally:
        os.close(descriptor)
    if len(value) > 4096:
        raise SourceChangedError("Git HEAD exceeds reference limit")
    if value.startswith(b"ref:"):
        reference = value[4:].strip()
        if reference.startswith(b"refs/"):
            return reference
    elif re.fullmatch(rb"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})\s*", value):
        return None
    raise SourceChangedError("Git HEAD is invalid")


class _ManifestGitBackend(GitBackend):
    """Small plumbing bridge; reuses GitBackend transport and ref policy."""

    def _environment(self, *, identity=None):
        environment = super()._environment(identity=identity)
        allowed = {
            "GIT_EDITOR",
            "GIT_CONFIG_NOSYSTEM",
            "GIT_CONFIG_GLOBAL",
            "GIT_LITERAL_PATHSPECS",
            "GIT_MERGE_AUTOEDIT",
            "GIT_PAGER",
            "GIT_SEQUENCE_EDITOR",
            "GIT_TERMINAL_PROMPT",
            "GIT_AUTHOR_NAME",
            "GIT_AUTHOR_EMAIL",
            "GIT_COMMITTER_NAME",
            "GIT_COMMITTER_EMAIL",
        }
        for key in tuple(environment):
            if key.startswith("GIT_") and key not in allowed:
                environment.pop(key)
        environment.update(GIT_OPTIONAL_LOCKS="0", GIT_ATTR_NOSYSTEM="1")
        return environment

    def _command(self, cwd, args):
        return super()._command(
            cwd,
            (
                "-c",
                "commit.gpgSign=false",
                "-c",
                "gc.auto=0",
                "-c",
                "maintenance.auto=false",
                *args,
            ),
        )

    def plumbing(self, root, args, *, input_text=None, identity=None):
        result = self._run(
            root,
            args,
            input_text=input_text,
            identity=identity,
        )
        if result.stdout_truncated or result.stderr_truncated:
            raise GitBackendError("Git plumbing output was truncated")
        return result.stdout.strip()

    def raw_blob(self, root: Path, temporary_root: Path, value: bytes) -> str:
        descriptor, name = tempfile.mkstemp(
            prefix=".git-blob-", dir=temporary_root
        )
        try:
            with os.fdopen(descriptor, "wb") as writer:
                writer.write(value)
            oid = self.plumbing(
                root, ("hash-object", "--no-filters", "-w", "--", name)
            )
            self._validate_object_name(oid)
            return oid
        finally:
            Path(name).unlink(missing_ok=True)


class GitWorkspaceProvider(DirectoryWorkspaceProvider):
    def __init__(
        self,
        store: ContentStore,
        workspace_root: Path,
        *,
        repository_root: Path,
        git: GitBackend | None = None,
        limits: CaptureLimits | None = None,
        retention: RetentionBackend | None = None,
        exclude_path: Callable[[str, bool], bool] | None = None,
    ) -> None:
        super().__init__(
            store,
            workspace_root,
            limits=limits,
            retention=retention,
            exclude_path=exclude_path,
        )
        backend = git or GitBackend()
        self.git = _ManifestGitBackend(
            backend.git_executable,
            timeout_seconds=backend.timeout_seconds,
            max_output_chars=backend.max_output_chars,
            max_status_output_chars=backend.max_status_output_chars,
            hooks_path=Path(os.devnull),
        )
        self.repository_root = self._source_root(repository_root)
        probe = self.git.probe(self.repository_root)
        if not probe.is_repository or not probe.owns_requested_root:
            raise GitBackendError(
                "Git provider requires an existing repository root"
            )
        if self.workspace_root.is_relative_to(self.repository_root):
            raise GitBackendError(
                "Git worktrees must be outside the source repository"
            )
        self.repository_identity = self._repository_identity()

    def _repository_identity(self) -> str:
        common = Path(
            self.git.plumbing(
                self.repository_root,
                ("rev-parse", "--path-format=absolute", "--git-common-dir"),
            )
        ).resolve(strict=True)
        observed = common.stat()
        return content_digest(
            canonical_json(
                [
                    str(common),
                    observed.st_dev,
                    observed.st_ino,
                ]
            )
        )

    def _require_repository(self) -> None:
        if self._repository_identity() != self.repository_identity:
            raise SourceChangedError("Git object database identity changed")

    def authorization_locator_state(self) -> tuple:
        """Cheap change detector surrounding a fresh Git identity command.

        This does not authorize a repository by itself. Capture it before the
        complete worker check, then compare it on the loop and at admission.
        Validate HEAD and searchable object/ref directories on every call.
        Pin locators and configuration metadata, not mutable Git contents:
        normal HEAD/index/ref/object writes must not invalidate a receipt.
        """

        def identity(path):
            resolved = path.resolve(strict=True)
            observed = resolved.stat()
            if not stat.S_ISDIR(observed.st_mode):
                raise SourceChangedError("Git metadata directory changed")
            if not os.access(resolved, os.X_OK):
                raise SourceChangedError("Git metadata is not searchable")
            return (
                str(resolved),
                observed.st_dev,
                observed.st_ino,
                observed.st_mode,
                observed.st_uid,
                observed.st_gid,
            )

        def locator_file(path):
            observed = path.stat()
            if not stat.S_ISREG(observed.st_mode):
                raise SourceChangedError("Git locator is not a regular file")
            with path.open("rb") as stream:
                value = stream.read(4097)
            if len(value) > 4096:
                raise SourceChangedError("Git locator exceeds path limit")
            return (
                str(path.resolve(strict=True)),
                observed.st_dev,
                observed.st_ino,
                observed.st_mtime_ns,
                observed.st_ctime_ns,
                value,
            )

        marker = self.repository_root / ".git"
        marker_state = None
        if marker.is_dir():
            directory = marker
        else:
            marker_state = locator_file(marker)
            value = marker_state[-1]
            if not value.startswith(b"gitdir: "):
                raise SourceChangedError("Git locator changed")
            directory = marker.parent / os.fsdecode(value[8:].rstrip(b"\r\n"))
        directory_state = identity(directory)
        common_marker = directory / "commondir"
        common_state = None
        if common_marker.exists():
            common_state = locator_file(common_marker)
            common = directory / os.fsdecode(common_state[-1].rstrip(b"\r\n"))
        else:
            common = directory
        _authorization_head(directory)
        return (
            marker_state,
            directory_state,
            common_state,
            identity(common),
            identity(self.repository_root),
            identity(common / "objects"),
            identity(common / "refs"),
            _configuration_state(common / "config"),
            _configuration_state(directory / "config.worktree"),
        )

    def _authorization_includes(self) -> tuple[tuple[Path, ...], bool]:
        # Run only in the authorization worker. Git resolves its own include
        # syntax/conditions; request paths only, never arbitrary config values.
        result = self.git._run(
            self.repository_root,
            (
                "config",
                "--null",
                "--show-origin",
                "--includes",
                "--get-regexp",
                r"^include(if\..*)?\.path$",
            ),
            check=False,
            preserve_newlines=True,
        )
        if result.returncode not in (0, 1):
            raise SourceChangedError(
                "Git include dependencies are unavailable"
            )
        if result.stdout_truncated or result.stderr_truncated:
            raise SourceChangedError("Git include dependencies exceed limit")
        fields = result.stdout.split("\0")
        if fields.pop() != "" or len(fields) % 2:
            raise SourceChangedError("Git include dependencies are invalid")
        paths = set()
        branch_dependent = False
        for origin, setting in zip(fields[::2], fields[1::2]):
            key, separator, value = setting.partition("\n")
            if not origin.startswith("file:") or not separator or not value:
                raise SourceChangedError("Git include path is unavailable")
            if value.startswith("%(prefix)"):
                raise SourceChangedError("Git include prefix is unsupported")
            owner = self.repository_root / origin[5:]
            path = Path(value).expanduser()
            if not path.is_absolute():
                path = owner.parent / path
            paths.update((owner, path))
            branch_dependent |= key.startswith("includeif.onbranch:")
        if len(paths) > 64:
            raise SourceChangedError("Git include dependencies exceed limit")
        return tuple(sorted(paths)), branch_dependent

    def capture_authorization_state(self) -> GitAuthorizationState:
        """Worker-only capture before the original complete require succeeds."""
        locator = self.authorization_locator_state()
        paths, branch_dependent = self._authorization_includes()
        configurations = tuple((p, _configuration_state(p)) for p in paths)
        branch = (
            _authorization_head(Path(locator[1][0]))
            if branch_dependent
            else None
        )
        # Check the discovered graph again around its file stamps. A config
        # edited during discovery cannot hide a newly introduced dependency.
        if paths and self._authorization_includes() != (
            paths,
            branch_dependent,
        ):
            raise SourceChangedError("Git include dependencies changed")
        state = GitAuthorizationState(
            locator, configurations, branch, branch_dependent
        )
        if not self.authorization_state_current(state):
            raise SourceChangedError("Git authorization dependencies changed")
        return state

    def authorization_state_current(
        self, state: GitAuthorizationState
    ) -> bool:
        # Filesystem-only: used on continuation and in the admission transaction.
        # A branch switch with onbranch includes needs a new complete check;
        # ordinary commits and detached HEAD advances do not change selection.
        return (
            self.authorization_locator_state() == state.locator
            and all(
                _configuration_state(path) == observed
                for path, observed in state.configurations
            )
            and (
                not state.branch_dependent
                or _authorization_head(Path(state.locator[1][0]))
                == state.branch
            )
        )

    def capture_source(
        self,
        source_root: Path,
        *,
        owner: str,
        read_fence: Callable[[], SourceFence],
        expected_fence: SourceFence | None = None,
        commit_capture: Callable[[SnapshotRef, SourceFence], None]
        | None = None,
    ) -> GitSnapshotRef:
        if self._source_root(source_root) != self.repository_root:
            raise SourceChangedError(
                "Git snapshot source differs from repository"
            )
        self._require_repository()
        source_commit = self.git.current_head(self.repository_root)
        captured = None

        def commit(snapshot, fence):
            nonlocal captured
            self._require_repository()
            if self.git.current_head(self.repository_root) != source_commit:
                raise SourceChangedError(
                    "Git source HEAD changed during capture"
                )
            if source_commit is not None:
                self._pin(
                    f"refs/eigent/runtime/sources/{source_commit}",
                    source_commit,
                )
            candidate = GitSnapshotRef(
                snapshot.revision_id,
                snapshot.owner,
                snapshot.fence,
                source_commit=source_commit,
                repository_identity=self.repository_identity,
            )
            if commit_capture is not None:
                commit_capture(candidate, fence)
            captured = candidate

        super().capture_source(
            source_root,
            owner=owner,
            read_fence=read_fence,
            expected_fence=expected_fence,
            commit_capture=commit,
        )
        assert captured is not None
        return captured

    def _pin(self, ref: str, oid: str) -> None:
        existing = self.git.ref_oid(self.repository_root, ref)
        if existing == oid:
            return
        if existing is not None:
            raise ContentIntegrityError("immutable Git runtime ref changed")
        try:
            self.git.update_eigent_ref(
                self.repository_root,
                ref,
                oid,
                expected_oid="0" * len(oid),
            )
        except GitBackendError:
            if self.git.ref_oid(self.repository_root, ref) != oid:
                raise

    def _tree_entries(self, tree: str) -> dict[str, tuple[str, str, str]]:
        """Read metadata only, without checkout, filters or overlay hashing."""
        self.git._validate_object_name(tree)
        result = self.git._run(self.repository_root, ("ls-tree", "-z", tree))
        if result.stdout_truncated:
            raise GitBackendError("Git tree metadata exceeded its read limit")
        entries = {}
        for record in result.stdout.split("\0"):
            if not record:
                continue
            metadata, separator, name = record.partition("\t")
            fields = metadata.split()
            if not separator or len(fields) != 3 or "/" in name:
                raise GitBackendError("malformed Git tree entry")
            relative_path(name)
            mode, kind, oid = fields
            if (mode, kind) not in {
                ("040000", "tree"),
                ("100644", "blob"),
                ("100755", "blob"),
                ("120000", "blob"),
                ("160000", "commit"),
            }:
                raise GitBackendError("unsupported Git tree entry")
            self.git._validate_object_name(oid)
            entries[name] = (mode, kind, oid)
        return entries

    def _tree_entry(self, tree: str, path: str):
        parts = relative_path(path).split("/")
        for index, name in enumerate(parts):
            entry = self._tree_entries(tree).get(name)
            if entry is None or index == len(parts) - 1:
                return entry
            if entry[1] != "tree":
                return None
            tree = entry[2]
        return None

    def _matches_managed(self, entry: ManifestEntry | None, managed) -> bool:
        if entry is None:
            return managed is None
        if managed is None:
            return False
        mode, kind, oid = managed
        if entry.kind == "directory":
            return kind == "tree" and entry.mode == 0o755
        if (
            mode not in {"100644", "100755"}
            or entry.mode != int(mode, 8) & 0o777
        ):
            return False
        if self.git.object_size(self.repository_root, oid) != entry.size:
            return False
        value = self.git.read_blob_range(
            self.repository_root,
            oid,
            start_offset=0,
            max_bytes=max(1, entry.size),
        )
        return (
            len(value) == entry.size and content_digest(value) == entry.digest
        )

    def _require_subtree_provenance(
        self,
        baseline: str,
        changes: Mapping[str, ManifestEntry | None],
        *,
        captured: Mapping[str, ManifestEntry],
        coverage: tuple[str, ...],
        provenance: Mapping[str, str],
    ) -> None:
        """A directory receipt never authorizes removing hidden descendants."""

        def require_descendants(tree, parent):
            for name, (_, kind, oid) in self._tree_entries(tree).items():
                path = f"{parent}/{name}"
                if (
                    path not in captured
                    or path not in provenance
                    or any(
                        path == excluded or path.startswith(excluded + "/")
                        for excluded in coverage
                    )
                ):
                    raise GitMutationProvenanceError(
                        "managed subtree removal requires captured descendants "
                        "with exact mutation receipts"
                    )
                if kind == "tree":
                    require_descendants(oid, path)

        for path, entry in changes.items():
            if entry is not None and entry.kind == "directory":
                continue
            managed = self._tree_entry(baseline, path)
            if managed is not None and managed[1] == "tree":
                require_descendants(managed[2], path)

    def _change_tree(
        self,
        baseline: str,
        changes: Mapping[str, ManifestEntry | None],
    ) -> str:
        """Replace only authorized paths; reuse all untouched Git object OIDs."""
        updates = {}
        for path, entry in changes.items():
            relative_path(path)
            if entry is not None and entry.kind == "file":
                value = self.store.read_blob(entry.digest)
                if len(value) != entry.size:
                    raise ContentIntegrityError("Git checkpoint size mismatch")
                oid = self.git.raw_blob(
                    self.repository_root, self.workspace_root, value
                )
                mode = "100755" if entry.mode & 0o111 else "100644"
                updates[path] = (mode, "blob", oid)
            else:
                updates[path] = "directory" if entry is not None else None

        def rewrite(tree, edits):
            entries = self._tree_entries(tree) if tree else {}
            groups = {}
            for path, value in edits.items():
                name, _, remainder = path.partition("/")
                groups.setdefault(name, {})[remainder] = value
            for name, group in groups.items():
                if "" in group and group[""] != "directory":
                    value = group[""]
                    if value is None:
                        entries.pop(name, None)
                    else:
                        entries[name] = value
                    continue
                old = entries.get(name)
                if old is not None and old[1] == "commit":
                    raise GitBackendError(
                        "cannot import paths inside a submodule"
                    )
                nested = {path: value for path, value in group.items() if path}
                child_tree = old[2] if old and old[1] == "tree" else None
                if not nested and child_tree:
                    continue
                oid, populated = rewrite(child_tree, nested)
                if populated:
                    entries[name] = ("040000", "tree", oid)
                else:
                    entries.pop(name, None)
            oid = self.git.plumbing(
                self.repository_root,
                ("mktree", "-z"),
                input_text="".join(
                    f"{mode} {kind} {oid}\t{name}\0"
                    for name, (mode, kind, oid) in entries.items()
                ),
            )
            self.git._validate_object_name(oid)
            return oid, bool(entries)

        return rewrite(baseline, updates)[0]

    def _commit_tree(
        self,
        tree: str,
        *,
        parent: str,
        actor: str,
        trigger: str,
        revision: str,
        provenance: Mapping[str, str],
        preimages: Mapping[str, ManifestEntry | None] | None = None,
    ) -> tuple[str, str]:
        self.git._validate_object_name(tree)
        self.git._validate_object_name(parent)
        evidence = {
            "revision": revision,
            "path_receipts": dict(provenance),
            "preimages": {
                path: asdict(entry) if entry else None
                for path, entry in (preimages or {}).items()
            },
        }
        message = (
            f"Eigent workspace {trigger}\n\n"
            f"Eigent-Actor: {actor}\nEigent-Trigger: {trigger}\n"
            f"Eigent-Provenance: {canonical_json(evidence).decode('utf-8')}"
        )
        commit = self.git.plumbing(
            self.repository_root,
            ("commit-tree", tree, "-p", parent, "-m", message),
            identity=("Eigent", "noreply@eigent.ai"),
        )
        self.git._validate_object_name(commit)
        # Commit time is not identity. Pin by exact OID; the returned handle or
        # journal keeps the manifest-to-commit mapping without mutable aliases.
        ref = f"refs/eigent/runtime/revisions/{commit}"
        self._pin(ref, commit)
        return commit, ref

    def prepare(
        self,
        snapshot: SnapshotRef,
        *,
        owner: str,
        generation: int,
        assert_owner: Callable[[str, int], None] | None = None,
    ) -> GitWorkspaceHandle:
        self._require_repository()
        if (
            not isinstance(snapshot, GitSnapshotRef)
            or snapshot.repository_identity != self.repository_identity
        ):
            raise WorkspaceOwnerError(
                "Git snapshot belongs to another repository"
            )
        # Reuse complete manifest validation, limits and independent byte copy.
        copied = super().prepare(
            snapshot,
            owner=owner,
            generation=generation,
            assert_owner=assert_owner,
        )
        staging = self.workspace_root / (".git-prepare-" + uuid.uuid4().hex)
        ref = f"refs/heads/eigent/runtime/{copied.workspace_id}"
        registration_started = False
        try:
            self._marker(copied).unlink()
            copied.local_root.rename(staging)
            anchor = self.git.create_anchor_commit(
                self.repository_root,
                message="Initialize isolated Eigent workspace",
            )
            commit = snapshot.source_commit or anchor
            tree = self.git.plumbing(
                self.repository_root,
                ("rev-parse", f"{commit}^{{tree}}"),
            )
            registration_started = True
            self.git.ensure_worktree(
                self.repository_root,
                worktree_path=copied.local_root,
                ref_name=ref,
                commit_oid=anchor,
            )
            # Empty checkout cannot execute content filters. Copy bytes directly
            # and read the immutable tree into only this private worktree index.
            for child in staging.iterdir():
                child.rename(copied.local_root / child.name)
            staging.rmdir()
            self.git.update_eigent_ref(
                self.repository_root,
                ref,
                commit,
                expected_oid=anchor,
            )
            self.git.plumbing(copied.local_root, ("read-tree", commit))
            sync_directory(copied.local_root)
            handle = GitWorkspaceHandle(
                copied.workspace_id,
                copied.local_root,
                owner,
                generation,
                copied.input_revision,
                git_ref=ref,
                input_commit=commit,
                input_tree=tree,
                repository_identity=self.repository_identity,
            )
            self._require_repository()
            if assert_owner is not None:
                assert_owner(owner, generation)
            with self._marker(handle).open("xb") as marker:
                marker.write(self._handle_bytes(handle))
                marker.flush()
                os.fsync(marker.fileno())
            sync_directory(self.workspace_root)
            if assert_owner is not None:
                assert_owner(owner, generation)
            return handle
        except BaseException:
            self._marker(copied).unlink(missing_ok=True)
            shutil.rmtree(staging, ignore_errors=True)
            # A partially registered Git worktree is retained as unreachable
            # preparation evidence. Never force-remove unknown/dirty Git state.
            if not registration_started:
                shutil.rmtree(copied.local_root, ignore_errors=True)
            raise

    def _require_git_handle(self, handle: GitWorkspaceHandle) -> None:
        if not isinstance(handle, GitWorkspaceHandle):
            raise WorkspaceOwnerError("handle is not a private Git worktree")
        self._require_repository()
        self._require_handle(handle)
        actual = self.git.probe(handle.local_root)
        if (
            handle.repository_identity != self.repository_identity
            or not actual.owns_requested_root
            or actual.branch != handle.git_ref.removeprefix("refs/heads/")
            or not any(
                item.path == handle.local_root
                and item.ref_name == handle.git_ref
                for item in self.git.list_worktrees(self.repository_root)
            )
        ):
            raise WorkspaceOwnerError("private Git worktree ownership changed")

    def preparation_identity(
        self, handle: GitWorkspaceHandle
    ) -> PreparationIdentity:
        self._require_git_handle(handle)
        identity = super().preparation_identity(handle)
        metadata = handle.local_root / ".git"
        observed = metadata.stat(follow_symlinks=False)
        if (
            not stat.S_ISREG(observed.st_mode)
            or observed.st_nlink != 1
            or observed.st_size > 65536
        ):
            raise WorkspaceOwnerError("invalid private Git metadata")
        value = metadata.read_bytes()
        if _stat_token(metadata.stat(follow_symlinks=False)) != _stat_token(
            observed
        ):
            raise WorkspaceOwnerError("private Git metadata changed")
        return replace(
            identity,
            metadata=((".git", _stat_token(observed), content_digest(value)),),
        )

    def discard_prepared_workspace(
        self,
        handle: GitWorkspaceHandle,
        identity: PreparationIdentity,
        *,
        assert_unadmitted: Callable[[], None],
    ) -> None:
        """Ordinary clean-worktree removal only; dirty overlays stay retained.

        No staging, force removal, reset or commit is permitted for cleanup.
        Repositories with filter configuration are conservatively retained so
        Git's cleanliness check cannot invoke an external content filter.
        """
        assert_unadmitted()
        self._require_git_handle(handle)
        if self.preparation_identity(handle) != identity:
            raise WorkspaceOwnerError("Git preparation identity changed")
        self._verify_prepared_cleanup(handle, identity, excluded=(".git",))
        if (
            self.git.ref_oid(self.repository_root, handle.git_ref)
            != handle.input_commit
        ):
            raise WorkspaceOwnerError("private Git ref changed")
        filters = self.git._run(
            handle.local_root,
            ("config", "--name-only", "--get-regexp", r"^filter\..*"),
            check=False,
        )
        if (
            filters.returncode != 1
            or filters.stdout
            or filters.stdout_truncated
            or filters.stderr_truncated
        ):
            raise WorkspaceOwnerError(
                "Git filter configuration requires recovery"
            )
        assert_unadmitted()
        self.git.remove_owned_worktree(
            self.repository_root,
            worktree_path=handle.local_root,
            expected_ref=handle.git_ref,
        )
        # Delete only this preparation's branch, with its original expected
        # OID. Source/revision refs and all objects remain available to CAS
        # lineage and any other Run; no repository-wide pruning is performed.
        self.git.plumbing(
            self.repository_root,
            ("update-ref", "-d", handle.git_ref, handle.input_commit),
        )
        marker = self._marker(handle)
        if (
            _stat_token(marker.stat(follow_symlinks=False))
            != identity.marker_token
            or marker.read_bytes() != self._handle_bytes(handle)
        ):
            raise WorkspaceOwnerError("preparation marker changed")
        marker.unlink()
        sync_directory(self.workspace_root)

    def checkpoint(
        self,
        handle: GitWorkspaceHandle,
        *,
        assert_owner: Callable[[WorkspaceHandle], None],
        mutation_receipts: tuple[str, ...] = (),
        path_provenance: Mapping[str, str] | None = None,
    ) -> GitWorkspaceRevision:
        """Checkpoint mutations whose run-scoped receipts the caller verified.

        Each actual I-to-O path change, including deletion/type/mode changes,
        requires an explicit receipt mapping. The caller verifies receipt
        ownership and authorization; a filesystem diff never grants it here.
        Complete frozen bytes remain in CAS even when absent from the Git tree.
        """
        self._require_git_handle(handle)
        output = super().checkpoint(
            handle,
            assert_owner=assert_owner,
            mutation_receipts=mutation_receipts,
        )
        provenance = dict(path_provenance or {})
        if set(provenance) != set(output.changed_paths) or any(
            not isinstance(receipt, str)
            or not receipt
            or receipt not in mutation_receipts
            for receipt in provenance.values()
        ):
            raise GitMutationProvenanceError(
                "path provenance must cover exactly I-to-O changes with mutation receipts"
            )
        self._require_git_handle(handle)
        assert_owner(handle)
        commit, tree, ref = (
            handle.input_commit,
            handle.input_tree,
            handle.git_ref,
        )
        preimage_commit = None
        if not provenance:
            ref = f"refs/eigent/runtime/revisions/{commit}"
            self._pin(ref, commit)
        if provenance:
            input_manifest = self.store.get_manifest(handle.input_revision)
            inputs = {
                entry.path: entry
                for entry in input_manifest.entries
                if entry.kind != "tombstone"
            }
            outputs = {
                entry.path: entry
                for entry in self.store.get_manifest(
                    output.revision_id
                ).entries
                if entry.kind != "tombstone"
            }
            preimages = {
                path: inputs.get(path)
                for path in provenance
                if not self._matches_managed(
                    inputs.get(path),
                    self._tree_entry(handle.input_tree, path),
                )
            }
            changes = {path: outputs.get(path) for path in provenance}
            # Validate both stages before writing any Git object/ref. Either
            # stage can replace a whole managed tree absent from the CAS view.
            # Preimages only add captured, receipt-backed paths, so validating
            # against the original managed tree covers its hidden descendants.
            for edits in (preimages, changes):
                self._require_subtree_provenance(
                    handle.input_tree,
                    edits,
                    captured=inputs,
                    coverage=input_manifest.coverage,
                    provenance=provenance,
                )
            if preimages:
                tree = self._change_tree(tree, preimages)
                commit, _ = self._commit_tree(
                    tree,
                    parent=commit,
                    actor="user",
                    trigger="overlay_preimage",
                    revision=handle.input_revision,
                    provenance={path: provenance[path] for path in preimages},
                    preimages=preimages,
                )
                preimage_commit = commit
            tree = self._change_tree(tree, changes)
            commit, ref = self._commit_tree(
                tree,
                parent=commit,
                actor="agent",
                trigger="agent_delta",
                revision=output.revision_id,
                provenance=provenance,
            )
        self._require_git_handle(handle)
        assert_owner(handle)
        return GitWorkspaceRevision(
            output.revision_id,
            output.workspace_id,
            output.owner,
            output.generation,
            output.input_revision,
            output.changed_paths,
            git_ref=ref,
            git_commit=commit,
            git_tree=tree,
            overlay_preimage_commit=preimage_commit,
            path_provenance=tuple(sorted(provenance.items())),
        )
