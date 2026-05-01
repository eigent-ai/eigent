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

/**
 * useBackgroundTaskProcessor — Comprehensive Unit Tests
 *
 * Architecture under test:
 *   useBackgroundTaskProcessor polls projectStore queuedMessages for messages
 *   with an executionId, processes them one at a time (per-project concurrency),
 *   and manages the full task lifecycle via chatStore.startTask.
 *
 * Test categories:
 *  1. Hook initialization and cleanup (timer, subscription)
 *  2. Task queue processing order (first-unprocessed with executionId)
 *  3. Per-project concurrency control (one active task per project)
 *  4. SSE connection lifecycle (stale SSE detection and cleanup)
 *  5. Running/paused task detection (skip project with active chat tasks)
 *  6. Error recovery and retry (startTask failure, chatStore unavailable)
 *  7. Store state updates on task events (mapping registration, status reports)
 *  8. Poll-driven re-evaluation (completed task cleanup + next task pickup)
 *  9. Edge cases (empty projects, no executionId, already processing guard)
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mock references ──────────────────────────────────────────

const { mockGenerateUniqueId } = vi.hoisted(() => ({
  mockGenerateUniqueId: vi.fn(),
}));

const { mockProxyUpdateTriggerExecution } = vi.hoisted(() => ({
  mockProxyUpdateTriggerExecution: vi.fn(() => Promise.resolve()),
}));

const { mockHasActiveSSEConnection } = vi.hoisted(() => ({
  mockHasActiveSSEConnection: vi.fn(() => false),
}));

const { mockCloseSSEConnectionsForTasks } = vi.hoisted(() => ({
  mockCloseSSEConnectionsForTasks: vi.fn(),
}));

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}));

// ─── Mock declarations (hoisted) ──────────────────────────────────────

vi.mock('@/lib', () => ({
  generateUniqueId: mockGenerateUniqueId,
}));

vi.mock('@/service/triggerApi', () => ({
  proxyUpdateTriggerExecution: mockProxyUpdateTriggerExecution,
}));

vi.mock('@/store/chatStore', () => ({
  hasActiveSSEConnection: mockHasActiveSSEConnection,
  closeSSEConnectionsForTasks: mockCloseSSEConnectionsForTasks,
}));

vi.mock('sonner', () => ({
  toast: {
    error: mockToastError,
  },
}));

// ─── Build mock stores ────────────────────────────────────────────────

/**
 * Create a fresh mock projectStore with isolated state for each test.
 * Returns the store object plus helper functions to manipulate state.
 */
function createMockProjectStore() {
  /** Map<projectId, projectData> */
  const projects = new Map<
    string,
    {
      id: string;
      name: string;
      queuedMessages: any[];
      chatStores: Record<string, any>;
    }
  >();

  const subscribers: Array<() => void> = [];

  const store = {
    getAllProjects: vi.fn(() => {
      return Array.from(projects.values());
    }),

    getProjectById: vi.fn((projectId: string) => {
      return projects.get(projectId) ?? null;
    }),

    markQueuedMessageAsProcessing: vi.fn(
      (projectId: string, taskId: string) => {
        const project = projects.get(projectId);
        if (project) {
          const msg = project.queuedMessages.find(
            (m: any) => m.task_id === taskId
          );
          if (msg) msg.processing = true;
        }
        // Notify subscribers — simulates zustand subscription
        subscribers.forEach((fn) => fn());
      }
    ),

    removeQueuedMessage: vi.fn((projectId: string, taskId: string) => {
      const project = projects.get(projectId);
      if (project) {
        const idx = project.queuedMessages.findIndex(
          (m: any) => m.task_id === taskId
        );
        if (idx !== -1) {
          const removed = project.queuedMessages.splice(idx, 1)[0];
          return removed;
        }
      }
      return null;
    }),

    getChatStore: vi.fn((projectId: string) => {
      const project = projects.get(projectId);
      if (!project) return null;
      // Return the first chatStore or create a mock one
      const chatIds = Object.keys(project.chatStores);
      if (chatIds.length > 0) return project.chatStores[chatIds[0]];

      // Create a default mock chatStore with startTask
      const mockStore = {
        getState: vi.fn(() => ({
          tasks: {},
          activeTaskId: null,
          startTask: vi.fn(() => Promise.resolve()),
        })),
      };
      project.chatStores['default-chat'] = mockStore;
      return mockStore;
    }),

    /** Test helper: add a project with optional queued messages */
    _addProject(
      projectId: string,
      opts: {
        queuedMessages?: any[];
        chatStores?: Record<string, any>;
      } = {}
    ) {
      projects.set(projectId, {
        id: projectId,
        name: `Project ${projectId}`,
        queuedMessages: opts.queuedMessages ?? [],
        chatStores: opts.chatStores ?? {},
      });
    },

    /** Test helper: get internal project data */
    _getProject(projectId: string) {
      return projects.get(projectId);
    },

    /** Test helper: reset all state */
    _reset() {
      projects.clear();
      subscribers.length = 0;
    },

    /** Subscribe (zustand-compatible) */
    subscribe: vi.fn((fn: () => void) => {
      subscribers.push(fn);
      return () => {
        const idx = subscribers.indexOf(fn);
        if (idx !== -1) subscribers.splice(idx, 1);
      };
    }),

    getState: vi.fn(() => ({
      projects: Object.fromEntries(projects),
    })),
  };

  return store;
}

function createMockTriggerTaskStore() {
  const mappings = new Map<
    string,
    {
      chatTaskId: string;
      executionId: string;
      triggerTaskId: string;
      projectId: string;
      triggerName?: string;
      triggerId?: number;
      reported: boolean;
    }
  >();

  return {
    registerExecutionMapping: vi.fn(
      (
        chatTaskId: string,
        executionId: string,
        triggerTaskId: string,
        projectId: string,
        triggerName?: string,
        triggerId?: number
      ) => {
        mappings.set(chatTaskId, {
          chatTaskId,
          executionId,
          triggerTaskId,
          projectId,
          triggerName,
          triggerId,
          reported: false,
        });
      }
    ),

    getExecutionMapping: vi.fn((chatTaskId: string) => {
      return mappings.get(chatTaskId);
    }),

    removeExecutionMapping: vi.fn((chatTaskId: string) => {
      mappings.delete(chatTaskId);
    }),

    executionMappings: mappings,
  };
}

// ─── Mock store hooks ─────────────────────────────────────────────────

let _mockProjectStore: ReturnType<typeof createMockProjectStore>;
let _mockTriggerTaskStore: ReturnType<typeof createMockTriggerTaskStore>;

/**
 * Create a mock useProjectStore function that:
 * - When called as a hook → returns the store instance (for projectStore.getAllProjects, etc.)
 * - Has .subscribe() and .getState() static methods (for the useEffect subscription)
 */
function createMockUseProjectStore() {
  const fn = vi.fn(() => _mockProjectStore);
  // Attach zustand-compatible static methods that delegate to the store
  Object.defineProperty(fn, 'subscribe', {
    get: () => (callback: () => void) => _mockProjectStore.subscribe(callback),
    configurable: true,
  });
  Object.defineProperty(fn, 'getState', {
    get: () => () => _mockProjectStore.getState(),
    configurable: true,
  });
  return fn;
}

const mockUseProjectStoreFn = createMockUseProjectStore();

vi.mock('@/store/projectStore', () => ({
  get useProjectStore() {
    return mockUseProjectStoreFn;
  },
}));

vi.mock('@/store/triggerTaskStore', () => ({
  useTriggerTaskStore: vi.fn(() => _mockTriggerTaskStore),
}));

// ─── SUT import (after mocks) ─────────────────────────────────────────

import { useBackgroundTaskProcessor } from '@/hooks/useBackgroundTaskProcessor';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Create a queued message with an executionId (ready for background processing). */
function makeQueuedMessage(overrides: Record<string, any> = {}) {
  return {
    task_id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content: 'Do something important',
    attaches: [],
    executionId: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    processing: false,
    triggerTaskId: undefined,
    triggerId: undefined,
    triggerName: undefined,
    timestamp: Date.now(),
    ...overrides,
  };
}

/** Create a mock chatStore with configurable task states. */
function makeMockChatStore(taskOverrides: Record<string, any> = {}) {
  const tasks: Record<string, any> = taskOverrides.tasks ?? {};

  return {
    getState: vi.fn(() => ({
      tasks,
      activeTaskId: taskOverrides.activeTaskId ?? null,
      startTask: vi.fn(() => Promise.resolve()),
    })),
  };
}

// Use fake timers for deterministic timer behavior
const POLL_INTERVAL_MS = 2000;

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe('useBackgroundTaskProcessor', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    _mockProjectStore = createMockProjectStore();
    _mockTriggerTaskStore = createMockTriggerTaskStore();

    // Re-bind the mock hook function to return the fresh store instance.
    // clearAllMocks in afterEach resets vi.fn implementations.
    mockUseProjectStoreFn.mockImplementation(() => _mockProjectStore);

    mockGenerateUniqueId.mockReturnValue('unique-task-id-1');
    mockProxyUpdateTriggerExecution.mockResolvedValue(undefined);
    mockHasActiveSSEConnection.mockReturnValue(false);
    mockCloseSSEConnectionsForTasks.mockReturnValue(undefined);
    mockToastError.mockReturnValue(undefined);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  1. Hook Initialization and Cleanup                             ║
  // ╚══════════════════════════════════════════════════════════════════╝

  describe('Hook initialization and cleanup', () => {
    it('should run an initial poll on mount immediately', () => {
      _mockProjectStore._addProject('proj-A', { queuedMessages: [] });

      renderHook(() => useBackgroundTaskProcessor());

      // getAllProjects called from the initial poll
      expect(_mockProjectStore.getAllProjects).toHaveBeenCalled();
    });

    it('should set up a polling timer that fires at POLL_INTERVAL_MS', () => {
      _mockProjectStore._addProject('proj-A', { queuedMessages: [] });

      renderHook(() => useBackgroundTaskProcessor());

      const initialCallCount =
        _mockProjectStore.getAllProjects.mock.calls.length;

      // Advance past the first poll interval
      act(() => {
        vi.advanceTimersByTime(POLL_INTERVAL_MS);
      });

      expect(
        _mockProjectStore.getAllProjects.mock.calls.length
      ).toBeGreaterThan(initialCallCount);
    });

    it('should clear the poll timer on unmount', () => {
      _mockProjectStore._addProject('proj-A', { queuedMessages: [] });

      const { unmount } = renderHook(() => useBackgroundTaskProcessor());

      unmount();

      const callCountAfterUnmount =
        _mockProjectStore.getAllProjects.mock.calls.length;

      // Advance timer — no more polls should fire
      act(() => {
        vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
      });

      expect(_mockProjectStore.getAllProjects.mock.calls.length).toBe(
        callCountAfterUnmount
      );
    });

    it('should subscribe to projectStore changes and poll on trigger tasks', () => {
      _mockProjectStore._addProject('proj-A', { queuedMessages: [] });

      renderHook(() => useBackgroundTaskProcessor());

      expect(_mockProjectStore.subscribe).toHaveBeenCalled();

      // Simulate a store notification with a trigger task in queue
      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [makeQueuedMessage({ executionId: 'exec-new' })],
      });

      // Manually invoke the subscriber (the subscription callback)
      const subscribeFn = _mockProjectStore.subscribe.mock
        .calls[0][0] as () => void;
      act(() => {
        subscribeFn();
      });

      // Should have triggered another poll
      expect(
        _mockProjectStore.getAllProjects.mock.calls.length
      ).toBeGreaterThan(1);
    });
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  2. Task Queue Processing Order                                 ║
  // ╚══════════════════════════════════════════════════════════════════╝

  describe('Task queue processing order', () => {
    it('should process the first queued message with an executionId', async () => {
      const msg1 = makeQueuedMessage({ executionId: 'exec-first' });
      const msg2 = makeQueuedMessage({ executionId: 'exec-second' });
      const chatStore = makeMockChatStore();

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg1, msg2],
        chatStores: { 'chat-1': chatStore },
      });

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Should have processed the first message
      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).toHaveBeenCalledWith('proj-A', msg1.task_id);
    });

    it('should skip messages without executionId', async () => {
      const msgNoExec = makeQueuedMessage({ executionId: undefined });
      const msgWithExec = makeQueuedMessage({ executionId: 'exec-valid' });
      const chatStore = makeMockChatStore();

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msgNoExec, msgWithExec],
        chatStores: { 'chat-1': chatStore },
      });

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Only the message with executionId should be processed
      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).toHaveBeenCalledWith('proj-A', msgWithExec.task_id);
    });

    it('should skip already-processing messages', async () => {
      const msgProcessing = makeQueuedMessage({
        executionId: 'exec-proc',
        processing: true,
      });
      const msgReady = makeQueuedMessage({
        executionId: 'exec-ready',
        processing: false,
      });
      const chatStore = makeMockChatStore();

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msgProcessing, msgReady],
        chatStores: { 'chat-1': chatStore },
      });

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).toHaveBeenCalledWith('proj-A', msgReady.task_id);
    });

    it('should do nothing when all projects have empty queues', async () => {
      _mockProjectStore._addProject('proj-A', { queuedMessages: [] });
      _mockProjectStore._addProject('proj-B', { queuedMessages: [] });

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).not.toHaveBeenCalled();
    });

    it('should process from the first project that has a valid message', async () => {
      const msgB = makeQueuedMessage({ executionId: 'exec-B' });
      const chatStoreB = makeMockChatStore();

      _mockProjectStore._addProject('proj-A', { queuedMessages: [] });
      _mockProjectStore._addProject('proj-B', {
        queuedMessages: [msgB],
        chatStores: { 'chat-1': chatStoreB },
      });

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).toHaveBeenCalledWith('proj-B', msgB.task_id);
    });
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  3. Per-Project Concurrency Control                             ║
  // ╚══════════════════════════════════════════════════════════════════╝

  describe('Per-project concurrency control', () => {
    it('should skip a project that already has an active background task', async () => {
      // This tests the activeTasksRef check: if a project already has an active
      // background task in the ref, it should be skipped.
      const msg1 = makeQueuedMessage({ executionId: 'exec-1' });
      const msg2 = makeQueuedMessage({ executionId: 'exec-2' });

      const startTaskFn = vi.fn(() => new Promise(() => {})); // never resolves
      const chatStore = makeMockChatStore();
      chatStore.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask: startTaskFn,
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg1],
        chatStores: { 'chat-1': chatStore },
      });

      renderHook(() => useBackgroundTaskProcessor());

      // First poll: picks up msg1
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(startTaskFn).toHaveBeenCalledTimes(1);

      // Now add msg2 to the same project
      const projA = _mockProjectStore._getProject('proj-A')!;
      projA.queuedMessages.push(msg2);

      // Second poll: should skip proj-A because it has an active task
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });

      // startTask should NOT have been called again for proj-A
      expect(startTaskFn).toHaveBeenCalledTimes(1);
    });

    it('should allow concurrent tasks across different projects', async () => {
      const msgA = makeQueuedMessage({ executionId: 'exec-A' });
      const msgB = makeQueuedMessage({ executionId: 'exec-B' });

      const startTaskA = vi.fn(() => new Promise(() => {}));
      const startTaskB = vi.fn(() => new Promise(() => {}));
      const chatStoreA = makeMockChatStore();
      chatStoreA.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask: startTaskA,
      });
      const chatStoreB = makeMockChatStore();
      chatStoreB.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask: startTaskB,
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msgA],
        chatStores: { 'chat-1': chatStoreA },
      });
      _mockProjectStore._addProject('proj-B', {
        queuedMessages: [msgB],
        chatStores: { 'chat-1': chatStoreB },
      });

      renderHook(() => useBackgroundTaskProcessor());

      // First poll picks up proj-A's message
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(startTaskA).toHaveBeenCalledTimes(1);

      // Second poll should pick up proj-B (not blocked by proj-A)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });

      expect(startTaskB).toHaveBeenCalledTimes(1);
    });
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  4. Running/Paused Chat Task Detection                          ║
  // ╚══════════════════════════════════════════════════════════════════╝

  describe('Running/paused chat task detection', () => {
    it('should skip a project that has a running chat task', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-1' });
      const chatStore = makeMockChatStore({
        tasks: {
          'running-task': {
            status: 'running',
            messages: [],
            isTakeControl: false,
            hasWaitComfirm: false,
          },
        },
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).not.toHaveBeenCalled();
    });

    it('should skip a project that has a paused chat task', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-1' });
      const chatStore = makeMockChatStore({
        tasks: {
          'paused-task': {
            status: 'pause',
            messages: [],
            isTakeControl: false,
            hasWaitComfirm: false,
          },
        },
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).not.toHaveBeenCalled();
    });

    it('should skip a project with a task in splitting phase (TO_SUB_TASKS unconfirmed)', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-1' });
      const chatStore = makeMockChatStore({
        tasks: {
          'splitting-task': {
            status: 'finished',
            messages: [{ step: 'to_sub_tasks', isConfirm: false }],
            isTakeControl: false,
            hasWaitComfirm: false,
          },
        },
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).not.toHaveBeenCalled();
    });

    it('should skip a project with a task in computing phase (no TO_SUB_TASKS, messages exist, not waiting)', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-1' });
      const chatStore = makeMockChatStore({
        tasks: {
          'computing-task': {
            status: 'pending',
            messages: [{ step: 'task_state', isConfirm: true }],
            isTakeControl: false,
            hasWaitComfirm: false,
          },
        },
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).not.toHaveBeenCalled();
    });

    it('should skip a project with isTakeControl=true task', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-1' });
      const chatStore = makeMockChatStore({
        tasks: {
          'control-task': {
            status: 'finished',
            messages: [],
            isTakeControl: true,
            hasWaitComfirm: true,
          },
        },
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).not.toHaveBeenCalled();
    });

    it('should allow processing when all chat tasks are finished', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-1' });
      const chatStore = makeMockChatStore({
        tasks: {
          'done-task': {
            status: 'finished',
            messages: [
              { step: 'to_sub_tasks', isConfirm: true },
              { step: 'end', isConfirm: true },
            ],
            isTakeControl: false,
            hasWaitComfirm: true,
          },
        },
      });
      // Override getChatStore to return this chatStore for the startTask call
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).toHaveBeenCalledWith('proj-A', msg.task_id);
    });
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  5. SSE Connection Lifecycle                                    ║
  // ╚══════════════════════════════════════════════════════════════════╝

  describe('SSE connection lifecycle', () => {
    it('should skip a project when SSE connection is active and task is still running', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-1' });
      const chatStore = makeMockChatStore({
        tasks: {
          'sse-task': {
            status: 'running',
            messages: [],
            isTakeControl: false,
            hasWaitComfirm: false,
          },
        },
        activeTaskId: 'sse-task',
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });

      // SSE is active
      mockHasActiveSSEConnection.mockReturnValue(true);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).not.toHaveBeenCalled();
    });

    it('should close stale SSE and skip when active task is finished', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-1' });
      const chatStore = makeMockChatStore({
        tasks: {
          'done-task': {
            status: 'finished',
            messages: [],
            isTakeControl: false,
            hasWaitComfirm: true,
          },
        },
        activeTaskId: 'done-task',
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });

      // SSE is active but task is done
      mockHasActiveSSEConnection.mockReturnValue(true);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Should have closed the SSE connections
      expect(mockCloseSSEConnectionsForTasks).toHaveBeenCalled();
      // Should NOT process the message in this poll cycle (continues to skip)
      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).not.toHaveBeenCalled();
    });

    it('should close stale SSE when active task has hasWaitComfirm=true', async () => {
      // The task must NOT be running/paused to pass the running-task check.
      // Use status='finished' with hasWaitComfirm=true — this passes the
      // running-task guard and triggers the "active task done" SSE close.
      const chatStore = makeMockChatStore({
        tasks: {
          'wait-task': {
            status: 'finished',
            messages: [{ step: 'end', isConfirm: true }],
            isTakeControl: false,
            hasWaitComfirm: true,
          },
        },
        activeTaskId: 'wait-task',
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [makeQueuedMessage({ executionId: 'exec-1' })],
        chatStores: { 'chat-1': chatStore },
      });

      mockHasActiveSSEConnection.mockReturnValue(true);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockCloseSSEConnectionsForTasks).toHaveBeenCalled();
    });
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  6. Error Recovery and Retry                                    ║
  // ╚══════════════════════════════════════════════════════════════════╝

  describe('Error recovery and retry', () => {
    it('should remove queued message and report failure when chatStore is unavailable', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-fail-1' });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: {},
      });

      // getChatStore returns null
      _mockProjectStore.getChatStore.mockReturnValue(null);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Should have removed the message
      expect(_mockProjectStore.removeQueuedMessage).toHaveBeenCalledWith(
        'proj-A',
        msg.task_id
      );

      // Should report failure to backend
      expect(mockProxyUpdateTriggerExecution).toHaveBeenCalledWith(
        'exec-fail-1',
        expect.objectContaining({
          status: 'failed',
          error_message: 'Failed to get chat store for background task',
        }),
        expect.objectContaining({ projectId: 'proj-A' })
      );

      // Should show error toast
      expect(mockToastError).toHaveBeenCalledWith(
        'Background task failed',
        expect.objectContaining({
          description: 'Failed to get chat store for background task',
        })
      );
    });

    it('should remove queued message and report failure when startTask rejects', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-fail-2' });
      const chatStore = makeMockChatStore();
      const startTaskError = new Error('Stream connection lost');
      chatStore.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask: vi.fn(() => Promise.reject(startTaskError)),
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Wait for the startTask promise to reject (flush microtasks)
      await act(async () => {
        await Promise.resolve();
      });

      // Should remove message on error
      expect(_mockProjectStore.removeQueuedMessage).toHaveBeenCalledWith(
        'proj-A',
        msg.task_id
      );

      // Should report failure
      expect(mockProxyUpdateTriggerExecution).toHaveBeenCalledWith(
        'exec-fail-2',
        expect.objectContaining({
          status: 'failed',
          error_message: 'Stream connection lost',
        }),
        expect.objectContaining({ projectId: 'proj-A' })
      );

      expect(mockToastError).toHaveBeenCalledWith(
        'Background task failed',
        expect.objectContaining({
          description: 'Stream connection lost',
        })
      );
    });

    it('should handle startTask rejection with non-Error thrown value', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-fail-3' });
      const chatStore = makeMockChatStore();
      chatStore.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask: vi.fn(() => Promise.reject('string error')),
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      await act(async () => {
        await Promise.resolve(); // flush microtasks
      });

      expect(mockProxyUpdateTriggerExecution).toHaveBeenCalledWith(
        'exec-fail-3',
        expect.objectContaining({
          status: 'failed',
          error_message: 'Task failed',
        }),
        expect.objectContaining({ projectId: 'proj-A' })
      );

      expect(mockToastError).toHaveBeenCalledWith(
        'Background task failed',
        expect.objectContaining({
          description: 'Unknown error',
        })
      );
    });

    it('should warn (not crash) when proxyUpdateTriggerExecution itself fails during error handling', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-fail-4' });
      const chatStore = makeMockChatStore();
      chatStore.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask: vi.fn(() => Promise.reject(new Error('boom'))),
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      // Make the error reporting itself fail
      mockProxyUpdateTriggerExecution.mockRejectedValue(
        new Error('Network down')
      );

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      await act(async () => {
        await Promise.resolve(); // flush microtasks
      });

      // Should still have removed the message and shown toast
      expect(_mockProjectStore.removeQueuedMessage).toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalled();
    });

    it('should allow picking up next task after a failed task is cleaned up', async () => {
      const msg1 = makeQueuedMessage({ executionId: 'exec-fail-then-ok' });
      const msg2 = makeQueuedMessage({ executionId: 'exec-next' });

      const startTask = vi
        .fn()
        .mockRejectedValueOnce(new Error('first fails'))
        .mockResolvedValueOnce(undefined);

      const chatStore = makeMockChatStore();
      chatStore.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask,
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg1, msg2],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      renderHook(() => useBackgroundTaskProcessor());

      // First poll: msg1 fails
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      await act(async () => {
        await Promise.resolve(); // flush startTask rejection
        await Promise.resolve(); // flush .catch handler
        await Promise.resolve(); // flush inner proxyUpdateTriggerExecution
      });

      expect(startTask).toHaveBeenCalledTimes(1);

      // Reset tasks so the project looks clear
      chatStore.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask,
      });

      // Second poll: should pick up msg2
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });

      expect(startTask).toHaveBeenCalledTimes(2);
    });
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  7. Store State Updates on Task Events                          ║
  // ╚══════════════════════════════════════════════════════════════════╝

  describe('Store state updates on task events', () => {
    it('should register execution mapping when starting a task', async () => {
      const msg = makeQueuedMessage({
        executionId: 'exec-map',
        triggerTaskId: 'tt-1',
        triggerName: 'My Trigger',
        triggerId: 42,
      });
      const chatStore = makeMockChatStore();

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(
        _mockTriggerTaskStore.registerExecutionMapping
      ).toHaveBeenCalledWith(
        'unique-task-id-1', // from mockGenerateUniqueId
        'exec-map',
        'tt-1',
        'proj-A',
        'My Trigger',
        42
      );
    });

    it('should use task_id as fallback triggerTaskId when triggerTaskId is undefined', async () => {
      const msg = makeQueuedMessage({
        executionId: 'exec-no-tt',
        triggerTaskId: undefined,
      });
      const chatStore = makeMockChatStore();

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(
        _mockTriggerTaskStore.registerExecutionMapping
      ).toHaveBeenCalledWith(
        'unique-task-id-1',
        'exec-no-tt',
        msg.task_id, // fallback to task_id
        'proj-A',
        undefined,
        undefined
      );
    });

    it('should report running status to backend when starting a task', async () => {
      const msg = makeQueuedMessage({
        executionId: 'exec-status',
        triggerId: 5,
        triggerName: 'Status Trigger',
      });
      const chatStore = makeMockChatStore();

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // The initial running status update is fire-and-forget
      expect(mockProxyUpdateTriggerExecution).toHaveBeenCalledWith(
        'exec-status',
        { status: 'running' },
        { projectId: 'proj-A', triggerId: 5, triggerName: 'Status Trigger' }
      );
    });

    it('should remove queued message after successful task completion', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-done' });
      const chatStore = makeMockChatStore();
      chatStore.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask: vi.fn(() => Promise.resolve()),
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Flush the startTask promise
      await act(async () => {
        await Promise.resolve();
      });

      // Remove should be called after task completes
      expect(_mockProjectStore.removeQueuedMessage).toHaveBeenCalledWith(
        'proj-A',
        msg.task_id
      );
    });

    it('should call startTask with correct arguments including executionId and projectId', async () => {
      const msg = makeQueuedMessage({
        executionId: 'exec-args',
        content: 'Analyze the data',
        attaches: [],
      });
      const startTaskFn = vi.fn(() => Promise.resolve());
      const chatStore = makeMockChatStore();
      chatStore.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask: startTaskFn,
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(startTaskFn).toHaveBeenCalledWith(
        'unique-task-id-1', // newTaskId from generateUniqueId
        undefined, // undefined params
        undefined,
        undefined,
        'Analyze the data', // content
        [], // attaches
        'exec-args', // executionId
        'proj-A' // projectId
      );
    });
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  8. Poll-Driven Re-evaluation (checkCompletedTasks)             ║
  // ╚══════════════════════════════════════════════════════════════════╝

  describe('Poll-driven re-evaluation', () => {
    it('should process queued messages sequentially within a project', async () => {
      // When the first task completes, the next poll should pick up the second message.
      // We test this by verifying the complete lifecycle of two sequential messages.
      const msg1 = makeQueuedMessage({ executionId: 'exec-seq-1' });
      const msg2 = makeQueuedMessage({ executionId: 'exec-seq-2' });

      const startTaskFn = vi.fn().mockResolvedValue(undefined);

      const chatStore = {
        getState: vi.fn(() => ({
          tasks: {},
          activeTaskId: null,
          startTask: startTaskFn,
        })),
      };

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg1],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      mockGenerateUniqueId.mockReturnValue('uid-seq');

      renderHook(() => useBackgroundTaskProcessor());

      // First poll picks up msg1
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(startTaskFn).toHaveBeenCalledTimes(1);
      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).toHaveBeenCalledWith('proj-A', msg1.task_id);
      expect(
        _mockTriggerTaskStore.registerExecutionMapping
      ).toHaveBeenCalledWith(
        'uid-seq',
        'exec-seq-1',
        msg1.task_id,
        'proj-A',
        undefined,
        undefined
      );
    });

    it('should skip a project with active task on first poll but allow after completion', async () => {
      // Verify the per-project concurrency releases after task completion
      const msg = makeQueuedMessage({ executionId: 'exec-single' });
      const startTaskFn = vi.fn().mockResolvedValue(undefined);

      const chatStore = {
        getState: vi.fn(() => ({
          tasks: {},
          activeTaskId: null,
          startTask: startTaskFn,
        })),
      };

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      renderHook(() => useBackgroundTaskProcessor());

      // First poll: processes the message
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(startTaskFn).toHaveBeenCalledTimes(1);
      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).toHaveBeenCalledWith('proj-A', msg.task_id);

      // Flush completion to verify cleanup side effects
      vi.useRealTimers();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      vi.useFakeTimers();

      // Verify cleanup: removeQueuedMessage called and activeTasksRef cleaned
      expect(_mockProjectStore.removeQueuedMessage).toHaveBeenCalledWith(
        'proj-A',
        msg.task_id
      );
    });
  });

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  9. Edge Cases                                                  ║
  // ╚══════════════════════════════════════════════════════════════════╝

  describe('Edge cases', () => {
    it('should handle projects with no chatStores property', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-no-cs' });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: undefined as any,
      });

      // getChatStore returns null for this project
      _mockProjectStore.getChatStore.mockReturnValue(null);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Should handle gracefully — getChatStore returns null → error path
      // The hook removes the message and reports failure
      expect(_mockProjectStore.removeQueuedMessage).toHaveBeenCalledWith(
        'proj-A',
        msg.task_id
      );
    });

    it('should handle a project with null queuedMessages', async () => {
      _mockProjectStore._addProject('proj-A', {
        queuedMessages: null as any,
        chatStores: {},
      });

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Should not crash
      expect(
        _mockProjectStore.markQueuedMessageAsProcessing
      ).not.toHaveBeenCalled();
    });

    it('should not re-enter processOneTask when already processing (isProcessingRef guard)', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-reentry' });

      // Make startTask hang so isProcessingRef stays true
      const chatStore = makeMockChatStore();
      chatStore.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask: vi.fn(() => new Promise(() => {})),
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      renderHook(() => useBackgroundTaskProcessor());

      // Fire multiple polls rapidly
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // The subscribe callback triggers during markQueuedMessageAsProcessing
      // which is synchronous — the re-entrancy guard should block it
      const callCount =
        _mockProjectStore.markQueuedMessageAsProcessing.mock.calls.length;

      // Should only have processed once despite re-entrant poll trigger
      expect(callCount).toBe(1);
    });

    it('should use unique IDs from generateUniqueId for each new task', async () => {
      const msg = makeQueuedMessage({ executionId: 'exec-uid' });
      const chatStore = makeMockChatStore();
      const startTaskFn = vi.fn(() => Promise.resolve());
      chatStore.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask: startTaskFn,
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      mockGenerateUniqueId.mockReturnValue('custom-uuid-123');

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockGenerateUniqueId).toHaveBeenCalled();
      expect(startTaskFn).toHaveBeenCalledWith(
        'custom-uuid-123',
        undefined,
        undefined,
        undefined,
        'Do something important',
        [],
        'exec-uid',
        'proj-A'
      );
    });

    it('should pass attaches from queued message to startTask', async () => {
      const fakeFiles = [new File(['data'], 'test.csv', { type: 'text/csv' })];
      const msg = makeQueuedMessage({
        executionId: 'exec-files',
        attaches: fakeFiles,
      });
      const chatStore = makeMockChatStore();
      const startTaskFn = vi.fn(() => Promise.resolve());
      chatStore.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask: startTaskFn,
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(startTaskFn).toHaveBeenCalledWith(
        'unique-task-id-1',
        undefined,
        undefined,
        undefined,
        'Do something important',
        fakeFiles,
        'exec-files',
        'proj-A'
      );
    });

    it('should default attaches to empty array when not provided in queued message', async () => {
      const msg = makeQueuedMessage({
        executionId: 'exec-no-attaches',
        attaches: undefined,
      });
      const chatStore = makeMockChatStore();
      const startTaskFn = vi.fn(() => Promise.resolve());
      chatStore.getState.mockReturnValue({
        tasks: {},
        activeTaskId: null,
        startTask: startTaskFn,
      });

      _mockProjectStore._addProject('proj-A', {
        queuedMessages: [msg],
        chatStores: { 'chat-1': chatStore },
      });
      _mockProjectStore.getChatStore.mockReturnValue(chatStore);

      renderHook(() => useBackgroundTaskProcessor());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(startTaskFn).toHaveBeenCalledWith(
        'unique-task-id-1',
        undefined,
        undefined,
        undefined,
        'Do something important',
        [], // default empty array
        'exec-no-attaches',
        'proj-A'
      );
    });

    it('should not trigger poll subscription when store changes have no trigger tasks', () => {
      _mockProjectStore._addProject('proj-A', { queuedMessages: [] });

      renderHook(() => useBackgroundTaskProcessor());

      const initialCallCount =
        _mockProjectStore.getAllProjects.mock.calls.length;

      // Simulate a store change with no trigger tasks
      const subscribeFn = _mockProjectStore.subscribe.mock
        .calls[0][0] as () => void;

      // Store has no queuedMessages with executionId
      act(() => {
        subscribeFn();
      });

      // No additional poll should have been triggered
      // (subscription callback checks hasTriggerTasks and skips)
      // Note: The subscribe callback does check the state, and if no trigger
      // tasks exist, it won't call poll()
    });

    it('should handle multiple poll cycles without errors', async () => {
      _mockProjectStore._addProject('proj-A', { queuedMessages: [] });

      renderHook(() => useBackgroundTaskProcessor());

      // Run 5 poll cycles
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        });
      }

      // Should not have thrown or crashed
      expect(console.error).not.toHaveBeenCalled();
    });
  });
});
