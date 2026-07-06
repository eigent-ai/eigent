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
Trace ID context for v1 request lifecycle.

Uses contextvars to propagate trace_id through the request and into downstream
calls (httpx, Celery, Redis pub/sub).
"""

import uuid
from contextvars import ContextVar

_trace_id_ctx: ContextVar[str | None] = ContextVar("trace_id", default=None)


def get_trace_id() -> str | None:
    """Get the current trace ID from context, or None if not set."""
    return _trace_id_ctx.get()


def set_trace_id(trace_id: str) -> None:
    """Set the trace ID in the current context."""
    _trace_id_ctx.set(trace_id)


def generate_trace_id() -> str:
    """Generate a new UUID v4 trace ID."""
    return str(uuid.uuid4())


def ensure_trace_id(trace_id: str | None) -> str:
    """
    Use provided trace_id if valid (UUID format), otherwise generate new one.
    Returns the trace_id to use. Does NOT set context - caller must call set_trace_id.
    """
    if trace_id and _is_valid_uuid(trace_id):
        return trace_id
    return generate_trace_id()


def _is_valid_uuid(value: str) -> bool:
    """Check if string is a valid UUID v4."""
    try:
        uuid.UUID(value, version=4)
        return True
    except (ValueError, TypeError):
        return False
