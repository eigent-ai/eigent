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
import uuid

from app.remote_sub_agent.types import RemoteSubAgentSession


class RemoteSubAgentSessionStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._sessions: dict[str, RemoteSubAgentSession] = {}

    def get_or_create(
        self,
        *,
        api_task_id: str,
        provider: str,
        remote_agent_name: str | None,
        session_key: str | None = None,
    ) -> RemoteSubAgentSession:
        key = session_key or self._default_key(
            api_task_id=api_task_id,
            provider=provider,
            remote_agent_name=remote_agent_name,
        )
        with self._lock:
            existing = self._sessions.get(key)
            if existing is not None:
                return existing

            session = RemoteSubAgentSession(
                session_id=f"rsa_{uuid.uuid4().hex}",
                provider=provider,
                api_task_id=api_task_id,
                remote_agent_name=remote_agent_name,
                metadata={"session_key": key},
            )
            self._sessions[key] = session
            return session

    def update(self, session: RemoteSubAgentSession) -> None:
        key = session.metadata.get("session_key")
        if not isinstance(key, str) or not key:
            return
        with self._lock:
            self._sessions[key] = session

    def clear(self) -> None:
        with self._lock:
            self._sessions.clear()

    def _default_key(
        self,
        *,
        api_task_id: str,
        provider: str,
        remote_agent_name: str | None,
    ) -> str:
        agent_part = remote_agent_name or "default"
        return f"{api_task_id}:{provider}:{agent_part}"


GLOBAL_REMOTE_SUB_AGENT_SESSIONS = RemoteSubAgentSessionStore()
