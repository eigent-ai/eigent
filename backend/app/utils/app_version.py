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

"""The desktop app version, with the root ``package.json`` as its only source.

The Electron Host passes ``app.getVersion()`` to the Brain as
``EIGENT_APP_VERSION``. A Brain started from a source checkout without the
Host falls back to the repository's ``package.json``.
"""

import json
import logging
import os
import re
from collections.abc import Mapping
from pathlib import Path

logger = logging.getLogger("app_version")

APP_VERSION_ENV_KEY = "EIGENT_APP_VERSION"
UNKNOWN_APP_VERSION = "unknown"

# The version becomes part of directory names, so only accept plain version
# characters (no separators or "..").
_VERSION_PATTERN = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$")

_REPO_PACKAGE_JSON = Path(__file__).resolve().parents[3] / "package.json"


def _valid(candidate: object) -> str | None:
    if not isinstance(candidate, str):
        return None
    value = candidate.strip()
    if not _VERSION_PATTERN.fullmatch(value) or ".." in value:
        return None
    return value


def _version_from_package_json(path: Path) -> str | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    return _valid(data.get("version"))


def resolve_app_version(
    environ: Mapping[str, str] | None = None,
    package_json: Path | None = None,
) -> str:
    """Return the app version: Host env first, then ``package.json``."""

    source = os.environ if environ is None else environ
    raw = source.get(APP_VERSION_ENV_KEY)
    if raw:
        from_env = _valid(raw)
        if from_env:
            return from_env
        logger.warning("Ignoring invalid %s value", APP_VERSION_ENV_KEY)

    from_file = _version_from_package_json(
        _REPO_PACKAGE_JSON if package_json is None else package_json
    )
    if from_file:
        return from_file

    logger.warning(
        "App version unavailable; set %s or run from a source checkout",
        APP_VERSION_ENV_KEY,
    )
    return UNKNOWN_APP_VERSION
