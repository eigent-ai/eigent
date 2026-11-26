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

"""Fill in the live bridge address when an Apple model is built."""

from __future__ import annotations

from typing import Any

from app.apple_bridge.platform_support import is_apple_bridge_model
from app.apple_bridge.supervisor import (
    AppleBridgeSupervisor,
    get_apple_bridge_supervisor,
)
from app.model.model_platform import OPENAI_COMPATIBLE_MODEL_PLATFORM


def resolve_apple_bridge_config(
    config: dict[str, Any],
    supervisor: AppleBridgeSupervisor | None = None,
) -> dict[str, Any]:
    """Point an Apple Intelligence config at the running bridge.

    Other configs come back unchanged. When the bridge cannot run, this
    raises `AppleBridgeUnavailableError`: the Run fails with that reason and
    never moves to another provider.
    """
    if not is_apple_bridge_model(
        config.get("model_type"), config.get("api_url")
    ):
        return config
    endpoint = (supervisor or get_apple_bridge_supervisor()).endpoint()
    return {
        **config,
        "model_platform": OPENAI_COMPATIBLE_MODEL_PLATFORM,
        "api_url": endpoint.base_url,
        "api_key": endpoint.token,
    }
