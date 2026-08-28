# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

"""Conservative local Git retention and large-repository contracts."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class GitRetentionPolicy:
    """Phase-6 defaults; object deletion is never an automatic side effect."""

    schema_version: int = 1
    undo_window_ms: int = 7 * 24 * 60 * 60 * 1000
    archive_ref_retention_ms: int = 90 * 24 * 60 * 60 * 1000
    project_archive_ref_retention_ms: int = 180 * 24 * 60 * 60 * 1000
    automatic_archive_ref_deletion: bool = False
    automatic_object_gc: bool = False
    large_repository_warning_bytes: int = 1024 * 1024 * 1024
    lfs_recommendation_blob_bytes: int = 100 * 1024 * 1024

    def to_dict(self) -> dict[str, int | bool]:
        return asdict(self)


DEFAULT_GIT_RETENTION_POLICY = GitRetentionPolicy()
