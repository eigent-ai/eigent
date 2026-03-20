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
Token blacklist for logout support (H16).

Uses Redis to store revoked token JTIs. Keys: token:blacklist:{jti}
TTL matches remaining token lifetime.
"""

from app.core.environment import env_or_fail
from redis import asyncio as aioredis

_redis: aioredis.Redis | None = None
BLACKLIST_PREFIX = "token:blacklist:"


def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(env_or_fail("redis_url"), encoding="utf-8", decode_responses=True)
    return _redis


async def is_blacklisted(jti: str) -> bool:
    """Check if token JTI is in blacklist. Fail-closed: reject token if Redis is unavailable."""
    try:
        r = _get_redis()
        key = f"{BLACKLIST_PREFIX}{jti}"
        return await r.exists(key) > 0
    except Exception as e:
        from loguru import logger
        logger.warning(f"Redis blacklist check failed (fail-closed): {e}")
        return True


async def blacklist_token(jti: str, ttl_seconds: int) -> None:
    """
    Add token JTI to blacklist.

    :param jti: JWT ID claim
    :param ttl_seconds: Seconds until token would have expired (blacklist entry TTL)
    """
    if ttl_seconds <= 0:
        return
    try:
        r = _get_redis()
        key = f"{BLACKLIST_PREFIX}{jti}"
        await r.set(key, "1", ex=ttl_seconds)
    except Exception as e:
        from loguru import logger
        logger.error(f"Redis blacklist_token failed: {e}")
