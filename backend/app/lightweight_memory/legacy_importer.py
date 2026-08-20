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
# Licensed under the Apache License, Version 2.0 (the "License");

"""Conservative, idempotent LocalMemory V1 -> lightweight Memory import.

Only explicit V1 facts are candidates. Conversation JSONL, summaries, Run
status, tool output and artifacts remain History/projection data and are never
promoted into editable Memory by this importer.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.lightweight_memory.service import (
    LightweightMemoryService,
    get_lightweight_memory_service,
    stable_memory_id,
)

logger = logging.getLogger("legacy_memory_v1_import")

_MAX_FACT_FILE_BYTES = 1024 * 1024
_MAX_FACTS_PER_FILE = 256
_MAX_CONTENT_CHARS = 8192


@dataclass(frozen=True)
class LegacyMemoryImportResult:
    status: str
    scanned_files: int = 0
    imported_count: int = 0
    skipped_count: int = 0
    degraded_files: int = 0


class LegacyMemoryV1Importer:
    def __init__(
        self,
        service: LightweightMemoryService,
        *,
        root: Path,
    ) -> None:
        self.service = service
        self.journal = service.journal
        self.root = root

    def run(self) -> LegacyMemoryImportResult:
        if not self.root.exists():
            return LegacyMemoryImportResult(status="not_applicable")
        scanned = imported = skipped = degraded = 0
        candidates = sorted(
            self.root.glob("users/*/spaces/*/projects/*/facts.json")
        )
        for path in candidates[:2000]:
            scanned += 1
            result = self._import_file(path)
            imported += result[0]
            skipped += result[1]
            degraded += int(result[2])
        return LegacyMemoryImportResult(
            status="degraded" if degraded else "completed",
            scanned_files=scanned,
            imported_count=imported,
            skipped_count=skipped,
            degraded_files=degraded,
        )

    def _import_file(self, path: Path) -> tuple[int, int, bool]:
        source_path = path.relative_to(self.root).as_posix()
        try:
            raw = path.read_bytes()
            if len(raw) > _MAX_FACT_FILE_BYTES:
                raise ValueError("legacy facts.json exceeds the import limit")
            checksum = hashlib.sha256(raw).hexdigest()
            if self.journal.has_legacy_memory_import(source_path, checksum):
                return (0, 0, False)
            payload = json.loads(raw.decode("utf-8"))
            rows = payload.get("facts") if isinstance(payload, dict) else None
            if not isinstance(rows, list):
                raise ValueError("legacy facts.json must contain a facts list")
            parts = path.parts
            space_marker = parts.index("spaces")
            project_marker = parts.index("projects")
            user_key = parts[parts.index("users") + 1]
            space_id = parts[space_marker + 1]
            project_id = parts[project_marker + 1]
            imported = skipped = 0
            for index, row in enumerate(rows[:_MAX_FACTS_PER_FILE]):
                if not isinstance(row, dict):
                    skipped += 1
                    continue
                if self._import_fact(
                    row,
                    index=index,
                    checksum=checksum,
                    user_key=user_key,
                    space_id=space_id,
                    project_id=project_id,
                ):
                    imported += 1
                else:
                    skipped += 1
            skipped += max(0, len(rows) - _MAX_FACTS_PER_FILE)
            self.journal.record_legacy_memory_import(
                source_path=source_path,
                source_checksum=checksum,
                status="completed",
                imported_count=imported,
                skipped_count=skipped,
            )
            return (imported, skipped, False)
        except Exception as exc:  # noqa: BLE001 - startup is fail-open
            checksum = hashlib.sha256(
                f"{source_path}:{type(exc).__name__}:{exc}".encode()
            ).hexdigest()
            try:
                self.journal.record_legacy_memory_import(
                    source_path=source_path,
                    source_checksum=checksum,
                    status="degraded",
                    imported_count=0,
                    skipped_count=0,
                    error=str(exc),
                )
            except Exception:  # pragma: no cover - diagnostic best effort
                pass
            logger.warning(
                "Legacy Memory import degraded for %s: %s", source_path, exc
            )
            return (0, 0, True)

    def _import_fact(
        self,
        row: dict[str, Any],
        *,
        index: int,
        checksum: str,
        user_key: str,
        space_id: str,
        project_id: str,
    ) -> bool:
        text = row.get("text")
        scope = row.get("scope")
        if (
            not isinstance(text, str)
            or not text.strip()
            or len(text) > _MAX_CONTENT_CHARS
            or scope not in {"project", "space"}
        ):
            return False
        fact_id = str(row.get("fact_id") or index)
        scope_id = project_id if scope == "project" else space_id
        memory_id = stable_memory_id(
            "legacy-v1", user_key, space_id, project_id, fact_id
        )
        if self.journal.get_memory_entry(memory_id) is not None:
            return False
        request_id = (
            f"legacy-memory-v1:{checksum[:24]}:"
            f"{hashlib.sha256(fact_id.encode()).hexdigest()[:16]}"
        )
        try:
            self.service.create_entry(
                scope_type=scope,
                scope_id=scope_id,
                kind="fact",
                content=text.strip(),
                actor_type="importer",
                reason="Imported from LocalMemory V1 facts",
                source_trust="legacy_unverified",
                source_refs=(f"legacy-memory:{checksum[:20]}",),
                memory_id=memory_id,
                request_id=request_id,
                actor_id="legacy-memory-v1-importer",
            )
            return True
        except Exception:  # invalid/secret/capacity entries are safe to skip
            logger.info(
                "Skipped one unsupported LocalMemory V1 fact",
                extra={"scope_type": scope, "scope_id": scope_id},
            )
            return False


def migrate_legacy_memory_v1_on_startup(
    *,
    root: Path | None = None,
) -> LegacyMemoryImportResult:
    return LegacyMemoryV1Importer(
        get_lightweight_memory_service(),
        root=root or Path.home() / ".eigent" / "memory",
    ).run()
