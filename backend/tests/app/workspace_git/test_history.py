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

import pytest

from .history_fixture import build_history_fixture


@pytest.fixture(scope="module")
def history_fixture(tmp_path_factory):
    return build_history_fixture(tmp_path_factory.mktemp("history"))


def test_history_enumerates_and_resolves_direct_task_refs(history_fixture):
    history = history_fixture["direct"]
    branches = {branch["ref"]: branch for branch in history["branches"]}
    for ref in history_fixture["direct_refs"]:
        assert ref in branches
        assert branches[ref]["run_id"] in {"task-a", "task-b", "task-c"}
        assert branches[ref]["project_id"] in {"session-a", "session-b"}
    assert set(history_fixture["oids"].values()) <= {
        commit["oid"] for commit in history["commits"]
    }


def test_history_keeps_unresolved_and_malformed_refs_technical(
    history_fixture,
):
    branches = {
        branch["ref"]: branch
        for branch in history_fixture["with_orphans"]["branches"]
    }
    for ref in history_fixture["technical_refs"]:
        assert ref in branches
        assert "project_id" not in branches[ref]
        assert "run_id" not in branches[ref]


def test_commit_limit_does_not_limit_task_ownership(history_fixture):
    assert len(history_fixture["limited"]["commits"]) == 1
    assert (
        history_fixture["limited"]["branches"]
        == history_fixture["with_orphans"]["branches"]
    )


def test_mixed_history_preserves_managed_and_legacy_refs(history_fixture):
    history = history_fixture["mixed"]
    branches = {branch["ref"]: branch for branch in history["branches"]}
    assert set(history_fixture["legacy_refs"]) <= branches.keys()
    assert set(history_fixture["direct_refs"]) <= branches.keys()
    assert branches[history_fixture["managed_ref"]]["run_id"] == "managed-task"
    assert (
        branches[history_fixture["managed_project_ref"]]["project_id"]
        == "session-a"
    )
    assert history["retention_policy"]["automatic_object_gc"] is False
