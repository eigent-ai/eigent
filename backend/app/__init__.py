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

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

# Initialize FastAPI with title
api = FastAPI(title="Eigent Multi-Agent System API")


@api.get("/")
def root():
    """Root endpoint - confirms this is the Brain backend."""
    return {"service": "eigent-brain", "docs": "/docs", "health": "/health"}


_cors_raw = os.environ.get("EIGENT_CORS_ORIGINS", "")
_allowed_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]
_default_frame_ancestors = [
    "'self'",
    "http://localhost:*",
    "http://127.0.0.1:*",
    "https://localhost:*",
    "https://127.0.0.1:*",
    # The packaged Desktop renderer is a file:// page.
    "file:",
]
_frame_ancestors = " ".join(
    dict.fromkeys(
        [
            *_default_frame_ancestors,
            *[origin for origin in _allowed_origins if origin != "*"],
        ]
    )
)
# File responses the app shows inside a frame: HTML previews, and the file
# stream that the built-in PDF viewer loads. Every other route stays DENY.
_framed_file_path_prefixes = ("/files/preview/", "/api/v1/files/preview/")
_framed_file_paths = ("/files/stream", "/api/v1/files/stream")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        path = request.url.path
        is_file_preview = (
            path.startswith(_framed_file_path_prefixes)
            or path in _framed_file_paths
        )
        if is_file_preview:
            if "X-Frame-Options" in response.headers:
                del response.headers["X-Frame-Options"]
            response.headers["Content-Security-Policy"] = (
                f"frame-ancestors {_frame_ancestors};"
            )
        else:
            response.headers["X-Frame-Options"] = "DENY"
        return response


# Desktop leaves EIGENT_CORS_ORIGINS unset: its packaged renderer is a file://
# page that Electron exempts from CORS, so there is no web origin to allowlist
# ("null" must never be allowlisted; sandboxed and data: pages share it). Brain
# routes rely on the Desktop capability (app/auth/local_control.py) instead.
api.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins or ["*"],
    allow_credentials=bool(_allowed_origins),
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-Session-ID",
        "Accept-Ranges",
        "Content-Disposition",
        "Content-Length",
        "Content-Range",
        "Last-Modified",
    ],
)
api.add_middleware(SecurityHeadersMiddleware)

# Phase 2: Channel/Session header parsing (X-Channel, X-Session-ID, X-User-ID)
from app.router_layer import ChannelSessionMiddleware

api.add_middleware(ChannelSessionMiddleware)

# Exception handlers are part of the application boundary and must be
# registered whenever the shared FastAPI instance is imported by Uvicorn.
from app.exception.handler import register_exception_handlers  # noqa: E402

register_exception_handlers(api)
