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

from app.utils.oauth_state_manager import OAuthStateManager


@pytest.mark.unit
class TestOAuthStateManager:
    """Tests for OAuthStateManager including the new remove_state method."""

    def setup_method(self):
        self.manager = OAuthStateManager()

    def test_create_and_get_state(self):
        """create_state should return a retrievable state object."""
        state = self.manager.create_state("google")
        assert state.provider == "google"
        assert state.status == "pending"
        retrieved = self.manager.get_state("google")
        assert retrieved is state

    def test_remove_state_cleans_up(self):
        """remove_state should remove the provider's state under lock."""
        self.manager.create_state("github")
        assert self.manager.get_state("github") is not None
        self.manager.remove_state("github")
        assert self.manager.get_state("github") is None

    def test_remove_state_nonexistent_does_not_raise(self):
        """remove_state on a missing provider should not raise."""
        self.manager.remove_state("nonexistent")

    def test_update_status_sets_completed_at(self):
        """Updating to a terminal status should set completed_at."""
        self.manager.create_state("slack")
        self.manager.update_status("slack", "success")
        state = self.manager.get_state("slack")
        assert state.status == "success"
        assert state.completed_at is not None

    def test_create_state_cancels_previous_pending(self):
        """Creating a new state for the same provider cancels the old one."""
        old = self.manager.create_state("google")
        assert old.status == "pending"
        _new = self.manager.create_state("google")
        assert old.status == "cancelled"

    def test_to_dict(self):
        """to_dict should include all expected keys."""
        state = self.manager.create_state("test")
        d = state.to_dict()
        assert set(d.keys()) == {"provider", "status", "error", "started_at", "completed_at"}
        assert d["provider"] == "test"
        assert d["status"] == "pending"
