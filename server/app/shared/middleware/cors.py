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
CORS middleware with configurable origins from env.

Reads CORS_ALLOW_ORIGINS from environment. Comma-separated list.
Defaults to ["*"] for development when not set.
When origins is ["*"], allow_credentials is False (CORS spec forbids * + credentials).
P2: Production warning when CORS_ALLOW_ORIGINS not set.
"""

import os

from loguru import logger


def get_cors_middleware():
    """
    Return kwargs for CORSMiddleware. Use: add_middleware(CORSMiddleware, **get_cors_middleware())

    Env: CORS_ALLOW_ORIGINS (comma-separated, e.g. "https://app.example.com,https://admin.example.com")
    Default: ["*"] when not set (development). Production should set explicit origins.
    """
    raw = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    if raw:
        origins = [o.strip() for o in raw.split(",") if o.strip()]
    else:
        origins = ["*"]
        from app.core.environment import env

        if env("debug", "") != "on":
            logger.warning('CORS_ALLOW_ORIGINS not set, using ["*"]. Production should set explicit origins.')
    # CORS spec: Access-Control-Allow-Origin: * cannot be used with credentials
    allow_credentials = origins != ["*"]
    return {
        "allow_origins": origins,
        "allow_credentials": allow_credentials,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    }
