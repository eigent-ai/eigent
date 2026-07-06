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

"""Preflight checks for the Space layer migration.

This script is intentionally read-only. It surfaces user id mappings and
cross-user project id collisions before the Alembic migration materializes
Legacy Space and Project rows.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

from sqlalchemy import create_engine, text

_server_root = pathlib.Path(__file__).resolve().parents[1]
if str(_server_root) not in sys.path:
    sys.path.insert(0, str(_server_root))

from app.core.environment import env_not_empty  # noqa: E402


def fetch_rows(engine, statement: str) -> list[dict]:
    with engine.connect() as connection:
        return [dict(row._mapping) for row in connection.execute(text(statement))]


def table_exists(engine, name: str) -> bool:
    with engine.connect() as connection:
        return bool(
            connection.execute(
                text(
                    "SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema = current_schema() AND table_name = :n"
                ),
                {"n": name},
            ).first()
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Space migration preflight")
    parser.add_argument(
        "--check-mappings-only",
        action="store_true",
        help="Only report user id mapping blockers.",
    )
    parser.add_argument(
        "--canonicalize-only",
        action="store_true",
        help="Alias for --check-mappings-only kept for the V2.6 rollout docs.",
    )
    args = parser.parse_args()

    engine = create_engine(env_not_empty("database_url"))

    has_chat_history = table_exists(engine, "chat_history")
    has_trigger = table_exists(engine, "trigger")
    missing_tables = [
        name
        for name, present in (("chat_history", has_chat_history), ("trigger", has_trigger))
        if not present
    ]

    user_source_sql_parts: list[str] = []
    if has_chat_history:
        user_source_sql_parts.append(
            "SELECT 'chat_history' AS source, CAST(user_id AS TEXT) AS source_id "
            "FROM chat_history WHERE user_id IS NOT NULL"
        )
    if has_trigger:
        user_source_sql_parts.append(
            "SELECT 'trigger' AS source, CAST(user_id AS TEXT) AS source_id "
            "FROM trigger WHERE user_id IS NOT NULL"
        )

    user_sources: list[dict] = (
        fetch_rows(engine, " UNION ".join(user_source_sql_parts))
        if user_source_sql_parts
        else []
    )
    mapping_blockers = [
        row
        for row in user_sources
        if row["source"] == "trigger" and not str(row["source_id"]).isdigit()
    ]

    report: dict[str, object] = {
        "missing_tables": missing_tables,
        "user_sources": user_sources,
        "mapping_blockers": mapping_blockers,
    }

    if not (args.check_mappings_only or args.canonicalize_only):
        collision_sql_parts: list[str] = []
        if has_chat_history:
            collision_sql_parts.append(
                "SELECT CAST(user_id AS TEXT) AS user_id, "
                "COALESCE(project_id, task_id) AS project_id "
                "FROM chat_history WHERE COALESCE(project_id, task_id) IS NOT NULL"
            )
        if has_trigger:
            collision_sql_parts.append(
                "SELECT CAST(user_id AS TEXT) AS user_id, project_id "
                "FROM trigger WHERE project_id IS NOT NULL"
            )

        if collision_sql_parts:
            report["project_id_collisions"] = fetch_rows(
                engine,
                f"""
                WITH source_projects AS (
                    {" UNION ".join(collision_sql_parts)}
                )
                SELECT project_id, COUNT(DISTINCT user_id) AS user_count
                FROM source_projects
                GROUP BY project_id
                HAVING COUNT(DISTINCT user_id) > 1
                ORDER BY user_count DESC, project_id ASC
                """,
            )
        else:
            report["project_id_collisions"] = []

    print(json.dumps(report, indent=2, sort_keys=True))
    return 1 if mapping_blockers else 0


if __name__ == "__main__":
    raise SystemExit(main())
