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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  proxyFetchGet: vi.fn(),
}));

vi.mock('@/api/http', () => ({ proxyFetchGet: mocks.proxyFetchGet }));
vi.mock('@/store/sessionExecutionStore', () => ({
  readSessionExecutionRoute: async () => ({ route: 'legacy' }),
}));

import {
  ensureProjectRuntimeLoaded,
  withoutTriggerPlaceholderTasks,
} from '@/lib/projectRuntimeHydration';

const PLACEHOLDER = {
  id: 1,
  task_id: 'session-1',
  question: 'Project created via trigger: Daily',
};

describe('withoutTriggerPlaceholderTasks', () => {
  it('drops only the placeholder row keyed by the Session id', () => {
    const task = { id: 2, task_id: 'task-2', question: 'Hello' };
    const userText = {
      id: 3,
      task_id: 'task-3',
      question: 'Project created via trigger: typed by a user',
    };
    expect(
      withoutTriggerPlaceholderTasks([PLACEHOLDER, task, userText], 'session-1')
    ).toEqual([task, userText]);
    expect(withoutTriggerPlaceholderTasks(undefined, 'session-1')).toEqual([]);
  });
});

describe('ensureProjectRuntimeLoaded with only the placeholder', () => {
  beforeEach(() => {
    mocks.proxyFetchGet.mockReset();
  });

  it('opens an empty chat instead of replaying the placeholder', async () => {
    mocks.proxyFetchGet.mockResolvedValue({ tasks: [PLACEHOLDER] });
    const projectStore = {
      getProjectById: vi.fn(() => ({ id: 'session-1', metadata: {} })),
      peekActiveChatStore: vi.fn(() => null),
      historyLoadIncompleteProjectIds: {},
      appendInitChatStore: vi.fn(),
      loadProjectFromHistory: vi.fn(),
      mergeProjectHistory: vi.fn(),
      setProjectNavLead: vi.fn(),
      updateProject: vi.fn(),
    };

    await ensureProjectRuntimeLoaded(projectStore as any, 'session-1');

    expect(projectStore.appendInitChatStore).toHaveBeenCalledWith('session-1');
    expect(projectStore.loadProjectFromHistory).not.toHaveBeenCalled();
    expect(projectStore.mergeProjectHistory).not.toHaveBeenCalled();
  });

  it('merges only real Tasks into a Session that ran in the background', async () => {
    const task = { id: 2, task_id: 'task-2', question: 'Hello' };
    mocks.proxyFetchGet.mockResolvedValue({
      tasks: [PLACEHOLDER, task],
      last_prompt: 'Hello',
    });
    const projectStore = {
      getProjectById: vi.fn(() => ({
        id: 'session-1',
        metadata: { remoteHistoryHydrationPending: true },
      })),
      peekActiveChatStore: vi.fn(() => ({})),
      historyLoadIncompleteProjectIds: {},
      appendInitChatStore: vi.fn(),
      loadProjectFromHistory: vi.fn(),
      mergeProjectHistory: vi.fn(async () => undefined),
      setProjectNavLead: vi.fn(),
      updateProject: vi.fn(),
    };

    await ensureProjectRuntimeLoaded(projectStore as any, 'session-1');

    expect(projectStore.mergeProjectHistory).toHaveBeenCalledWith(
      'session-1',
      [task],
      'Hello'
    );
  });
});
