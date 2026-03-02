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

import { TriggerType } from '@/types';
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
   */
  projectId: string | null;
  /** Input data from webhook request or scheduled context */
  inputData: Record<string, any>;
  /** Timestamp when the task was triggered */
  timestamp: number;
  /** Formatted message content for display and processing */
  formattedMessage?: string;
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
  /** The trigger task ID */
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

  // Skip adding context for scheduled triggers - just use the task prompt as-is
  if (task.triggerType === 'schedule') {
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
  /** Maps chat task IDs to execution IDs for status reporting */
  executionMappings: Map<string, ExecutionMapping>;

  // Execution status tracking
  /** Register a mapping between chat task ID and execution ID */
  registerExecutionMapping: (
    chatTaskId: string,
    executionId: string,
    triggerTaskId: string,
    projectId: string,
    triggerName?: string,
    triggerId?: number
  ) => void;
  /** Get execution mapping by chat task ID */
  getExecutionMapping: (chatTaskId: string) => ExecutionMapping | undefined;
  /** Remove execution mapping */
  removeExecutionMapping: (chatTaskId: string) => void;
}

export const useTriggerTaskStore = create<TriggerTaskStore>((set, get) => ({
  executionMappings: new Map(),

  registerExecutionMapping: (
    chatTaskId: string,
    executionId: string,
    triggerTaskId: string,
    projectId: string,
    _triggerName?: string,
    _triggerId?: number
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
