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

"""Unit tests for the knowledge base (issue #1099)."""

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.controller import knowledge_controller
from app.utils import sqlite_toolkit as kb


@pytest.mark.unit
class TestKnowledgeBase:
    """Test sqlite_toolkit add, get, delete, and get_context_for_prompt."""

    def test_add_get_delete_entries(self, tmp_path):
        """Add, list, and delete entries using a temp DB path."""
        db_path = tmp_path / "test_kb.db"
        with patch.object(kb, "_get_db_path", return_value=str(db_path)):
            # Force fresh schema (module may have already inited another DB)
            pid = "test-project-1"
            eid = kb.add_entry(pid, "The default branch is main.")
            assert eid > 0

            entries = kb.get_entries(pid)
            assert len(entries) == 1
            assert entries[0]["content"] == "The default branch is main."
            assert entries[0]["project_id"] == pid

            ok = kb.delete_entry(pid, eid)
            assert ok is True
            entries2 = kb.get_entries(pid)
            assert len(entries2) == 0

    def test_get_entries_with_query(self, tmp_path):
        """Keyword filter returns only matching entries."""
        db_path = tmp_path / "test_kb.db"
        with patch.object(kb, "_get_db_path", return_value=str(db_path)):
            pid = "test-project-2"
            kb.add_entry(pid, "We use Python 3.10 for the backend.")
            kb.add_entry(pid, "The frontend uses TypeScript.")
            kb.add_entry(pid, "Backend tests use pytest.")

            entries = kb.get_entries(pid, query="backend")
            assert len(entries) >= 1
            contents = [e["content"] for e in entries]
            assert any("backend" in c.lower() for c in contents)

            entries_all = kb.get_entries(pid, limit=10)
            assert len(entries_all) == 3

    def test_get_context_for_prompt(self, tmp_path):
        """get_context_for_prompt returns formatted string with header."""
        db_path = tmp_path / "test_kb.db"
        with patch.object(kb, "_get_db_path", return_value=str(db_path)):
            pid = "test-project-3"
            kb.add_entry(pid, "User prefers dark mode.")

            ctx = kb.get_context_for_prompt(pid)
            assert "Knowledge Base" in ctx
            assert "long-term memory" in ctx
            assert "dark mode" in ctx

            empty_ctx = kb.get_context_for_prompt("nonexistent-project-999")
            assert empty_ctx == ""

    def test_delete_entry_wrong_project_no_op(self, tmp_path):
        """delete_entry with wrong project_id does not delete."""
        db_path = tmp_path / "test_kb.db"
        with patch.object(kb, "_get_db_path", return_value=str(db_path)):
            pid = "test-project-4"
            eid = kb.add_entry(pid, "A fact.")
            ok = kb.delete_entry("other-project", eid)
            assert ok is False
            entries = kb.get_entries(pid)
            assert len(entries) == 1


@pytest.mark.unit
class TestKnowledgeBaseAPI:
    """Test knowledge base REST API (add, list, delete) via TestClient."""

    def test_api_add_list_delete(self, tmp_path):
        """POST add, GET list, DELETE entry."""
        db_path = tmp_path / "api_test_kb.db"
        with patch.object(kb, "_get_db_path", return_value=str(db_path)):
            app = FastAPI()
            app.include_router(knowledge_controller.router)
            client = TestClient(app)
            pid = "api-test-project"

            # Add
            r = client.post(
                "/knowledge",
                json={"project_id": pid, "content": "User prefers Python 3.10."},
            )
            assert r.status_code == 200
            data = r.json()
            assert data["project_id"] == pid
            assert "id" in data
            entry_id = data["id"]

            # List
            r = client.get(f"/knowledge?project_id={pid}")
            assert r.status_code == 200
            data = r.json()
            assert data["project_id"] == pid
            assert len(data["entries"]) == 1
            assert data["entries"][0]["content"] == "User prefers Python 3.10."

            # Delete
            r = client.delete(f"/knowledge/{entry_id}?project_id={pid}")
            assert r.status_code == 200
            assert r.json()["deleted"] is True

            # List empty
            r = client.get(f"/knowledge?project_id={pid}")
            assert r.status_code == 200
            assert len(r.json()["entries"]) == 0
