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
"""Let a standalone Brain be asked to shut down over its own API.

A Brain started in the background by ``eigent brain start`` has no terminal
to press Ctrl+C in, and Windows has no signal that reaches it gracefully.
The standalone launcher registers its stop function here. A Brain run by
Desktop registers none, so it can only be stopped by quitting the app.
"""

from __future__ import annotations

from collections.abc import Callable

_request_stop: Callable[[], None] | None = None


def register_shutdown_handler(handler: Callable[[], None] | None) -> None:
    global _request_stop
    _request_stop = handler


def request_shutdown() -> bool:
    """Ask the launcher to stop. False when this Brain cannot be stopped."""

    if _request_stop is None:
        return False
    _request_stop()
    return True
