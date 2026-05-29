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

import type { RenderGroupMeta, WorkLogCursor } from '@/store/chatStore';
import { AgentStep } from '@/types/constants';

export type { WorkLogCursor };

/**
 * A fully-resolved render group — one user query plus all agent output and
 * work-log metadata produced for it.
 */
export interface ChatQueryGroup {
  id: string;
  taskId: string;
  kind: 'initial_query' | 'human_reply' | 'follow_up' | 'orphan';
  userMessage: Message | null;
  /** TO_SUB_TASKS message, if this group triggered workforce splitting. */
  taskMessage?: Message;
  /** All agent messages belonging to this group (excluding TO_SUB_TASKS). */
  outputMessages: Message[];
  /**
   * Work-log cursor range. When present, TaskWorkLogAccordion shows only the
   * agent-log entries produced between startCursor and endCursor.
   * When endCursor is absent the group is still active (show to current end).
   */
  workLog?: {
    taskId: string;
    startCursor: WorkLogCursor;
    endCursor?: WorkLogCursor;
    /** task.elapsed when this group opened, for per-group timer. */
    startElapsedMs?: number;
    /** task.elapsed when this group closed. Absent = still active. */
    endElapsedMs?: number;
  };
}

interface TaskLike {
  messages: Message[];
  renderGroups?: RenderGroupMeta[];
  activeRenderGroupId?: string | null;
  taskAssigning?: Agent[];
}

/**
 * Converts a task's messages + render-group metadata into an ordered list of
 * `ChatQueryGroup`s suitable for rendering.
 *
 * New data path: uses `task.renderGroups` if populated (accurate cursor slicing).
 * Legacy fallback: infers groups from message order (whole log on last group).
 */
export function normalizeTaskToQueryGroups(
  task: TaskLike,
  taskId: string
): ChatQueryGroup[] {
  const { messages, renderGroups } = task;

  if (renderGroups && renderGroups.length > 0) {
    return renderGroups.map((meta, metaIdx) => {
      const userMsg = meta.userMessageId
        ? (messages.find((m) => m.id === meta.userMessageId) ?? null)
        : null;

      const groupStartIdx = userMsg ? messages.indexOf(userMsg) : 0;

      const nextMeta = renderGroups[metaIdx + 1];
      const nextUserMsgId = nextMeta?.userMessageId;
      const rawEndIdx = nextUserMsgId
        ? messages.findIndex((m) => m.id === nextUserMsgId)
        : messages.length;

      const start = groupStartIdx < 0 ? 0 : groupStartIdx;
      const end = rawEndIdx < 0 ? messages.length : rawEndIdx;
      const groupMsgs = messages.slice(start, end);

      const taskMessage = groupMsgs.find(
        (m) => m.step === AgentStep.TO_SUB_TASKS
      );
      const outputMessages = groupMsgs.filter(
        (m) => m.role === 'agent' && m.step !== AgentStep.TO_SUB_TASKS
      );

      return {
        id: meta.id,
        taskId,
        kind: meta.kind,
        userMessage: userMsg,
        taskMessage,
        outputMessages,
        workLog: {
          taskId,
          startCursor: meta.startCursor,
          endCursor: meta.endCursor,
          startElapsedMs: meta.startElapsedMs,
          endElapsedMs: meta.endElapsedMs,
        },
      };
    });
  }

  return normalizeLegacyMessages(messages, taskId);
}

/**
 * Legacy fallback: infer query groups purely from message order.
 * Only the last group receives a workLog entry (shows the full accumulated log).
 */
function normalizeLegacyMessages(
  messages: Message[],
  taskId: string
): ChatQueryGroup[] {
  const groups: ChatQueryGroup[] = [];
  let current: ChatQueryGroup | null = null;
  const processedTaskMsgs = new Set<string>();

  messages.forEach((message, index) => {
    if (message.role === 'user') {
      if (current) groups.push(current);

      let kind: ChatQueryGroup['kind'];
      if (groups.length === 0) {
        kind = 'initial_query';
      } else {
        const prevMsg = messages[index - 1];
        if (prevMsg?.role === 'agent' && prevMsg.step === AgentStep.ASK) {
          kind = 'human_reply';
        } else {
          kind = 'follow_up';
        }
      }

      current = {
        id: message.id,
        taskId,
        kind,
        userMessage: message,
        outputMessages: [],
      };
    } else if (message.step === AgentStep.TO_SUB_TASKS) {
      if (processedTaskMsgs.has(message.id)) return;
      processedTaskMsgs.add(message.id);

      if (current && !current.taskMessage) {
        current.taskMessage = message;
      } else {
        if (current) groups.push(current);

        let correspondingUser: Message | null = null;
        for (let i = index - 1; i >= 0; i--) {
          const m = messages[i];
          if (m && m.role === 'user') {
            const alreadyTaken = groups.some(
              (g) => g.userMessage?.id === m.id && g.taskMessage
            );
            if (!alreadyTaken) {
              correspondingUser = m;
              break;
            }
          }
        }

        current = {
          id: correspondingUser ? correspondingUser.id : `task-${message.id}`,
          taskId,
          kind: 'initial_query',
          userMessage: correspondingUser,
          taskMessage: message,
          outputMessages: [],
        };
      }
    } else {
      if (!current) {
        current = {
          id: `orphan-${message.id}`,
          taskId,
          kind: 'orphan',
          userMessage: null,
          outputMessages: [],
        };
      }
      if (message.role === 'agent') {
        current.outputMessages.push(message);
      }
    }
  });

  if (current) groups.push(current);

  // Attach the full work log to only the last group (no cursor slicing for legacy data)
  const last = groups.at(-1);
  if (last) {
    last.workLog = { taskId, startCursor: {} };
  }

  return groups;
}
