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
Trace ID middleware.

Reads X-Trace-ID from request header (or generates UUID v4), injects into
request.state and contextvars, and adds to response headers.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.shared.context import (
    ensure_trace_id,
    set_trace_id,
    get_trace_id,
)

TRACE_HEADER = "X-Trace-ID"


class TraceIDMiddleware(BaseHTTPMiddleware):
    """ASGI middleware that propagates X-Trace-ID through the request lifecycle."""

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get(TRACE_HEADER)
        trace_id = ensure_trace_id(incoming)
        set_trace_id(trace_id)

        request.state.trace_id = trace_id

        response = await call_next(request)

        if TRACE_HEADER not in response.headers:
            response.headers[TRACE_HEADER] = trace_id

        return response
