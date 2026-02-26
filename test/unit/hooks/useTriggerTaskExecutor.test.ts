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
 * Trigger Task System — Unit Tests
 *
 * Architecture:
 *   WebSocket event → useTriggerTaskExecutor (routes to projectStore.addQueuedMessage)
 *     → useBackgroundTaskProcessor (polls queuedMessages, runs up to POOL_SIZE concurrently)
 *     → triggerTaskStore (only tracks executionMappings)
 *
 * Plan under test:
 * 1. IF current project is running → add to queue (projectStore.queuedMessages)
 * 2. IF current project finished running → execute & remove from queue; update execution status on start
 * 3. IF triggered new task while on a different page → show toast, add to project queue / run in background
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock external dependencies ───────────────────────────────────

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

vi.mock('@/service/triggerApi', () => ({
  proxyUpdateTriggerExecution: vi.fn(() => Promise.resolve()),
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
import {
  formatTriggeredTaskMessage,
  useTriggerTaskStore,
} from '@/store/triggerTaskStore';
import { TriggerType } from '@/types';
import { toast } from 'sonner';

// ─── Helpers ──────────────────────────────────────────────────────

function makeTask(overrides: Partial<TriggeredTask> = {}): TriggeredTask {
  return {
    id:
      overrides.id ??
      `triggered-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    triggerId: overrides.triggerId ?? 1,
    triggerName: overrides.triggerName ?? 'Test Trigger',
    taskPrompt: overrides.taskPrompt ?? 'Do something',
    executionId: overrides.executionId ?? `exec-${Date.now()}-${Math.random()}`,
    triggerType: (overrides.triggerType ?? 'webhook') as TriggerType,
    projectId: overrides.projectId ?? null,
    inputData: overrides.inputData ?? {},
    timestamp: overrides.timestamp ?? Date.now(),
    formattedMessage: overrides.formattedMessage,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. triggerTaskStore — execution mappings only
// ═══════════════════════════════════════════════════════════════════

describe('triggerTaskStore — execution mappings', () => {
  beforeEach(() => {
    useTriggerTaskStore.setState({ executionMappings: new Map() });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register an execution mapping', () => {
    const store = useTriggerTaskStore.getState();
    store.registerExecutionMapping(
      'chat-task-1',
      'exec-1',
      'trigger-task-1',
      'proj-A',
      'My Trigger',
      42
    );

    const mapping = useTriggerTaskStore
      .getState()
      .getExecutionMapping('chat-task-1');
    expect(mapping).toBeDefined();
    expect(mapping!.chatTaskId).toBe('chat-task-1');
    expect(mapping!.executionId).toBe('exec-1');
    expect(mapping!.triggerTaskId).toBe('trigger-task-1');
    expect(mapping!.projectId).toBe('proj-A');
    expect(mapping!.reported).toBe(false);
  });

  it('should remove an execution mapping', () => {
    const store = useTriggerTaskStore.getState();
    store.registerExecutionMapping('chat-task-1', 'exec-1', 'tt-1', 'proj-A');

    store.removeExecutionMapping('chat-task-1');

    expect(
      useTriggerTaskStore.getState().getExecutionMapping('chat-task-1')
    ).toBeUndefined();
  });

  it('should return undefined for non-existent mapping', () => {
    expect(
      useTriggerTaskStore.getState().getExecutionMapping('nope')
    ).toBeUndefined();
  });

  it('should support multiple independent mappings', () => {
    const store = useTriggerTaskStore.getState();
    store.registerExecutionMapping('ct-1', 'e-1', 'tt-1', 'proj-A');
    store.registerExecutionMapping('ct-2', 'e-2', 'tt-2', 'proj-B');

    expect(useTriggerTaskStore.getState().executionMappings.size).toBe(2);
    expect(
      useTriggerTaskStore.getState().getExecutionMapping('ct-1')!.executionId
    ).toBe('e-1');
    expect(
      useTriggerTaskStore.getState().getExecutionMapping('ct-2')!.executionId
    ).toBe('e-2');
  });

  it('should overwrite mapping for same chatTaskId', () => {
    const store = useTriggerTaskStore.getState();
    store.registerExecutionMapping('ct-1', 'e-old', 'tt-1', 'proj-A');
    store.registerExecutionMapping('ct-1', 'e-new', 'tt-1', 'proj-A');

    expect(useTriggerTaskStore.getState().executionMappings.size).toBe(1);
    expect(
      useTriggerTaskStore.getState().getExecutionMapping('ct-1')!.executionId
    ).toBe('e-new');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. formatTriggeredTaskMessage
// ═══════════════════════════════════════════════════════════════════

describe('formatTriggeredTaskMessage', () => {
  it('should return just the prompt for schedule triggers', () => {
    const msg = formatTriggeredTaskMessage(
      makeTask({
        triggerType: 'schedule' as TriggerType,
        taskPrompt: 'Run daily report',
      })
    );
    expect(msg).toBe('Run daily report');
  });

  it('should return just the prompt for webhook with no extra data', () => {
    const msg = formatTriggeredTaskMessage(
      makeTask({
        triggerType: 'webhook' as TriggerType,
        taskPrompt: 'Handle hook',
        inputData: {},
      })
    );
    expect(msg).toBe('Handle hook');
  });

  it('should include webhook context when present', () => {
    const msg = formatTriggeredTaskMessage(
      makeTask({
        triggerType: 'webhook' as TriggerType,
        taskPrompt: 'Process request',
        inputData: {
          method: 'POST',
          body: { key: 'value' },
        },
      })
    );
    expect(msg).toContain('Process request');
    expect(msg).toContain('**Method:** POST');
    expect(msg).toContain('"key": "value"');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. useTriggerTaskExecutor — hook-level tests
// ═══════════════════════════════════════════════════════════════════

describe('useTriggerTaskExecutor — hook behavior', () => {
  beforeEach(() => {
    // Reset stores
    useTriggerTaskStore.setState({ executionMappings: new Map() });
    useTriggerStore.setState({ webSocketEvent: null });

    // Create test projects
    const projectStore = useProjectStore.getState();
    projectStore.createProject('Project A', 'Test project A', 'proj-A');
    projectStore.createProject('Project B', 'Test project B', 'proj-B');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();

    // Clean up projects
    const projectStore = useProjectStore.getState();
    const projects = projectStore.getAllProjects();
    for (const p of projects) {
      projectStore.removeProject(p.id);
    }
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║  PLAN 1: If current project is running → add to queue       ║
  // ╚═══════════════════════════════════════════════════════════════╝

  it('should add task to project queuedMessages when executeTask is called', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    const task = makeTask({
      projectId: 'proj-A',
      triggerName: 'Webhook #1',
      executionId: 'exec-001',
      taskPrompt: 'Process webhook',
    });

    await act(async () => {
      await result.current.executeTask(task);
    });

    // Message should be in project A's queuedMessages
    const project = useProjectStore.getState().getProjectById('proj-A');
    expect(project!.queuedMessages).toHaveLength(1);
    expect(project!.queuedMessages[0].executionId).toBe('exec-001');
    expect(project!.queuedMessages[0].content).toContain('Process webhook');
  });

  it('should queue multiple tasks for the same project (serialization)', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    // Fire two tasks at proj-A
    const task1 = makeTask({
      projectId: 'proj-A',
      triggerName: 'First',
      executionId: 'exec-1',
    });
    const task2 = makeTask({
      projectId: 'proj-A',
      triggerName: 'Second',
      executionId: 'exec-2',
    });

    await act(async () => {
      await result.current.executeTask(task1);
      await result.current.executeTask(task2);
    });

    const project = useProjectStore.getState().getProjectById('proj-A');
    expect(project!.queuedMessages).toHaveLength(2);
    expect(project!.queuedMessages[0].executionId).toBe('exec-1');
    expect(project!.queuedMessages[1].executionId).toBe('exec-2');
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║  PLAN 2: Project finished → execute & remove from queue     ║
  // ║          Update execution status on start                   ║
  // ╚═══════════════════════════════════════════════════════════════╝

  it('should allow background processor to remove message from queue when processing', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    const task = makeTask({ projectId: 'proj-A', executionId: 'exec-rm' });

    await act(async () => {
      await result.current.executeTask(task);
    });

    // Verify it's queued
    let project = useProjectStore.getState().getProjectById('proj-A');
    expect(project!.queuedMessages).toHaveLength(1);
    const taskId = project!.queuedMessages[0].task_id;

    // Simulate background processor removing the message (what useBackgroundTaskProcessor does)
    useProjectStore.getState().removeQueuedMessage('proj-A', taskId);

    project = useProjectStore.getState().getProjectById('proj-A');
    expect(project!.queuedMessages).toHaveLength(0);
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║  PLAN 3: Triggered on different page → toast + queue/run    ║
  // ╚═══════════════════════════════════════════════════════════════╝

  it('should show toast when task is queued via executeTask', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    const task = makeTask({
      projectId: 'proj-A',
      triggerName: 'Remote Trigger',
      executionId: 'exec-toast',
    });

    await act(async () => {
      await result.current.executeTask(task);
    });

    // Toast info should have been called on start
    expect(toast.info).toHaveBeenCalledWith(
      'Execution started: Remote Trigger',
      expect.objectContaining({ description: 'Processing trigger task...' })
    );
    // Toast success should have been called after queueing
    expect(toast.success).toHaveBeenCalledWith(
      'Queued: Remote Trigger',
      expect.objectContaining({
        description: 'Task has been added to the project queue',
      })
    );
  });

  it('should queue tasks for different projects independently (parallel background execution)', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    const taskA = makeTask({
      projectId: 'proj-A',
      triggerName: 'Task A',
      executionId: 'exec-A',
    });
    const taskB = makeTask({
      projectId: 'proj-B',
      triggerName: 'Task B',
      executionId: 'exec-B',
    });

    await act(async () => {
      await result.current.executeTask(taskA);
      await result.current.executeTask(taskB);
    });

    const projA = useProjectStore.getState().getProjectById('proj-A');
    const projB = useProjectStore.getState().getProjectById('proj-B');

    expect(projA!.queuedMessages).toHaveLength(1);
    expect(projA!.queuedMessages[0].executionId).toBe('exec-A');
    expect(projB!.queuedMessages).toHaveLength(1);
    expect(projB!.queuedMessages[0].executionId).toBe('exec-B');
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║  WebSocket event integration                                ║
  // ╚═══════════════════════════════════════════════════════════════╝

  it('should process WebSocket event and add to project queue', async () => {
    renderHook(() => useTriggerTaskExecutor());

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

    // Allow async executeTask to complete
    await act(async () => {
      await Promise.resolve();
    });

    const project = useProjectStore.getState().getProjectById('proj-A');
    expect(project!.queuedMessages.length).toBeGreaterThanOrEqual(1);
    expect(
      project!.queuedMessages.some((m) => m.executionId === 'exec-ws-1')
    ).toBe(true);
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

    expect(useTriggerStore.getState().webSocketEvent).toBeNull();
  });

  it('should create a new project when projectId is null', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    const task = makeTask({
      projectId: null,
      triggerName: 'No-Project Trigger',
      executionId: 'exec-no-proj',
    });

    await act(async () => {
      await result.current.executeTask(task);
    });

    // A new project should have been created with the task queued
    const allProjects = useProjectStore.getState().getAllProjects();
    const triggerProject = allProjects.find((p) =>
      p.name.includes('No-Project Trigger')
    );
    expect(triggerProject).toBeDefined();
    expect(triggerProject!.queuedMessages).toHaveLength(1);
    expect(triggerProject!.queuedMessages[0].executionId).toBe('exec-no-proj');

    // Clean up
    if (triggerProject) {
      useProjectStore.getState().removeProject(triggerProject.id);
    }
  });

  it('should handle WebSocket event for project not found locally (loads from history)', async () => {
    renderHook(() => useTriggerTaskExecutor());

    await act(async () => {
      useTriggerStore.getState().emitWebSocketEvent({
        triggerId: 1,
        triggerName: 'History Trigger',
        taskPrompt: 'Do something from history',
        executionId: 'exec-hist-1',
        timestamp: Date.now(),
        triggerType: TriggerType.Webhook,
        projectId: 'proj-no-exist',
        inputData: {},
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    // The executor should have created or loaded a project
    const project = useProjectStore.getState().getProjectById('proj-no-exist');
    // Either loaded from history mock or created new
    expect(project).not.toBeNull();

    // Clean up
    if (project) {
      useProjectStore.getState().removeProject(project.id);
    }
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║  Edge cases                                                 ║
  // ╚═══════════════════════════════════════════════════════════════╝

  it('should expose executeTask function', () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());
    expect(result.current.executeTask).toBeDefined();
    expect(typeof result.current.executeTask).toBe('function');
  });

  it('should queue messages with triggerId and triggerName metadata', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    const task = makeTask({
      projectId: 'proj-A',
      triggerId: 42,
      triggerName: 'Special Trigger',
      executionId: 'exec-meta',
    });

    await act(async () => {
      await result.current.executeTask(task);
    });

    const project = useProjectStore.getState().getProjectById('proj-A');
    const msg = project!.queuedMessages[0];
    expect(msg.triggerId).toBe(42);
    expect(msg.triggerName).toBe('Special Trigger');
    expect(msg.executionId).toBe('exec-meta');
  });

  it('should handle multiple WebSocket events in sequence', async () => {
    renderHook(() => useTriggerTaskExecutor());

    // First event
    await act(async () => {
      useTriggerStore.getState().emitWebSocketEvent({
        triggerId: 1,
        triggerName: 'Seq Trigger 1',
        taskPrompt: 'First task',
        executionId: 'exec-seq-1',
        timestamp: Date.now(),
        triggerType: TriggerType.Webhook,
        projectId: 'proj-A',
        inputData: {},
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Second event
    await act(async () => {
      useTriggerStore.getState().emitWebSocketEvent({
        triggerId: 2,
        triggerName: 'Seq Trigger 2',
        taskPrompt: 'Second task',
        executionId: 'exec-seq-2',
        timestamp: Date.now(),
        triggerType: TriggerType.Webhook,
        projectId: 'proj-A',
        inputData: {},
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    const project = useProjectStore.getState().getProjectById('proj-A');
    expect(project!.queuedMessages).toHaveLength(2);

    const execIds = project!.queuedMessages.map((m) => m.executionId);
    expect(execIds).toContain('exec-seq-1');
    expect(execIds).toContain('exec-seq-2');
  });

  it('should queue tasks for different projects from WebSocket events (background parallel)', async () => {
    renderHook(() => useTriggerTaskExecutor());

    // Event for proj-A
    await act(async () => {
      useTriggerStore.getState().emitWebSocketEvent({
        triggerId: 1,
        triggerName: 'Trigger A',
        taskPrompt: 'Task for A',
        executionId: 'exec-par-A',
        timestamp: Date.now(),
        triggerType: TriggerType.Webhook,
        projectId: 'proj-A',
        inputData: {},
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Event for proj-B
    await act(async () => {
      useTriggerStore.getState().emitWebSocketEvent({
        triggerId: 2,
        triggerName: 'Trigger B',
        taskPrompt: 'Task for B',
        executionId: 'exec-par-B',
        timestamp: Date.now(),
        triggerType: TriggerType.Webhook,
        projectId: 'proj-B',
        inputData: {},
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    const projA = useProjectStore.getState().getProjectById('proj-A');
    const projB = useProjectStore.getState().getProjectById('proj-B');

    expect(projA!.queuedMessages).toHaveLength(1);
    expect(projA!.queuedMessages[0].executionId).toBe('exec-par-A');
    expect(projB!.queuedMessages).toHaveLength(1);
    expect(projB!.queuedMessages[0].executionId).toBe('exec-par-B');
  });

  // ╔═══════════════════════════════════════════════════════════════╗
  // ║  Queue removal / cancellation via projectStore              ║
  // ╚═══════════════════════════════════════════════════════════════╝

  it('should support removing a queued message (cancel from UI)', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    const task1 = makeTask({
      projectId: 'proj-A',
      executionId: 'exec-c1',
      triggerName: 'Keep',
    });
    const task2 = makeTask({
      projectId: 'proj-A',
      executionId: 'exec-c2',
      triggerName: 'Remove',
    });

    await act(async () => {
      await result.current.executeTask(task1);
      await result.current.executeTask(task2);
    });

    let project = useProjectStore.getState().getProjectById('proj-A');
    expect(project!.queuedMessages).toHaveLength(2);

    // Remove the second one (simulating cancel)
    const toRemoveId = project!.queuedMessages[1].task_id;
    useProjectStore.getState().removeQueuedMessage('proj-A', toRemoveId);

    project = useProjectStore.getState().getProjectById('proj-A');
    expect(project!.queuedMessages).toHaveLength(1);
    expect(project!.queuedMessages[0].executionId).toBe('exec-c1');
  });

  it('should support restoring a removed queued message (undo cancel)', async () => {
    const { result } = renderHook(() => useTriggerTaskExecutor());

    const task = makeTask({
      projectId: 'proj-A',
      executionId: 'exec-restore',
    });

    await act(async () => {
      await result.current.executeTask(task);
    });

    let project = useProjectStore.getState().getProjectById('proj-A');
    const taskId = project!.queuedMessages[0].task_id;

    // Remove then restore
    const removed = useProjectStore
      .getState()
      .removeQueuedMessage('proj-A', taskId);
    useProjectStore.getState().restoreQueuedMessage('proj-A', removed);

    project = useProjectStore.getState().getProjectById('proj-A');
    expect(project!.queuedMessages).toHaveLength(1);
    expect(project!.queuedMessages[0].executionId).toBe('exec-restore');
  });
});
