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

import ast
from pathlib import Path


def _migration_revisions(path: Path) -> tuple[str, str | None]:
    tree = ast.parse(path.read_text())
    values: dict[str, str | None] = {}
    for node in tree.body:
        if not isinstance(node, ast.AnnAssign) or not isinstance(node.target, ast.Name):
            continue
        if node.target.id not in {"revision", "down_revision"}:
            continue
        values[node.target.id] = ast.literal_eval(node.value)
    return values["revision"], values["down_revision"]


def test_user_work_role_migration_extends_current_merged_head(server_root: Path):
    migration = server_root / "alembic/versions/2026_09_20_1300-add_user_work_role_key.py"

    assert _migration_revisions(migration) == (
        "add_user_work_role_key",
        "merge_self_hosted_rc_lineages",
    )
    source = migration.read_text()
    assert 'sa.Column("work_role_key", sa.String(length=50), nullable=True)' in source
    assert "create_check_constraint" not in source
    assert "server_default" not in source
