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

"""Where the Apple Intelligence provider can run.

Apple Intelligence needs macOS on Apple silicon and the bundled bridge
binary. Everything here is a cheap local check: nothing starts a process,
so it is safe to call on every platform.
"""

from __future__ import annotations

import os
import platform
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Final

PROVIDER_ID: Final = "apple-intelligence"
ON_DEVICE_MODEL: Final = "apple-on-device"
APPLE_MODEL_TYPES: Final = frozenset({ON_DEVICE_MODEL})
BRIDGE_ENV: Final = "EIGENT_APPLE_BRIDGE"

# Reasons the provider is unavailable before the bridge is asked anything.
NOT_MACOS: Final = "not_macos"
NOT_APPLE_SILICON: Final = "not_apple_silicon"
BRIDGE_MISSING: Final = "bridge_missing"


def platform_unsupported_reason(
    system: str | None = None, machine: str | None = None
) -> str | None:
    """Return why this machine cannot run Apple Intelligence, or None."""
    system = sys.platform if system is None else system
    machine = platform.machine() if machine is None else machine
    if system != "darwin":
        return NOT_MACOS
    if machine.lower() not in {"arm64", "aarch64"}:
        return NOT_APPLE_SILICON
    return None


def bridge_binary_path(
    environ: Mapping[str, str] | None = None,
) -> Path | None:
    """The bridge binary passed in by the desktop app, if it exists."""
    environ = os.environ if environ is None else environ
    raw = environ.get(BRIDGE_ENV, "").strip()
    if not raw:
        return None
    path = Path(raw)
    if not path.is_file() or not os.access(path, os.X_OK):
        return None
    return path


def is_apple_bridge_model(model_type: object, api_url: object) -> bool:
    """Whether a model config targets the bridge.

    Saved Apple Intelligence records keep an empty endpoint: the live bridge
    URL changes every time the bridge starts, so it is filled in only when a
    model is built.
    """
    return (
        isinstance(model_type, str)
        and model_type in APPLE_MODEL_TYPES
        and not (isinstance(api_url, str) and api_url.strip())
    )
