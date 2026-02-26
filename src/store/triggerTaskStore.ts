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

import { ExecutionStatus, TriggerType } from '@/types';
import { create } from 'zustand';

/**
 * Represents a task triggered by webhook or scheduled execution.
 * Contains all context needed to run the task programmatically.
 */
export interface TriggeredTask {
  /** Unique identifier for this triggered task */
  id: string;
  /** The trigger that initiated this task */
  triggerId: number;
  /** Human-readable name of the trigger */
  triggerName: string;
  /** The task prompt from the trigger configuration */
  taskPrompt: string;
  /** Execution ID from the backend */
  executionId: string;
  /** Type of trigger: webhook or scheduled */
  triggerType: TriggerType;
  /**
   * Target project ID where this task should run.
   * If null, creates a new project or uses active project.
   * Future: triggers will be associated with specific projects.
   */
  projectId: string | null;
  /** Input data from webhook request or scheduled context */
  inputData: Record<string, any>;
  /** Timestamp when the task was triggered */
  timestamp: number;
  /** Current status of the triggered task */
  status: ExecutionStatus;
  /** Formatted message content for display and processing */
  formattedMessage?: string;
  /** Error message if task failed */
  errorMessage?: string;
  /** Whether the execution status has been reported to the backend */
  executionReported?: boolean;
  /** Tokens used for this execution */
  tokensUsed?: number;
}

/**
 * Tracks the relationship between chat task IDs and trigger execution IDs.
 * This allows us to update execution status when a chat task completes.
 */
interface ExecutionMapping {
  /** The chat task ID (from chatStore) */
  chatTaskId: string;
  /** The trigger execution ID (from backend) */
  executionId: string;
  /** The trigger task ID (from triggerTaskStore) */
  triggerTaskId: string;
  /** Project ID where the task is running */
  projectId: string;
  /** Whether the status has been reported */
  reported: boolean;
}

/**
 * Formats the task message with context from webhook or schedule
 */
export function formatTriggeredTaskMessage(task: TriggeredTask): string {
  const parts: string[] = [];

  // Add the main task prompt
  parts.push(task.taskPrompt);

  // Add context separator if we have input data
  // Skip adding context for scheduled triggers - just use the task prompt as-is
  if (task.triggerType === 'schedule') {
    // For scheduled triggers, return only the task prompt without any context
    return parts.join('\n');
  }

  // For webhook triggers, only add context if there's actual data beyond just the trigger name
  if (task.triggerType === 'webhook') {
    const hasWebhookData =
      task.inputData &&
      (task.inputData.method ||
        (task.inputData.query &&
          Object.keys(task.inputData.query).length > 0) ||
        (task.inputData.body && Object.keys(task.inputData.body).length > 0) ||
        (task.inputData.headers &&
          Object.keys(task.inputData.headers).length > 0));

    if (!hasWebhookData) {
      // No extra webhook data, return just the task prompt
      return parts.join('\n');
    }
  }

  if (task.inputData && Object.keys(task.inputData).length > 0) {
    parts.push('\n\n---\n**Trigger Context:**');

    // Format webhook data nicely
    if (task.triggerType === 'webhook') {
      parts.push(`- **Source:** Webhook trigger "${task.triggerName}"`);

      // Include relevant webhook data
      if (task.inputData.method) {
        parts.push(`- **Method:** ${task.inputData.method}`);
      }
      if (
        task.inputData.query &&
        Object.keys(task.inputData.query).length > 0
      ) {
        parts.push(
          `- **Query Parameters:** \`${JSON.stringify(task.inputData.query)}\``
        );
      }
      if (task.inputData.body && Object.keys(task.inputData.body).length > 0) {
        parts.push(
          `- **Request Body:**\n\`\`\`json\n${JSON.stringify(task.inputData.body, null, 2)}\n\`\`\``
        );
      }
      if (
        task.inputData.headers &&
        Object.keys(task.inputData.headers).length > 0
      ) {
        // Filter out sensitive headers
        const safeHeaders = { ...task.inputData.headers };
        delete safeHeaders['authorization'];
        delete safeHeaders['cookie'];
        if (Object.keys(safeHeaders).length > 0) {
          parts.push(`- **Headers:** \`${JSON.stringify(safeHeaders)}\``);
        }
      }
    } else if (task.triggerType === 'slack_trigger') {
      parts.push(`- **Source:** Slack trigger "${task.triggerName}"`);

      // Slack event context
      if (task.inputData.event_type) {
        parts.push(`- **Event Type:** ${task.inputData.event_type}`);
      }
      if (task.inputData.text) {
        parts.push(`- **Message:** ${task.inputData.text}`);
      }
      if (task.inputData.channel_id) {
        parts.push(`- **Channel ID:** ${task.inputData.channel_id}`);
      }
      if (task.inputData.user_id) {
        parts.push(`- **Sender User ID:** ${task.inputData.user_id}`);
      }
      if (task.inputData.thread_ts) {
        parts.push(`- **Thread TS:** ${task.inputData.thread_ts}`);
      }
      if (task.inputData.message_ts) {
        parts.push(`- **Message TS:** ${task.inputData.message_ts}`);
      }
      if (task.inputData.team_id) {
        parts.push(`- **Team ID:** ${task.inputData.team_id}`);
      }
      if (task.inputData.reaction) {
        parts.push(`- **Reaction:** :${task.inputData.reaction}:`);
      }
      if (task.inputData.files && task.inputData.files.length > 0) {
        parts.push(
          `- **Files:** ${task.inputData.files.length} file(s) attached`
        );
      }
    }
  }

  return parts.join('\n');
}

interface TriggerTaskStore {
  /** Queue of triggered tasks waiting to be executed */
  taskQueue: TriggeredTask[];
  /** Currently running triggered tasks (one per project) */
  runningTasks: TriggeredTask[];
  /** History of completed/failed tasks */
  taskHistory: TriggeredTask[];
  /** Maps chat task IDs to execution IDs for status reporting */
  executionMappings: Map<string, ExecutionMapping>;

  // Actions
  /** Add a new triggered task to the queue */
  enqueueTask: (
    task: Omit<TriggeredTask, 'id' | 'status' | 'timestamp'>
  ) => string;
  /** Get the next pending task from the queue, optionally filtered by projectId */
  dequeueTask: (projectId?: string | null) => TriggeredTask | null;
  /** Check if a project already has a running task */
  isProjectBusy: (projectId: string | null) => boolean;
  /** Get the running task for a specific project */
  getRunningTaskForProject: (projectId: string | null) => TriggeredTask | null;
  /** Mark a task as completed */
  completeTask: (taskId: string) => void;
  /** Mark a task as failed */
  failTask: (taskId: string, errorMessage: string) => void;
  /** Cancel a pending task (user-initiated removal from queue) */
  cancelTask: (taskId: string, reason?: string) => void;
  /** Get task by ID */
  getTaskById: (taskId: string) => TriggeredTask | undefined;
  /** Get all pending tasks for a specific project */
  getTasksForProject: (projectId: string) => TriggeredTask[];
  /** Clear completed tasks from history */
  clearHistory: () => void;

  // Execution status tracking
  /** Register a mapping between chat task ID and execution ID */
  registerExecutionMapping: (
    chatTaskId: string,
    executionId: string,
    triggerTaskId: string,
    projectId: string
  ) => void;
  /** Get execution mapping by chat task ID */
  getExecutionMapping: (chatTaskId: string) => ExecutionMapping | undefined;
  /** Remove execution mapping */
  removeExecutionMapping: (chatTaskId: string) => void;
}

export const useTriggerTaskStore = create<TriggerTaskStore>((set, get) => ({
  taskQueue: [],
  runningTasks: [],
  taskHistory: [],
  executionMappings: new Map(),

  enqueueTask: (taskData) => {
    const id = `triggered-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Check for duplicate event_id (Slack deduplication)
    const eventId = taskData.inputData?.event_id;
    if (eventId) {
      const { taskQueue, taskHistory, runningTasks } = get();

      // Check if event_id exists in queue, running tasks, or history
      const isDuplicate =
        taskQueue.some((t) => t.inputData?.event_id === eventId) ||
        runningTasks.some((t) => t.inputData?.event_id === eventId) ||
        taskHistory.some((t) => t.inputData?.event_id === eventId);

      if (isDuplicate) {
        console.warn(
          '[TriggerTaskStore] Duplicate event_id detected, marking as missed:',
          eventId
        );

        const failedTask: TriggeredTask = {
          ...taskData,
          id,
          status: ExecutionStatus.Missed,
          timestamp: Date.now(),
          errorMessage: `Duplicate event_id: ${eventId}`,
        };

        // Add to history as failed
        set((state) => ({
          taskHistory: [...state.taskHistory, failedTask],
        }));

        return id;
      }
    }

    const newTask: TriggeredTask = {
      ...taskData,
      id,
      status: ExecutionStatus.Pending,
      timestamp: Date.now(),
    };

    set((state) => ({
      taskQueue: [...state.taskQueue, newTask],
    }));

    console.log('[TriggerTaskStore] Task enqueued:', id, taskData.triggerName);
    return id;
  },

  dequeueTask: (projectId?: string | null) => {
    const { taskQueue } = get();
    // If projectId is provided, find the next pending task for that project
    // If not provided, find the next pending task (any project)
    const nextTask =
      projectId !== undefined
        ? taskQueue.find(
            (t) =>
              t.status === ExecutionStatus.Pending && t.projectId === projectId
          )
        : taskQueue.find((t) => t.status === ExecutionStatus.Pending);

    if (nextTask) {
      const runningTask = { ...nextTask, status: ExecutionStatus.Running };
      // Mark as running and add to runningTasks
      set((state) => ({
        taskQueue: state.taskQueue.filter((t) => t.id !== nextTask.id),
        runningTasks: [...state.runningTasks, runningTask],
      }));
      console.log(
        '[TriggerTaskStore] Task dequeued:',
        nextTask.id,
        'for project:',
        nextTask.projectId
      );
      return runningTask;
    }
    return null;
  },

  isProjectBusy: (projectId) => {
    const { runningTasks } = get();
    return runningTasks.some((t) => t.projectId === projectId);
  },

  getRunningTaskForProject: (projectId) => {
    const { runningTasks } = get();
    return runningTasks.find((t) => t.projectId === projectId) || null;
  },

  completeTask: (taskId) => {
    set((state) => {
      // Search in runningTasks first, then queue as fallback
      const completedTask =
        state.runningTasks.find((t) => t.id === taskId) ||
        state.taskQueue.find((t) => t.id === taskId);

      if (!completedTask) return state;

      return {
        runningTasks: state.runningTasks.filter((t) => t.id !== taskId),
        taskQueue: state.taskQueue.filter((t) => t.id !== taskId),
        taskHistory: [
          { ...completedTask, status: ExecutionStatus.Completed as const },
          ...state.taskHistory,
        ].slice(0, 50),
      };
    });
    console.log('[TriggerTaskStore] Task completed:', taskId);
  },

  failTask: (taskId, errorMessage) => {
    set((state) => {
      // Search in runningTasks first, then queue as fallback
      const failedTask =
        state.runningTasks.find((t) => t.id === taskId) ||
        state.taskQueue.find((t) => t.id === taskId);

      if (!failedTask) return state;

      return {
        runningTasks: state.runningTasks.filter((t) => t.id !== taskId),
        taskQueue: state.taskQueue.filter((t) => t.id !== taskId),
        taskHistory: [
          {
            ...failedTask,
            status: ExecutionStatus.Failed as const,
            errorMessage,
          },
          ...state.taskHistory,
        ].slice(0, 50),
      };
    });
    console.log('[TriggerTaskStore] Task failed:', taskId, errorMessage);
  },

  cancelTask: (taskId, reason) => {
    set((state) => {
      const cancelledTask = state.taskQueue.find((t) => t.id === taskId);

      if (!cancelledTask) return state;

      return {
        taskQueue: state.taskQueue.filter((t) => t.id !== taskId),
        taskHistory: [
          {
            ...cancelledTask,
            status: ExecutionStatus.Cancelled as const,
            errorMessage: reason || 'Task cancelled by user',
          },
          ...state.taskHistory,
        ].slice(0, 50),
      };
    });
    console.log('[TriggerTaskStore] Task cancelled:', taskId, reason);
  },

  getTaskById: (taskId) => {
    const { taskQueue, runningTasks, taskHistory } = get();
    return (
      taskQueue.find((t) => t.id === taskId) ||
      runningTasks.find((t) => t.id === taskId) ||
      taskHistory.find((t) => t.id === taskId)
    );
  },

  getTasksForProject: (projectId) => {
    const { taskQueue } = get();
    return taskQueue.filter((t) => t.projectId === projectId);
  },

  clearHistory: () => {
    set({ taskHistory: [] });
  },

  // Execution status tracking methods
  registerExecutionMapping: (
    chatTaskId: string,
    executionId: string,
    triggerTaskId: string,
    projectId: string
  ) => {
    set((state) => {
      const newMappings = new Map(state.executionMappings);
      newMappings.set(chatTaskId, {
        chatTaskId,
        executionId,
        triggerTaskId,
        projectId,
        reported: false,
      });
      return { executionMappings: newMappings };
    });
    console.log(
      '[TriggerTaskStore] Registered execution mapping:',
      chatTaskId,
      '->',
      executionId
    );
  },

  getExecutionMapping: (chatTaskId: string) => {
    return get().executionMappings.get(chatTaskId);
  },

  removeExecutionMapping: (chatTaskId: string) => {
    set((state) => {
      const newMappings = new Map(state.executionMappings);
      newMappings.delete(chatTaskId);
      return { executionMappings: newMappings };
    });
  },
}));
