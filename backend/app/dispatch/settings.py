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
"""What the Brain resolves itself for a Task it starts.

The model comes from Brain settings, in the process environment or
``~/.eigent/.env``. The key is never part of a ``/v1/tasks`` request.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

from app.component.environment import env

MODEL_PLATFORM_ENV = "EIGENT_MODEL_PLATFORM"
MODEL_TYPE_ENV = "EIGENT_MODEL_TYPE"
MODEL_API_KEY_ENV = "EIGENT_MODEL_API_KEY"
MODEL_API_URL_ENV = "EIGENT_MODEL_API_URL"

# Tasks started by the Brain have no signed-in account. Their files and
# Space bindings live under this local owner.
LOCAL_OWNER_EMAIL = "local-user@localhost"

# Local endpoints take any key, but the model client refuses an empty one.
_KEYLESS_PLACEHOLDER = "not-needed"


class ModelNotConfiguredError(Exception):
    def __init__(self, missing: list[str]):
        self.missing = missing
        super().__init__(
            "No model is configured for Tasks started without the app. Set "
            + ", ".join(missing)
            + " in the environment or in ~/.eigent/.env, then restart Eigent."
        )


@dataclass(frozen=True)
class DispatchModel:
    model_platform: str
    model_type: str
    api_key: str
    api_url: str | None


def _setting(name: str) -> str:
    return str(env(name, "") or "").strip()


def resolve_dispatch_model(model_type: str | None = None) -> DispatchModel:
    """The model a Brain-owned Task runs on.

    ``model_type`` overrides only the model name; platform, key and endpoint
    always come from Brain settings.
    """

    platform = _setting(MODEL_PLATFORM_ENV)
    configured_type = _setting(MODEL_TYPE_ENV)
    api_key = _setting(MODEL_API_KEY_ENV)
    api_url = _setting(MODEL_API_URL_ENV) or None
    missing = []
    if not platform:
        missing.append(MODEL_PLATFORM_ENV)
    if not (model_type or configured_type):
        missing.append(MODEL_TYPE_ENV)
    if not api_key and not api_url:
        missing.append(MODEL_API_KEY_ENV)
    if missing:
        raise ModelNotConfiguredError(missing)
    return DispatchModel(
        model_platform=platform,
        model_type=(model_type or configured_type).strip(),
        api_key=api_key or _KEYLESS_PLACEHOLDER,
        api_url=api_url,
    )


def resolve_space_folder(space_root_path: str) -> Path:
    return Path(space_root_path).expanduser().resolve()


def space_id_for_folder(folder: Path) -> str:
    """A stable Space ID for a folder.

    The same folder is always the same Space, so its permission profile and
    approval rules carry over from one Task to the next.
    """

    digest = hashlib.sha256(
        os.path.normcase(str(folder)).encode("utf-8")
    ).hexdigest()
    return f"local-{digest[:20]}"
