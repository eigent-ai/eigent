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

from typing import Any

from app.model.chat import Chat

SUBSCRIPTION_AUTH_SOURCES = {"codex_subscription"}


def is_subscription_auth(options: Chat) -> bool:
    return options.auth_source in SUBSCRIPTION_AUTH_SOURCES


def apply_subscription_runtime(
    options: Chat,
    effective_config: dict[str, Any],
    extra_params: dict[str, Any],
    *,
    force_refresh: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if options.auth_source == "codex_subscription":
        from app.model.subscription_runtime.codex import (
            apply_codex_subscription_runtime,
        )

        return apply_codex_subscription_runtime(
            options,
            effective_config,
            extra_params,
            force_refresh=force_refresh,
        )

    return effective_config, extra_params
