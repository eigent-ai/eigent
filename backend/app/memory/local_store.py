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

"""Local filesystem-backed memory store (§22.1 of design doc).

Owns ~/.eigent/memory/users/<owner>/... layout. All small JSON files are
written atomically (tmp + os.replace). Append-only *.jsonl files are protected
by a per-path threading.Lock so concurrent writers in the same Brain process
do not interleave lines (cross-process writes are out of scope -- single Brain
per user is the design invariant).

Reads tolerate missing files: return None for `read_project`/`read_space`,
return [] for list-returning helpers. First-time callers do not need a
special "init" step -- writes auto-create parent directories.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import weakref
from dataclasses import asdict, fields, is_dataclass
from pathlib import Path
from typing import Any, TypeVar

from app.memory.events import (
    ConversationEvent,
    MemoryArtifact,
    MemoryFact,
    ProjectMemory,
    RunMemory,
    RunStatus,
    SpaceMemory,
    SyncSettings,
    ToolEvent,
)
from app.memory.paths import (
    memory_root,
    project_dir,
    run_dir,
    space_dir,
    user_dir,
)

logger = logging.getLogger("memory.local_store")

T = TypeVar("T")

# Per-path locks so two coroutines / threads cannot interleave lines in the
# same jsonl file. WeakValueDictionary so unused locks GC after their last
# holder releases.
_PATH_LOCKS: weakref.WeakValueDictionary[str, threading.Lock] = (
    weakref.WeakValueDictionary()
)
_PATH_LOCKS_GUARD = threading.Lock()


def _path_lock(path: Path) -> threading.Lock:
    key = str(path)
    with _PATH_LOCKS_GUARD:
        lock = _PATH_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _PATH_LOCKS[key] = lock
        return lock


def _atomic_write_text(path: Path, text: str) -> None:
    """Write `text` to `path` atomically. Parent dirs created on demand."""

    path.parent.mkdir(parents=True, exist_ok=True)
    # delete=False so we control the rename; suffix keeps inspection easy if
    # the process crashes between flush and replace.
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as tmp:
        tmp.write(text)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_name = tmp.name
    os.replace(tmp_name, path)


def _atomic_write_json(path: Path, payload: Any) -> None:
    _atomic_write_text(path, json.dumps(payload, indent=2, ensure_ascii=False))


def _read_json(path: Path) -> Any | None:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError:
        logger.warning(
            "memory.local_store: failed to read %s", path, exc_info=True
        )
        return None
    if not text.strip():
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning(
            "memory.local_store: malformed JSON at %s; treating as missing",
            path,
        )
        return None


def _filter_known_fields(
    cls: type[T], payload: dict[str, Any]
) -> dict[str, Any]:
    """Drop unknown keys before instantiating a dataclass.

    Lets us evolve the schema by adding fields without rejecting older files.
    Unknown keys are dropped silently; missing required fields raise from the
    dataclass constructor (caller handles).
    """

    if not is_dataclass(cls):
        return payload
    known = {f.name for f in fields(cls)}
    return {k: v for k, v in payload.items() if k in known}


def _from_dataclass_payload(cls: type[T], payload: Any) -> T | None:
    if not isinstance(payload, dict):
        return None
    cleaned = _filter_known_fields(cls, payload)
    # Nested SyncSettings on SpaceMemory / ProjectMemory
    if cls in (SpaceMemory, ProjectMemory) and isinstance(
        cleaned.get("sync"), dict
    ):
        cleaned["sync"] = SyncSettings(
            **_filter_known_fields(SyncSettings, cleaned["sync"])
        )
    try:
        return cls(**cleaned)
    except TypeError:
        logger.warning(
            "memory.local_store: payload at incompatible shape for %s; ignoring",
            cls.__name__,
        )
        return None


def _to_dataclass_dict(value: Any) -> Any:
    """asdict() variant that handles our top-level dataclasses safely."""

    if is_dataclass(value):
        return asdict(value)
    return value


def _append_jsonl(path: Path, payload: Any) -> None:
    """Append one JSON line to `path`, atomic-per-line under a per-path lock."""

    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(payload, ensure_ascii=False) + "\n"
    with _path_lock(path):
        with path.open("a", encoding="utf-8") as fh:
            fh.write(line)
            fh.flush()
            os.fsync(fh.fileno())


def _read_jsonl_lines(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    logger.warning(
                        "memory.local_store: skipping malformed jsonl line in %s",
                        path,
                    )
    except OSError:
        logger.warning(
            "memory.local_store: failed to read %s", path, exc_info=True
        )
        return []
    return out


class LocalMemoryStore:
    """Filesystem-backed Project memory store.

    Construction is cheap and does NOT touch the filesystem -- writes lazily
    create the directory tree on demand. Pass a custom `root` to redirect the
    whole tree for tests; default is `~/.eigent/memory`.
    """

    def __init__(self, root: Path | None = None) -> None:
        self._root = root or memory_root()

    @property
    def root(self) -> Path:
        return self._root

    # ----- Path helpers (exposed for tests / debug logging) -----

    def user_path(self, user_key: str) -> Path:
        return user_dir(user_key, self._root)

    def space_path(self, user_key: str, space_id: str) -> Path:
        return space_dir(user_key, space_id, self._root)

    def project_path(
        self, user_key: str, space_id: str, project_id: str
    ) -> Path:
        return project_dir(user_key, space_id, project_id, self._root)

    def run_path(
        self,
        user_key: str,
        space_id: str,
        project_id: str,
        run_id: str,
    ) -> Path:
        return run_dir(user_key, space_id, project_id, run_id, self._root)

    # ----- Space-level -----

    def read_space(self, user_key: str, space_id: str) -> SpaceMemory | None:
        payload = _read_json(
            self.space_path(user_key, space_id) / "space.json"
        )
        return _from_dataclass_payload(SpaceMemory, payload)

    def write_space(self, user_key: str, payload: SpaceMemory) -> None:
        target = self.space_path(user_key, payload.space_id) / "space.json"
        _atomic_write_json(target, _to_dataclass_dict(payload))

    # ----- Project-level -----

    def read_project(
        self, user_key: str, space_id: str, project_id: str
    ) -> ProjectMemory | None:
        payload = _read_json(
            self.project_path(user_key, space_id, project_id) / "project.json"
        )
        return _from_dataclass_payload(ProjectMemory, payload)

    def write_project(self, user_key: str, payload: ProjectMemory) -> None:
        target = (
            self.project_path(user_key, payload.space_id, payload.project_id)
            / "project.json"
        )
        _atomic_write_json(target, _to_dataclass_dict(payload))

    def append_conversation(
        self,
        user_key: str,
        space_id: str,
        project_id: str,
        event: ConversationEvent,
    ) -> None:
        target = (
            self.project_path(user_key, space_id, project_id)
            / "conversation.jsonl"
        )
        _append_jsonl(target, asdict(event))

    def read_conversation_tail(
        self,
        user_key: str,
        space_id: str,
        project_id: str,
        limit: int,
    ) -> list[ConversationEvent]:
        if limit <= 0:
            return []
        target = (
            self.project_path(user_key, space_id, project_id)
            / "conversation.jsonl"
        )
        rows = _read_jsonl_lines(target)
        if not rows:
            return []
        tail = rows[-limit:]
        out: list[ConversationEvent] = []
        for row in tail:
            event = _from_dataclass_payload(ConversationEvent, row)
            if event is not None:
                out.append(event)
        return out

    def read_project_summary(
        self, user_key: str, space_id: str, project_id: str
    ) -> str:
        path = self.project_path(user_key, space_id, project_id) / "summary.md"
        try:
            return path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return ""
        except OSError:
            logger.warning(
                "memory.local_store: failed to read project summary %s",
                path,
                exc_info=True,
            )
            return ""

    def write_project_summary(
        self,
        user_key: str,
        space_id: str,
        project_id: str,
        text: str,
    ) -> None:
        path = self.project_path(user_key, space_id, project_id) / "summary.md"
        _atomic_write_text(path, text)

    def read_facts(
        self, user_key: str, space_id: str, project_id: str
    ) -> list[MemoryFact]:
        payload = _read_json(
            self.project_path(user_key, space_id, project_id) / "facts.json"
        )
        if not isinstance(payload, dict):
            return []
        rows = payload.get("facts", [])
        out: list[MemoryFact] = []
        for row in rows if isinstance(rows, list) else []:
            fact = _from_dataclass_payload(MemoryFact, row)
            if fact is not None:
                out.append(fact)
        return out

    def upsert_fact(
        self,
        user_key: str,
        space_id: str,
        project_id: str,
        fact: MemoryFact,
    ) -> None:
        path = self.project_path(user_key, space_id, project_id) / "facts.json"
        with _path_lock(path):
            payload = _read_json(path)
            rows = (
                payload.get("facts", []) if isinstance(payload, dict) else []
            )
            existing: list[MemoryFact] = []
            for row in rows if isinstance(rows, list) else []:
                existing_fact = _from_dataclass_payload(MemoryFact, row)
                if existing_fact is not None:
                    existing.append(existing_fact)
            by_id = {f.fact_id: f for f in existing}
            by_id[fact.fact_id] = fact
            _atomic_write_json(
                path, {"facts": [asdict(f) for f in by_id.values()]}
            )

    def read_artifacts(
        self, user_key: str, space_id: str, project_id: str
    ) -> list[MemoryArtifact]:
        payload = _read_json(
            self.project_path(user_key, space_id, project_id)
            / "artifacts.json"
        )
        if not isinstance(payload, dict):
            return []
        rows = payload.get("artifacts", [])
        out: list[MemoryArtifact] = []
        for row in rows if isinstance(rows, list) else []:
            artifact = _from_dataclass_payload(MemoryArtifact, row)
            if artifact is not None:
                out.append(artifact)
        return out

    def upsert_artifact(
        self,
        user_key: str,
        space_id: str,
        project_id: str,
        artifact: MemoryArtifact,
    ) -> None:
        path = (
            self.project_path(user_key, space_id, project_id)
            / "artifacts.json"
        )
        with _path_lock(path):
            payload = _read_json(path)
            rows = (
                payload.get("artifacts", [])
                if isinstance(payload, dict)
                else []
            )
            existing: list[MemoryArtifact] = []
            for row in rows if isinstance(rows, list) else []:
                existing_artifact = _from_dataclass_payload(
                    MemoryArtifact, row
                )
                if existing_artifact is not None:
                    existing.append(existing_artifact)
            by_id = {a.artifact_id: a for a in existing}
            by_id[artifact.artifact_id] = artifact
            _atomic_write_json(
                path, {"artifacts": [asdict(a) for a in by_id.values()]}
            )

    # ----- Run-level -----

    def write_run(self, user_key: str, payload: RunMemory) -> None:
        target = (
            self.run_path(
                user_key, payload.space_id, payload.project_id, payload.run_id
            )
            / "run.json"
        )
        _atomic_write_json(target, _to_dataclass_dict(payload))

    def read_run(
        self,
        user_key: str,
        space_id: str,
        project_id: str,
        run_id: str,
    ) -> RunMemory | None:
        payload = _read_json(
            self.run_path(user_key, space_id, project_id, run_id) / "run.json"
        )
        return _from_dataclass_payload(RunMemory, payload)

    def append_tool_event(
        self,
        user_key: str,
        space_id: str,
        project_id: str,
        run_id: str,
        event: ToolEvent,
    ) -> None:
        target = (
            self.run_path(user_key, space_id, project_id, run_id)
            / "tool_events.jsonl"
        )
        _append_jsonl(target, asdict(event))

    def write_run_status(
        self,
        user_key: str,
        space_id: str,
        project_id: str,
        run_id: str,
        status: RunStatus,
    ) -> None:
        target = (
            self.run_path(user_key, space_id, project_id, run_id)
            / "status.json"
        )
        _atomic_write_json(target, _to_dataclass_dict(status))

    def read_run_status(
        self,
        user_key: str,
        space_id: str,
        project_id: str,
        run_id: str,
    ) -> RunStatus | None:
        payload = _read_json(
            self.run_path(user_key, space_id, project_id, run_id)
            / "status.json"
        )
        return _from_dataclass_payload(RunStatus, payload)

    def write_run_summary(
        self,
        user_key: str,
        space_id: str,
        project_id: str,
        run_id: str,
        text: str,
    ) -> None:
        path = (
            self.run_path(user_key, space_id, project_id, run_id)
            / "summary.md"
        )
        _atomic_write_text(path, text)
