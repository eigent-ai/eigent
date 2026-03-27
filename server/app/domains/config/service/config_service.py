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

"""ConfigService: user config CRUD with validation. Follows CreditsService pattern."""

from sqlmodel import select
from loguru import logger

from app.core.database import session_make
from app.model.config.config import Config, ConfigInfo


class ConfigService:
    """User configuration management - static methods, self-managed session."""

    @staticmethod
    def list_for_user(user_id: int, config_group: str | None = None) -> list[Config]:
        """List user configs, optionally filtered by group."""
        with session_make() as s:
            query = select(Config).where(Config.user_id == user_id)
            if config_group is not None:
                query = query.where(Config.config_group == config_group)
            return list(s.exec(query).all())

    @staticmethod
    def get(config_id: int, user_id: int) -> Config | None:
        """Get a single config by id, scoped to user."""
        with session_make() as s:
            return s.exec(
                select(Config).where(Config.id == config_id, Config.user_id == user_id)
            ).first()

    @staticmethod
    def create(user_id: int, config_name: str, config_value: str, config_group: str | None = None) -> dict:
        """Create config: env var name validation + duplicate check.
        Returns {"success": True, "config": Config} or {"success": False, "error_code": str}.
        """
        if not ConfigInfo.is_valid_env_var(config_group, config_name):
            return {"success": False, "error_code": "CONFIG_INVALID_NAME"}

        from sqlalchemy.exc import IntegrityError

        with session_make() as s:
            db_config = Config(
                user_id=user_id,
                config_name=config_name,
                config_value=config_value,
                config_group=config_group,
            )
            s.add(db_config)
            try:
                s.commit()
            except IntegrityError:
                s.rollback()
                return {"success": False, "error_code": "CONFIG_DUPLICATE"}
            s.refresh(db_config)
            return {"success": True, "config": db_config}

    @staticmethod
    def update(config_id: int, user_id: int, config_name: str, config_value: str, config_group: str | None = None) -> dict:
        """Update config: ownership + validation + duplicate check."""
        if not ConfigInfo.is_valid_env_var(config_group, config_name):
            return {"success": False, "error_code": "CONFIG_INVALID_NAME"}

        with session_make() as s:
            db_config = s.exec(
                select(Config).where(Config.id == config_id, Config.user_id == user_id)
            ).first()
            if not db_config:
                return {"success": False, "error_code": "CONFIG_NOT_FOUND"}

            # Check for name conflict with other configs
            conflict = s.exec(
                select(Config).where(
                    Config.user_id == user_id,
                    Config.config_name == config_name,
                    Config.id != config_id,
                )
            ).first()
            if conflict:
                return {"success": False, "error_code": "CONFIG_DUPLICATE"}

            db_config.config_name = config_name
            db_config.config_value = config_value
            s.add(db_config)
            s.commit()
            s.refresh(db_config)
            return {"success": True, "config": db_config}

    @staticmethod
    def delete(config_id: int, user_id: int) -> bool:
        """Delete config: ownership check."""
        with session_make() as s:
            db_config = s.exec(
                select(Config).where(Config.id == config_id, Config.user_id == user_id)
            ).first()
            if not db_config:
                return False
            s.delete(db_config)
            s.commit()
            return True

    @staticmethod
    def get_config_info(show_all: bool = False) -> dict:
        """Return available config metadata."""
        configs = ConfigInfo.getinfo()
        if show_all:
            return configs
        return {k: v for k, v in configs.items() if v.get("env_vars") and len(v["env_vars"]) > 0}
