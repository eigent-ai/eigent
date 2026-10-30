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

from sqlalchemy import update
from sqlmodel import col, select

from app.core.database import session_make
from app.model.remote_sub_agent.provider import RemoteSubAgentProvider


class RemoteSubAgentProviderService:
    """Remote sub-agent provider CRUD.

    A user can store multiple providers, but only one remote sub-agent provider
    should be enabled at a time for now. This keeps the runtime selection
    deterministic while still leaving room for additional providers later.
    """

    @staticmethod
    def list_for_user(
        user_id: int,
        provider_name: str | None = None,
        enabled: bool | None = None,
    ) -> list[RemoteSubAgentProvider]:
        with session_make() as s:
            stmt = select(RemoteSubAgentProvider).where(
                RemoteSubAgentProvider.user_id == user_id,
                RemoteSubAgentProvider.no_delete(),
            )
            if provider_name:
                stmt = stmt.where(
                    RemoteSubAgentProvider.provider_name == provider_name
                )
            if enabled is not None:
                stmt = stmt.where(RemoteSubAgentProvider.enabled == enabled)
            stmt = stmt.order_by(
                col(RemoteSubAgentProvider.created_at).desc(),
                col(RemoteSubAgentProvider.id).desc(),
            )
            return list(s.exec(stmt).all())

    @staticmethod
    def get(
        provider_id: int,
        user_id: int,
    ) -> RemoteSubAgentProvider | None:
        with session_make() as s:
            return s.exec(
                select(RemoteSubAgentProvider).where(
                    RemoteSubAgentProvider.user_id == user_id,
                    RemoteSubAgentProvider.no_delete(),
                    RemoteSubAgentProvider.id == provider_id,
                )
            ).first()

    @staticmethod
    def create(user_id: int, data: dict) -> dict:
        with session_make() as s:
            if data.get("enabled"):
                RemoteSubAgentProviderService._clear_enabled(s, user_id)
            model = RemoteSubAgentProvider(**data, user_id=user_id)
            model.save(s)
            s.refresh(model)
            return {"success": True, "provider": model}

    @staticmethod
    def update(provider_id: int, user_id: int, data: dict) -> dict:
        with session_make() as s:
            model = s.exec(
                select(RemoteSubAgentProvider).where(
                    RemoteSubAgentProvider.user_id == user_id,
                    RemoteSubAgentProvider.no_delete(),
                    RemoteSubAgentProvider.id == provider_id,
                )
            ).first()
            if not model:
                return {
                    "success": False,
                    "error_code": "REMOTE_SUB_AGENT_PROVIDER_NOT_FOUND",
                }

            if data.get("enabled"):
                RemoteSubAgentProviderService._clear_enabled(s, user_id)

            for key in (
                "provider_name",
                "enabled",
                "api_key",
                "endpoint_url",
                "agent_name",
                "model_name",
                "config",
            ):
                if key in data:
                    setattr(model, key, data[key])
            model.save(s)
            s.refresh(model)
            return {"success": True, "provider": model}

    @staticmethod
    def delete(provider_id: int, user_id: int) -> bool:
        with session_make() as s:
            model = s.exec(
                select(RemoteSubAgentProvider).where(
                    RemoteSubAgentProvider.user_id == user_id,
                    RemoteSubAgentProvider.no_delete(),
                    RemoteSubAgentProvider.id == provider_id,
                )
            ).first()
            if not model:
                return False
            model.delete(s)
            return True

    @staticmethod
    def _clear_enabled(s, user_id: int) -> None:
        s.exec(
            update(RemoteSubAgentProvider)
            .where(
                RemoteSubAgentProvider.user_id == user_id,
                RemoteSubAgentProvider.no_delete(),
            )
            .values(enabled=False)
        )
        s.commit()
