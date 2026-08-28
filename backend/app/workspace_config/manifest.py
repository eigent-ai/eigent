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

"""Safe parser for shareable Workspace Bundle manifests."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from app.workspace_config.models import (
    WorkspaceBundleManifest,
    WorkspaceConfigError,
    assert_manifest_secret_free,
)


def parse_workspace_manifest(value: str | bytes) -> WorkspaceBundleManifest:
    try:
        payload: Any = yaml.safe_load(value)
    except yaml.YAMLError as exc:
        raise WorkspaceConfigError("invalid Workspace Bundle YAML") from exc
    if not isinstance(payload, dict):
        raise WorkspaceConfigError(
            "Workspace Bundle manifest must be a YAML mapping"
        )
    # Run this before Pydantic so callers receive the typed privacy-boundary
    # error instead of a generic wrapped ValidationError.
    assert_manifest_secret_free(payload)
    return WorkspaceBundleManifest.model_validate(payload)


def load_workspace_manifest(path: Path) -> WorkspaceBundleManifest:
    if path.name != "workspace.yaml":
        raise WorkspaceConfigError(
            "Workspace Bundle manifest must be named workspace.yaml"
        )
    return parse_workspace_manifest(path.read_text(encoding="utf-8"))
