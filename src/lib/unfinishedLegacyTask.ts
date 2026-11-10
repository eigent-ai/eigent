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

interface CloseGuardTask {
  type?: string;
  status: string;
  isPending: boolean;
  activeAsk: string;
}

/**
 * Whether this window holds a live task that has not finished: starting
 * (pending send), running, paused, or waiting for an answer. Replays and
 * shared views only display history. A fresh, empty task is also `pending`
 * but has nothing in flight, so status alone is not enough.
 */
export function hasUnfinishedLegacyTask(
  states: Iterable<{ tasks?: Record<string, CloseGuardTask> } | undefined>
): boolean {
  for (const state of states) {
    for (const task of Object.values(state?.tasks ?? {})) {
      if (task.type === 'replay' || task.type === 'share') continue;
      if (
        ['running', 'pause'].includes(task.status) ||
        task.isPending ||
        Boolean(task.activeAsk)
      ) {
        return true;
      }
    }
  }
  return false;
}
