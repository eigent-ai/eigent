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

from app.file_access import LocalFileAccess
from app.utils.workspace_paths import get_workspace_root

_instance: LocalFileAccess | None = None


def get_file_access() -> LocalFileAccess:
    global _instance
    if _instance is None:
        _instance = LocalFileAccess(workspace_root=str(get_workspace_root()))
    return _instance
