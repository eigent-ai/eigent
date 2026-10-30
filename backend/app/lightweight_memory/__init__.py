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

"""Lightweight, bounded Memory and canonical History retrieval."""

from app.lightweight_memory.legacy_importer import (
    LegacyMemoryImportResult,
    LegacyMemoryV1Importer,
    migrate_legacy_memory_v1_on_startup,
)
from app.lightweight_memory.maintainer import (
    ConservativeMemoryExtractor,
    IncrementalMemoryMaintainer,
    ProposedMemoryMutation,
    schedule_project_memory_maintenance,
)
from app.lightweight_memory.service import (
    HistoryQueryPage,
    HistoryQueryResult,
    LightweightMemoryService,
    MemoryConsolidationResult,
    get_lightweight_memory_service,
)

__all__ = [
    "HistoryQueryPage",
    "HistoryQueryResult",
    "ConservativeMemoryExtractor",
    "IncrementalMemoryMaintainer",
    "LegacyMemoryImportResult",
    "LegacyMemoryV1Importer",
    "LightweightMemoryService",
    "MemoryConsolidationResult",
    "ProposedMemoryMutation",
    "schedule_project_memory_maintenance",
    "get_lightweight_memory_service",
    "migrate_legacy_memory_v1_on_startup",
]
