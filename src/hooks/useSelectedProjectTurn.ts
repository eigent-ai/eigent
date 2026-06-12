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

import type { ChatStore, VanillaChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useCallback, useSyncExternalStore } from 'react';

export interface SelectedProjectTurn {
  chatId: string | null;
  chatStore: VanillaChatStore | null;
  task: ChatStore['tasks'][string] | undefined;
  taskId: string | null;
}

export function useSelectedProjectTurn(
  projectId: string | null | undefined
): SelectedProjectTurn {
  const projectStore = useProjectRuntimeStore();
  const selectedTaskId = usePageTabStore((state) =>
    projectId ? state.sidePanelSelectedTurnByProject[projectId] : undefined
  );

  let chatId: string | null = null;
  let chatStore: VanillaChatStore | null = null;
  let taskId = selectedTaskId ?? null;

  if (projectId && taskId) {
    for (const entry of projectStore.getAllChatStores(projectId)) {
      if (entry.chatStore.getState().tasks[taskId]) {
        chatId = entry.chatId;
        chatStore = entry.chatStore;
        break;
      }
    }
  }

  if (projectId && !chatStore) {
    const activeStore = projectStore.getActiveChatStore(projectId);
    const activeTaskId = activeStore?.getState().activeTaskId ?? null;
    if (activeStore && activeTaskId) {
      const project = projectStore.projects[projectId];
      chatId =
        Object.entries(project?.chatStores ?? {}).find(
          ([, store]) => store === activeStore
        )?.[0] ?? null;
      chatStore = activeStore;
      taskId = activeTaskId;
    }
  }

  const subscribe = useCallback(
    (listener: () => void) => chatStore?.subscribe(listener) ?? (() => {}),
    [chatStore]
  );
  const getSnapshot = useCallback(
    () => chatStore?.getState() ?? null,
    [chatStore]
  );
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    chatId,
    chatStore,
    task: taskId ? state?.tasks[taskId] : undefined,
    taskId,
  };
}
