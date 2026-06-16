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

from app.core.environment import env

LOCAL_FILE_OPS_DISABLED_MESSAGE = "Folder Space local file operations are disabled on this server"


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def local_file_operations_enabled() -> bool:
    """Whether this server may touch host paths for folder-backed Spaces."""

    return _truthy(env("SPACE_LOCAL_FILE_OPERATIONS_ENABLED", "false"))


def assert_local_file_operations_enabled() -> None:
    if not local_file_operations_enabled():
        raise ValueError(LOCAL_FILE_OPS_DISABLED_MESSAGE)
