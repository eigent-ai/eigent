// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import type { MemoryEntry } from '@/service/memoryApi';

/**
 * An Agent-proposed rule the user has not accepted or dismissed. It stays out
 * of Agent context until accepted; mirrors the backend's pending state.
 */
export const isPendingMemorySuggestion = (
  entry: Pick<
    MemoryEntry,
    'created_by' | 'kind' | 'confirmed_by_user' | 'deleted_at'
  >
) =>
  entry.created_by === 'agent' &&
  (entry.kind === 'preference' || entry.kind === 'constraint') &&
  !entry.confirmed_by_user &&
  !entry.deleted_at;
