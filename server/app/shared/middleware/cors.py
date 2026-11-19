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
When CORS_ALLOW_ORIGINS is missing, derives remote-control origins from
REMOTE_CONTROL_WEB_ORIGIN / VITE_REMOTE_CONTROL_WEB_ORIGIN / VITE_SITE_URL,
then falls back to localhost dev origins.
When origins is ["*"], allow_credentials is False (CORS spec forbids * + credentials).
"""

import os

from loguru import logger

from app.core.environment import env
from app.shared.middleware.origins import (
    configured_remote_origins,
    csv_values,
    local_dev_cors_origins,
    truthy,
)


DEFAULT_ALLOW_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
DEFAULT_ALLOW_HEADERS = [
    "Accept",
    "Authorization",
    "Content-Type",
    "X-Remote-Control-Token",
    "X-Trace-Id",
    "X-Requested-With",
]


def get_cors_middleware():
    """
    Return kwargs for CORSMiddleware. Use: add_middleware(CORSMiddleware, **get_cors_middleware())

    Env:
      CORS_ALLOW_ORIGINS: comma-separated origins.
      REMOTE_CONTROL_ALLOW_UNSAFE_ORIGINS: set true to intentionally allow "*".
      CORS_ALLOW_METHODS: comma-separated methods. Defaults to standard REST verbs.
      CORS_ALLOW_HEADERS: comma-separated headers. Defaults include X-Remote-Control-Token.
    """
    origins_raw = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    if origins_raw:
        origins = csv_values(origins_raw)
    elif truthy(os.getenv("REMOTE_CONTROL_ALLOW_UNSAFE_ORIGINS")):
        origins = ["*"]
        logger.warning('REMOTE_CONTROL_ALLOW_UNSAFE_ORIGINS=true, using CORS allow_origins ["*"].')
    else:
        origins = configured_remote_origins() or local_dev_cors_origins()
        if env("debug", "") != "on":
            logger.warning(
                "CORS_ALLOW_ORIGINS not set. Using configured remote web/local dev origins only; "
                "production should set explicit origins."
            )

    methods_raw = os.getenv("CORS_ALLOW_METHODS", "").strip()
    methods = csv_values(methods_raw) if methods_raw else DEFAULT_ALLOW_METHODS

    headers_raw = os.getenv("CORS_ALLOW_HEADERS", "").strip()
    headers = csv_values(headers_raw) if headers_raw else DEFAULT_ALLOW_HEADERS

    # CORS spec: Access-Control-Allow-Origin: * cannot be used with credentials
    allow_credentials = origins != ["*"]
    return {
        "allow_origins": origins,
        "allow_credentials": allow_credentials,
        "allow_methods": methods,
        "allow_headers": headers,
    }
