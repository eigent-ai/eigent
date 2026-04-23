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
 * TaskQueue Tests
 *
 * Testes unitários para o módulo TaskQueue.
 */

import { TaskQueue } from '@/store/handlers/TaskQueue';
import type { Task } from '@/types/chatbox';
import { beforeEach, describe, expect, it } from 'vitest';

// ============================================================================
// HELPERS
// ============================================================================

function createMockTask(): Task {
  return {
    messages: [],
    type: 'default',
    summaryTask: '',
    taskInfo: [],
    attaches: [],
    taskRunning: [],
    taskAssigning: [],
    fileList: [],
    webViewUrls: [],
    activeAsk: '',
    askList: [],
    progressValue: 0,
    isPending: false,
    activeWorkspace: null,
    hasMessages: false,
    activeAgent: '',
    status: 'pending' as const,
    taskTime: 0,
    elapsed: 0,
    tokens: 0,
    hasWaitComfirm: false,
    cotList: [],
    hasAddWorker: false,
    nuwFileNum: 0,
    delayTime: 0,
    selectedFile: null,
    snapshots: [],
    snapshotsTemp: [],
    isTakeControl: false,
    isTaskEdit: false,
    streamingDecomposeText: '',
  };
}

// ============================================================================
// TESTS: Configuration
// ============================================================================

describe('TaskQueue - Configuration', () => {
  beforeEach(() => {
    TaskQueue.clear();
    TaskQueue.configure({ maxConcurrent: 5, maxQueueSize: 100 });
  });

  it('should return default config', () => {
    const config = TaskQueue.getConfig();
    expect(config.maxConcurrent).toBe(5);
    expect(config.maxQueueSize).toBe(100);
  });

  it('should update config', () => {
    TaskQueue.configure({ maxConcurrent: 10 });
    const config = TaskQueue.getConfig();
    expect(config.maxConcurrent).toBe(10);
  });
});

// ============================================================================
// TESTS: Task Management
// ============================================================================

describe('TaskQueue - Task Management', () => {
  beforeEach(() => {
    TaskQueue.clear();
    TaskQueue.configure({ maxConcurrent: 2, maxQueueSize: 10 });
  });

  describe('startTask', () => {
    it('should start a task when under limit', () => {
      const task = createMockTask();
      const result = TaskQueue.startTask('task-1', task);
      expect(result).toBe(true);
    });

    it('should not start task when at limit', () => {
      TaskQueue.startTask('task-1', createMockTask());
      TaskQueue.startTask('task-2', createMockTask());

      // At limit
      const result = TaskQueue.startTask('task-3', createMockTask());
      expect(result).toBe(false);
    });

    it('should track active task count', () => {
      expect(TaskQueue.getActiveCount()).toBe(0);

      TaskQueue.startTask('task-1', createMockTask());
      expect(TaskQueue.getActiveCount()).toBe(1);

      TaskQueue.startTask('task-2', createMockTask());
      expect(TaskQueue.getActiveCount()).toBe(2);
    });

    it('should detect active task', () => {
      TaskQueue.startTask('task-1', createMockTask());

      expect(TaskQueue.isTaskActive('task-1')).toBe(true);
      expect(TaskQueue.isTaskActive('task-2')).toBe(false);
    });
  });

  describe('finishTask', () => {
    it('should remove task from active', () => {
      TaskQueue.startTask('task-1', createMockTask());
      expect(TaskQueue.isTaskActive('task-1')).toBe(true);

      TaskQueue.finishTask('task-1');
      expect(TaskQueue.isTaskActive('task-1')).toBe(false);
    });

    it('should reduce active count', () => {
      TaskQueue.startTask('task-1', createMockTask());
      TaskQueue.startTask('task-2', createMockTask());

      TaskQueue.finishTask('task-1');
      expect(TaskQueue.getActiveCount()).toBe(1);
    });
  });

  describe('getActiveTasks', () => {
    it('should return all active task ids', () => {
      TaskQueue.startTask('task-1', createMockTask());
      TaskQueue.startTask('task-2', createMockTask());

      const active = TaskQueue.getActiveTasks();
      expect(active).toContain('task-1');
      expect(active).toContain('task-2');
    });
  });
});

// ============================================================================
// TESTS: Queue Operations
// ============================================================================

describe('TaskQueue - Queue Operations', () => {
  beforeEach(() => {
    TaskQueue.clear();
    TaskQueue.configure({ maxConcurrent: 1, maxQueueSize: 5 });
  });

  describe('enqueue', () => {
    it('should add task to queue', () => {
      const result = TaskQueue.enqueue({
        id: 'q-1',
        taskId: 'task-1',
        priority: 'normal',
        createdAt: new Date(),
      });
      expect(result).toBe(true);
      expect(TaskQueue.getQueueSize()).toBe(1);
    });

    it('should reject when queue is full', () => {
      // Fill the queue
      for (let i = 0; i < 5; i++) {
        TaskQueue.enqueue({
          id: `q-${i}`,
          taskId: `task-${i}`,
          priority: 'normal',
          createdAt: new Date(),
        });
      }

      const result = TaskQueue.enqueue({
        id: 'q-extra',
        taskId: 'task-extra',
        priority: 'normal',
        createdAt: new Date(),
      });
      expect(result).toBe(false);
    });

    it('should maintain queue size limit', () => {
      TaskQueue.configure({ maxQueueSize: 3 });

      TaskQueue.enqueue({
        id: '1',
        taskId: 't1',
        priority: 'normal',
        createdAt: new Date(),
      });
      TaskQueue.enqueue({
        id: '2',
        taskId: 't2',
        priority: 'normal',
        createdAt: new Date(),
      });
      TaskQueue.enqueue({
        id: '3',
        taskId: 't3',
        priority: 'normal',
        createdAt: new Date(),
      });

      expect(TaskQueue.getQueueSize()).toBe(3);
    });
  });

  describe('dequeue', () => {
    it('should remove specific task from queue', () => {
      TaskQueue.enqueue({
        id: 'q-1',
        taskId: 'task-1',
        priority: 'normal',
        createdAt: new Date(),
      });
      TaskQueue.enqueue({
        id: 'q-2',
        taskId: 'task-2',
        priority: 'normal',
        createdAt: new Date(),
      });

      const removed = TaskQueue.dequeue('q-1');
      expect(removed?.id).toBe('q-1');
      expect(TaskQueue.getQueueSize()).toBe(1);
    });

    it('should return undefined for non-existent task', () => {
      const removed = TaskQueue.dequeue('non-existent');
      expect(removed).toBeUndefined();
    });
  });

  describe('peek', () => {
    it('should return next task without removing', () => {
      TaskQueue.enqueue({
        id: 'q-1',
        taskId: 'task-1',
        priority: 'normal',
        createdAt: new Date(),
      });
      TaskQueue.enqueue({
        id: 'q-2',
        taskId: 'task-2',
        priority: 'normal',
        createdAt: new Date(),
      });

      const peeked = TaskQueue.peek();
      expect(peeked?.id).toBe('q-1');
      expect(TaskQueue.getQueueSize()).toBe(2);
    });

    it('should return undefined for empty queue', () => {
      const peeked = TaskQueue.peek();
      expect(peeked).toBeUndefined();
    });
  });
});

// ============================================================================
// TESTS: Priority Queue
// ============================================================================

describe('TaskQueue - Priority Queue', () => {
  beforeEach(() => {
    TaskQueue.clear();
    TaskQueue.configure({ maxConcurrent: 0, maxQueueSize: 10 });
  });

  it('should prioritize urgent tasks', () => {
    TaskQueue.enqueue({
      id: '1',
      taskId: 't1',
      priority: 'low',
      createdAt: new Date(),
    });
    TaskQueue.enqueue({
      id: '2',
      taskId: 't2',
      priority: 'urgent',
      createdAt: new Date(),
    });
    TaskQueue.enqueue({
      id: '3',
      taskId: 't3',
      priority: 'normal',
      createdAt: new Date(),
    });

    const peeked = TaskQueue.peek();
    expect(peeked?.id).toBe('2');
  });

  it('should prioritize high over normal', () => {
    TaskQueue.enqueue({
      id: '1',
      taskId: 't1',
      priority: 'normal',
      createdAt: new Date(),
    });
    TaskQueue.enqueue({
      id: '2',
      taskId: 't2',
      priority: 'high',
      createdAt: new Date(),
    });

    const peeked = TaskQueue.peek();
    expect(peeked?.id).toBe('2');
  });

  it('should handle prioritize operation', () => {
    TaskQueue.enqueue({
      id: '1',
      taskId: 't1',
      priority: 'low',
      createdAt: new Date(),
    });
    TaskQueue.enqueue({
      id: '2',
      taskId: 't2',
      priority: 'normal',
      createdAt: new Date(),
    });

    TaskQueue.prioritize('1', 'urgent');

    const peeked = TaskQueue.peek();
    expect(peeked?.id).toBe('1');
    expect(peeked?.priority).toBe('urgent');
  });

  it('should maintain order for same priority', () => {
    const now = new Date();
    TaskQueue.enqueue({
      id: '1',
      taskId: 't1',
      priority: 'normal',
      createdAt: now,
    });
    TaskQueue.enqueue({
      id: '2',
      taskId: 't2',
      priority: 'normal',
      createdAt: new Date(now.getTime() + 1000),
    });

    const first = TaskQueue.dequeue();
    const second = TaskQueue.dequeue();

    expect(first?.id).toBe('1');
    expect(second?.id).toBe('2');
  });
});

// ============================================================================
// TESTS: Concurrency
// ============================================================================

describe('TaskQueue - Concurrency', () => {
  beforeEach(() => {
    TaskQueue.clear();
    TaskQueue.configure({ maxConcurrent: 2, maxQueueSize: 10 });
  });

  describe('canStartTask', () => {
    it('should allow new task when under limit', () => {
      expect(TaskQueue.canStartTask()).toBe(true);
    });

    it('should block new task when at limit', () => {
      TaskQueue.startTask('task-1', createMockTask());
      TaskQueue.startTask('task-2', createMockTask());

      expect(TaskQueue.canStartTask()).toBe(false);
    });
  });

  describe('processNext', () => {
    it('should not process when at concurrency limit', () => {
      TaskQueue.startTask('task-1', createMockTask());
      TaskQueue.startTask('task-2', createMockTask());
      TaskQueue.enqueue({
        id: 'q-1',
        taskId: 'task-3',
        priority: 'normal',
        createdAt: new Date(),
      });

      TaskQueue.processNext();

      // Should still be in queue
      expect(TaskQueue.getQueueSize()).toBe(1);
    });

    it('should process when slot available', () => {
      TaskQueue.startTask('task-1', createMockTask());
      TaskQueue.enqueue({
        id: 'q-1',
        taskId: 'task-2',
        priority: 'normal',
        createdAt: new Date(),
      });

      TaskQueue.finishTask('task-1');
      TaskQueue.processNext();

      // Should be dequeued
      expect(TaskQueue.getQueueSize()).toBe(0);
    });
  });
});

// ============================================================================
// TESTS: Clear
// ============================================================================

describe('TaskQueue - Clear', () => {
  it('should clear all tasks and queue', () => {
    TaskQueue.startTask('task-1', createMockTask());
    TaskQueue.enqueue({
      id: 'q-1',
      taskId: 'task-2',
      priority: 'normal',
      createdAt: new Date(),
    });

    TaskQueue.clear();

    expect(TaskQueue.getActiveCount()).toBe(0);
    expect(TaskQueue.getQueueSize()).toBe(0);
  });
});

// ============================================================================
// TESTS: Edge Cases
// ============================================================================

describe('TaskQueue - Edge Cases', () => {
  beforeEach(() => {
    TaskQueue.clear();
  });

  it('should handle rapid start/finish cycles', () => {
    for (let i = 0; i < 100; i++) {
      TaskQueue.startTask(`task-${i}`, createMockTask());
      TaskQueue.finishTask(`task-${i}`);
    }

    expect(TaskQueue.getActiveCount()).toBe(0);
  });

  it('should handle config changes dynamically', () => {
    TaskQueue.configure({ maxConcurrent: 1 });

    TaskQueue.startTask('task-1', createMockTask());
    expect(TaskQueue.canStartTask()).toBe(false);

    TaskQueue.configure({ maxConcurrent: 5 });
    expect(TaskQueue.canStartTask()).toBe(true);
  });

  it('should handle empty string task id', () => {
    const result = TaskQueue.startTask('', createMockTask());
    expect(result).toBe(true);
  });
});
