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

import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { createChatStoreInstance } from '@/store/chatStore';
import { useProjectStore } from '@/store/projectStore';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

describe('useChatStoreAdapter', () => {
  beforeEach(() => {
    useProjectStore.setState({
      activeProjectId: null,
      projects: {},
      navLeadByProjectId: {},
      historyLoadingProjectIds: {},
      staleProjectIds: new Set(),
    });
  });

  it('never combines a newly selected Project with the previous chat state', () => {
    const firstProjectId = 'project_first';
    const firstTaskId = 'task_first';
    const firstChatStore = createChatStoreInstance();
    firstChatStore.getState().create(firstTaskId);
    const secondProjectId = 'project_second';
    const secondTaskId = 'task_second';
    const secondChatStore = createChatStoreInstance();
    secondChatStore.getState().create(secondTaskId);
    useProjectStore.setState({
      activeProjectId: firstProjectId,
      projects: {
        [firstProjectId]: {
          id: firstProjectId,
          name: 'First',
          createdAt: 1,
          updatedAt: 1,
          mode: null,
          workdirMode: null,
          chatStores: { chat_first: firstChatStore },
          chatStoreTimestamps: { chat_first: 1 },
          activeChatId: 'chat_first',
          queuedMessages: [],
          metadata: {},
        },
        [secondProjectId]: {
          id: secondProjectId,
          name: 'Second',
          createdAt: 2,
          updatedAt: 2,
          mode: null,
          workdirMode: null,
          chatStores: { chat_second: secondChatStore },
          chatStoreTimestamps: { chat_second: 2 },
          activeChatId: 'chat_second',
          queuedMessages: [],
          metadata: {},
        },
      },
    });

    const observedFrames: Array<{
      projectId: string | null;
      taskId: string | null | undefined;
    }> = [];
    const { result } = renderHook(() => {
      const adapter = useChatStoreAdapter();
      observedFrames.push({
        projectId: adapter.projectStore.activeProjectId,
        taskId: adapter.chatStore?.activeTaskId,
      });
      return adapter;
    });
    expect(result.current.chatStore.activeTaskId).toBe(firstTaskId);
    observedFrames.length = 0;

    act(() => {
      useProjectStore.getState().setActiveProject(secondProjectId);
    });

    expect(result.current.chatStore.activeTaskId).toBe(secondTaskId);
    expect(
      observedFrames.filter(({ projectId }) => projectId === secondProjectId)
    ).toEqual([{ projectId: secondProjectId, taskId: secondTaskId }]);
  });
});
