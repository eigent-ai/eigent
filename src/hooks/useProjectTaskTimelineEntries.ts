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

import type { ChatTimelineEntry } from '@/components/Session/HeaderBox/ChatTimeline';
import type { ChatStore } from '@/store/chatStore';
import { useMemo } from 'react';

/**
 * Task rows for ChatTimeline (shared by session header dropdown and ChatBox rail).
 * `chatStore` is a dependency so the list updates when the active chat store changes.
 */
export function useProjectTaskTimelineEntries(
  projectStore: {
    activeProjectId: string | null;
    getAllChatStores: (
      projectId: string
    ) => Array<{ chatId: string; chatStore: { getState: () => ChatStore } }>;
  },
  chatStore: ChatStore | null | undefined
): ChatTimelineEntry[] {
  return useMemo(() => {
    const pid = projectStore.activeProjectId;
    if (!pid) return [];
    const stores = projectStore.getAllChatStores(pid);
    const entries: ChatTimelineEntry[] = [];
    for (const { chatId, chatStore: cs } of stores) {
      const state = cs.getState();
      const tid = state.activeTaskId;
      if (!tid || !state.tasks[tid]) continue;
      const task = state.tasks[tid];
      const hasUserMessages = task.messages.some(
        (m) => m.role === 'user' && m.content
      );
      if (!hasUserMessages) continue;
      const firstUser = task.messages.find((m) => m.role === 'user');
      entries.push({
        chatId,
        taskId: tid,
        task,
        firstUserMessageId: firstUser?.id ?? null,
      });
    }
    return entries;
  }, [projectStore, chatStore]);
}
