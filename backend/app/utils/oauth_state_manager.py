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
"""
OAuth authorization state manager for background authorization flows
"""

import logging
import threading
from datetime import datetime
from typing import Any, Literal

logger = logging.getLogger("main")

AuthStatus = Literal[
    "pending", "authorizing", "success", "failed", "cancelled"
]


class OAuthState:
    """Represents the state of an OAuth authorization flow"""

    def __init__(self, provider: str):
        self.provider = provider
        self.status: AuthStatus = "pending"
        self.error: str | None = None
        self.thread: threading.Thread | None = None
        self.result: Any | None = None
        self.started_at = datetime.now()
        self.completed_at: datetime | None = None
        self._cancel_event = threading.Event()
        self.server = (
            None  # Store the local server instance for forced shutdown
        )

    def is_cancelled(self) -> bool:
        """Check if cancellation has been requested"""
        return self._cancel_event.is_set()

    def cancel(self):
        """Request cancellation of the authorization flow"""
        self._cancel_event.set()
        self.status = "cancelled"
        self.completed_at = datetime.now()

    def to_dict(self) -> dict:
        """Convert state to dictionary for API response"""
        return {
            "provider": self.provider,
            "status": self.status,
            "error": self.error,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat()
            if self.completed_at
            else None,
        }


class OAuthStateManager:
    """Manager for tracking OAuth authorization flows"""

    def __init__(self):
        self._states: dict[str, OAuthState] = {}
        self._lock = threading.Lock()

    def create_state(self, provider: str) -> OAuthState:
        """Create a new OAuth state for a provider"""
        with self._lock:
            # Cancel any existing authorization for this provider
            if provider in self._states:
                old_state = self._states[provider]
                if old_state.status in ["pending", "authorizing"]:
                    old_state.cancel()
                    logger.info(f"Cancelled previous {provider} authorization")

            state = OAuthState(provider)
            self._states[provider] = state
            return state

    def get_state(self, provider: str) -> OAuthState | None:
        """Get the current state for a provider"""
        with self._lock:
            return self._states.get(provider)

    def update_status(
        self,
        provider: str,
        status: AuthStatus,
        error: str | None = None,
        result: Any | None = None,
    ):
        """Update the status of an authorization flow"""
        with self._lock:
            if provider in self._states:
                state = self._states[provider]
                state.status = status
                state.error = error
                state.result = result
                if status in ["success", "failed", "cancelled"]:
                    state.completed_at = datetime.now()
                logger.info(f"Updated {provider} OAuth status to {status}")


# Global instance
oauth_state_manager = OAuthStateManager()
