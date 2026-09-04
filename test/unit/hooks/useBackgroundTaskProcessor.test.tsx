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

import { useBackgroundTaskProcessor } from '@/hooks/useBackgroundTaskProcessor';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const projectRuntimeStore = {
    getAllProjects: vi.fn(),
    getProjectById: vi.fn(),
    getChatStore: vi.fn(),
    appendInitChatStore: vi.fn(),
    markQueuedMessageAsProcessing: vi.fn(),
    removeQueuedMessage: vi.fn(),
  };
  const useProjectRuntimeStore = Object.assign(
    vi.fn(() => projectRuntimeStore),
    {
      getState: vi.fn(() => projectRuntimeStore),
      subscribe: vi.fn(() => vi.fn()),
    }
  );
  const triggerTaskStore = {
    registerExecutionMapping: vi.fn(),
  };

  return {
    closeIdleSSEConnectionsForTasks: vi.fn(),
    fetchGet: vi.fn(),
    fetchPost: vi.fn(),
    hasActiveSSEConnection: vi.fn(),
    hasSSETransportForTasks: vi.fn(),
    projectRuntimeStore,
    proxyUpdateTriggerExecution: vi.fn(() => Promise.resolve()),
    startTask: vi.fn(),
    triggerTaskStore,
    useProjectRuntimeStore,
  };
});

vi.mock('@/i18n', () => ({
  default: {
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue || _key,
  },
}));

vi.mock('@/api/http', () => ({
  fetchGet: mocks.fetchGet,
  fetchPost: mocks.fetchPost,
}));

vi.mock('@/lib', () => ({
  generateUniqueId: () => 'new-trigger-run',
}));

vi.mock('@/service/triggerApi', () => ({
  proxyUpdateTriggerExecution: mocks.proxyUpdateTriggerExecution,
}));

vi.mock('@/store/chatStore', () => ({
  closeIdleSSEConnectionsForTasks: mocks.closeIdleSSEConnectionsForTasks,
  hasActiveSSEConnection: mocks.hasActiveSSEConnection,
  hasSSETransportForTasks: mocks.hasSSETransportForTasks,
}));

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: mocks.useProjectRuntimeStore,
}));

vi.mock('@/store/triggerTaskStore', () => ({
  useTriggerTaskStore: () => mocks.triggerTaskStore,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

describe('useBackgroundTaskProcessor SSE admission', () => {
  let idleController: AbortController;
  let physicalTransportPresent: boolean;
  let sourceState: any;

  beforeEach(() => {
    vi.clearAllMocks();
    idleController = new AbortController();
    physicalTransportPresent = true;

    sourceState = {
      activeTaskId: 'ended-run',
      tasks: {
        'ended-run': {
          status: ChatTaskStatus.FINISHED,
          messages: [{ step: AgentStep.TO_SUB_TASKS, isConfirm: true }],
          hasWaitComfirm: false,
          isTakeControl: false,
        },
      },
      startTask: mocks.startTask,
    };
    const chatStore = { getState: () => sourceState };
    const project = {
      id: 'project-1',
      mode: 'single-agent',
      chatStores: { primary: chatStore },
      queuedMessages: [
        {
          task_id: 'queued-trigger',
          content: 'Run scheduled task',
          attaches: [],
          executionId: 'execution-1',
          triggerTaskId: 'trigger-task-1',
          triggerId: 42,
          triggerName: 'Scheduled trigger',
          timestamp: 1,
        },
      ],
    };

    mocks.projectRuntimeStore.getAllProjects.mockReturnValue([project]);
    mocks.projectRuntimeStore.getProjectById.mockReturnValue(project);
    mocks.projectRuntimeStore.getChatStore.mockReturnValue(chatStore);
    Object.assign(mocks.projectRuntimeStore, {
      projects: { 'project-1': project },
    });
    mocks.hasActiveSSEConnection.mockReturnValue(false);
    mocks.hasSSETransportForTasks.mockImplementation(
      () => physicalTransportPresent
    );
    mocks.closeIdleSSEConnectionsForTasks.mockImplementation(() => {
      idleController.abort();
      physicalTransportPresent = false;
    });
    mocks.fetchGet.mockResolvedValue({
      status: 'done',
      run_id: 'ended-run',
      consumer_alive: true,
      subscriber_count: 1,
    });
    mocks.fetchPost.mockResolvedValue({
      retired: true,
      consumer_alive: false,
    });
    mocks.startTask.mockImplementation(() => new Promise<void>(() => {}));
  });

  it('retires an attached warm consumer before starting a fresh trigger stream', async () => {
    const { unmount } = renderHook(() => useBackgroundTaskProcessor());

    await waitFor(() => expect(mocks.startTask).toHaveBeenCalledTimes(1));
    expect(mocks.fetchPost).toHaveBeenCalledWith(
      '/chat/project-1/runtime/retire-idle',
      { run_id: 'ended-run' }
    );
    expect(mocks.fetchPost.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.closeIdleSSEConnectionsForTasks.mock.invocationCallOrder[0]
    );
    expect(
      mocks.closeIdleSSEConnectionsForTasks.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.startTask.mock.invocationCallOrder[0]);
    expect(idleController.signal.aborted).toBe(true);
    expect(mocks.startTask).toHaveBeenCalledWith(
      'new-trigger-run',
      undefined,
      undefined,
      undefined,
      'Run scheduled task',
      [],
      'execution-1',
      'project-1'
    );

    // Re-entrant project-store notifications must see the execution guard and
    // cannot admit the same trigger twice.
    const subscription =
      mocks.useProjectRuntimeStore.subscribe.mock.calls[0][0];
    subscription();
    await Promise.resolve();
    expect(mocks.fetchPost).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('awaits backend retirement after the renderer subscriber is gone', async () => {
    physicalTransportPresent = false;
    let retirementCompleted = false;
    mocks.fetchPost.mockImplementation(async (url: string) => {
      expect(url).toBe('/chat/project-1/runtime/retire-idle');
      retirementCompleted = true;
      return { retired: true, consumer_alive: false };
    });
    mocks.startTask.mockImplementation(() => {
      expect(retirementCompleted).toBe(true);
      return new Promise<void>(() => {});
    });

    const { unmount } = renderHook(() => useBackgroundTaskProcessor());

    await waitFor(() => expect(mocks.startTask).toHaveBeenCalledTimes(1));
    expect(mocks.fetchPost).toHaveBeenCalledWith(
      '/chat/project-1/runtime/retire-idle',
      { run_id: 'ended-run' }
    );
    expect(mocks.fetchPost.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startTask.mock.invocationCallOrder[0]
    );
    expect(mocks.closeIdleSSEConnectionsForTasks).not.toHaveBeenCalled();

    unmount();
  });

  it('keeps a queued trigger pending when backend retirement fails', async () => {
    physicalTransportPresent = false;
    mocks.fetchPost.mockRejectedValue(new Error('retirement unavailable'));

    const { unmount } = renderHook(() => useBackgroundTaskProcessor());

    await waitFor(() => expect(mocks.fetchPost).toHaveBeenCalledTimes(1));
    expect(mocks.startTask).not.toHaveBeenCalled();
    expect(
      mocks.projectRuntimeStore.markQueuedMessageAsProcessing
    ).not.toHaveBeenCalled();
    expect(
      mocks.projectRuntimeStore.removeQueuedMessage
    ).not.toHaveBeenCalled();

    unmount();
  });

  it('closes a stale renderer transport when Brain has no consumer', async () => {
    mocks.fetchGet.mockResolvedValue({
      status: 'done',
      run_id: 'ended-run',
      consumer_alive: false,
      subscriber_count: 0,
    });
    mocks.startTask.mockImplementation(() => {
      expect(idleController.signal.aborted).toBe(true);
      expect(physicalTransportPresent).toBe(false);
      return new Promise<void>(() => {});
    });

    const { unmount } = renderHook(() => useBackgroundTaskProcessor());

    await waitFor(() => expect(mocks.startTask).toHaveBeenCalledTimes(1));
    expect(mocks.closeIdleSSEConnectionsForTasks).toHaveBeenCalledWith([
      'ended-run',
    ]);
    expect(
      mocks.closeIdleSSEConnectionsForTasks.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.startTask.mock.invocationCallOrder[0]);

    unmount();
  });

  it('does not close a transport or start a trigger while its Run is active', async () => {
    mocks.hasActiveSSEConnection.mockReturnValue(true);

    const { unmount } = renderHook(() => useBackgroundTaskProcessor());

    await waitFor(() =>
      expect(mocks.hasActiveSSEConnection).toHaveBeenCalledWith(['ended-run'])
    );
    expect(mocks.closeIdleSSEConnectionsForTasks).not.toHaveBeenCalled();
    expect(mocks.startTask).not.toHaveBeenCalled();
    expect(idleController.signal.aborted).toBe(false);

    unmount();
  });

  it('leaves a reusable transport open when the queue has no trigger execution', async () => {
    const project = mocks.projectRuntimeStore.getProjectById('project-1');
    project.queuedMessages[0].executionId = undefined;

    const { unmount } = renderHook(() => useBackgroundTaskProcessor());

    await waitFor(() =>
      expect(mocks.projectRuntimeStore.getProjectById).toHaveBeenCalledWith(
        'project-1'
      )
    );
    expect(mocks.hasActiveSSEConnection).not.toHaveBeenCalled();
    expect(mocks.closeIdleSSEConnectionsForTasks).not.toHaveBeenCalled();
    expect(mocks.startTask).not.toHaveBeenCalled();
    expect(idleController.signal.aborted).toBe(false);

    unmount();
  });
});
