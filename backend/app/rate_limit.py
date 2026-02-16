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
Rate limiting for API endpoints to mitigate abuse and DoS risks.
Uses SlowAPI with in-memory storage (configurable via RATE_LIMIT_DEFAULT).
"""

import logging

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

logger = logging.getLogger("rate_limit")


def _get_default_limits() -> list[str]:
    """Parse RATE_LIMIT_DEFAULT env (e.g. '100/minute') into slowapi format."""
    from app.component.environment import env

    default = env("RATE_LIMIT_DEFAULT", "100/minute")
    if not default or env("RATE_LIMIT_ENABLED", "true").lower() in ("false", "0", "no"):
        return []
    return [default.strip()]


limiter = Limiter(
    key_func=get_remote_address,
    default_limits=_get_default_limits(),
)


def setup_rate_limiting(api):
    """
    Register rate limiting middleware and exception handler on the FastAPI app.
    Call this after creating the app and before including routers.
    """
    limits = _get_default_limits()
    if not limits:
        logger.info("Rate limiting disabled (RATE_LIMIT_ENABLED=false or empty RATE_LIMIT_DEFAULT)")
        return

    api.state.limiter = limiter
    api.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    api.add_middleware(SlowAPIMiddleware)
    logger.info("Rate limiting enabled: %s", limits)
