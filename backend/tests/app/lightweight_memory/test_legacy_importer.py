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

from __future__ import annotations

import json

from app.lightweight_memory import (
    LegacyMemoryV1Importer,
    LightweightMemoryService,
)
from app.run_journal import SQLiteRunJournal


def _legacy_project(root):
    path = (
        root
        / "users"
        / "user-1"
        / "spaces"
        / "space-1"
        / "projects"
        / "project-1"
    )
    path.mkdir(parents=True)
    return path


def test_importer_only_copies_v1_facts_and_is_idempotent(tmp_path):
    root = tmp_path / "memory"
    project = _legacy_project(root)
    (project / "facts.json").write_text(
        json.dumps(
            {
                "facts": [
                    {
                        "fact_id": "project-fact",
                        "text": "Use PostgreSQL for Cloud History.",
                        "scope": "project",
                    },
                    {
                        "fact_id": "space-fact",
                        "text": "Workspace reports use ISO dates.",
                        "scope": "space",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    (project / "conversation.jsonl").write_text(
        '{"content":"raw transcript must not become Memory"}\n',
        encoding="utf-8",
    )
    (project / "summary.md").write_text(
        "A large rolling summary that must not become Memory.",
        encoding="utf-8",
    )

    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        importer = LegacyMemoryV1Importer(
            LightweightMemoryService(journal), root=root
        )
        first = importer.run()
        second = importer.run()

        assert first.imported_count == 2
        assert second.imported_count == 0
        project_entries = journal.list_memory_entries("project", "project-1")
        space_entries = journal.list_memory_entries("space", "space-1")
        assert [item.content for item in project_entries] == [
            "Use PostgreSQL for Cloud History."
        ]
        assert [item.content for item in space_entries] == [
            "Workspace reports use ISO dates."
        ]
        assert {
            item.source_trust for item in (*project_entries, *space_entries)
        } == {"legacy_unverified"}
        assert all(
            "raw transcript" not in item.content
            for item in (*project_entries, *space_entries)
        )


def test_importer_degrades_bad_files_and_skips_secrets_without_blocking(
    tmp_path,
):
    root = tmp_path / "memory"
    project = _legacy_project(root)
    (project / "facts.json").write_text(
        json.dumps(
            {
                "facts": [
                    {
                        "fact_id": "secret",
                        "text": "API_KEY=sk-live-123456789012345678901234",
                        "scope": "project",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        importer = LegacyMemoryV1Importer(
            LightweightMemoryService(journal), root=root
        )
        result = importer.run()
        assert result.status == "completed"
        assert result.imported_count == 0
        assert result.skipped_count == 1

        (project / "facts.json").write_text("not-json", encoding="utf-8")
        degraded = importer.run()
        assert degraded.status == "degraded"
        assert degraded.degraded_files == 1
