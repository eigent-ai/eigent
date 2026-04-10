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
Shared sync Redis client for v1 (CreditsService idempotency, etc).

Reuse connection instead of creating new one per call.
Uses same redis_url as app.core.database.redis (async).
"""

from redis import Redis

from app.core.environment import env_or_fail

_redis_sync: Redis | None = None


def get_redis_sync() -> Redis:
    """Get shared sync Redis client. Lazy init, reused across calls."""
    global _redis_sync
    if _redis_sync is None:
        _redis_sync = Redis.from_url(
            env_or_fail("redis_url"),
            decode_responses=True,
        )
    return _redis_sync
