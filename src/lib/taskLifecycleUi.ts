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

import type { BottomBoxState } from '@/components/ChatBox/BottomBox';
import {
  AgentStep,
  ChatTaskStatus,
  type ChatTaskStatusType,
  SessionMode,
  type SessionModeType,
} from '@/types/constants';

/** Minimal task shape for bottom-box / sidebar lifecycle (matches chatStore Task fields used). */
export interface TaskLifecycleFields {
  messages?: Message[];
  type?: string;
  status?: ChatTaskStatusType;
  hasWaitComfirm?: boolean;
  isTakeControl?: boolean;
  taskInfo?: { id: string; content: string }[];
  isContextExceeded?: boolean;
  sessionMode?: SessionModeType;
}

function getTaskMessages(task: TaskLifecycleFields): Message[] {
  return Array.isArray(task.messages) ? task.messages : [];
}

function getTaskInfoRows(
  task: TaskLifecycleFields
): { id: string; content: string }[] {
  return Array.isArray(task.taskInfo) ? task.taskInfo : [];
}

/**
 * `'splitting'` is no longer a real `BottomBoxState` — the splitting visuals
 * moved into `PlanTaskBox`. For the sidebar/project list we still need a way to
 * recognize the pre-confirm planning window, so we compute that signal locally
 * via {@link isTaskInPlanPhase}.
 */
function isTaskInPlanPhase(task: TaskLifecycleFields): boolean {
  // Single agent runs directly — it has no task-splitting / confirm phase.
  if (task.sessionMode === SessionMode.SINGLE_AGENT) return false;
  const messages = getTaskMessages(task);
  const status = task.status ?? ChatTaskStatus.PENDING;
  const hasWaitComfirm = Boolean(task.hasWaitComfirm);
  const isTakeControl = Boolean(task.isTakeControl);

  const anyToSubTasksMessage = messages.find((m) => m.step === 'to_sub_tasks');
  const unconfirmedToSubTasks = messages.find(
    (m) => m.step === 'to_sub_tasks' && !m.isConfirm
  );

  const isSkeletonPhase =
    (status !== 'finished' &&
      !anyToSubTasksMessage &&
      !hasWaitComfirm &&
      messages.length > 0) ||
    (isTakeControl && !anyToSubTasksMessage);

  return isSkeletonPhase || Boolean(unconfirmedToSubTasks);
}

export function getBottomBoxStateForTask(
  task: TaskLifecycleFields
): BottomBoxState {
  const messages = getTaskMessages(task);
  const status = task.status ?? ChatTaskStatus.PENDING;
  const type = task.type ?? '';

  const toSubTasksMessage = messages.find(
    (m) => m.step === 'to_sub_tasks' && !m.isConfirm
  );

  if (toSubTasksMessage && !toSubTasksMessage.isConfirm) {
    return 'confirm';
  }

  if (status === ChatTaskStatus.RUNNING || status === ChatTaskStatus.PAUSE) {
    return 'running';
  }

  if (status === 'finished' && type !== '') {
    return 'finished';
  }

  return 'input';
}

/** Shelf tone for project-style task rows; finished and idle both use `default`. */
export type TaskListShelfTone = 'splitting' | 'running' | 'default';

export function getTaskListShelfTone(
  task: TaskLifecycleFields
): TaskListShelfTone {
  if (isTaskInPlanPhase(task)) return 'splitting';
  const s = getBottomBoxStateForTask(task);
  if (s === 'running') return 'running';
  if (s === 'confirm') return 'splitting';
  return 'default';
}

/**
 * Agent-reported failures and error-shaped content — excludes `isContextExceeded`
 * (use for splitting **error** vs **warning** in session chrome).
 */
export function isTaskListRowHardFailure(task: TaskLifecycleFields): boolean {
  return getTaskMessages(task).some((m) => {
    if (m.role !== 'agent') return false;
    if (m.step === AgentStep.FAILED) return true;
    const c = m.content?.trim() ?? '';
    if (c.startsWith('❌ **Error**')) return true;
    return false;
  });
}

/** Sidebar row: failures (model error, subtask failed, context limit, etc.). */
export function isTaskListRowFailureState(task: TaskLifecycleFields): boolean {
  if (task.isContextExceeded) return true;
  return isTaskListRowHardFailure(task);
}

export function isWorkforceTask(task: TaskLifecycleFields): boolean {
  const messages = getTaskMessages(task);
  const taskInfo = getTaskInfoRows(task);
  const toSubTasks = messages.filter((m) => m.step === 'to_sub_tasks');
  const latest = toSubTasks[toSubTasks.length - 1];
  if (latest?.taskType === 2) return true;
  if (taskInfo.length > 1) return true;
  return false;
}
