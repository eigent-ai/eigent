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

"""ProviderService: model provider CRUD with prefer/invalidate. Follows CreditsService pattern."""

from sqlalchemy import update
from sqlmodel import select, col
from loguru import logger

from app.core.database import session_make
from app.model.provider.provider import Provider, VaildStatus


class ProviderService:
    """Model provider management - static methods, self-managed session."""

    @staticmethod
    def list_for_user(user_id: int, keyword: str | None = None, prefer: bool | None = None) -> list[Provider]:
        """List user providers, supports keyword search and prefer filter."""
        with session_make() as s:
            stmt = select(Provider).where(Provider.user_id == user_id, Provider.no_delete())
            if keyword:
                safe_keyword = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                stmt = stmt.where(col(Provider.provider_name).like(f"%{safe_keyword}%"))
            if prefer is not None:
                stmt = stmt.where(Provider.prefer == prefer)
            stmt = stmt.order_by(col(Provider.created_at).desc(), col(Provider.id).desc())
            return list(s.exec(stmt).all())

    @staticmethod
    def get(provider_id: int, user_id: int) -> Provider | None:
        """Get a single provider by id, scoped to user."""
        with session_make() as s:
            model = s.exec(
                select(Provider).where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == provider_id)
            ).first()
            return model

    @staticmethod
    def create(user_id: int, data: dict) -> dict:
        """Create provider. Returns {"success": True, "provider": Provider}."""
        with session_make() as s:
            model = Provider(**data, user_id=user_id)
            model.save(s)
            s.refresh(model)
            return {"success": True, "provider": model}

    @staticmethod
    def update(provider_id: int, user_id: int, data: dict) -> dict:
        """Update provider: ownership check."""
        with session_make() as s:
            model = s.exec(
                select(Provider).where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == provider_id)
            ).first()
            if not model:
                return {"success": False, "error_code": "PROVIDER_NOT_FOUND"}
            # H10: only allow updating safe fields
            _UPDATABLE_FIELDS = {
                "provider_name", "api_key", "endpoint_url", "encrypted_config",
                "model_type", "model_types", "prefer", "is_vaild",
            }
            for key, value in data.items():
                if key in _UPDATABLE_FIELDS:
                    setattr(model, key, value)
            model.save(s)
            s.refresh(model)
            return {"success": True, "provider": model}

    @staticmethod
    def delete(provider_id: int, user_id: int) -> bool:
        """Soft-delete provider."""
        with session_make() as s:
            model = s.exec(
                select(Provider).where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == provider_id)
            ).first()
            if not model:
                return False
            model.delete(s)
            return True

    @staticmethod
    def invalidate(provider_id: int, user_id: int) -> dict:
        """Mark provider as not_valid."""
        with session_make() as s:
            model = s.exec(
                select(Provider).where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == provider_id)
            ).first()
            if not model:
                return {"success": False, "error_code": "PROVIDER_NOT_FOUND"}
            model.is_vaild = VaildStatus.not_valid
            model.save(s)
            s.refresh(model)
            logger.info("Provider invalidated", extra={"user_id": user_id, "provider_id": provider_id})
            return {"success": True, "provider": model}

    @staticmethod
    def set_prefer(provider_id: int, user_id: int) -> dict:
        """Set preferred provider: lock user rows, clear all prefer flags, then set the specified one."""
        with session_make() as s:
            # Lock all provider rows for this user to prevent concurrent prefer changes
            s.exec(
                select(Provider).where(Provider.user_id == user_id, Provider.no_delete()).with_for_update()
            ).all()
            # Clear all prefer flags for this user
            s.exec(update(Provider).where(Provider.user_id == user_id, Provider.no_delete()).values(prefer=False))
            # Set the specified provider as preferred
            s.exec(
                update(Provider)
                .where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == provider_id)
                .values(prefer=True)
            )
            s.commit()
            return {"success": True}
