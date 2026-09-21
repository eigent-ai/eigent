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
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import * as authStore from '@/store/authStore';
import { ExecutionStatus } from '@/types';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const projectRuntimeStore = {
    getAllProjects: vi.fn(),
    getProjectById: vi.fn(),
    getChatStore: vi.fn(),
    appendInitChatStore: vi.fn(),
    markQueuedMessageAsProcessing: vi.fn(),
    setQueuedMessageProcessing: vi.fn(),
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
    flushPendingTriggerExecutionUpdates: vi.fn(() => Promise.resolve()),
    hasActiveSSEConnection: vi.fn(),
    hasSSETransportForTasks: vi.fn(),
    projectRuntimeStore,
    proxyUpdateTriggerExecution: vi.fn(() => Promise.resolve()),
    startTask: vi.fn(),
    triggerTaskStore,
    useProjectRuntimeStore,
    waitForIdleSSEDisplayTail: vi.fn(),
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
  flushPendingTriggerExecutionUpdates:
    mocks.flushPendingTriggerExecutionUpdates,
  proxyUpdateTriggerExecution: mocks.proxyUpdateTriggerExecution,
}));

vi.mock('@/store/chatStore', () => ({
  closeIdleSSEConnectionsForTasks: mocks.closeIdleSSEConnectionsForTasks,
  hasActiveSSEConnection: mocks.hasActiveSSEConnection,
  hasSSETransportForTasks: mocks.hasSSETransportForTasks,
  waitForIdleSSEDisplayTail: mocks.waitForIdleSSEDisplayTail,
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
    mocks.projectRuntimeStore.markQueuedMessageAsProcessing.mockImplementation(
      (_projectId: string, taskId: string) => {
        project.queuedMessages = project.queuedMessages.map((message) =>
          message.task_id === taskId
            ? { ...message, processing: true }
            : message
        );
      }
    );
    Object.assign(mocks.projectRuntimeStore, {
      projects: { 'project-1': project },
    });
    mocks.hasActiveSSEConnection.mockReturnValue(false);
    mocks.waitForIdleSSEDisplayTail.mockResolvedValue(undefined);
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

  it('reconciles receipts at startup and periodically without dispatching a Run, and stops on unmount', async () => {
    vi.useFakeTimers();
    mocks.projectRuntimeStore.getAllProjects.mockReturnValue([]);
    const { unmount } = renderHook(() => useBackgroundTaskProcessor());
    try {
      expect(mocks.flushPendingTriggerExecutionUpdates).toHaveBeenCalledTimes(
        1
      );
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(mocks.flushPendingTriggerExecutionUpdates).toHaveBeenCalledTimes(
        2
      );
      expect(mocks.startTask).not.toHaveBeenCalled();
      expect(mocks.fetchPost).not.toHaveBeenCalled();
      unmount();
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(mocks.flushPendingTriggerExecutionUpdates).toHaveBeenCalledTimes(
        2
      );
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('reports pre-admission failure under the submitting account after an account switch', async () => {
    const originalAccount = { user_id: 1, email: 'one@example.invalid' };
    const account = vi
      .spyOn(authStore, 'getAuthStore')
      .mockReturnValue(originalAccount as any);
    const expectedAccount = getAccountEnvironmentKey(originalAccount);
    let rejectAdmission!: (error: Error) => void;
    mocks.startTask.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectAdmission = reject;
        })
    );
    const { unmount } = renderHook(() => useBackgroundTaskProcessor());
    try {
      await waitFor(() => expect(mocks.startTask).toHaveBeenCalledTimes(1));
      account.mockReturnValue({
        user_id: 2,
        email: 'two@example.invalid',
      } as any);
      await act(async () =>
        rejectAdmission(new Error('local preflight failed'))
      );
      expect(mocks.proxyUpdateTriggerExecution).toHaveBeenCalledWith(
        'execution-1',
        expect.objectContaining({ status: ExecutionStatus.Failed }),
        expect.objectContaining({ projectId: 'project-1' }),
        expectedAccount
      );
    } finally {
      unmount();
      account.mockRestore();
    }
  });

  it('retires an attached warm consumer before starting a fresh trigger stream', async () => {
    const { unmount } = renderHook(() => useBackgroundTaskProcessor());

    await waitFor(() => expect(mocks.startTask).toHaveBeenCalledTimes(1));
    expect(mocks.fetchPost).toHaveBeenCalledWith(
      '/chat/project-1/runtime/retire-idle',
      { run_id: 'ended-run' },
      undefined,
      { signal: expect.any(AbortSignal) }
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
      'project-1',
      undefined,
      { preserveTaskId: true, awaitAdmission: true }
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

  describe.each(['status', 'retirement'] as const)(
    'bounded %s requests',
    (stage) => {
      beforeEach(() => {
        vi.useFakeTimers();
        const first = mocks.projectRuntimeStore.getProjectById('project-1');
        const second = {
          ...first,
          id: 'project-2',
          queuedMessages: [
            {
              ...first.queuedMessages[0],
              task_id: 'queued-trigger-2',
              executionId: 'execution-2',
            },
          ],
        };
        const projects: Record<string, typeof first> = {
          'project-1': first,
          'project-2': second,
        };
        mocks.projectRuntimeStore.getAllProjects.mockReturnValue(
          Object.values(projects)
        );
        mocks.projectRuntimeStore.getProjectById.mockImplementation(
          (id: string) => projects[id]
        );
        mocks.projectRuntimeStore.getChatStore.mockImplementation(
          (id: string) => projects[id].chatStores.primary
        );
        mocks.projectRuntimeStore.markQueuedMessageAsProcessing.mockImplementation(
          (id: string, taskId: string) => {
            projects[id].queuedMessages = projects[id].queuedMessages.map(
              (message: { task_id: string }) =>
                message.task_id === taskId
                  ? { ...message, processing: true }
                  : message
            );
          }
        );
        Object.assign(mocks.projectRuntimeStore, { projects });
        mocks.hasSSETransportForTasks.mockReturnValue(false);
      });

      afterEach(() => vi.useRealTimers());

      const suspendFirstProject = () => {
        let resolveRequest!: (value: unknown) => void;
        // Deliberately ignore AbortSignal: the hook must also bound async
        // readiness/header work that has not reached fetch yet.
        const request = new Promise((resolve) => {
          resolveRequest = resolve;
        });
        let suspendedSignal!: AbortSignal;
        let suspended = false;
        let retryAllowed = false;
        const successfulSignals: AbortSignal[] = [];
        const events: string[] = [];
        mocks.fetchGet.mockImplementation(
          async (
            url: string,
            _params: unknown,
            _headers: unknown,
            { signal }: { signal: AbortSignal }
          ) => {
            if (url.includes('/project-2/')) {
              successfulSignals.push(signal);
              return { consumer_alive: false };
            }
            if (stage === 'status' && !suspended) {
              suspended = true;
              suspendedSignal = signal;
              return request;
            }
            successfulSignals.push(signal);
            if (retryAllowed) events.push('fresh-status');
            return {
              status: !suspended || retryAllowed ? 'done' : 'running',
              run_id: 'ended-run',
              consumer_alive: true,
            };
          }
        );
        mocks.fetchPost.mockImplementation(
          async (
            _url: string,
            _data: unknown,
            _headers: unknown,
            { signal }: { signal: AbortSignal }
          ) => {
            if (stage === 'retirement' && !suspended) {
              suspended = true;
              suspendedSignal = signal;
              return request;
            }
            successfulSignals.push(signal);
            events.push('retired');
            return { retired: true, consumer_alive: false };
          }
        );
        mocks.startTask.mockImplementation((...args: unknown[]) => {
          events.push(`start:${args[7]}`);
          return new Promise<void>(() => {});
        });
        return {
          signal: () => suspendedSignal,
          resolve: () => resolveRequest({ consumer_alive: false }),
          allowRetry: () => {
            retryAllowed = true;
          },
          successfulSignals,
          events,
        };
      };

      it('skips a hung Session without treating timeout as retirement, then retries ownership afresh', async () => {
        const pending = suspendFirstProject();
        const { unmount } = renderHook(() => useBackgroundTaskProcessor());
        await act(async () => vi.advanceTimersByTimeAsync(0));
        const fetch = stage === 'status' ? mocks.fetchGet : mocks.fetchPost;
        expect(fetch).toHaveBeenCalledTimes(1);
        const subscription =
          mocks.useProjectRuntimeStore.subscribe.mock.calls[0][0];

        await act(async () => {
          subscription();
          subscription();
          await vi.advanceTimersByTimeAsync(9_999);
        });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(mocks.startTask).not.toHaveBeenCalled();
        expect(pending.signal().aborted).toBe(false);

        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(pending.signal().aborted).toBe(true);
        expect(mocks.startTask).toHaveBeenCalledTimes(1);
        expect(mocks.startTask.mock.calls[0][7]).toBe('project-2');
        expect(
          mocks.projectRuntimeStore.markQueuedMessageAsProcessing
        ).not.toHaveBeenCalledWith('project-1', 'queued-trigger');
        expect(mocks.closeIdleSSEConnectionsForTasks).not.toHaveBeenCalled();

        // Even a successful late retirement response cannot resume the old
        // attempt or consume its still-pending queue row.
        await act(async () => pending.resolve());
        expect(mocks.startTask).toHaveBeenCalledTimes(1);
        expect(
          mocks.projectRuntimeStore.getProjectById('project-1')
            .queuedMessages[0].processing
        ).not.toBe(true);

        pending.allowRetry();
        await act(async () => vi.advanceTimersByTimeAsync(2_000));
        expect(pending.events).toEqual([
          'start:project-2',
          'fresh-status',
          'retired',
          'start:project-1',
        ]);
        await act(async () => {
          subscription();
          await vi.advanceTimersByTimeAsync(20_000);
        });
        expect(mocks.startTask).toHaveBeenCalledTimes(2);
        expect(
          pending.successfulSignals.every((signal) => !signal.aborted)
        ).toBe(true);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
      });

      it('aborts on unmount and cannot start either Session from a late response', async () => {
        const pending = suspendFirstProject();
        const { unmount } = renderHook(() => useBackgroundTaskProcessor());
        await act(async () => vi.advanceTimersByTimeAsync(0));
        expect(pending.signal().aborted).toBe(false);

        await act(async () => {
          unmount();
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(pending.signal().aborted).toBe(true);
        await act(async () => {
          pending.resolve();
          await vi.advanceTimersByTimeAsync(20_000);
        });
        expect(vi.getTimerCount()).toBe(0);
        expect(mocks.startTask).not.toHaveBeenCalled();
        expect(mocks.closeIdleSSEConnectionsForTasks).not.toHaveBeenCalled();
        expect(
          mocks.projectRuntimeStore.markQueuedMessageAsProcessing
        ).not.toHaveBeenCalled();
        expect(
          mocks.fetchGet.mock.calls.every(
            ([url]) => !url.includes('/project-2/')
          )
        ).toBe(true);
      });
    }
  );

  it.each([true, false])(
    'waits for the display tail before retirement/close when consumer_alive is %s',
    async (consumerAlive) => {
      let releaseDisplay!: () => void;
      mocks.waitForIdleSSEDisplayTail.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          releaseDisplay = resolve;
        })
      );
      mocks.fetchGet.mockResolvedValue({
        status: 'done',
        run_id: 'ended-run',
        consumer_alive: consumerAlive,
      });
      const { unmount } = renderHook(() => useBackgroundTaskProcessor());
      await waitFor(() =>
        expect(mocks.waitForIdleSSEDisplayTail).toHaveBeenCalledOnce()
      );
      expect(mocks.fetchPost).not.toHaveBeenCalled();
      expect(mocks.closeIdleSSEConnectionsForTasks).not.toHaveBeenCalled();
      expect(mocks.startTask).not.toHaveBeenCalled();

      await act(async () => releaseDisplay());
      await waitFor(() => expect(mocks.startTask).toHaveBeenCalledOnce());
      expect(mocks.fetchPost).toHaveBeenCalledTimes(consumerAlive ? 1 : 0);
      expect(
        mocks.waitForIdleSSEDisplayTail.mock.invocationCallOrder[0]
      ).toBeLessThan(
        mocks.closeIdleSSEConnectionsForTasks.mock.invocationCallOrder[0]
      );
      unmount();
    }
  );

  it('continues to another Session after the display barrier resolves and its first queue row was cancelled', async () => {
    const first = mocks.projectRuntimeStore.getProjectById('project-1');
    const second = {
      ...first,
      id: 'project-2',
      queuedMessages: [
        {
          ...first.queuedMessages[0],
          task_id: 'queued-2',
          executionId: 'execution-2',
        },
      ],
    };
    mocks.projectRuntimeStore.getAllProjects.mockReturnValue([first, second]);
    mocks.projectRuntimeStore.getProjectById.mockImplementation((id) =>
      id === first.id ? first : second
    );
    mocks.projectRuntimeStore.markQueuedMessageAsProcessing.mockImplementation(
      (id, taskId) => {
        const project = id === first.id ? first : second;
        project.queuedMessages = project.queuedMessages.map((msg: any) =>
          msg.task_id === taskId ? { ...msg, processing: true } : msg
        );
      }
    );
    let releaseDisplay!: () => void;
    mocks.waitForIdleSSEDisplayTail.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseDisplay = resolve;
      })
    );
    const { unmount } = renderHook(() => useBackgroundTaskProcessor());
    await waitFor(() =>
      expect(mocks.waitForIdleSSEDisplayTail).toHaveBeenCalledOnce()
    );
    first.queuedMessages = [];
    await act(async () => releaseDisplay());
    await waitFor(() => expect(mocks.startTask).toHaveBeenCalledOnce());
    expect(mocks.startTask.mock.calls[0][7]).toBe('project-2');
    expect(mocks.fetchPost.mock.calls.map(([url]) => url)).toEqual([
      '/chat/project-2/runtime/retire-idle',
    ]);
    unmount();
  });

  it('does not retire or admit after unmount while waiting for the display tail', async () => {
    let releaseDisplay!: () => void;
    mocks.waitForIdleSSEDisplayTail.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseDisplay = resolve;
      })
    );
    const { unmount } = renderHook(() => useBackgroundTaskProcessor());
    await waitFor(() =>
      expect(mocks.waitForIdleSSEDisplayTail).toHaveBeenCalledOnce()
    );
    unmount();
    await act(async () => releaseDisplay());
    expect(mocks.fetchPost).not.toHaveBeenCalled();
    expect(mocks.closeIdleSSEConnectionsForTasks).not.toHaveBeenCalled();
    expect(mocks.startTask).not.toHaveBeenCalled();
  });

  describe.each(['status', 'display tail', 'retirement'] as const)(
    'queue changes while awaiting %s',
    (stage) => {
      const suspendOwnershipRequest = () => {
        let resolveRequest!: (value: unknown) => void;
        const request = new Promise((resolve) => {
          resolveRequest = resolve;
        });
        const fetch =
          stage === 'status'
            ? mocks.fetchGet
            : stage === 'display tail'
              ? mocks.waitForIdleSSEDisplayTail
              : mocks.fetchPost;
        fetch.mockReturnValueOnce(request);
        return {
          fetch,
          finish: () => resolveRequest({ consumer_alive: false }),
        };
      };

      it('does not start an execution removed by queue cancellation', async () => {
        const { fetch, finish } = suspendOwnershipRequest();
        const project = mocks.projectRuntimeStore.getProjectById('project-1');
        const { unmount } = renderHook(() => useBackgroundTaskProcessor());
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

        project.queuedMessages = [];
        await act(async () => finish());

        expect(mocks.startTask).not.toHaveBeenCalled();
        expect(mocks.proxyUpdateTriggerExecution).not.toHaveBeenCalled();
        expect(
          mocks.projectRuntimeStore.markQueuedMessageAsProcessing
        ).not.toHaveBeenCalled();
        expect(mocks.closeIdleSSEConnectionsForTasks).not.toHaveBeenCalled();
        if (stage !== 'retirement')
          expect(mocks.fetchPost).not.toHaveBeenCalled();
        unmount();
      });

      it.each(['running', 'pending', 'logical SSE'])(
        'defers to a new foreground Run with %s state',
        async (state) => {
          const { fetch, finish } = suspendOwnershipRequest();
          const project = mocks.projectRuntimeStore.getProjectById('project-1');
          const { unmount } = renderHook(() => useBackgroundTaskProcessor());
          await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

          // A foreground start creates a new chat store before its async
          // preparation registers a backend consumer or an SSE controller.
          project.chatStores = {
            ...project.chatStores,
            foreground: {
              getState: () => ({
                tasks: {
                  'new-foreground-run': {
                    status:
                      state === 'running'
                        ? ChatTaskStatus.RUNNING
                        : state === 'pending'
                          ? ChatTaskStatus.PENDING
                          : ChatTaskStatus.FINISHED,
                    messages: [{ role: 'user', content: 'Foreground task' }],
                    hasWaitComfirm: false,
                    isTakeControl: false,
                  },
                },
              }),
            },
          };
          if (state === 'logical SSE') {
            mocks.hasActiveSSEConnection.mockImplementation((taskIds) =>
              taskIds.includes('new-foreground-run')
            );
          }
          await act(async () => finish());

          expect(mocks.startTask).not.toHaveBeenCalled();
          expect(mocks.proxyUpdateTriggerExecution).not.toHaveBeenCalled();
          expect(
            mocks.projectRuntimeStore.markQueuedMessageAsProcessing
          ).not.toHaveBeenCalled();
          expect(mocks.closeIdleSSEConnectionsForTasks).not.toHaveBeenCalled();
          if (stage !== 'retirement')
            expect(mocks.fetchPost).not.toHaveBeenCalled();
          expect(project.queuedMessages).toHaveLength(1);
          unmount();
        }
      );

      it('defers to pending admission on the same existing Run', async () => {
        const { fetch, finish } = suspendOwnershipRequest();
        const { unmount } = renderHook(() => useBackgroundTaskProcessor());
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        sourceState.tasks['ended-run'].isPending = true;
        await act(async () => finish());
        expect(mocks.startTask).not.toHaveBeenCalled();
        expect(mocks.closeIdleSSEConnectionsForTasks).not.toHaveBeenCalled();
        expect(
          mocks.projectRuntimeStore.markQueuedMessageAsProcessing
        ).not.toHaveBeenCalled();
        if (stage !== 'retirement')
          expect(mocks.fetchPost).not.toHaveBeenCalled();
        unmount();
      });

      it.each([
        { task_id: 'replacement-task' },
        { executionId: 'replacement-execution' },
        { timestamp: 2 },
      ])(
        'does not claim a replacement queue identity %j',
        async (replacement) => {
          const { fetch, finish } = suspendOwnershipRequest();
          const project = mocks.projectRuntimeStore.getProjectById('project-1');
          const { unmount } = renderHook(() => useBackgroundTaskProcessor());
          await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

          project.queuedMessages = [
            { ...project.queuedMessages[0], ...replacement },
          ];
          await act(async () => finish());

          expect(mocks.startTask).not.toHaveBeenCalled();
          expect(mocks.proxyUpdateTriggerExecution).not.toHaveBeenCalled();
          expect(
            mocks.projectRuntimeStore.markQueuedMessageAsProcessing
          ).not.toHaveBeenCalled();
          unmount();
        }
      );

      it('does not claim an execution already taken by another processor', async () => {
        const { fetch, finish } = suspendOwnershipRequest();
        const project = mocks.projectRuntimeStore.getProjectById('project-1');
        const { unmount } = renderHook(() => useBackgroundTaskProcessor());
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

        project.queuedMessages[0].processing = true;
        await act(async () => finish());

        expect(mocks.startTask).not.toHaveBeenCalled();
        expect(
          mocks.projectRuntimeStore.markQueuedMessageAsProcessing
        ).not.toHaveBeenCalled();
        unmount();
      });

      it('does not start an execution after its project was removed', async () => {
        const { fetch, finish } = suspendOwnershipRequest();
        const { unmount } = renderHook(() => useBackgroundTaskProcessor());
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

        mocks.projectRuntimeStore.getProjectById.mockReturnValue(undefined);
        await act(async () => finish());

        expect(mocks.startTask).not.toHaveBeenCalled();
        unmount();
      });
    }
  );

  it('verifies the claim after a synchronous queue subscriber removes it', async () => {
    const project = mocks.projectRuntimeStore.getProjectById('project-1');
    mocks.projectRuntimeStore.markQueuedMessageAsProcessing.mockImplementation(
      () => {
        project.queuedMessages = [];
      }
    );
    const { unmount } = renderHook(() => useBackgroundTaskProcessor());

    await waitFor(() =>
      expect(
        mocks.projectRuntimeStore.markQueuedMessageAsProcessing
      ).toHaveBeenCalledTimes(1)
    );

    expect(mocks.startTask).not.toHaveBeenCalled();
    expect(mocks.proxyUpdateTriggerExecution).not.toHaveBeenCalled();
    unmount();
  });

  it('keeps the queue item until the exact Run is admitted', async () => {
    let admitRun!: () => void;
    mocks.startTask.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          admitRun = resolve;
        })
    );

    const { unmount } = renderHook(() => useBackgroundTaskProcessor());

    await waitFor(() => expect(mocks.startTask).toHaveBeenCalledTimes(1));
    expect(
      mocks.projectRuntimeStore.removeQueuedMessage
    ).not.toHaveBeenCalled();

    admitRun();
    await waitFor(() =>
      expect(
        mocks.projectRuntimeStore.removeQueuedMessage
      ).toHaveBeenCalledWith('project-1', 'queued-trigger')
    );

    unmount();
  });

  it('requeues a trigger when another Project consumer wins admission', async () => {
    mocks.startTask.mockRejectedValue(
      Object.assign(new Error('Project consumer is active'), {
        code: 'project_consumer_active',
      })
    );

    const { unmount } = renderHook(() => useBackgroundTaskProcessor());

    await waitFor(() =>
      expect(
        mocks.projectRuntimeStore.setQueuedMessageProcessing
      ).toHaveBeenCalledWith('project-1', 'queued-trigger', false)
    );
    expect(
      mocks.projectRuntimeStore.removeQueuedMessage
    ).not.toHaveBeenCalled();
    expect(
      mocks.proxyUpdateTriggerExecution.mock.calls.some(
        ([, update]) => update.status === ExecutionStatus.Failed
      )
    ).toBe(false);

    unmount();
  });

  it('does not treat a finished direct task as an active skeleton phase', async () => {
    sourceState.tasks['ended-run'].messages = [
      { role: 'user', content: 'Create a direct answer' },
    ];

    const { unmount } = renderHook(() => useBackgroundTaskProcessor());

    await waitFor(() => expect(mocks.startTask).toHaveBeenCalledTimes(1));

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
      { run_id: 'ended-run' },
      undefined,
      { signal: expect.any(AbortSignal) }
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
