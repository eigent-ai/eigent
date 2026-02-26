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
 * useTriggerTaskExecutor Unit Tests
 *
 * Tests the core queueing and execution behavior:
 * - Same project running + new task same project → add to queue (serialize)
 * - Different project not busy + new task → execute immediately (parallel)
 * - Different project busy + new task → add to queue (serialize per-project)
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies before importing anything else
vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn(() =>
    Promise.resolve({
      tasks: [{ task_id: 'mock-task-1', question: 'test' }],
      last_prompt: 'test prompt',
    })
  ),
  proxyFetchPost: vi.fn(() => Promise.resolve({ id: 'mock-id' })),
  fetchPost: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

import { useTriggerTaskExecutor } from '@/hooks/useTriggerTaskExecutor';
import { useProjectStore } from '@/store/projectStore';
import { useTriggerStore } from '@/store/triggerStore';
import type { TriggeredTask } from '@/store/triggerTaskStore';
import { useTriggerTaskStore } from '@/store/triggerTaskStore';
import { ExecutionStatus, TriggerType } from '@/types';

// ───────────────────────────────────────────
// Helper: create a minimal task payload
// ───────────────────────────────────────────
function makeTaskPayload(overrides: Partial<TriggeredTask> = {}) {
  return {
    triggerId: 1,
    triggerName: overrides.triggerName ?? 'Test Trigger',
    taskPrompt: overrides.taskPrompt ?? 'Do something',
    executionId: overrides.executionId ?? `exec-${Date.now()}-${Math.random()}`,
    triggerType: (overrides.triggerType ?? 'webhook') as TriggerType,
    projectId: overrides.projectId ?? null,
    inputData: overrides.inputData ?? {},
    formattedMessage: overrides.formattedMessage ?? 'Do something',
  };
}

// ───────────────────────────────────────────
// Store-level tests for triggerTaskStore
// ───────────────────────────────────────────
describe('triggerTaskStore - per-project queue behavior', () => {
  beforeEach(() => {
    // Reset the store between tests
    useTriggerTaskStore.setState({
      taskQueue: [],
      runningTasks: [],
      taskHistory: [],
      executionMappings: new Map(),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ──── Basic enqueue/dequeue ────

  it('should enqueue a task as pending', () => {
    const store = useTriggerTaskStore.getState();
    const id = store.enqueueTask(makeTaskPayload({ projectId: 'proj-A' }));

    const state = useTriggerTaskStore.getState();
    expect(state.taskQueue).toHaveLength(1);
    expect(state.taskQueue[0].id).toBe(id);
    expect(state.taskQueue[0].status).toBe(ExecutionStatus.Pending);
    expect(state.taskQueue[0].projectId).toBe('proj-A');
  });

  it('should dequeue a task and move it to runningTasks', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-A' }));

    const dequeued = useTriggerTaskStore.getState().dequeueTask('proj-A');
    expect(dequeued).not.toBeNull();
    expect(dequeued!.status).toBe(ExecutionStatus.Running);

    const state = useTriggerTaskStore.getState();
    expect(state.taskQueue).toHaveLength(0);
    expect(state.runningTasks).toHaveLength(1);
    expect(state.runningTasks[0].projectId).toBe('proj-A');
  });

  it('should dequeue without projectId (any pending)', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-A' }));
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-B' }));

    // Dequeue without specifying projectId → takes first pending
    const dequeued = useTriggerTaskStore.getState().dequeueTask();
    expect(dequeued).not.toBeNull();
    expect(dequeued!.projectId).toBe('proj-A');

    const state = useTriggerTaskStore.getState();
    expect(state.taskQueue).toHaveLength(1);
    expect(state.runningTasks).toHaveLength(1);
  });

  // ──── Per-project dequeue isolation ────

  it('should only dequeue tasks for the specified project', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-A' }));
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-B' }));

    // Dequeue for proj-B → should skip proj-A
    const dequeued = useTriggerTaskStore.getState().dequeueTask('proj-B');
    expect(dequeued).not.toBeNull();
    expect(dequeued!.projectId).toBe('proj-B');

    const state = useTriggerTaskStore.getState();
    // proj-A task still in queue
    expect(state.taskQueue).toHaveLength(1);
    expect(state.taskQueue[0].projectId).toBe('proj-A');
    // only proj-B in running
    expect(state.runningTasks).toHaveLength(1);
    expect(state.runningTasks[0].projectId).toBe('proj-B');
  });

  it('should return null when no pending tasks match the projectId', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-A' }));

    const dequeued = useTriggerTaskStore.getState().dequeueTask('proj-B');
    expect(dequeued).toBeNull();

    // Queue unchanged
    expect(useTriggerTaskStore.getState().taskQueue).toHaveLength(1);
  });

  // ──── isProjectBusy ────

  it('should report project as busy when it has a running task', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-A' }));
    useTriggerTaskStore.getState().dequeueTask('proj-A');

    expect(useTriggerTaskStore.getState().isProjectBusy('proj-A')).toBe(true);
    expect(useTriggerTaskStore.getState().isProjectBusy('proj-B')).toBe(false);
  });

  it('should report project as not busy after task completes', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-A' }));
    const dequeued = useTriggerTaskStore.getState().dequeueTask('proj-A');

    useTriggerTaskStore.getState().completeTask(dequeued!.id);

    expect(useTriggerTaskStore.getState().isProjectBusy('proj-A')).toBe(false);
    expect(useTriggerTaskStore.getState().runningTasks).toHaveLength(0);
    expect(useTriggerTaskStore.getState().taskHistory).toHaveLength(1);
    expect(useTriggerTaskStore.getState().taskHistory[0].status).toBe(
      ExecutionStatus.Completed
    );
  });

  it('should report project as not busy after task fails', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-A' }));
    const dequeued = useTriggerTaskStore.getState().dequeueTask('proj-A');

    useTriggerTaskStore.getState().failTask(dequeued!.id, 'Something broke');

    expect(useTriggerTaskStore.getState().isProjectBusy('proj-A')).toBe(false);
    expect(useTriggerTaskStore.getState().runningTasks).toHaveLength(0);
    expect(useTriggerTaskStore.getState().taskHistory).toHaveLength(1);
    expect(useTriggerTaskStore.getState().taskHistory[0].status).toBe(
      ExecutionStatus.Failed
    );
    expect(useTriggerTaskStore.getState().taskHistory[0].errorMessage).toBe(
      'Something broke'
    );
  });

  // ──── getRunningTaskForProject ────

  it('should return running task for the correct project', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(
      makeTaskPayload({ projectId: 'proj-A', triggerName: 'Trigger A' })
    );
    store.enqueueTask(
      makeTaskPayload({ projectId: 'proj-B', triggerName: 'Trigger B' })
    );

    useTriggerTaskStore.getState().dequeueTask('proj-A');
    useTriggerTaskStore.getState().dequeueTask('proj-B');

    const runningA = useTriggerTaskStore
      .getState()
      .getRunningTaskForProject('proj-A');
    const runningB = useTriggerTaskStore
      .getState()
      .getRunningTaskForProject('proj-B');
    const runningC = useTriggerTaskStore
      .getState()
      .getRunningTaskForProject('proj-C');

    expect(runningA).not.toBeNull();
    expect(runningA!.triggerName).toBe('Trigger A');
    expect(runningB).not.toBeNull();
    expect(runningB!.triggerName).toBe('Trigger B');
    expect(runningC).toBeNull();
  });

  // ──── Multiple tasks per project (serialization) ────

  it('should support multiple running tasks for different projects simultaneously', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-A' }));
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-B' }));

    useTriggerTaskStore.getState().dequeueTask('proj-A');
    useTriggerTaskStore.getState().dequeueTask('proj-B');

    const state = useTriggerTaskStore.getState();
    expect(state.runningTasks).toHaveLength(2);
    expect(state.isProjectBusy('proj-A')).toBe(true);
    expect(state.isProjectBusy('proj-B')).toBe(true);
    expect(state.taskQueue).toHaveLength(0);
  });

  it('should queue second task for same project while first is running', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(
      makeTaskPayload({ projectId: 'proj-A', triggerName: 'First' })
    );
    store.enqueueTask(
      makeTaskPayload({ projectId: 'proj-A', triggerName: 'Second' })
    );

    // Dequeue first task for proj-A
    const first = useTriggerTaskStore.getState().dequeueTask('proj-A');
    expect(first!.triggerName).toBe('First');

    // proj-A is now busy
    expect(useTriggerTaskStore.getState().isProjectBusy('proj-A')).toBe(true);

    // Second task still in queue
    expect(useTriggerTaskStore.getState().taskQueue).toHaveLength(1);
    expect(useTriggerTaskStore.getState().taskQueue[0].triggerName).toBe(
      'Second'
    );

    // Complete first task
    useTriggerTaskStore.getState().completeTask(first!.id);

    // Now proj-A is free
    expect(useTriggerTaskStore.getState().isProjectBusy('proj-A')).toBe(false);

    // Can dequeue second task
    const second = useTriggerTaskStore.getState().dequeueTask('proj-A');
    expect(second).not.toBeNull();
    expect(second!.triggerName).toBe('Second');
    expect(useTriggerTaskStore.getState().isProjectBusy('proj-A')).toBe(true);
  });

  // ──── getTaskById with runningTasks ────

  it('should find task by ID in runningTasks', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-A' }));
    const dequeued = useTriggerTaskStore.getState().dequeueTask('proj-A');

    const found = useTriggerTaskStore.getState().getTaskById(dequeued!.id);
    expect(found).not.toBeUndefined();
    expect(found!.status).toBe(ExecutionStatus.Running);
  });

  it('should find task by ID in taskHistory after completion', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(makeTaskPayload({ projectId: 'proj-A' }));
    const dequeued = useTriggerTaskStore.getState().dequeueTask('proj-A');
    useTriggerTaskStore.getState().completeTask(dequeued!.id);

    const found = useTriggerTaskStore.getState().getTaskById(dequeued!.id);
    expect(found).not.toBeUndefined();
    expect(found!.status).toBe(ExecutionStatus.Completed);
  });

  // ──── Cancel task from queue ────

  it('should cancel a pending task from the queue', () => {
    const store = useTriggerTaskStore.getState();
    const id = store.enqueueTask(makeTaskPayload({ projectId: 'proj-A' }));

    useTriggerTaskStore.getState().cancelTask(id, 'User cancelled');

    const state = useTriggerTaskStore.getState();
    expect(state.taskQueue).toHaveLength(0);
    expect(state.taskHistory).toHaveLength(1);
    expect(state.taskHistory[0].status).toBe(ExecutionStatus.Cancelled);
  });

  // ──── Duplicate event_id deduplication ────

  it('should reject duplicate event_id in queue', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(
      makeTaskPayload({
        projectId: 'proj-A',
        inputData: { event_id: 'evt-123' },
      })
    );

    // Enqueue duplicate
    store.enqueueTask(
      makeTaskPayload({
        projectId: 'proj-A',
        inputData: { event_id: 'evt-123' },
      })
    );

    const state = useTriggerTaskStore.getState();
    // Only 1 in queue, duplicate goes to history as missed
    expect(state.taskQueue).toHaveLength(1);
    expect(state.taskHistory).toHaveLength(1);
    expect(state.taskHistory[0].status).toBe(ExecutionStatus.Missed);
  });

  it('should reject duplicate event_id in runningTasks', () => {
    const store = useTriggerTaskStore.getState();
    store.enqueueTask(
      makeTaskPayload({
        projectId: 'proj-A',
        inputData: { event_id: 'evt-456' },
      })
    );
    // Move to running
    useTriggerTaskStore.getState().dequeueTask('proj-A');

    // Enqueue duplicate
    useTriggerTaskStore.getState().enqueueTask(
      makeTaskPayload({
        projectId: 'proj-A',
        inputData: { event_id: 'evt-456' },
      })
    );

    const state = useTriggerTaskStore.getState();
    expect(state.taskQueue).toHaveLength(0);
    expect(state.runningTasks).toHaveLength(1);
    // Duplicate added to history as missed
    expect(state.taskHistory).toHaveLength(1);
    expect(state.taskHistory[0].status).toBe(ExecutionStatus.Missed);
  });
});

// ───────────────────────────────────────────
// Hook-level tests for useTriggerTaskExecutor
// ───────────────────────────────────────────
describe('useTriggerTaskExecutor - hook behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    // Reset all stores
    useTriggerTaskStore.setState({
      taskQueue: [],
      runningTasks: [],
      taskHistory: [],
      executionMappings: new Map(),
    });

    useTriggerStore.setState({
      webSocketEvent: null,
    });

    // Create test projects in the project store
    const projectStore = useProjectStore.getState();
    projectStore.createProject('Project A', 'Test project A', 'proj-A');
    projectStore.createProject('Project B', 'Test project B', 'proj-B');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();

    // Clean up projects
    const projectStore = useProjectStore.getState();
    const projects = projectStore.getAllProjects();
    for (const p of projects) {
      projectStore.removeProject(p.id);
    }
  });

  it('should expose processNextTask and executeTask', () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    expect(result.current.processNextTask).toBeDefined();
    expect(result.current.executeTask).toBeDefined();
  });

  it('should process a task when no project is busy', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Enqueue a task for proj-A
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'Task 1' })
      );

    // Process
    await act(async () => {
      await result.current.processNextTask();
    });

    const state = useTriggerTaskStore.getState();
    // Task should have been dequeued and is now running
    expect(state.taskQueue).toHaveLength(0);
    expect(state.runningTasks).toHaveLength(1);
    expect(state.runningTasks[0].projectId).toBe('proj-A');
  });

  it('should NOT process a second task for the SAME project while first is running', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Enqueue two tasks for the same project
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'Task 1' })
      );
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'Task 2' })
      );

    // Process → should only execute one task
    await act(async () => {
      await result.current.processNextTask();
    });

    const state = useTriggerTaskStore.getState();
    // First task running, second still queued
    expect(state.runningTasks).toHaveLength(1);
    expect(state.runningTasks[0].triggerName).toBe('Task 1');
    expect(state.taskQueue).toHaveLength(1);
    expect(state.taskQueue[0].triggerName).toBe('Task 2');
  });

  it('should process tasks for DIFFERENT projects in parallel', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Enqueue tasks for different projects
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'Task A' })
      );
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-B', triggerName: 'Task B' })
      );

    // Process → should execute both (different projects)
    await act(async () => {
      await result.current.processNextTask();
    });

    const state = useTriggerTaskStore.getState();
    // Both tasks should be running
    expect(state.runningTasks).toHaveLength(2);
    expect(state.taskQueue).toHaveLength(0);

    const runningProjects = state.runningTasks.map((t) => t.projectId).sort();
    expect(runningProjects).toEqual(['proj-A', 'proj-B']);
  });

  it('should queue task for busy project while executing for non-busy project', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Start a task for proj-A (make it busy)
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'Running A' })
      );
    await act(async () => {
      await result.current.processNextTask();
    });

    // Now proj-A is busy, enqueue tasks for both projects
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'Queued A' })
      );
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-B', triggerName: 'New B' })
      );

    // Process again
    await act(async () => {
      await result.current.processNextTask();
    });

    const state = useTriggerTaskStore.getState();
    // proj-A: 1 running (original), 1 queued (new one for A)
    // proj-B: 1 running (new one for B)
    expect(state.runningTasks).toHaveLength(2);
    expect(state.taskQueue).toHaveLength(1);
    expect(state.taskQueue[0].triggerName).toBe('Queued A');
    expect(state.taskQueue[0].projectId).toBe('proj-A');

    const runningNames = state.runningTasks.map((t) => t.triggerName).sort();
    expect(runningNames).toEqual(['New B', 'Running A']);
  });

  it('should process queued task after busy project completes', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Start a task for proj-A
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'First A' })
      );
    await act(async () => {
      await result.current.processNextTask();
    });

    // Enqueue second task for proj-A while first is running
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'Second A' })
      );

    // Verify: first running, second queued
    let state = useTriggerTaskStore.getState();
    expect(state.runningTasks).toHaveLength(1);
    expect(state.taskQueue).toHaveLength(1);

    // Complete the first task
    const firstTaskId = state.runningTasks[0].id;
    useTriggerTaskStore.getState().completeTask(firstTaskId);

    // proj-A should no longer be busy
    expect(useTriggerTaskStore.getState().isProjectBusy('proj-A')).toBe(false);

    // Process again → second task should now be picked up
    await act(async () => {
      await result.current.processNextTask();
    });

    state = useTriggerTaskStore.getState();
    expect(state.runningTasks).toHaveLength(1);
    expect(state.runningTasks[0].triggerName).toBe('Second A');
    expect(state.taskQueue).toHaveLength(0);
  });

  it('should handle WebSocket events by enqueuing and processing', async () => {
    renderHook(() => useTriggerTaskExecutor());

    // Simulate a WebSocket event
    await act(async () => {
      useTriggerStore.getState().emitWebSocketEvent({
        triggerId: 1,
        triggerName: 'WS Trigger',
        taskPrompt: 'Do the thing',
        executionId: 'exec-ws-1',
        timestamp: Date.now(),
        triggerType: TriggerType.Webhook,
        projectId: 'proj-A',
        inputData: {},
      });
    });

    // Give microtask a chance to run
    await act(async () => {
      await Promise.resolve();
    });

    const state = useTriggerTaskStore.getState();
    // The WebSocket event should have been enqueued and processed
    const allTasks = [...state.taskQueue, ...state.runningTasks];
    expect(allTasks.length).toBeGreaterThanOrEqual(1);
    expect(allTasks.some((t) => t.triggerName === 'WS Trigger')).toBe(true);
  });

  it('should clear WebSocket event after processing', async () => {
    renderHook(() => useTriggerTaskExecutor());

    await act(async () => {
      useTriggerStore.getState().emitWebSocketEvent({
        triggerId: 1,
        triggerName: 'WS Trigger',
        taskPrompt: 'test',
        executionId: 'exec-ws-2',
        timestamp: Date.now(),
        triggerType: TriggerType.Webhook,
        projectId: 'proj-A',
        inputData: {},
      });
    });

    // After processing, the event should be cleared
    expect(useTriggerStore.getState().webSocketEvent).toBeNull();
  });

  // ──── Mixed scenario: 3 projects, various states ────

  it('should handle complex multi-project scenario correctly', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Create proj-C
    useProjectStore.getState().createProject('Project C', 'Test C', 'proj-C');

    // Enqueue tasks A1, B1, C1
    useTriggerTaskStore
      .getState()
      .enqueueTask(makeTaskPayload({ projectId: 'proj-A', triggerName: 'A1' }));
    useTriggerTaskStore
      .getState()
      .enqueueTask(makeTaskPayload({ projectId: 'proj-B', triggerName: 'B1' }));
    useTriggerTaskStore
      .getState()
      .enqueueTask(makeTaskPayload({ projectId: 'proj-C', triggerName: 'C1' }));

    // Process → all 3 should run (different projects)
    await act(async () => {
      await result.current.processNextTask();
    });

    let state = useTriggerTaskStore.getState();
    expect(state.runningTasks).toHaveLength(3);
    expect(state.taskQueue).toHaveLength(0);

    // Now enqueue A2, B2 while all projects are busy
    useTriggerTaskStore
      .getState()
      .enqueueTask(makeTaskPayload({ projectId: 'proj-A', triggerName: 'A2' }));
    useTriggerTaskStore
      .getState()
      .enqueueTask(makeTaskPayload({ projectId: 'proj-B', triggerName: 'B2' }));

    // Process → nothing should move (all busy)
    await act(async () => {
      await result.current.processNextTask();
    });

    state = useTriggerTaskStore.getState();
    expect(state.runningTasks).toHaveLength(3);
    expect(state.taskQueue).toHaveLength(2);

    // Complete proj-A's task
    const taskA1 = state.runningTasks.find((t) => t.triggerName === 'A1')!;
    useTriggerTaskStore.getState().completeTask(taskA1.id);

    // Process → A2 should start running
    await act(async () => {
      await result.current.processNextTask();
    });

    state = useTriggerTaskStore.getState();
    // proj-A: A2 running (A1 completed)
    // proj-B: B1 running, B2 still queued
    // proj-C: C1 still running
    expect(state.runningTasks).toHaveLength(3);
    expect(state.taskQueue).toHaveLength(1);
    expect(state.taskQueue[0].triggerName).toBe('B2');

    const runningNames = state.runningTasks.map((t) => t.triggerName).sort();
    expect(runningNames).toEqual(['A2', 'B1', 'C1']);

    // Clean up proj-C
    useProjectStore.getState().removeProject('proj-C');
  });

  // ──── Edge case: null projectId ────

  it('should handle tasks with null projectId', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Enqueue a task without project ID
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: null, triggerName: 'No Project' })
      );

    // Process
    await act(async () => {
      await result.current.processNextTask();
    });

    const state = useTriggerTaskStore.getState();
    // Should have been dequeued and running
    expect(state.runningTasks).toHaveLength(1);
    expect(state.runningTasks[0].projectId).toBeNull();
    expect(state.taskQueue).toHaveLength(0);
  });

  it('should serialize null-projectId tasks among themselves', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Enqueue two tasks without project ID
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: null, triggerName: 'No Project 1' })
      );
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: null, triggerName: 'No Project 2' })
      );

    // Process → only first should run
    await act(async () => {
      await result.current.processNextTask();
    });

    const state = useTriggerTaskStore.getState();
    expect(state.runningTasks).toHaveLength(1);
    expect(state.runningTasks[0].triggerName).toBe('No Project 1');
    expect(state.taskQueue).toHaveLength(1);
    expect(state.taskQueue[0].triggerName).toBe('No Project 2');
  });

  // ──── Returned values ────

  it('should return pending tasks and running tasks', async () => {
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'Pending 1' })
      );

    const { result } = renderHook(() => useTriggerTaskExecutor());

    expect(result.current.pendingTasks).toHaveLength(1);
    expect(result.current.pendingTasks[0].triggerName).toBe('Pending 1');
    expect(result.current.runningTasks).toHaveLength(0);
  });

  // ──── Auto-process on completion ────

  it('should auto-process queued task when running task completes', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Enqueue two tasks for the same project
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'First' })
      );
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'Second' })
      );

    // Process → only first should run (same project serialization)
    await act(async () => {
      await result.current.processNextTask();
    });

    let state = useTriggerTaskStore.getState();
    expect(state.runningTasks).toHaveLength(1);
    expect(state.runningTasks[0].triggerName).toBe('First');
    expect(state.taskQueue).toHaveLength(1);

    // Complete the first task (simulates chatStore calling completeTask)
    const firstId = state.runningTasks[0].id;
    await act(async () => {
      useTriggerTaskStore.getState().completeTask(firstId);
    });

    // The useEffect watches runningTasks + taskQueue and calls processNextTask
    // after a 500ms delay. Advance timers to trigger it.
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    // Allow the async processNextTask to complete
    await act(async () => {
      await Promise.resolve();
    });

    state = useTriggerTaskStore.getState();
    // Second task should now be running, none queued
    expect(state.runningTasks).toHaveLength(1);
    expect(state.runningTasks[0].triggerName).toBe('Second');
    expect(state.taskQueue).toHaveLength(0);
    // First task should be in history
    expect(state.taskHistory).toHaveLength(1);
    expect(state.taskHistory[0].triggerName).toBe('First');
  });

  it('should auto-process queued task when running task fails', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Enqueue two tasks for the same project
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'First' })
      );
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'Second' })
      );

    // Process → only first runs
    await act(async () => {
      await result.current.processNextTask();
    });

    let state = useTriggerTaskStore.getState();
    const firstId = state.runningTasks[0].id;

    // Fail the first task
    await act(async () => {
      useTriggerTaskStore.getState().failTask(firstId, 'Oops');
    });

    // Advance past the 500ms delay
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    await act(async () => {
      await Promise.resolve();
    });

    state = useTriggerTaskStore.getState();
    // Second task should now be running
    expect(state.runningTasks).toHaveLength(1);
    expect(state.runningTasks[0].triggerName).toBe('Second');
    expect(state.taskQueue).toHaveLength(0);
    // Failed task in history
    expect(state.taskHistory).toHaveLength(1);
    expect(state.taskHistory[0].status).toBe(ExecutionStatus.Failed);
  });

  it('should NOT auto-process when no pending tasks remain', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Enqueue only one task
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'Only One' })
      );

    await act(async () => {
      await result.current.processNextTask();
    });

    let state = useTriggerTaskStore.getState();
    const taskId = state.runningTasks[0].id;

    // Complete it
    await act(async () => {
      useTriggerTaskStore.getState().completeTask(taskId);
    });

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    await act(async () => {
      await Promise.resolve();
    });

    state = useTriggerTaskStore.getState();
    // Nothing running, nothing queued, one in history
    expect(state.runningTasks).toHaveLength(0);
    expect(state.taskQueue).toHaveLength(0);
    expect(state.taskHistory).toHaveLength(1);
  });

  // ──── Cross-project auto-switch on completion ────

  it('should switch active project and process queued task from a DIFFERENT project after current completes', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Start with proj-A active
    useProjectStore.getState().setActiveProject('proj-A');

    // Enqueue and process a task for proj-A (makes it busy)
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-A', triggerName: 'Running A' })
      );
    await act(async () => {
      await result.current.processNextTask();
    });

    // Verify proj-A is active and running
    expect(useProjectStore.getState().activeProjectId).toBe('proj-A');
    expect(useTriggerTaskStore.getState().runningTasks).toHaveLength(1);

    // Now enqueue a task for proj-B while proj-A is running AND proj-B is not busy
    useTriggerTaskStore
      .getState()
      .enqueueTask(
        makeTaskPayload({ projectId: 'proj-B', triggerName: 'Waiting B' })
      );

    // Process → proj-B task should execute immediately (proj-B is not busy)
    //          This will call setActiveProject('proj-B')
    await act(async () => {
      await result.current.processNextTask();
    });

    let state = useTriggerTaskStore.getState();
    // Both should be running now
    expect(state.runningTasks).toHaveLength(2);
    expect(state.taskQueue).toHaveLength(0);
    // Active project switched to proj-B (last executeTask call)
    expect(useProjectStore.getState().activeProjectId).toBe('proj-B');

    // Now complete proj-B task
    const taskB = state.runningTasks.find(
      (t) => t.triggerName === 'Waiting B'
    )!;
    await act(async () => {
      useTriggerTaskStore.getState().completeTask(taskB.id);
    });

    state = useTriggerTaskStore.getState();
    // Only proj-A running, nothing queued
    expect(state.runningTasks).toHaveLength(1);
    expect(state.runningTasks[0].triggerName).toBe('Running A');
    expect(state.taskQueue).toHaveLength(0);
  });

  it('should auto-switch to different project when queued task becomes eligible after completion', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Set proj-A as active
    useProjectStore.getState().setActiveProject('proj-A');

    // Start tasks for both proj-A and proj-B
    useTriggerTaskStore
      .getState()
      .enqueueTask(makeTaskPayload({ projectId: 'proj-A', triggerName: 'A1' }));
    useTriggerTaskStore
      .getState()
      .enqueueTask(makeTaskPayload({ projectId: 'proj-B', triggerName: 'B1' }));
    await act(async () => {
      await result.current.processNextTask();
    });

    // Both running
    expect(useTriggerTaskStore.getState().runningTasks).toHaveLength(2);

    // Enqueue a second task for proj-B while B1 is running (will be queued)
    useTriggerTaskStore
      .getState()
      .enqueueTask(makeTaskPayload({ projectId: 'proj-B', triggerName: 'B2' }));

    let state = useTriggerTaskStore.getState();
    expect(state.taskQueue).toHaveLength(1);
    expect(state.taskQueue[0].triggerName).toBe('B2');

    // User manually switches to proj-A
    useProjectStore.getState().setActiveProject('proj-A');
    expect(useProjectStore.getState().activeProjectId).toBe('proj-A');

    // Complete proj-B's first task (B1)
    const taskB1 = state.runningTasks.find((t) => t.triggerName === 'B1')!;
    await act(async () => {
      useTriggerTaskStore.getState().completeTask(taskB1.id);
    });

    // The useEffect detects pending B2 and calls processNextTask after 500ms
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    await act(async () => {
      await Promise.resolve();
    });

    state = useTriggerTaskStore.getState();
    // B2 should be running now (auto-processed after B1 completed)
    expect(state.runningTasks).toHaveLength(2);
    const runningNames = state.runningTasks.map((t) => t.triggerName).sort();
    expect(runningNames).toEqual(['A1', 'B2']);
    expect(state.taskQueue).toHaveLength(0);

    // Active project should now be proj-B (executeTask called setActiveProject)
    expect(useProjectStore.getState().activeProjectId).toBe('proj-B');
  });
});
