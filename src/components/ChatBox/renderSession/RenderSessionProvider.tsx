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

import { fetchPost } from '@/api/http';
import { generateUniqueId } from '@/lib';
import type { VanillaChatStore } from '@/store/chatStore';
import { useProjectStore } from '@/store/projectStore';
import { ChatTaskStatus } from '@/types/constants';
import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { normalizeMessagesToChatTurns } from './normalizeMessages';
import type { ChatTurn } from './types';

interface RenderSessionContextValue {
  chatTurns: ChatTurn[];
  projectId: string | null;
  taskId: string | null;
  activeAsk: string;
  submitReply: (reply: string, agentName: string) => Promise<void>;
}

export const RenderSessionContext = createContext<RenderSessionContextValue>({
  chatTurns: [],
  projectId: null,
  taskId: null,
  activeAsk: '',
  submitReply: async () => {},
});

interface RenderSessionProviderProps {
  chatStore: VanillaChatStore;
  children: React.ReactNode;
}

export const RenderSessionProvider: React.FC<RenderSessionProviderProps> = ({
  chatStore,
  children,
}) => {
  const projectId = useProjectStore((s) => s.activeProjectId);
  const chatState = chatStore.getState();
  const taskId = chatState.activeTaskId;
  const task = taskId ? chatState.tasks[taskId] : null;

  const chatTurns = useMemo(() => {
    if (!task) return [];
    return normalizeMessagesToChatTurns({
      messages: task.messages,
      activeAsk: task.activeAsk,
      taskId: taskId!,
      taskRunning: task.status === ChatTaskStatus.RUNNING,
    });
  }, [task, taskId]);

  const submitReply = useCallback(
    async (reply: string, agentName: string) => {
      if (!taskId || !projectId) return;
      const state = chatStore.getState();
      const t = state.tasks[taskId];
      if (!t) return;

      state.addMessages(taskId, {
        id: generateUniqueId(),
        role: 'user',
        content: reply,
        attaches: JSON.parse(JSON.stringify(t.attaches || [])),
      });

      state.setIsPending(taskId, true);

      await fetchPost(`/chat/${projectId}/human-reply`, {
        agent: agentName,
        reply,
      });

      state.setAttaches(taskId, []);

      const fresh = chatStore.getState().tasks[taskId];
      if (!fresh) return;

      if (fresh.askList.length === 0) {
        state.setActiveAsk(taskId, '');
      } else {
        const queue = [...fresh.askList];
        const next = queue.shift()!;
        state.setActiveAskList(taskId, queue);
        state.setActiveAsk(taskId, next.agent_name || '');
        state.setIsPending(taskId, false);
        state.addMessages(taskId, next);
      }
    },
    [chatStore, taskId, projectId]
  );

  const value = useMemo(
    () => ({
      chatTurns,
      projectId,
      taskId,
      activeAsk: task?.activeAsk ?? '',
      submitReply,
    }),
    [chatTurns, projectId, taskId, task?.activeAsk, submitReply]
  );

  return (
    <RenderSessionContext.Provider value={value}>
      {children}
    </RenderSessionContext.Provider>
  );
};

export function useRenderSession(): RenderSessionContextValue {
  return useContext(RenderSessionContext);
}
