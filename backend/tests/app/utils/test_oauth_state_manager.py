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

import threading
import pytest

from app.utils.oauth_state_manager import (
    AuthStatus,
    OAuthState,
    OAuthStateManager,
    TERMINAL_STATUSES,
)


@pytest.mark.unit
class TestOAuthState:
    """Tests for OAuthState."""

    def test_init_defaults(self):
        state = OAuthState("test_provider")
        assert state.provider == "test_provider"
        assert state.status == "pending"
        assert state.error is None
        assert state.completed_at is None
        assert state.is_cancelled() is False

    def test_to_dict_pending(self):
        state = OAuthState("p")
        d = state.to_dict()
        assert d["provider"] == "p"
        assert d["status"] == "pending"
        assert d["error"] is None
        assert d["started_at"] is not None
        assert d["completed_at"] is None

    def test_to_dict_with_completed_at(self):
        state = OAuthState("p")
        state.cancel()
        d = state.to_dict()
        assert d["status"] == "cancelled"
        assert d["completed_at"] is not None

    def test_is_cancelled_false_initially(self):
        state = OAuthState("p")
        assert state.is_cancelled() is False

    def test_cancel_sets_event_and_status(self):
        state = OAuthState("p")
        state.cancel()
        assert state.is_cancelled() is True
        assert state.status == "cancelled"
        assert state.completed_at is not None


@pytest.mark.unit
class TestOAuthStateManagerCreateGet:
    """Tests for create_state and get_state."""

    def test_create_state_returns_state(self):
        mgr = OAuthStateManager()
        state = mgr.create_state("google_calendar")
        assert state is not None
        assert state.provider == "google_calendar"
        assert mgr.get_state("google_calendar") is state

    def test_create_state_same_provider_replaces_and_cancels_old(self):
        mgr = OAuthStateManager()
        s1 = mgr.create_state("p")
        s2 = mgr.create_state("p")
        assert s1.is_cancelled() is True
        assert mgr.get_state("p") is s2

    def test_get_state_missing_returns_none(self):
        mgr = OAuthStateManager()
        assert mgr.get_state("nonexistent") is None


@pytest.mark.unit
class TestOAuthStateManagerUpdateStatus:
    """Tests for update_status."""

    def test_update_status_success_sets_completed_at(self):
        mgr = OAuthStateManager()
        mgr.create_state("p")
        mgr.update_status("p", "success")
        state = mgr.get_state("p")
        assert state.status == "success"
        assert state.completed_at is not None

    def test_update_status_failed_sets_completed_at(self):
        mgr = OAuthStateManager()
        mgr.create_state("p")
        mgr.update_status("p", "failed", error="err")
        state = mgr.get_state("p")
        assert state.status == "failed"
        assert state.error == "err"
        assert state.completed_at is not None

    def test_update_status_missing_provider_no_op(self):
        mgr = OAuthStateManager()
        mgr.update_status("nonexistent", "success")
        assert mgr.get_state("nonexistent") is None


@pytest.mark.unit
class TestOAuthStateManagerRemoveState:
    """Tests for remove_state."""

    def test_remove_state_none_provider_returns_false(self):
        mgr = OAuthStateManager()
        assert mgr.remove_state(None) is False

    def test_remove_state_empty_provider_returns_false(self):
        mgr = OAuthStateManager()
        assert mgr.remove_state("") is False
        assert mgr.remove_state("   ") is False

    def test_remove_state_missing_returns_false(self):
        mgr = OAuthStateManager()
        assert mgr.remove_state("nonexistent") is False

    def test_remove_state_existing_returns_true(self):
        mgr = OAuthStateManager()
        mgr.create_state("p")
        assert mgr.remove_state("p") is True
        assert mgr.get_state("p") is None

    def test_remove_state_cancels_if_pending(self):
        mgr = OAuthStateManager()
        state = mgr.create_state("p")
        assert state.is_cancelled() is False
        mgr.remove_state("p")
        assert state.is_cancelled() is True


@pytest.mark.unit
class TestOAuthStateManagerListStates:
    """Tests for list_states."""

    def test_list_states_empty(self):
        mgr = OAuthStateManager()
        assert mgr.list_states() == []

    def test_list_states_returns_dicts(self):
        mgr = OAuthStateManager()
        mgr.create_state("a")
        mgr.create_state("b")
        lst = mgr.list_states()
        assert len(lst) == 2
        providers = {d["provider"] for d in lst}
        assert providers == {"a", "b"}
        for d in lst:
            assert "status" in d
            assert "started_at" in d


@pytest.mark.unit
class TestOAuthStateManagerClearCompleted:
    """Tests for clear_completed."""

    def test_clear_completed_empty_returns_zero(self):
        mgr = OAuthStateManager()
        assert mgr.clear_completed() == 0

    def test_clear_completed_removes_terminal_states(self):
        mgr = OAuthStateManager()
        mgr.create_state("a")
        mgr.create_state("b")
        mgr.update_status("a", "success")
        mgr.update_status("b", "failed")
        n = mgr.clear_completed()
        assert n == 2
        assert mgr.get_state("a") is None
        assert mgr.get_state("b") is None

    def test_clear_completed_leaves_pending(self):
        mgr = OAuthStateManager()
        mgr.create_state("a")
        mgr.create_state("b")
        mgr.update_status("a", "success")
        assert mgr.clear_completed() == 1
        assert mgr.get_state("a") is None
        assert mgr.get_state("b") is not None

    def test_clear_completed_with_max_age_seconds(self):
        mgr = OAuthStateManager()
        mgr.create_state("a")
        mgr.update_status("a", "success")
        n = mgr.clear_completed(max_age_seconds=99999)
        assert n == 0
        assert mgr.get_state("a") is not None
        n2 = mgr.clear_completed(max_age_seconds=0)
        assert n2 == 1
        assert mgr.get_state("a") is None


@pytest.mark.unit
class TestOAuthStateManagerConcurrency:
    """Tests for thread safety."""

    def test_create_state_same_provider_under_lock(self):
        mgr = OAuthStateManager()
        results = []

        def create():
            s = mgr.create_state("p")
            results.append(s)

        t1 = threading.Thread(target=create)
        t2 = threading.Thread(target=create)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
        assert len(results) == 2
        assert mgr.get_state("p") is not None


@pytest.mark.unit
class TestConstants:
    """Tests for module constants."""

    def test_terminal_statuses_contains_expected(self):
        assert "success" in TERMINAL_STATUSES
        assert "failed" in TERMINAL_STATUSES
        assert "cancelled" in TERMINAL_STATUSES
        assert "pending" not in TERMINAL_STATUSES
        assert "authorizing" not in TERMINAL_STATUSES
