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

import asyncio
import logging
from collections.abc import Callable

from sqlalchemy.engine import make_url
from sqlmodel import Session, create_engine

from app.core.environment import env, env_or_fail

logger = logging.getLogger("database")


def _env_int(name: str, default: int, *, min_value: int = 0) -> int:
    raw_value = env(name)
    try:
        value = int(raw_value) if raw_value not in {None, ""} else default
    except (TypeError, ValueError):
        logger.warning(
            "Invalid integer environment value; using default",
            extra={"name": name, "value": raw_value, "default": default},
        )
        value = default
    return max(min_value, value)


def _database_connect_args(database_url: str) -> dict[str, object]:
    """Bound PostgreSQL waits without limiting a long-running agent task."""

    if make_url(database_url).get_backend_name() != "postgresql":
        return {}

    connect_timeout_seconds = _env_int("DB_CONNECT_TIMEOUT_SECONDS", 10, min_value=1)
    lock_timeout_ms = _env_int("DB_LOCK_TIMEOUT_MS", 5_000, min_value=1)
    statement_timeout_ms = _env_int("DB_STATEMENT_TIMEOUT_MS", 120_000, min_value=1)
    idle_transaction_timeout_ms = _env_int("DB_IDLE_IN_TRANSACTION_TIMEOUT_MS", 60_000, min_value=1)
    return {
        "connect_timeout": connect_timeout_seconds,
        "options": " ".join(
            (
                f"-c lock_timeout={lock_timeout_ms}",
                f"-c statement_timeout={statement_timeout_ms}",
                f"-c idle_in_transaction_session_timeout={idle_transaction_timeout_ms}",
            )
        ),
    }


database_url = env_or_fail("database_url")

logger.info(
    "Initializing database engine",
    extra={
        "database_url_prefix": database_url[:20] + "...",
        "debug_mode": env("debug") == "on",
        "pool_size": _env_int("DB_POOL_SIZE", 10, min_value=1),
    },
)

engine = create_engine(
    database_url,
    echo=True if env("debug") == "on" else False,
    pool_size=_env_int("DB_POOL_SIZE", 10, min_value=1),
    max_overflow=_env_int("DB_MAX_OVERFLOW", 10),
    pool_pre_ping=True,
    pool_recycle=_env_int("DB_POOL_RECYCLE", 300, min_value=1),
    pool_timeout=_env_int("DB_POOL_TIMEOUT", 10, min_value=1),
    pool_reset_on_return="rollback",
    connect_args=_database_connect_args(database_url),
)

logger.info("Database engine initialized successfully")


def session_make():
    logger.debug("Creating new database session")
    session = Session(engine)
    logger.debug("Database session created successfully")
    return session


def session():
    logger.debug("Creating database session context")
    with Session(engine) as db:
        logger.debug("Database session context established")
        try:
            yield db
        finally:
            db.rollback()
            logger.debug("Database session context closed")


def run_in_session[T](
    operation: Callable[[Session], T],
    *,
    commit: bool = False,
) -> T:
    """Run one bounded unit of database work in a fresh, closed session."""

    with session_make() as db:
        try:
            result = operation(db)
            if commit:
                db.commit()
            else:
                db.rollback()
            return result
        except Exception:
            db.rollback()
            raise


async def run_in_session_async[T](
    operation: Callable[[Session], T],
    *,
    commit: bool = False,
) -> T:
    """Run synchronous SQLModel work outside the asyncio event-loop thread."""

    return await asyncio.to_thread(run_in_session, operation, commit=commit)
