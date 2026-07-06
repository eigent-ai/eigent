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
v1 trace-aware logging with sensitive data masking.

- Binds trace_id from contextvars to all log records
- Masks API keys, emails, Redis URLs, payment info in log output
"""

import re
from loguru import logger

from app.shared.context import get_trace_id


# Patterns for sensitive data - replace with masked placeholder
MASK_PATTERNS = [
    (re.compile(r'(api[_-]?key|apikey|secret[_-]?key|authorization|bearer)\s*[:=]\s*["\']?([a-zA-Z0-9_\-\.]{8,})["\']?', re.I), r'\1=***MASKED***'),
    (re.compile(r'([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)'), r'***@***'),
    (re.compile(r'redis://[^\s\'"&\]]+'), 'redis://***MASKED***'),
    (re.compile(r'(sk_|pk_)[a-zA-Z0-9]+'), r'\1***MASKED***'),  # Stripe keys & primary keys
]


def mask_sensitive(text: str) -> str:
    """Mask sensitive data in log message."""
    if not isinstance(text, str):
        return str(text)
    result = text
    for pattern, repl in MASK_PATTERNS:
        result = pattern.sub(repl, result)
    return result


def trace_filter(record: dict) -> bool:
    """Loguru filter: bind trace_id and mask sensitive data."""
    record.setdefault("extra", {})["trace_id"] = get_trace_id() or "-"
    record["message"] = mask_sensitive(record["message"])
    return True


def configure_v1_logging():
    """Add trace_id to default log format. Call during v1 app setup."""
    logger.configure(extra={"trace_id": "-"})
