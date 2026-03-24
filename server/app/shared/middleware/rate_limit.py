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
Rate limiter factory for per-route limiting.

Uses fastapi-limiter (initialized by main app lifespan).
Provides convenient factory for common limits: login, register, webhook.
"""

from collections.abc import Callable

from fastapi import Depends
from fastapi_limiter.depends import RateLimiter


def rate_limiter_factory(times: int = 10, seconds: int = 60) -> Callable:
    """
    Create a RateLimiter dependency with given limits.

    :param times: Max requests allowed in the window
    :param seconds: Window size in seconds
    :return: FastAPI Depends-compatible callable
    """
    return Depends(RateLimiter(times=times, seconds=seconds))


# Predefined limiters for common use cases
login_rate_limiter = rate_limiter_factory(times=5, seconds=60)
register_rate_limiter = rate_limiter_factory(times=3, seconds=60)
webhook_rate_limiter = rate_limiter_factory(times=10, seconds=60)
install_rate_limiter = rate_limiter_factory(times=10, seconds=60)
