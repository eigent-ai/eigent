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

"""Local-first Project memory (see docs/core/space-project-memory-local-first-design.md).

Provides schema dataclasses, path helpers, LocalMemoryStore, context assembly,
and best-effort runtime lifecycle hooks for chat_controller, Single Agent, and
Workforce.
"""

from app.memory.context_builder import (
    AgentContextBundle,
    ContextMode,
    ProjectContextBuilder,
)
from app.memory.events import (
    SCHEMA_VERSION,
    ConversationEvent,
    MemoryArtifact,
    MemoryFact,
    ProjectMemory,
    RunMemory,
    RunStatus,
    SpaceMemory,
    SyncSettings,
    ToolEvent,
)
from app.memory.local_store import LocalMemoryStore
from app.memory.paths import (
    canonical_user_id,
    memory_root,
    project_dir,
    run_dir,
    space_dir,
    user_dir,
)
from app.memory.service import (
    MemoryService,
    build_durable_context_for_task_lock,
    finalize_task_lock_run_memory,
    get_memory_service,
)

__all__ = [
    "SCHEMA_VERSION",
    "AgentContextBundle",
    "ContextMode",
    "ConversationEvent",
    "LocalMemoryStore",
    "MemoryArtifact",
    "MemoryFact",
    "MemoryService",
    "ProjectContextBuilder",
    "ProjectMemory",
    "RunMemory",
    "RunStatus",
    "SpaceMemory",
    "SyncSettings",
    "ToolEvent",
    "build_durable_context_for_task_lock",
    "canonical_user_id",
    "finalize_task_lock_run_memory",
    "get_memory_service",
    "memory_root",
    "project_dir",
    "run_dir",
    "space_dir",
    "user_dir",
]
