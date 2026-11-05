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

"""Save one finished Run as a local Harbor task directory.

The task is built only from what Eigent already recorded for the Run: the
user's messages and text answers, and the Content Repository commits before
and after the Run. Nothing leaves the machine and no model is called.

- ``environment/``: the files at the commit before the Run, as ``/app``;
- ``instruction.md``: the user's own words; workspace paths become ``/app``;
- ``solution/solve.sh`` and ``tests/test.sh``: placeholders. The task's
  verifier and reference solution are written later, from the instruction
  (Harbor Hub drafts both), so Eigent's own result is not kept; the test
  writes no reward, and tasks run with ``harbor run ...
  --disable-verification`` until then.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import shutil
import tempfile
from collections import Counter
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from app.workspace_git.backend import (
    GitBackend,
    GitBackendError,
    GitTreeEntry,
)

HARBOR_TASKS_DIR_ENV = "EIGENT_HARBOR_TASKS_DIR"

_DEFAULT_TASKS_DIR_NAME = "eigent-harbor-tasks"
_SCHEMA_VERSION = "1.4"
_WORKDIR = "/app"
_BASE_IMAGE = "ubuntu:24.04"
_AGENT_TIMEOUT_SEC = 1800.0
_VERIFIER_TIMEOUT_SEC = 600.0
_BUILD_TIMEOUT_SEC = 600.0
_MAX_FILES = 5000
_MAX_TOTAL_BYTES = 200 * 1024 * 1024
# Fixed, so images and patches are reproducible.
_GIT_DATE = "2000-01-01T00:00:00+0000"
# Git stores and applies bytes exactly as they are.
_GIT_ATTRIBUTES = "* -text -filter -ident -working-tree-encoding"
# Regular file modes and whether they are executable.
_REGULAR_FILE_MODES = {"100644": False, "100755": True}
# Regenerable build caches and OS metadata never belong to a task.
_CACHE_DIRECTORIES = frozenset(
    {
        ".cache",
        ".mypy_cache",
        ".next",
        ".parcel-cache",
        ".pytest_cache",
        ".ruff_cache",
        ".turbo",
        "__pycache__",
        "node_modules",
    }
)
_SYSTEM_FILES = frozenset({".DS_Store", "Thumbs.db"})
# A file the Task never referenced is kept only when it is text this small.
_MAX_UNREFERENCED_TEXT_BYTES = 1024 * 1024
# Earlier Runs looked at for who wrote a starting file, newest first.
_MAX_EARLIER_RUNS = 100
# Every file left out of the environment, with its reason (build_cache,
# system_file, binary_unreferenced, large_unreferenced or
# other_session_output) and Git blob id,
# so a failure can be checked against what the agent did not have. It sits
# in the build context but is not copied into the image.
_OMITTED_LIST = "environment/omitted_files.json"
_PATH_TOKEN = re.compile(r"[^\s\"'`<>|;,()\[\]{}=\\]+")
_HOST_PATH = re.compile(r"/Users/|/home/|[A-Za-z]:\\")
_SECRET_NAMES = (
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "id_rsa*",
    "id_ecdsa*",
    "id_ed25519*",
    ".npmrc",
    ".netrc",
    "credentials",
    "credentials.json",
)
_NOT_SECRET_NAMES = (".env.example", ".env.sample", ".env.template")
# Anchored to the task root: unanchored patterns would drop workspace files
# on `harbor publish`.
_TASK_GITIGNORE = "/.DS_Store\n"

_SOLVE_SH = """#!/bin/bash
# Placeholder: no reference solution is written yet; it is drafted later, with the verifier.
echo "No reference solution is defined for this task yet." >&2
exit 1
"""

_TEST_SH = """#!/bin/bash
# Placeholder: no verifier is designed yet. Run with `harbor run ... --disable-verification`.
# It writes no reward on purpose, so a run without that flag fails instead of scoring.
echo "No verifier is defined for this task; run it with --disable-verification." >&2
exit 1
"""


class HarborTaskUnavailable(Exception):
    """A Run that cannot become a Harbor task; ``reason`` is a stable code."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class HarborTaskSource:
    run_id: str
    project_id: str
    repository_id: str
    base_commit: str
    target_commit: str


@dataclass(frozen=True)
class EarlierRun:
    """A Run before this one in the same Content Repository: its Session and
    the commits it started from and ended at."""

    project_id: str
    base_commit: str
    target_commit: str


@dataclass(frozen=True)
class HarborTaskInstruction:
    text: str
    notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class SavedHarborTask:
    name: str
    path: Path
    notes: tuple[str, ...]


@dataclass(frozen=True)
class _File:
    data: bytes
    executable: bool


@dataclass(frozen=True)
class _OmittedFile:
    entry: GitTreeEntry
    reason: str


def task_directory_name(run_id: str) -> str:
    """The folder a Run's Harbor task is saved in, under the tasks root."""

    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", run_id).strip("-._")
    return f"task-{slug or 'run'}"


def harbor_tasks_root() -> Path:
    """Where saved tasks go; Electron passes the user's Downloads folder."""

    configured = os.environ.get(HARBOR_TASKS_DIR_ENV, "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / "Downloads" / _DEFAULT_TASKS_DIR_NAME


def resolve_harbor_task_source(journal, run_id: str) -> HarborTaskSource:
    """Check that a Run completed, changed files and recorded both commits."""

    run = journal.get_run(run_id)
    if run is None:
        raise HarborTaskUnavailable(
            "run_not_found", f"Run {run_id!r} does not exist"
        )
    if run.status != "completed":
        raise HarborTaskUnavailable(
            "run_not_completed", f"Run {run_id!r} is {run.status}"
        )
    materialization = journal.get_run_git_materialization(run_id)
    if materialization is None:
        raise HarborTaskUnavailable(
            "run_git_not_recorded",
            "The Run has no recorded Content Repository commits",
        )
    base_commit = materialization.workspace_base_commit
    target_commit = materialization.promoted_commit
    if base_commit is None or target_commit is None:
        raise HarborTaskUnavailable(
            "run_git_not_finalized",
            "The Run's Content Repository commits are not finalized",
        )
    if base_commit == target_commit:
        raise HarborTaskUnavailable(
            "run_changed_no_files", "The Run changed no files"
        )
    if not _user_messages(journal, run_id):
        raise HarborTaskUnavailable(
            "run_has_no_user_message", "The Run has no user message"
        )
    return HarborTaskSource(
        run_id=run_id,
        project_id=run.project_id,
        repository_id=materialization.repository_id,
        base_commit=base_commit,
        target_commit=target_commit,
    )


def run_instruction(
    journal, run_id: str, *, workspace_root: Path
) -> HarborTaskInstruction:
    """The user's own words for the Run, with workspace paths as ``/app``.

    The first message is the task. Later messages and text answers to the
    agent's questions follow in order; the agent's questions stay out, since
    they carry its own findings and decisions.
    """

    messages = _user_messages(journal, run_id)
    if not messages:
        raise HarborTaskUnavailable(
            "run_has_no_user_message", "The Run has no user message"
        )
    host_paths = {
        str(workspace_root): _WORKDIR,
        str(workspace_root.resolve()): _WORKDIR,
    }
    first, later = messages[0], messages[1:]
    additions = sorted(
        [
            (float(event.created_at), event.payload["content"].strip())
            for event in later
        ]
        + _user_answers(journal, run_id),
        key=lambda item: item[0],
    )
    parts = [_localize(first.payload["content"].strip(), host_paths)]
    parts += [
        "Additional input from the user:\n" + _localize(text, host_paths)
        for _, text in additions
    ]
    text = "\n\n".join(parts) + "\n"

    notes = []
    attachments = sorted(
        {
            name
            for event in messages
            for name in event.payload.get("attachment_names") or []
            if isinstance(name, str) and name
        }
    )
    if attachments:
        notes.append(
            "The user attached "
            + ", ".join(attachments)
            + "; attachments that were not files in the workspace are not "
            "included."
        )
    if _HOST_PATH.search(text):
        notes.append(
            "The instruction mentions paths on the user's computer outside "
            "the workspace."
        )
    return HarborTaskInstruction(text=text, notes=tuple(notes))


def run_reference_text(journal, run_id: str) -> str:
    """Every string the Run recorded: messages, tool calls, terminal output.

    It tells which workspace files the Task actually referenced.
    """

    return "\n".join(
        text
        for event in journal.list_events(run_id)
        for text in _strings(event.payload)
    )


def run_request_text(journal, run_id: str) -> str:
    """What the user wrote and the arguments of the tools the agent called,
    without any tool's output: a file named here was asked for or used, not
    only listed in a directory."""

    texts = [
        event.payload["content"] for event in _user_messages(journal, run_id)
    ]
    texts += [reply for _, reply in _user_answers(journal, run_id)]
    for event in journal.list_events(run_id, event_type_prefix="tool."):
        if event.event_type == "tool.dispatched":
            texts.extend(_strings(event.payload.get("request")))
    return "\n".join(texts)


def earlier_runs(journal, source: HarborTaskSource) -> tuple[EarlierRun, ...]:
    """The Runs before this one in its Content Repository, from every
    Session, newest first, that changed files."""

    current = journal.get_run_git_materialization(source.run_id)
    before = current.created_at if current is not None else float("inf")
    runs = sorted(
        (
            item
            for item in journal.list_run_git_materializations()
            if item.repository_id == source.repository_id
            and item.run_id != source.run_id
            and item.created_at < before
            and item.workspace_base_commit
            and item.promoted_commit
            and item.workspace_base_commit != item.promoted_commit
        ),
        key=lambda item: item.created_at,
        reverse=True,
    )
    return tuple(
        EarlierRun(
            project_id=item.project_id,
            base_commit=item.workspace_base_commit,
            target_commit=item.promoted_commit,
        )
        for item in runs[:_MAX_EARLIER_RUNS]
    )


def save_harbor_task(
    *,
    git: GitBackend,
    repository_root: Path,
    source: HarborTaskSource,
    instruction: HarborTaskInstruction,
    reference_text: str,
    destination_root: Path,
    earlier: Iterable[EarlierRun] = (),
    request_text: str = "",
) -> SavedHarborTask:
    """Write the Harbor task for one Run and return where it was saved.

    The environment does not mirror the whole workspace: a task needs what
    its instruction depends on, not every byte that happened to be there. It
    keeps the files the Task changed or referenced (``reference_text``) and
    small text files such as source and configuration. Build caches, OS
    metadata, and binary or large files the Task never referenced are left
    out. So are files a Task in another Session of the Space wrote
    (``earlier``), since the Sessions share the folder, unless this Task
    changed them or the user or the agent's tool calls name them
    (``request_text``): a directory listing does not count. What the Run
    produced is not kept: the solution is written later.
    """

    start_entries, start_ignored = _task_files(
        git.tree_entries(repository_root, source.base_commit)
    )
    end_entries, _ = _task_files(
        git.tree_entries(repository_root, source.target_commit)
    )
    changed = {
        path
        for path in start_entries.keys() | end_entries.keys()
        if _identity(start_entries.get(path))
        != _identity(end_entries.get(path))
    }
    if not changed:
        raise HarborTaskUnavailable(
            "run_changed_no_files", "The Run changed no files"
        )
    referenced = _referenced_paths(
        start_entries, reference_text, repository_root
    )
    other_sessions = (
        _other_session_outputs(
            git, repository_root, start_entries, earlier, source.project_id
        )
        - changed
        - _referenced_paths(start_entries, request_text, repository_root)
    )
    needed = (changed | referenced) - other_sessions
    candidates = {
        path: entry
        for path, entry in start_entries.items()
        if path not in other_sessions
        and (
            path in needed
            or (entry.size_bytes or 0) <= _MAX_UNREFERENCED_TEXT_BYTES
        )
    }
    _check_budget(
        len(candidates),
        sum(entry.size_bytes or 0 for entry in candidates.values()),
    )

    omitted = [
        _OmittedFile(entry, _ignored_reason(entry.relative_path))
        for entry in start_ignored
    ]
    start: dict[str, _File] = {}
    for path, entry in start_entries.items():
        if path in other_sessions:
            omitted.append(_OmittedFile(entry, "other_session_output"))
            continue
        if path not in candidates:
            omitted.append(_OmittedFile(entry, "large_unreferenced"))
            continue
        data = _read_blob(git, repository_root, entry)
        if path in needed or _is_text(data):
            start[path] = _File(data, _REGULAR_FILE_MODES[entry.mode])
        else:
            omitted.append(_OmittedFile(entry, "binary_unreferenced"))

    omitted.sort(key=lambda item: item.entry.relative_path)
    omitted_bytes = sum(item.entry.size_bytes or 0 for item in omitted)

    directory_name = task_directory_name(source.run_id)
    name = f"eigent/{directory_name}"
    notes = [*instruction.notes]
    if omitted:
        notes.append(
            f"{len(omitted)} workspace files ({_format_bytes(omitted_bytes)}) "
            "are left out: build caches, binary or large files this Task "
            "never referenced, and what Tasks in other Sessions wrote. "
            f"{_OMITTED_LIST} lists each one."
        )
    secrets = sorted(path for path in start if _looks_like_secret(path))
    if secrets:
        notes.append(
            "Files that look like secrets are included: " + ", ".join(secrets)
        )
    final = destination_root / directory_name
    _write_task(
        final,
        name=name,
        source=source,
        instruction=instruction,
        start=start,
        omitted=omitted,
        notes=notes,
    )
    return SavedHarborTask(name=name, path=final, notes=tuple(notes))


def _user_messages(journal, run_id: str) -> list:
    return [
        event
        for event in journal.list_events(
            run_id, event_type_prefix="user.message"
        )
        if event.event_type == "user.message"
        and isinstance(event.payload.get("content"), str)
        and event.payload["content"].strip()
    ]


def _user_answers(journal, run_id: str) -> list[tuple[float, str]]:
    answers = []
    for interaction in journal.list_human_interactions(run_id):
        if interaction.interaction_type != "question":
            continue
        for decision in journal.list_human_interaction_decisions(
            interaction.interaction_id
        ):
            if decision.actor_type != "user":
                continue
            reply = decision.decision.get(
                "reply", decision.decision.get("decision")
            )
            if isinstance(reply, str) and reply.strip():
                answers.append((float(decision.created_at), reply.strip()))
    return answers


def _localize(text: str, host_paths: Mapping[str, str]) -> str:
    """Map host paths to container paths; a host path matches only whole:
    ``/a/ws`` maps in ``/a/ws/x`` but not in ``/a/ws-old/x``."""

    for host, container in sorted(
        host_paths.items(), key=lambda item: -len(item[0])
    ):
        host = host.rstrip("/\\")
        if not host:
            continue
        text = re.sub(
            re.escape(host) + r"(?![\w-]|\.[\w-])",
            lambda _match: container,
            text,
        )
    return text


def _strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _strings(item)


def _other_session_outputs(
    git: GitBackend,
    root: Path,
    start_entries: Mapping[str, GitTreeEntry],
    earlier: Iterable[EarlierRun],
    project_id: str,
) -> set[str]:
    """Starting files whose content a Run in another Session wrote. The
    newest Run that wrote a file's current content decides; a file no Run
    wrote, or one edited since, is the user's."""

    trees: dict[str, dict[str, GitTreeEntry]] = {}

    def tree(commit: str) -> dict[str, GitTreeEntry]:
        if commit not in trees:
            trees[commit] = {
                entry.relative_path: entry
                for entry in git.tree_entries(root, commit)
            }
        return trees[commit]

    unknown = {path: entry.oid for path, entry in start_entries.items()}
    writers: dict[str, str] = {}
    for run in earlier:
        if not unknown:
            break
        try:
            before, after = tree(run.base_commit), tree(run.target_commit)
        except GitBackendError:
            continue  # a commit that is gone: this Run tells nothing
        for path, oid in list(unknown.items()):
            written = after.get(path)
            if written is None or written.oid != oid:
                continue
            original = before.get(path)
            if original is not None and original.oid == oid:
                continue
            writers[path] = run.project_id
            del unknown[path]
    return {path for path, writer in writers.items() if writer != project_id}


def _ignored_reason(path: str) -> str:
    return (
        "system_file"
        if PurePosixPath(path).name in _SYSTEM_FILES
        else "build_cache"
    )


def _is_ignored_path(path: str) -> bool:
    parts = PurePosixPath(path).parts
    return parts[-1] in _SYSTEM_FILES or any(
        part in _CACHE_DIRECTORIES for part in parts[:-1]
    )


def _task_files(
    entries: Iterable[GitTreeEntry],
) -> tuple[dict[str, GitTreeEntry], list[GitTreeEntry]]:
    """Regular files that may belong to a task, and the cache files left out."""

    files: dict[str, GitTreeEntry] = {}
    ignored: list[GitTreeEntry] = []
    for entry in entries:
        if _is_ignored_path(entry.relative_path):
            ignored.append(entry)
            continue
        if (
            entry.object_type != "blob"
            or entry.mode not in _REGULAR_FILE_MODES
        ):
            kind = (
                "a submodule"
                if entry.object_type == "commit"
                else "a symbolic link"
            )
            raise HarborTaskUnavailable(
                "unsupported_file_type",
                f"{entry.relative_path} is {kind}, which Harbor tasks "
                "saved by Eigent do not support yet",
            )
        files[entry.relative_path] = entry
    return files, ignored


def _identity(entry: GitTreeEntry | None) -> tuple[str, str] | None:
    return None if entry is None else (entry.oid, entry.mode)


def _referenced_paths(paths: Iterable[str], text: str, root: Path) -> set[str]:
    """Workspace paths the Task's own record mentions.

    A path counts when it appears whole (relative, absolute, or as
    ``path:line``), or when its file name appears and no other workspace
    file has that name, as in a directory listing.
    """

    prefixes = {
        str(root).rstrip("/") + "/",
        str(root.resolve()).rstrip("/") + "/",
    }
    mentioned = set()
    for token in _PATH_TOKEN.findall(text):
        token = re.sub(r"(:\d+)+$", "", token.rstrip(".,:"))
        for prefix in prefixes:
            if token.startswith(prefix):
                token = token[len(prefix) :]
                break
        token = token.removeprefix("./")
        if token:
            mentioned.add(token)
    mentioned_names = {PurePosixPath(token).name for token in mentioned}
    paths = list(paths)
    name_counts = Counter(PurePosixPath(path).name for path in paths)
    referenced = set()
    for path in paths:
        name = PurePosixPath(path).name
        unique_name = name_counts[name] == 1
        if path in mentioned or (unique_name and name in mentioned_names):
            referenced.add(path)
        elif any(character.isspace() for character in path) and (
            path in text or (unique_name and name in text)
        ):
            # Tokens split on whitespace, so match such names directly.
            referenced.add(path)
    return referenced


def _is_text(data: bytes) -> bool:
    if b"\0" in data[:8192]:
        return False
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


def _format_bytes(size: int) -> str:
    if size < 1024:
        return f"{size} bytes"
    value = float(size)
    for unit in ("KB", "MB"):
        value /= 1024
        if value < 1024:
            return f"{value:.1f} {unit}"
    return f"{value / 1024:.1f} GB"


def _check_budget(file_count: int, total_bytes: int) -> None:
    if file_count > _MAX_FILES or total_bytes > _MAX_TOTAL_BYTES:
        raise HarborTaskUnavailable(
            "workspace_too_large",
            f"The task needs {file_count} files and {total_bytes} bytes; "
            f"the limit is {_MAX_FILES} files and {_MAX_TOTAL_BYTES} bytes",
        )


def _read_blob(git: GitBackend, root: Path, entry: GitTreeEntry) -> bytes:
    size = entry.size_bytes or 0
    if size == 0:
        return b""
    data = git.read_blob_range(root, entry.oid, start_offset=0, max_bytes=size)
    if len(data) != size:
        raise GitBackendError(f"Git returned a short blob for {entry.oid}")
    return data


def _looks_like_secret(path: str) -> bool:
    name = PurePosixPath(path).name
    return name not in _NOT_SECRET_NAMES and any(
        fnmatch.fnmatchcase(name, pattern) for pattern in _SECRET_NAMES
    )


def _write_task(
    final: Path,
    *,
    name: str,
    source: HarborTaskSource,
    instruction: HarborTaskInstruction,
    start: Mapping[str, _File],
    omitted: list[_OmittedFile],
    notes: list[str],
) -> None:
    final.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=f".{final.name}.", dir=final.parent))
    try:
        environment = tmp / "environment"
        _write_files(environment / "workspace", start)
        (environment / "Dockerfile").write_text(
            _dockerfile(has_files=bool(start)), encoding="utf-8"
        )
        (tmp / _OMITTED_LIST).write_text(
            _omitted_list(source, omitted), encoding="utf-8"
        )
        (tmp / "instruction.md").write_text(instruction.text, encoding="utf-8")
        solution = tmp / "solution"
        solution.mkdir()
        _write_script(solution / "solve.sh", _SOLVE_SH)
        tests = tmp / "tests"
        tests.mkdir()
        _write_script(tests / "test.sh", _TEST_SH)
        (tmp / "task.toml").write_text(
            _task_toml(name, source, instruction, omitted, notes),
            encoding="utf-8",
        )
        (tmp / "README.md").write_text(
            _readme(name, source, instruction, notes), encoding="utf-8"
        )
        (tmp / ".gitignore").write_text(_TASK_GITIGNORE, encoding="utf-8")
        tmp.chmod(0o755)
        if final.exists():
            shutil.rmtree(final)
        tmp.rename(final)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def _write_files(root: Path, files: Mapping[str, _File]) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    for relative_path, file in files.items():
        target = root.joinpath(*PurePosixPath(relative_path).parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(file.data)
        if file.executable:
            target.chmod(0o755)
    return root


def _write_script(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def _dockerfile(*, has_files: bool) -> str:
    copy = f"COPY workspace/ {_WORKDIR}/\n" if has_files else ""
    return f"""FROM {_BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8 PYTHONIOENCODING=utf-8

# Tools Eigent's agent uses (python3, node, git, ripgrep) plus what Harbor's installed agents
# check for at setup (curl, npm, procps, tmux, asciinema), so trials skip apt-get.
RUN apt-get update \\
    && apt-get install -y --no-install-recommends \\
        asciinema bash ca-certificates curl git nodejs npm procps python3 ripgrep tmux \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR {_WORKDIR}
{copy}
# Eigent workspaces are git repositories: start from one commit holding every file byte for byte.
RUN git init -q -b main \\
    && echo '{_GIT_ATTRIBUTES}' > .git/info/attributes \\
    && git add -A --force \\
    && GIT_AUTHOR_DATE='{_GIT_DATE}' GIT_COMMITTER_DATE='{_GIT_DATE}' \\
       git -c user.name=workspace -c user.email=workspace@localhost commit -q --allow-empty -m 'Initial workspace'
"""


def _omitted_list(
    source: HarborTaskSource, omitted: list[_OmittedFile]
) -> str:
    return (
        json.dumps(
            {
                "base_commit": source.base_commit,
                "files": [
                    {
                        "path": item.entry.relative_path,
                        "size_bytes": item.entry.size_bytes or 0,
                        "reason": item.reason,
                        "git_oid": item.entry.oid,
                    }
                    for item in omitted
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )


def _toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        # JSON escapes are valid TOML, except a raw DEL.
        return json.dumps(value, ensure_ascii=False).replace("\x7f", "\\u007f")
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(item) for item in value) + "]"
    if isinstance(value, dict):
        return (
            "{ "
            + ", ".join(f"{k} = {_toml_value(v)}" for k, v in value.items())
            + " }"
        )
    raise TypeError(f"cannot write {value!r} as TOML")


def _dump_toml(document: Mapping[str, Any], prefix: str = "") -> str:
    """Scalars first, then sub-tables; None values are left out. Keys must
    be bare."""

    scalars = [
        f"{key} = {_toml_value(value)}"
        for key, value in document.items()
        if value is not None and not isinstance(value, dict)
    ]
    text = (f"\n[{prefix}]\n" if prefix and scalars else "") + "".join(
        line + "\n" for line in scalars
    )
    for key, value in document.items():
        if isinstance(value, dict):
            text += _dump_toml(value, f"{prefix}.{key}" if prefix else key)
    return text


def _task_toml(
    name: str,
    source: HarborTaskSource,
    instruction: HarborTaskInstruction,
    omitted: list[_OmittedFile],
    notes: list[str],
) -> str:
    return _dump_toml(
        {
            "schema_version": _SCHEMA_VERSION,
            "source": f"eigent:run/{source.run_id}",
            "artifacts": [
                {
                    "source": _WORKDIR,
                    "destination": "workspace",
                    "exclude": [".git", "node_modules"],
                }
            ],
            "task": {
                "name": name,
                "version": "1.0.0",
                "description": " ".join(instruction.text.split())[:200],
                "keywords": ["eigent", "user-query"],
            },
            "metadata": {
                "eigent": {
                    "run_id": source.run_id,
                    "project_id": source.project_id,
                    "base_commit": source.base_commit,
                    "target_commit": source.target_commit,
                    "starting_files": (
                        "files the Task changed or referenced, plus small "
                        "text files, from the Content Repository commit "
                        "before the Run, without what Tasks in other "
                        "Sessions wrote"
                    ),
                    "omitted_files": len(omitted),
                    "omitted_bytes": sum(
                        item.entry.size_bytes or 0 for item in omitted
                    ),
                    "omitted_list": _OMITTED_LIST,
                    "verifier": "none",
                    "notes": notes,
                }
            },
            "verifier": {
                "timeout_sec": _VERIFIER_TIMEOUT_SEC,
                "environment_mode": "separate",
            },
            "agent": {"timeout_sec": _AGENT_TIMEOUT_SEC},
            "environment": {
                "build_timeout_sec": _BUILD_TIMEOUT_SEC,
                "os": "linux",
                "network_mode": "public",
            },
        }
    )


def _readme(
    name: str,
    source: HarborTaskSource,
    instruction: HarborTaskInstruction,
    notes: list[str],
) -> str:
    lines = [
        f"# {name}",
        "",
        f"Saved by Eigent from Task `{source.run_id}` in Session "
        f"`{source.project_id}`.",
        "",
        f"`{_WORKDIR}` starts as the workspace before the Task, keeping "
        "only what the task needs: the files the Task changed or "
        "referenced, plus small text files such as source and "
        "configuration. Files that Tasks in other Sessions of the Space "
        "wrote are left out unless this Task used them.",
        "",
        "## instruction.md",
        "",
        "````text",
        instruction.text.rstrip(),
        "````",
        "",
        "## Notes",
        "",
        *[f"- {note}" for note in notes],
        f"- Environment: `{_BASE_IMAGE}`; the starting files are in "
        f"`{_WORKDIR}` as one git commit.",
        "- No verifier or reference solution yet: `tests/test.sh` and "
        "`solution/solve.sh` are placeholders, so run with "
        "`harbor run -p <this folder> --disable-verification`.",
        f"- The verifier runs separately and gets only `{_WORKDIR}` from the "
        "agent.",
    ]
    return "\n".join(lines) + "\n"
