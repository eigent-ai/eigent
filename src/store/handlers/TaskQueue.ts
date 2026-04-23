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
 * TaskQueue Module
 *
 * Responsável por gerenciar a fila de tarefas do chat.
 * Extraído do chatStore.ts para melhorar manutenibilidade e testabilidade.
 *
 * @module stores/handlers/TaskQueue
 */

// TODO: Implementar extração completa do TaskQueue
// Este é um placeholder que será implementado na Story 1.3

// ============================================================================
// LOCAL TYPES (Task/TaskInfo not exported from @/types/chatbox)
// ============================================================================

interface TaskInfo {
  id: string;
  content: string;
  status?: string;
}

interface Task {
  id: string;
  messages: unknown[];
  status?: string;
}

// ============================================================================
// TYPES
// ============================================================================

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface QueuedTask {
  id: string;
  taskId: string;
  priority: TaskPriority;
  createdAt: Date;
  data?: unknown;
}

export interface TaskQueueConfig {
  maxConcurrent: number;
  maxQueueSize: number;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: TaskQueueConfig = {
  maxConcurrent: 5,
  maxQueueSize: 100,
};

// ============================================================================
// QUEUE IMPLEMENTATION
// ============================================================================

class PriorityQueue<T extends { priority: TaskPriority }> {
  private items: T[] = [];

  private getPriorityValue(priority: TaskPriority): number {
    const values: Record<TaskPriority, number> = {
      urgent: 4,
      high: 3,
      normal: 2,
      low: 1,
    };
    return values[priority];
  }

  enqueue(item: T): void {
    const priorityValue = this.getPriorityValue(item.priority);

    // Find the correct position based on priority
    let inserted = false;
    for (let i = 0; i < this.items.length; i++) {
      if (this.getPriorityValue(this.items[i].priority) < priorityValue) {
        this.items.splice(i, 0, item);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.items.push(item);
    }
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  peek(): T | undefined {
    return this.items[0];
  }

  size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  clear(): void {
    this.items = [];
  }

  remove(predicate: (item: T) => boolean): T | undefined {
    const index = this.items.findIndex(predicate);
    if (index !== -1) {
      return this.items.splice(index, 1)[0];
    }
    return undefined;
  }
}

// ============================================================================
// ACTIVE TASKS TRACKING
// ============================================================================

const activeTasks = new Map<string, Task>();
const taskQueue = new PriorityQueue<QueuedTask>();
let config: TaskQueueConfig = { ...DEFAULT_CONFIG };

// ============================================================================
// TASK QUEUE MANAGER
// ============================================================================

export const TaskQueue = {
  /**
   * Configura o TaskQueue
   */
  configure(newConfig: Partial<TaskQueueConfig>): void {
    config = { ...config, ...newConfig };
  },

  /**
   * Obtém a configuração atual
   */
  getConfig(): TaskQueueConfig {
    return { ...config };
  },

  /**
   * Obtém número de tasks ativas
   */
  getActiveCount(): number {
    return activeTasks.size;
  },

  /**
   * Obtém número de tasks na fila
   */
  getQueueSize(): number {
    return taskQueue.size();
  },

  /**
   * Verifica se pode iniciar nova task
   */
  canStartTask(): boolean {
    return activeTasks.size < config.maxConcurrent;
  },

  /**
   * Inicia uma nova task
   */
  startTask(taskId: string, task: Task): boolean {
    if (!this.canStartTask()) {
      return false;
    }

    activeTasks.set(taskId, task);
    return true;
  },

  /**
   * Finaliza uma task
   */
  finishTask(taskId: string): void {
    activeTasks.delete(taskId);

    // Processar próxima da fila
    this.processNext();
  },

  /**
   * Adiciona task à fila
   */
  enqueue(queuedTask: QueuedTask): boolean {
    if (taskQueue.size() >= config.maxQueueSize) {
      console.warn('Task queue is full');
      return false;
    }

    taskQueue.enqueue(queuedTask);
    return true;
  },

  /**
   * Remove task da fila
   */
  dequeue(taskId: string): QueuedTask | undefined {
    return taskQueue.remove((t) => t.id === taskId);
  },

  /**
   * Obtém próxima task da fila
   */
  peek(): QueuedTask | undefined {
    return taskQueue.peek();
  },

  /**
   * Prioriza uma task na fila
   */
  prioritize(taskId: string, newPriority: TaskPriority): boolean {
    const queuedTask = taskQueue.remove((t) => t.id === taskId);
    if (queuedTask) {
      queuedTask.priority = newPriority;
      taskQueue.enqueue(queuedTask);
      return true;
    }
    return false;
  },

  /**
   * Limpa todas as tasks
   */
  clear(): void {
    activeTasks.clear();
    taskQueue.clear();
  },

  /**
   * Processa próxima task da fila
   */
  processNext(): void {
    if (!this.canStartTask() || taskQueue.isEmpty()) {
      return;
    }

    const next = taskQueue.dequeue();
    if (next) {
      console.log(`Processing queued task: ${next.id}`);
      // A task será iniciada externamente via callback
    }
  },

  /**
   * Obtém todas as tasks ativas
   */
  getActiveTasks(): string[] {
    return Array.from(activeTasks.keys());
  },

  /**
   * Verifica se task está ativa
   */
  isTaskActive(taskId: string): boolean {
    return activeTasks.has(taskId);
  },
};

export default TaskQueue;
