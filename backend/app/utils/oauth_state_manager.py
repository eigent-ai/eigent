"""
OAuth authorization state manager for background authorization flows
"""
import threading
from typing import Dict, Optional, Literal, Any
from datetime import datetime
from utils import traceroot_wrapper as traceroot
logger = traceroot.get_logger("main")

AuthStatus = Literal["pending", "authorizing", "success", "failed", "cancelled"]


class OAuthState:
    """Represents the state of an OAuth authorization flow"""

    def __init__(self, provider: str):
        self.provider = provider
        self.status: AuthStatus = "pending"
        self.error: Optional[str] = None
        self.thread: Optional[threading.Thread] = None
        self.result: Optional[Any] = None
        self.started_at = datetime.now()
        self.completed_at: Optional[datetime] = None
        self._cancel_event = threading.Event()
        self.server = None  # Store the local server instance for forced shutdown
    
    def is_cancelled(self) -> bool:
        """Check if cancellation has been requested"""
        return self._cancel_event.is_set()
    
    def cancel(self):
        """Request cancellation of the authorization flow"""
        self._cancel_event.set()
        self.status = "cancelled"
        self.completed_at = datetime.now()
    
    def to_dict(self) -> Dict:
        """Convert state to dictionary for API response"""
        return {
            "provider": self.provider,
            "status": self.status,
            "error": self.error,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class OAuthStateManager:
    """Manager for tracking OAuth authorization flows"""
    
    def __init__(self):
        self._states: Dict[str, OAuthState] = {}
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
    
    def get_state(self, provider: str) -> Optional[OAuthState]:
        """Get the current state for a provider"""
        with self._lock:
            return self._states.get(provider)
    
    def update_status(
        self,
        provider: str,
        status: AuthStatus,
        error: Optional[str] = None,
        result: Optional[Any] = None
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

