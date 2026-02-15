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

import logging

from sqlmodel import Session, create_engine

from app.component.environment import env, env_or_fail

logger = logging.getLogger("database")

logger.info(
    "Initializing database engine",
    extra={
        "database_url_prefix": env_or_fail("database_url")[:20] + "...",
        "debug_mode": env("debug") == "on",
        "pool_size": 36,
    },
)

engine = create_engine(
    env_or_fail("database_url"),
    echo=True if env("debug") == "on" else False,
    pool_size=36,
)

logger.info("Database engine initialized successfully")


def session_make():
    logger.debug("Creating new database session")
    session = Session(engine)
    logger.debug("Database session created successfully")
    return session


def session():
    logger.debug("Creating database session context")
    with Session(engine) as session:
        logger.debug("Database session context established")
        yield session
        logger.debug("Database session context closed")
