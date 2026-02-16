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
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load env so CORS_ORIGINS is available when this module is imported (before main runs).
load_dotenv(dotenv_path=os.path.join(os.path.expanduser("~"), ".eigent", ".env"))

logger = logging.getLogger(__name__)

# Initialize FastAPI with title
api = FastAPI(title="Eigent Multi-Agent System API")


def _get_cors_origins() -> list[str]:
    """
    CORS allowed origins. Avoids overly permissive '*' to prevent unwanted origins.
    Set CORS_ORIGINS (comma-separated) in ~/.eigent/.env or environment;
    in development only, defaults to common localhost origins if unset.
    """
    raw = os.environ.get("CORS_ORIGINS")
    if raw is not None and raw.strip():
        origins = [o.strip() for o in raw.split(",") if o.strip()]
        if origins:
            return origins
    if os.environ.get("ENVIRONMENT", "development").lower() == "development":
        return [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    return []


_cors_origins = _get_cors_origins()
if _cors_origins:
    api.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "x-stack-auth"],
    )
    logger.info("CORS enabled for origins: %s", _cors_origins)
else:
    logger.info(
        "CORS disabled (no CORS_ORIGINS set in non-development). "
        "Set CORS_ORIGINS (comma-separated) to allow browser origins."
    )
