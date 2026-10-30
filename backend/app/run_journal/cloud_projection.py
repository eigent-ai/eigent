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

"""Cloud-safe projection shared by Run upload and bootstrap comparison."""

from __future__ import annotations

import copy
import re
from pathlib import PurePath
from typing import Any
from urllib.parse import urlsplit


def cloud_resource_label(value: Any) -> str:
    resource = str(value)
    parsed = urlsplit(resource)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    if resource.startswith(("/", "~", "\\\\")) or re.match(
        r"^[A-Za-z]:[\\/]", resource
    ):
        normalized_path = resource.replace("\\", "/")
        return f"[local]/{PurePath(normalized_path).name}"
    return resource


def cloud_event_payload(
    event_type: str, payload: dict[str, Any]
) -> dict[str, Any]:
    """Return the deterministic, redacted Cloud representation of an event."""

    projected = copy.deepcopy(payload)
    if event_type.startswith("artifact."):
        projected.pop("path", None)
        projected["localPathAvailable"] = False
        artifacts = projected.get("artifacts")
        if isinstance(artifacts, list):
            for artifact in artifacts:
                if isinstance(artifact, dict):
                    artifact.pop("path", None)
                    artifact["localPathAvailable"] = False
        return projected
    if event_type != "approval.requested":
        return projected
    prompt = projected.get("prompt")
    if not isinstance(prompt, dict):
        return projected
    resources = prompt.get("target_resources")
    if isinstance(resources, list):
        prompt["target_resources"] = [
            cloud_resource_label(item) for item in resources
        ]
    action = prompt.get("action")
    if isinstance(action, dict):
        action.pop("normalized_arguments", None)
        action_resources = action.get("target_resources")
        if isinstance(action_resources, list):
            action["target_resources"] = [
                cloud_resource_label(item) for item in action_resources
            ]
    matcher = prompt.get("rule_matcher")
    if isinstance(matcher, dict) and isinstance(
        matcher.get("resource_pattern"), str
    ):
        matcher["resource_pattern"] = cloud_resource_label(
            matcher["resource_pattern"]
        )
    return projected
