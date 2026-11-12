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

import sqlite3

import pytest

from app.run_journal import SCHEMA_VERSION, SQLiteRunJournal

_V42_INTENTS = """
CREATE TABLE git_mutation_intents (
    intent_id TEXT PRIMARY KEY,
    change_set_id TEXT NOT NULL REFERENCES git_change_sets(
        change_set_id
    ) ON DELETE CASCADE,
    operation_request_id TEXT NOT NULL,
    mutation_scope TEXT NOT NULL CHECK (
        mutation_scope IN ('exact_path', 'broad_process')
    ),
    relative_path TEXT,
    preimage_digest TEXT,
    actor_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'prepared' CHECK (
        status IN ('prepared', 'completed', 'needs_attention')
    ),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(change_set_id, operation_request_id),
    CHECK (
        (mutation_scope = 'exact_path' AND relative_path IS NOT NULL)
        OR (mutation_scope = 'broad_process' AND relative_path IS NULL)
    )
);
CREATE INDEX git_mutation_intents_reconcile_idx
ON git_mutation_intents(status, updated_at, change_set_id);
"""


def _seed(journal: SQLiteRunJournal) -> None:
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    journal.put_git_repository(
        repository_id="repo-1",
        space_id="space-1",
        repository_role="content",
        root_path="/tmp/space",
        root_path_digest="0" * 64,
        ownership="eigent_owned",
        state="ready",
        version_coverage="managed_files_only",
    )
    # A quarantined ChangeSet as a v42 journal left it after restart.
    journal._connection.execute(
        """INSERT INTO git_change_sets(
            change_set_id, run_id, repository_id, worktree_ref, base_commit,
            state, created_at, updated_at
        ) VALUES ('cs-1', 'run-1', 'repo-1', 'refs/heads/main', NULL,
                  'needs_attention', 1, 1)"""
    )
    journal._connection.commit()


def _downgrade_to_v42(path) -> list[tuple]:
    with sqlite3.connect(path) as connection:
        rows = connection.execute(
            "SELECT * FROM git_mutation_intents ORDER BY intent_id"
        ).fetchall()
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute("DROP TABLE git_mutation_intents")
        connection.executescript(_V42_INTENTS)
        connection.executemany(
            "INSERT INTO git_mutation_intents VALUES "
            "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        connection.execute(
            "DELETE FROM run_journal_migrations WHERE version = 43"
        )
        connection.execute("PRAGMA user_version = 42")
    return rows


def test_v43_keeps_every_intent_and_allows_abandoning_one(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        _seed(journal)
        for index, status in enumerate(("prepared", "needs_attention")):
            journal._connection.execute(
                """INSERT INTO git_mutation_intents(
                    intent_id, change_set_id, operation_request_id,
                    mutation_scope, relative_path, preimage_digest, actor_id,
                    trigger, status, created_at, updated_at
                ) VALUES (?, 'cs-1', ?, 'exact_path', 'a.txt', NULL,
                          'agent', 'filesystem.edit', ?, 1, 1)""",
                (f"intent-{index}", f"request-{index}", status),
            )
        journal._connection.commit()
    before = _downgrade_to_v42(path)
    with sqlite3.connect(path) as connection:
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE git_mutation_intents SET status = 'abandoned'"
            )

    with SQLiteRunJournal(path) as upgraded:
        assert upgraded.schema_version == SCHEMA_VERSION == 43
        connection = upgraded._connection
        assert [
            tuple(row)
            for row in connection.execute(
                "SELECT * FROM git_mutation_intents ORDER BY intent_id"
            ).fetchall()
        ] == before
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index' "
            "AND name = 'git_mutation_intents_reconcile_idx'"
        ).fetchone()
        abandoned = upgraded.abandon_git_mutation_intent(
            intent_id="intent-1", expected_status="needs_attention"
        )
        assert abandoned.status == "abandoned"
        # Another unresolved operation keeps the ChangeSet under review.
        (change_set,) = upgraded.list_git_change_sets()
        assert change_set.state == "needs_attention"
        upgraded.abandon_git_mutation_intent(
            intent_id="intent-0", expected_status="prepared"
        )
        (change_set,) = upgraded.list_git_change_sets()
        assert change_set.state == "discarded"

    with SQLiteRunJournal(path) as reopened:
        assert reopened.schema_version == 43
        assert {
            item.status for item in reopened.list_git_mutation_intents()
        } == {"abandoned"}


def test_abandoned_intent_is_terminal(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _seed(journal)
        journal._connection.execute(
            """INSERT INTO git_mutation_intents(
                intent_id, change_set_id, operation_request_id,
                mutation_scope, relative_path, preimage_digest, actor_id,
                trigger, status, created_at, updated_at
            ) VALUES ('intent-0', 'cs-1', 'request-0', 'broad_process', NULL,
                      NULL, 'agent', 'terminal.execute', 'needs_attention',
                      1, 1)"""
        )
        journal._connection.commit()
        journal.abandon_git_mutation_intent(
            intent_id="intent-0", expected_status="needs_attention"
        )
        for status in ("prepared", "completed", "needs_attention"):
            with pytest.raises(Exception, match="cannot transition"):
                journal.update_git_mutation_intent_status(
                    intent_id="intent-0",
                    expected_status="abandoned",
                    status=status,
                )


def _insert_item(journal, relative_path, operation_request_id) -> None:
    journal._connection.execute(
        """INSERT INTO git_change_set_items(
            change_set_id, relative_path, operation_request_id, actor_id,
            trigger, change_kind, source, item_state, created_at, updated_at
        ) VALUES ('cs-1', ?, ?, 'agent', 'test', 'modified',
                  'agent_modified', 'pending', 1, 1)""",
        (relative_path, operation_request_id),
    )


def _item_states(journal) -> dict[str, str]:
    return {
        item.relative_path: item.item_state
        for item in journal.list_git_change_set_items("cs-1")
    }


@pytest.mark.parametrize(
    ("scope", "relative_path", "trigger", "own_item"),
    [
        ("exact_path", "a.txt", "filesystem.edit", "a.txt"),
        ("broad_process", None, "terminal.execute", "b.txt"),
    ],
)
def test_abandoning_stops_tracking_only_its_own_items(
    tmp_path, scope, relative_path, trigger, own_item
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _seed(journal)
        journal._connection.execute(
            """INSERT INTO git_mutation_intents(
                intent_id, change_set_id, operation_request_id,
                mutation_scope, relative_path, preimage_digest, actor_id,
                trigger, status, created_at, updated_at
            ) VALUES ('intent-0', 'cs-1', 'request-0', ?, ?, NULL,
                      'agent', ?, 'needs_attention', 1, 1)""",
            (scope, relative_path, trigger),
        )
        # a.txt matches the exact path; b.txt was recorded by this
        # operation; c.txt belongs to another operation.
        _insert_item(journal, "a.txt", "request-other")
        _insert_item(journal, "b.txt", "request-0")
        _insert_item(journal, "c.txt", "request-other")
        journal._connection.commit()

        journal.abandon_git_mutation_intent(
            intent_id="intent-0", expected_status="needs_attention"
        )

        expected = {"a.txt": "pending", "b.txt": "pending", "c.txt": "pending"}
        expected[own_item] = "ignored"
        assert _item_states(journal) == expected
        # Other unfinished items keep the ChangeSet under review.
        (change_set,) = journal.list_git_change_sets()
        assert change_set.state == "needs_attention"
