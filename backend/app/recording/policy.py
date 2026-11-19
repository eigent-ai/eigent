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

"""Application-bound exclusions injected into transport-neutral snapshot ports."""

from collections.abc import Callable
from pathlib import Path


def managed_capture_exclusion(
    root: Path, *, tracked: Callable[[str], bool] | None = None
):
    from .runtime import is_reserved_recording

    def exclude(relative: str, is_directory: bool) -> bool:
        if not is_reserved_recording(root, relative):
            return False
        # A tracked subtree must be traversed so its tracked children survive;
        # only untracked, catalog-owned paths become operational media.
        return not (tracked and tracked(relative))

    return exclude


def coordinate_source_capture(provider, root: Path) -> None:
    """Use the same Space-folder lock for source snapshots and media publication."""
    from functools import wraps

    from app.utils.workspace_resolver import _filesystem_space_lock

    capture = provider.capture_source

    @wraps(capture)
    def capture_locked(*args, **kwargs):
        with _filesystem_space_lock(root):
            return capture(*args, **kwargs)

    provider.capture_source = capture_locked
